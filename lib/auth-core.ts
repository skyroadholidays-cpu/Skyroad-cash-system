// Authentication core – framework independent so it can be tested directly.
// Passwords: scrypt (Node built-in, memory-hard), random 16-byte salt.
// Sessions: random 32-byte token in an httpOnly cookie; only its SHA-256
// hash is stored, so a database leak does not leak live sessions.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db, UserError } from './db-core';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

const N = 16384, R = 8, P = 1, KEYLEN = 64;
export const SESSION_IDLE_DAYS = 7;       // signed out after 7 days without use
export const SESSION_MAX_DAYS = 30;       // and always after 30 days
export const MAX_FAILED_LOGINS = 5;       // per 15 minutes, per username or IP
export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function validateNewPassword(pw: string, confirm: string): void {
  if (pw.length < MIN_PASSWORD_LENGTH) throw new UserError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (pw.length > 200) throw new UserError('Password is too long.');
  if (pw !== confirm) throw new UserError('The two passwords do not match.');
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface SessionUser {
  userId: number;
  username: string;
  sessionId: string;
}

export async function isPasswordSet(): Promise<boolean> {
  const [row] = await db()<{ set: boolean }>`select bool_or(password_hash is not null) as set from skyroad.app_user`;
  return !!row?.set;
}

/** First-time password setup. Only works while no password exists. */
export async function setInitialPassword(password: string, confirm: string): Promise<void> {
  validateNewPassword(password, confirm);
  const hash = await hashPassword(password);
  const rows = await db()`
    update skyroad.app_user set password_hash = ${hash}::text, password_changed_at = now()
    where password_hash is null returning id`;
  if (rows.length === 0) throw new UserError('A password has already been set. Sign in instead.');
}

/** Checks credentials with lockout. Returns a new session token on success. */
export async function login(username: string, password: string, ip: string, userAgent: string): Promise<string> {
  const sql = db();
  // 5 failures from one IP blocks that IP; 20 failures across all IPs blocks
  // the account. Per-IP first, so a stranger guessing cannot easily lock the
  // owner out from their own devices.
  const [{ ip_failures, user_failures }] = await sql<{ ip_failures: number; user_failures: number }>`
    select count(*) filter (where ip = ${ip}::text)::int as ip_failures,
           count(*) filter (where lower(username) = lower(${username}::text))::int as user_failures
    from skyroad.login_attempt
    where not success and at > now() - interval '15 minutes'`;
  if (ip_failures >= MAX_FAILED_LOGINS || user_failures >= MAX_FAILED_LOGINS * 4) {
    throw new UserError('Too many failed attempts. Please wait 15 minutes and try again.');
  }
  const [user] = await sql<{ id: number; username: string; password_hash: string | null }>`
    select id, username, password_hash from skyroad.app_user where lower(username) = lower(${username}::text)`;
  const ok = !!user && (await verifyPassword(password, user.password_hash));
  await sql`insert into skyroad.login_attempt (username, ip, success) values (${username}::text, ${ip}::text, ${ok}::boolean)`;
  // housekeeping: keep the attempts table small
  await sql`delete from skyroad.login_attempt where at < now() - interval '30 days'`;
  if (!ok || !user) throw new UserError('Incorrect username or password.');
  return createSession(user.id, ip, userAgent);
}

export async function createSession(userId: number, ip: string, userAgent: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db()`
    insert into skyroad.session (id, user_id, expires_at, ip, user_agent)
    values (${sha256(token)}::text, ${userId}::int, now() + make_interval(days => ${SESSION_MAX_DAYS}::int),
            ${ip}::text, ${userAgent.slice(0, 300)}::text)`;
  await db()`delete from skyroad.session where expires_at < now()`;
  return token;
}

/** Validates a session token; refreshes its last-seen time (at most every 5 minutes). */
export async function validateSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const id = sha256(token);
  const [row] = await db()<{ user_id: number; username: string; stale: boolean }>`
    select s.user_id, u.username, (s.last_seen_at < now() - interval '5 minutes') as stale
    from skyroad.session s join skyroad.app_user u on u.id = s.user_id
    where s.id = ${id}::text and s.expires_at > now()
      and s.last_seen_at > now() - make_interval(days => ${SESSION_IDLE_DAYS}::int)`;
  if (!row) return null;
  if (row.stale) await db()`update skyroad.session set last_seen_at = now() where id = ${id}::text`;
  return { userId: row.user_id, username: row.username, sessionId: id };
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db()`delete from skyroad.session where id = ${sha256(token)}::text`;
}

export async function signOutOtherSessions(user: SessionUser): Promise<number> {
  const rows = await db()`delete from skyroad.session where user_id = ${user.userId}::int and id <> ${user.sessionId}::text returning id`;
  return rows.length;
}

export async function listSessions(user: SessionUser) {
  return db()<{ id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string; current: boolean }>`
    select id, created_at::text, last_seen_at::text, ip, user_agent, (id = ${user.sessionId}::text) as current
    from skyroad.session where user_id = ${user.userId}::int and expires_at > now()
    order by last_seen_at desc`;
}

/** Changes the password and signs out every other device. */
export async function changePassword(user: SessionUser, current: string, next: string, confirm: string): Promise<void> {
  const [row] = await db()<{ password_hash: string }>`select password_hash from skyroad.app_user where id = ${user.userId}::int`;
  if (!(await verifyPassword(current, row?.password_hash))) throw new UserError('Your current password is incorrect.');
  validateNewPassword(next, confirm);
  if (next === current) throw new UserError('The new password must be different from the current one.');
  const hash = await hashPassword(next);
  await db().begin(async (tx) => {
    await tx`update skyroad.app_user set password_hash = ${hash}::text, password_changed_at = now() where id = ${user.userId}::int`;
    await tx`delete from skyroad.session where user_id = ${user.userId}::int and id <> ${user.sessionId}::text`;
  });
}

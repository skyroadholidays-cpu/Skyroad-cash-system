// Sets (or resets) the Skyroadholidays password directly in the database and
// signs out every device. Use this if you forget your password.
// Usage: npm run set-password
import { randomBytes, scryptSync } from 'node:crypto';
import readline from 'node:readline';
import postgres from 'postgres';
import { connectOptions } from './_env.mjs';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Put it in .env.local (see .env.example).');
  process.exit(1);
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); }; // hide typed characters
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

const pw = await ask('New password (min 8 characters): ');
const confirm = await ask('Type it again: ');
if (pw.length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }
if (pw !== confirm) { console.error('Passwords do not match.'); process.exit(1); }

const N = 16384, r = 8, p = 1;
const salt = randomBytes(16);
const key = scryptSync(pw, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
const hash = `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;

const sql = postgres(process.env.DATABASE_URL, connectOptions());
try {
  const rows = await sql`update skyroad.app_user set password_hash = ${hash}, password_changed_at = now()
                         where lower(username) = 'skyroadholidays' returning id`;
  if (!rows.length) throw new Error('User not found – has the migration been run?');
  await sql`delete from skyroad.session where user_id = ${rows[0].id}`;
  await sql`delete from skyroad.login_attempt`;
  console.log('✓ Password updated. All devices have been signed out; sign in again with the new password.');
} catch (e) {
  console.error('Failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

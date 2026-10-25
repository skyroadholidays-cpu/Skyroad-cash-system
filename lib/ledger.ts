// Ledger: transactions, bookings, cash locations, cash counts.
// All writes go through withTx() so the audit log records who changed what,
// and every balance is re-derived from the txn table by the database views.
import type { Sql } from './sql-types';
import { db, withTx, UserError } from './db-core';
import { parseAmount, parsePositiveAmount } from './money';
import { isIsoDate, todayIST, addDays } from './dates';

import { TXN_TYPES, type TxnType, type Account, type EntryFor } from './constants';
import { partyOwningTxn } from './parties';
export * from './constants';

// ───────────────────────────── input parsing ─────────────────────────────

export type Getter = (key: string) => string | undefined;
export const getterFrom = (src: FormData | Record<string, unknown>): Getter => (key) => {
  const v = src instanceof FormData ? src.get(key) : (src as Record<string, unknown>)[key];
  if (v === null || v === undefined) return undefined;
  return typeof v === 'string' ? v : String(v);
};

const text = (v: string | undefined, max = 500): string | null => {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (s.length > max) throw new UserError(`Text is too long (max ${max} characters).`);
  return s;
};
const intOrNull = (v: string | undefined): number | null => {
  if (!v || !/^\d{1,9}$/.test(v.trim())) return null;
  return Number(v.trim());
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TxnInput {
  txn_date: string;
  type: TxnType;
  amount: string;
  booking_ref: string | null;
  client_name: string | null;
  supplier_name: string | null;
  service_provider: string | null;
  description: string | null;
  category: string | null;
  notes: string | null;
  location_id: number | null;
  from_location_id: number | null;
  to_location_id: number | null;
  settles_id: string | null;
  due_date: string | null;
  account: Account;
}

/** Validates a transaction form. Throws UserError with a readable message. */
export function parseTxnInput(get: Getter, today = todayIST()): TxnInput {
  const type = get('type') as TxnType;
  if (!TXN_TYPES.includes(type)) throw new UserError('Choose a transaction type.');

  const amount = parsePositiveAmount(get('amount'));
  if (!amount) throw new UserError('Enter an amount greater than zero, e.g. 25000 or 25,000.50 (max 2 decimals).');

  const txn_date = (get('txn_date') ?? '').trim();
  if (!isIsoDate(txn_date) || txn_date < '2000-01-01') throw new UserError('Enter a valid transaction date.');
  const isCash = type === 'cash_in' || type === 'cash_out' || type === 'transfer';
  if (isCash && txn_date > today) throw new UserError('Cash entries cannot be dated in the future.');

  const dueRaw = (get('due_date') ?? '').trim();
  const due_date = dueRaw ? (isIsoDate(dueRaw) ? dueRaw : null) : null;
  if (dueRaw && !due_date) throw new UserError('Enter a valid due date.');

  const settlesRaw = (get('settles_id') ?? '').trim();
  const settles_id = settlesRaw && UUID_RE.test(settlesRaw) ? settlesRaw : null;

  const input: TxnInput = {
    txn_date, type, amount,
    booking_ref: text(get('booking_ref'), 40),
    client_name: text(get('client_name'), 120),
    supplier_name: text(get('supplier_name'), 120),
    service_provider: text(get('service_provider'), 120),
    description: text(get('description'), 300),
    category: text(get('category'), 60),
    notes: text(get('notes'), 2000),
    location_id: intOrNull(get('location_id')),
    from_location_id: intOrNull(get('from_location_id')),
    to_location_id: intOrNull(get('to_location_id')),
    settles_id,
    due_date,
    account: 'business',
  };

  // Clear fields that do not apply, so stale values never slip through after a type change.
  if (type === 'cash_in' || type === 'cash_out') {
    input.from_location_id = input.to_location_id = null;
    input.due_date = null;
    if (!input.location_id) throw new UserError('Choose which cash location the money ' + (type === 'cash_in' ? 'went into.' : 'came out of.'));
  } else if (type === 'transfer') {
    input.location_id = null;
    input.settles_id = null;
    input.due_date = null;
    if (!input.from_location_id || !input.to_location_id) throw new UserError('Choose both the "from" and "to" cash locations.');
    if (input.from_location_id === input.to_location_id) throw new UserError('Transfer locations must be different.');
  } else {
    input.location_id = input.from_location_id = input.to_location_id = null;
    input.settles_id = null;
  }

  // "Entry for": Skyroad booking / Skyroad – no booking / Home – personal.
  // Applies to Cash In, Cash Out, Collection Due and Payment Due (not transfers).
  // Older callers that don't send it are inferred from the booking field.
  if (type !== 'transfer') {
    const raw = get('entry_for');
    const entryFor: EntryFor = raw === 'home' || raw === 'business' || raw === 'booking'
      ? raw : input.booking_ref ? 'booking' : 'business';
    if (entryFor === 'home') {
      input.account = 'home';
      input.booking_ref = null;
    } else if (entryFor === 'business') {
      input.booking_ref = null;
    } else if (!input.booking_ref && !input.settles_id) {
      throw new UserError('Enter the booking reference, or choose "Skyroad – no booking" / "Home / personal".');
    }
  }

  if (type === 'collection_due' && !input.client_name && !input.booking_ref)
    throw new UserError('Enter who owes this money (client or person name) or a booking reference.');
  if (type === 'payment_due' && !input.supplier_name)
    throw new UserError('Enter who you need to pay (supplier, employee or payee name).');
  return input;
}

/** A payment must be on the same side (Skyroad / Home) as the amount it settles. */
async function checkSettlementSide(tx: Sql, input: TxnInput): Promise<void> {
  if (!input.settles_id) return;
  const [d] = await tx<{ account: string }>`select account from skyroad.txn where id = ${input.settles_id}::uuid and deleted_at is null`;
  if (!d) throw new UserError('The amount this payment was linked to no longer exists.');
  if (d.account !== input.account) {
    throw new UserError(d.account === 'home'
      ? 'That is a Home / personal amount – choose "Home / personal" for this entry.'
      : 'That is a Skyroad amount – choose "Skyroad booking" or "Skyroad – no booking" for this entry.');
  }
}

async function resolveBookingId(tx: Sql, ref: string | null): Promise<number | null> {
  if (!ref) return null;
  const [b] = await tx<{ id: number }>`select id from skyroad.booking where lower(booking_ref) = lower(${ref}::text)`;
  if (!b) throw new UserError(`Booking "${ref}" was not found. Create the booking first or clear the field.`);
  return b.id;
}

// ───────────────────────────── transactions ─────────────────────────────

export interface SaveResult {
  id: string;
  txn_no: string;
  duplicate?: boolean;
}

export async function createTxn(actor: string, input: TxnInput, idempotencyKey?: string | null): Promise<SaveResult> {
  const idem = idempotencyKey && idempotencyKey.length <= 100 ? idempotencyKey : null;
  if (idem) {
    const [dup] = await db()<SaveResult>`select id::text, txn_no from skyroad.txn where idempotency_key = ${idem}::text`;
    if (dup) return { ...dup, duplicate: true };
  }
  try {
    return await withTx(actor, async (tx) => {
      await checkSettlementSide(tx, input);
      const bookingId = await resolveBookingId(tx, input.booking_ref);
      const [row] = await tx<SaveResult>`
        insert into skyroad.txn (txn_date, type, amount, booking_id, client_name, supplier_name, service_provider,
          description, category, notes, location_id, from_location_id, to_location_id, settles_id, due_date,
          account, idempotency_key, created_by, updated_by)
        values (${input.txn_date}::date, ${input.type}::skyroad.txn_type, ${input.amount}::numeric, ${bookingId}::int,
          ${input.client_name}::text, ${input.supplier_name}::text, ${input.service_provider}::text,
          ${input.description}::text, ${input.category}::text, ${input.notes}::text,
          ${input.location_id}::int, ${input.from_location_id}::int, ${input.to_location_id}::int,
          ${input.settles_id}::uuid, ${input.due_date}::date, ${input.account}::text, ${idem}::text, ${actor}::text, ${actor}::text)
        returning id::text, txn_no`;
      return row;
    });
  } catch (e: any) {
    // Two submits raced past the pre-check: return the one that won.
    if (idem && e?.code === '23505' && String(e?.constraint_name ?? '').includes('idempotency')) {
      const [dup] = await db()<SaveResult>`select id::text, txn_no from skyroad.txn where idempotency_key = ${idem}::text`;
      if (dup) return { ...dup, duplicate: true };
    }
    throw e;
  }
}

export async function updateTxn(actor: string, id: string, input: TxnInput): Promise<SaveResult> {
  if (!UUID_RE.test(id)) throw new UserError('Transaction not found.');
  return withTx(actor, async (tx) => {
    const [cur] = await tx<{ type: TxnType; is_package_due: boolean; settles_id: string | null }>`
      select type, is_package_due, settles_id::text from skyroad.txn where id = ${id}::uuid and deleted_at is null for update`;
    if (!cur) throw new UserError('This transaction no longer exists (it may have been deleted on another device).');
    const owner = await partyOwningTxn(tx, id);
    if (owner) throw new UserError(`This cash entry belongs to ${owner.name}'s party account – edit it from Parties so both stay in step.`);
    if (cur.is_package_due && input.type !== 'collection_due')
      throw new UserError('This is the booking\'s package receivable – change it from the booking instead.');
    if (input.settles_id === id) throw new UserError('A transaction cannot settle itself.');
    await checkSettlementSide(tx, input);
    const bookingId = await resolveBookingId(tx, input.booking_ref);
    const [row] = await tx<SaveResult>`
      update skyroad.txn set
        txn_date = ${input.txn_date}::date, type = ${input.type}::skyroad.txn_type, amount = ${input.amount}::numeric,
        booking_id = ${bookingId}::int, client_name = ${input.client_name}::text, supplier_name = ${input.supplier_name}::text,
        service_provider = ${input.service_provider}::text, description = ${input.description}::text,
        category = ${input.category}::text, notes = ${input.notes}::text,
        location_id = ${input.location_id}::int, from_location_id = ${input.from_location_id}::int,
        to_location_id = ${input.to_location_id}::int, settles_id = ${input.settles_id}::uuid,
        due_date = ${input.due_date}::date, account = ${input.account}::text, updated_by = ${actor}::text
      where id = ${id}::uuid and deleted_at is null
      returning id::text, txn_no`;
    return row;
  });
}

export async function softDeleteTxn(actor: string, id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw new UserError('Transaction not found.');
  await withTx(actor, async (tx) => {
    const [cur] = await tx<{ is_package_due: boolean }>`
      select is_package_due from skyroad.txn where id = ${id}::uuid and deleted_at is null for update`;
    if (!cur) throw new UserError('This transaction was already deleted.');
    const owner = await partyOwningTxn(tx, id);
    if (owner) throw new UserError(`This cash entry belongs to ${owner.name}'s party account – delete it from Parties so both stay in step.`);
    await tx`update skyroad.txn set deleted_at = now(), deleted_by = ${actor}::text where id = ${id}::uuid`;
  });
}

export async function restoreTxn(actor: string, id: string): Promise<void> {
  if (!UUID_RE.test(id)) throw new UserError('Transaction not found.');
  await withTx(actor, async (tx) => {
    const owner = await partyOwningTxn(tx, id);
    if (owner) throw new UserError(`This cash entry belongs to ${owner.name}'s party account – restore it from Parties.`);
    const rows = await tx`update skyroad.txn set deleted_at = null, deleted_by = null, updated_by = ${actor}::text
                          where id = ${id}::uuid and deleted_at is not null returning id`;
    if (rows.length === 0) throw new UserError('Nothing to restore.');
  });
}

const TXN_COLUMNS = `id, txn_no, txn_date, type, amount, booking_id, booking_ref, client_name, supplier_name, service_provider,
  description, category, notes, location_id, location_name, from_location_id, from_location_name, to_location_id,
  to_location_name, settles_id, settles_txn_no, due_date, is_package_due, created_at, updated_at, created_by, updated_by`;
void TXN_COLUMNS;

export interface TxnRow {
  id: string; txn_no: string; txn_date: string; type: TxnType; amount: string;
  booking_id: number | null; booking_ref: string | null; client_name: string | null; supplier_name: string | null;
  service_provider: string | null; description: string | null; category: string | null; notes: string | null;
  location_id: number | null; location_name: string | null; from_location_id: number | null; from_location_name: string | null;
  to_location_id: number | null; to_location_name: string | null; settles_id: string | null; settles_txn_no: string | null;
  due_date: string | null; is_package_due: boolean; created_at: string; updated_at: string;
  created_by: string | null; updated_by: string | null; account: Account;
  settled?: string; outstanding?: string; settle_status?: string; last_settled_on?: string | null;
}

export type Scope = 'skyroad' | 'booking' | 'business' | 'home';
export const SCOPES: Scope[] = ['skyroad', 'booking', 'business', 'home'];
export const parseScope = (v: unknown): Scope | null => (SCOPES.includes(v as Scope) ? (v as Scope) : null);

export interface TxnFilters {
  q?: string | null;
  type?: TxnType | null;
  location_id?: number | null;
  booking_id?: number | null;
  /** 'skyroad' = all business, 'booking' / 'business' = with / without a booking, 'home' = home / personal */
  scope?: Scope | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export async function listTxns(f: TxnFilters): Promise<{ rows: TxnRow[]; total: number }> {
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const type = f.type && TXN_TYPES.includes(f.type) ? f.type : null;
  const from = isIsoDate(f.from) ? f.from : null;
  const to = isIsoDate(f.to) ? f.to : null;
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 5000);
  const offset = Math.max(f.offset ?? 0, 0);
  const rows = await db()<TxnRow & { total: number }>`
    select t.id::text, t.txn_no, t.txn_date::text, t.type::text, t.amount::text, t.booking_id, t.booking_ref,
           t.client_name, t.supplier_name, t.service_provider, t.description, t.category, t.notes,
           t.location_id, t.location_name, t.from_location_id, t.from_location_name, t.to_location_id, t.to_location_name,
           t.settles_id::text, t.settles_txn_no, t.due_date::text, t.is_package_due, t.created_at::text, t.updated_at::text,
           t.created_by, t.updated_by, t.account, d.settled::text, d.outstanding::text, d.settle_status,
           count(*) over ()::int as total
    from skyroad.v_txn t
    left join skyroad.v_due d on d.id = t.id
    where (${type}::text is null or t.type::text = ${type}::text)
      and (${from}::date is null or t.txn_date >= ${from}::date)
      and (${to}::date is null or t.txn_date <= ${to}::date)
      and (${f.location_id ?? null}::int is null or ${f.location_id ?? null}::int in (t.location_id, t.from_location_id, t.to_location_id))
      and (${f.booking_id ?? null}::int is null or t.booking_id = ${f.booking_id ?? null}::int)
      and case ${parseScope(f.scope)}::text
            when 'skyroad'  then t.account = 'business'
            when 'booking'  then t.account = 'business' and t.booking_id is not null
            when 'business' then t.account = 'business' and t.booking_id is null
            when 'home'     then t.account = 'home'
            else true end
      and (${q}::text is null or t.txn_no ilike ${q}::text or t.client_name ilike ${q}::text
           or t.supplier_name ilike ${q}::text or t.service_provider ilike ${q}::text
           or t.booking_ref ilike ${q}::text or t.description ilike ${q}::text or t.notes ilike ${q}::text
           or t.category ilike ${q}::text)
    order by t.txn_date desc, t.created_at desc
    limit ${limit}::int offset ${offset}::int`;
  return { rows, total: rows[0]?.total ?? 0 };
}

export async function getTxn(id: string) {
  if (!UUID_RE.test(id)) return null;
  const [t] = await db()<TxnRow & { deleted_at: string | null; deleted_by: string | null }>`
    select t.id::text, t.txn_no, t.txn_date::text, t.type::text, t.amount::text, t.booking_id, b.booking_ref,
           t.client_name, t.supplier_name, t.service_provider, t.description, t.category, t.notes,
           t.location_id, l.name as location_name, t.from_location_id, lf.name as from_location_name,
           t.to_location_id, lt.name as to_location_name, t.settles_id::text, d.txn_no as settles_txn_no,
           t.due_date::text, t.is_package_due, t.created_at::text, t.updated_at::text, t.created_by, t.updated_by,
           t.deleted_at::text, t.deleted_by, t.account, vd.settled::text, vd.outstanding::text, vd.settle_status,
           vd.last_settled_on::text
    from skyroad.txn t
    left join skyroad.booking b on b.id = t.booking_id
    left join skyroad.cash_location l on l.id = t.location_id
    left join skyroad.cash_location lf on lf.id = t.from_location_id
    left join skyroad.cash_location lt on lt.id = t.to_location_id
    left join skyroad.txn d on d.id = t.settles_id
    left join skyroad.v_due vd on vd.id = t.id
    where t.id = ${id}::uuid`;
  if (!t) return null;
  const settlements = await db()<TxnRow>`
    select id::text, txn_no, txn_date::text, type::text, amount::text, location_name, notes, description
    from skyroad.v_txn where settles_id = ${id}::uuid order by txn_date, created_at`;
  const rawHistory = await db()<{ at: string; actor: string | null; action: string; old_data: string | null; new_data: string | null }>`
    select at::text, actor, action, old_data::text, new_data::text from skyroad.audit_log
    where table_name = 'txn' and record_id = ${id}::text order by at desc, id desc limit 50`;
  const history = rawHistory.map((h) => ({ ...h, changes: diffAudit(h.old_data, h.new_data) }));
  return { txn: t, settlements, history };
}

const AUDIT_IGNORE = new Set(['updated_at', 'updated_by', 'created_at', 'created_by', 'idempotency_key', 'deleted_by']);

/** Field-level differences between two audit snapshots. */
export function diffAudit(oldJson: string | null, newJson: string | null): { field: string; from: unknown; to: unknown }[] {
  const o = oldJson ? JSON.parse(oldJson) : {};
  const n = newJson ? JSON.parse(newJson) : {};
  if (!oldJson || !newJson) return [];
  return Object.keys({ ...o, ...n })
    .filter((k) => !AUDIT_IGNORE.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => ({ field: k, from: o[k], to: n[k] }));
}

export async function listDeletedTxns(limit = 100) {
  return db()<TxnRow & { deleted_at: string; deleted_by: string | null }>`
    select t.id::text, t.txn_no, t.txn_date::text, t.type::text, t.amount::text, b.booking_ref, t.client_name,
           t.supplier_name, t.description, t.deleted_at::text, t.deleted_by
    from skyroad.txn t left join skyroad.booking b on b.id = t.booking_id
    where t.deleted_at is not null order by t.deleted_at desc limit ${limit}::int`;
}

// ───────────────────────────── dues (to collect / to pay) ─────────────────────────────

export type DueKind = 'collection_due' | 'payment_due';
export type DueFilter = 'open' | 'today' | 'overdue' | 'week' | 'settled' | 'all';

export interface DueRow extends TxnRow {
  settled: string; outstanding: string; settle_status: string; last_settled_on: string | null;
  package_amount: string | null; is_overdue: boolean;
}

export async function listDues(kind: DueKind, filter: DueFilter, q?: string | null, today = todayIST(), scope?: Scope | null): Promise<DueRow[]> {
  const like = q?.trim() ? `%${q.trim()}%` : null;
  const week = addDays(today, 7);
  return db()<DueRow>`
    select d.id::text, d.txn_no, d.txn_date::text, d.type::text, d.amount::text, d.booking_id, d.booking_ref,
           d.client_name, d.supplier_name, d.service_provider, d.description, d.category, d.notes,
           d.due_date::text, d.is_package_due, d.settled::text, d.outstanding::text, d.settle_status,
           d.last_settled_on::text, b.package_amount::text, d.account,
           (d.outstanding > 0 and d.due_date < ${today}::date) as is_overdue
    from skyroad.v_due d left join skyroad.booking b on b.id = d.booking_id
    where d.type::text = ${kind}::text
      and case ${filter}::text
            when 'open'    then d.outstanding > 0
            when 'today'   then d.outstanding > 0 and d.due_date = ${today}::date
            when 'overdue' then d.outstanding > 0 and d.due_date < ${today}::date
            when 'week'    then d.outstanding > 0 and d.due_date between ${today}::date and ${week}::date
            when 'settled' then d.outstanding = 0
            else true end
      and (${like}::text is null or d.client_name ilike ${like}::text or d.booking_ref ilike ${like}::text
           or d.supplier_name ilike ${like}::text or d.service_provider ilike ${like}::text
           or d.txn_no ilike ${like}::text or d.description ilike ${like}::text)
      and case ${parseScope(scope)}::text
            when 'skyroad'  then d.account = 'business'
            when 'booking'  then d.account = 'business' and d.booking_id is not null
            when 'business' then d.account = 'business' and d.booking_id is null
            when 'home'     then d.account = 'home'
            else true end
    order by (d.outstanding = 0), d.due_date nulls last, d.txn_date`;
}

/** Open dues for the transaction form's "settles" picker. */
export async function openDuesForPicker() {
  return db()<{ id: string; type: DueKind; txn_no: string; booking_ref: string | null; client_name: string | null;
                supplier_name: string | null; service_provider: string | null; outstanding: string; due_date: string | null;
                description: string | null; account: Account }>`
    select id::text, type::text, txn_no, booking_ref, client_name, supplier_name, service_provider,
           outstanding::text, due_date::text, description, account
    from skyroad.v_due where outstanding > 0 order by due_date nulls last, txn_date limit 1000`;
}

export async function getDue(id: string) {
  if (!UUID_RE.test(id)) return null;
  const [d] = await db()<DueRow>`
    select d.id::text, d.txn_no, d.type::text, d.amount::text, d.booking_ref, d.client_name, d.supplier_name,
           d.service_provider, d.description, d.due_date::text, d.settled::text, d.outstanding::text, d.settle_status,
           d.account, d.booking_id
    from skyroad.v_due d where d.id = ${id}::uuid`;
  return d ?? null;
}

/** Records a full or partial collection/payment against a due. */
export async function settleDue(actor: string, dueId: string, get: Getter, idem?: string | null): Promise<SaveResult> {
  const due = await getDue(dueId);
  if (!due) throw new UserError('That receivable/payable no longer exists.');
  const type: TxnType = due.type === 'collection_due' ? 'cash_in' : 'cash_out';
  const input = parseTxnInput((k) => {
    if (k === 'type') return type;
    if (k === 'settles_id') return dueId;
    if (k === 'entry_for') return due.account === 'home' ? 'home' : due.booking_ref ? 'booking' : 'business';
    if (k === 'booking_ref') return due.booking_ref ?? undefined;
    if (k === 'category') return get('category') || (type === 'cash_in' ? 'Client collection' : 'Supplier payment');
    if (k === 'description') return get('description') || `${type === 'cash_in' ? 'Collection' : 'Payment'} against ${due.txn_no}`;
    return get(k);
  });
  return createTxn(actor, input, idem);
}

// ───────────────────────────── bookings ─────────────────────────────

export interface BookingInput {
  booking_ref: string;
  client_name: string;
  destination: string | null;
  travel_start: string | null;
  travel_end: string | null;
  package_amount: string;
  status: 'active' | 'completed' | 'cancelled';
  notes: string | null;
}

export function parseBookingInput(get: Getter): BookingInput {
  const booking_ref = text(get('booking_ref'), 40);
  if (!booking_ref) throw new UserError('Enter a booking reference.');
  const client_name = text(get('client_name'), 120);
  if (!client_name) throw new UserError('Enter the client or company name.');
  const pkgRaw = (get('package_amount') ?? '').trim();
  const package_amount = pkgRaw ? parseAmount(pkgRaw) : '0.00';
  if (package_amount === null) throw new UserError('Enter a valid package amount (e.g. 125000 or 1,25,000).');
  const ts = (get('travel_start') ?? '').trim(), te = (get('travel_end') ?? '').trim();
  if (ts && !isIsoDate(ts)) throw new UserError('Enter a valid travel start date.');
  if (te && !isIsoDate(te)) throw new UserError('Enter a valid travel end date.');
  if (ts && te && te < ts) throw new UserError('Travel end date cannot be before the start date.');
  const status = (get('status') ?? 'active') as BookingInput['status'];
  if (!['active', 'completed', 'cancelled'].includes(status)) throw new UserError('Choose a valid booking status.');
  return {
    booking_ref, client_name, destination: text(get('destination'), 120),
    travel_start: ts || null, travel_end: te || null, package_amount, status, notes: text(get('notes'), 2000),
  };
}

export interface Advance {
  amount: string;
  date: string;
  locationId: number;
}

export interface BookingExtras {
  createReceivable: boolean;          // raise the package amount as a client receivable
  dueDate: string | null;             // expected collection date for that receivable
  advances: Advance[];                // advances already received (one or many)
}

/**
 * Reads the booking form's extras. Advances come as numbered rows
 * (advance_amount_0, advance_date_0, advance_location_id_0, …); fully empty rows
 * are ignored. A single un-numbered advance_amount is still accepted.
 */
export function parseBookingExtras(get: Getter, today = todayIST()): BookingExtras {
  const dueDate = (get('due_date') ?? '').trim();
  if (dueDate && !isIsoDate(dueDate)) throw new UserError('Enter a valid expected collection date.');
  const count = Math.min(intOrNull(get('advance_count')) ?? 0, 30);
  const rows: { amount?: string; date?: string; loc?: string; n: number }[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ amount: get(`advance_amount_${i}`), date: get(`advance_date_${i}`), loc: get(`advance_location_id_${i}`), n: i + 1 });
  }
  if (get('advance_amount') !== undefined) {
    rows.push({ amount: get('advance_amount'), date: get('advance_date') ?? today, loc: get('advance_location_id'), n: rows.length + 1 });
  }
  const advances: Advance[] = [];
  for (const r of rows) {
    const raw = (r.amount ?? '').trim();
    if (!raw) continue;
    const label = rows.length > 1 ? `advance ${r.n}` : 'the advance';
    const amount = parsePositiveAmount(raw);
    if (!amount) throw new UserError(`Enter a valid amount for ${label}.`);
    const date = (r.date ?? '').trim() || today;
    if (!isIsoDate(date) || date < '2000-01-01') throw new UserError(`Enter a valid date for ${label}.`);
    if (date > today) throw new UserError(`The date for ${label} cannot be in the future.`);
    const locationId = intOrNull(r.loc);
    if (!locationId) throw new UserError(`Choose where the cash for ${label} was kept.`);
    advances.push({ amount, date, locationId });
  }
  return {
    createReceivable: get('create_receivable') === 'on' || get('create_receivable') === 'true',
    dueDate: dueDate || null,
    advances,
  };
}

export async function createBooking(actor: string, input: BookingInput, extras: BookingExtras, idem?: string | null): Promise<{ id: number; duplicate?: boolean }> {
  if (idem) {
    const [dup] = await db()<{ booking_id: number }>`select booking_id from skyroad.txn where idempotency_key = ${'bk:' + idem}::text`;
    if (dup?.booking_id) return { id: dup.booking_id, duplicate: true };
    const [dupB] = await db()<{ id: number }>`select id from skyroad.booking where lower(booking_ref) = lower(${input.booking_ref}::text)
      and created_at > now() - interval '2 minutes'`;
    if (dupB) return { id: dupB.id, duplicate: true };
  }
  if (extras.advances.length && !(extras.createReceivable && Number(input.package_amount) > 0))
    throw new UserError('To record advances, enter the package amount and tick "Raise the package amount as a client receivable".');
  const paise = (v: string) => Math.round(Number(v) * 100);
  const advTotal = extras.advances.reduce((t, a) => t + paise(a.amount), 0);
  if (advTotal > paise(input.package_amount))
    throw new UserError(`The advances add up to ₹${(advTotal / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}, which is more than the package amount.`);
  return withTx(actor, async (tx) => {
    const [b] = await tx<{ id: number }>`
      insert into skyroad.booking (booking_ref, client_name, destination, travel_start, travel_end, package_amount, status, notes, created_by, updated_by)
      values (${input.booking_ref}::text, ${input.client_name}::text, ${input.destination}::text, ${input.travel_start}::date,
              ${input.travel_end}::date, ${input.package_amount}::numeric, ${input.status}::text, ${input.notes}::text, ${actor}::text, ${actor}::text)
      returning id`;
    if (extras.createReceivable && Number(input.package_amount) > 0) {
      // The receivable is dated no later than the first advance, so history reads in order.
      const raisedOn = [todayIST(), ...extras.advances.map((a) => a.date)].sort()[0];
      const [due] = await tx<{ id: string }>`
        insert into skyroad.txn (txn_date, type, amount, booking_id, client_name, description, category, is_package_due,
                                 due_date, idempotency_key, created_by, updated_by)
        values (${raisedOn}::date, 'collection_due', ${input.package_amount}::numeric, ${b.id}::int, ${input.client_name}::text,
                ${'Package amount – ' + input.booking_ref}::text, 'Package payment', true, ${extras.dueDate ?? input.travel_start}::date,
                ${idem ? 'bk:' + idem : null}::text, ${actor}::text, ${actor}::text)
        returning id::text`;
      const ordered = [...extras.advances].sort((a, b) => a.date.localeCompare(b.date));
      for (const [i, adv] of ordered.entries()) {
        await tx`
          insert into skyroad.txn (txn_date, type, amount, booking_id, client_name, description, category, location_id,
                                   settles_id, created_by, updated_by)
          values (${adv.date}::date, 'cash_in', ${adv.amount}::numeric, ${b.id}::int, ${input.client_name}::text,
                  ${(ordered.length > 1 ? `Advance ${i + 1} – ` : 'Advance – ') + input.booking_ref}::text, 'Advance received',
                  ${adv.locationId}::int, ${due.id}::uuid, ${actor}::text, ${actor}::text)`;
      }
    }
    return { id: b.id };
  });
}

export async function updateBooking(actor: string, id: number, input: BookingInput, extras: BookingExtras): Promise<void> {
  await withTx(actor, async (tx) => {
    const rows = await tx`
      update skyroad.booking set booking_ref = ${input.booking_ref}::text, client_name = ${input.client_name}::text,
        destination = ${input.destination}::text, travel_start = ${input.travel_start}::date, travel_end = ${input.travel_end}::date,
        package_amount = ${input.package_amount}::numeric, status = ${input.status}::text, notes = ${input.notes}::text,
        updated_by = ${actor}::text
      where id = ${id}::int returning id`;
    if (rows.length === 0) throw new UserError('Booking not found.');
    const [pkg] = await tx<{ id: string }>`
      select id::text from skyroad.txn where booking_id = ${id}::int and is_package_due and deleted_at is null for update`;
    if (pkg) {
      // Keep the package receivable in step with the package amount.
      if (Number(input.package_amount) > 0) {
        await tx`update skyroad.txn set amount = ${input.package_amount}::numeric, client_name = ${input.client_name}::text,
                   description = ${'Package amount – ' + input.booking_ref}::text,
                   due_date = coalesce(${extras.dueDate}::date, due_date), updated_by = ${actor}::text
                 where id = ${pkg.id}::uuid`;
      } else {
        await tx`update skyroad.txn set deleted_at = now(), deleted_by = ${actor}::text where id = ${pkg.id}::uuid`;
      }
    } else if (extras.createReceivable && Number(input.package_amount) > 0) {
      await tx`
        insert into skyroad.txn (txn_date, type, amount, booking_id, client_name, description, category, is_package_due, due_date, created_by, updated_by)
        values (${todayIST()}::date, 'collection_due', ${input.package_amount}::numeric, ${id}::int, ${input.client_name}::text,
                ${'Package amount – ' + input.booking_ref}::text, 'Package payment', true,
                ${extras.dueDate ?? input.travel_start}::date, ${actor}::text, ${actor}::text)`;
    }
  });
}

export async function deleteBooking(actor: string, id: number): Promise<void> {
  await withTx(actor, async (tx) => {
    const [{ n }] = await tx<{ n: number }>`select count(*)::int as n from skyroad.txn where booking_id = ${id}::int`;
    if (n > 0) throw new UserError('This booking has transactions (including deleted ones in Trash), so it cannot be deleted. Set its status to "Cancelled" instead.');
    await tx`delete from skyroad.booking where id = ${id}::int`;
  });
}

export interface BookingSummary {
  id: number; booking_ref: string; client_name: string; destination: string | null;
  travel_start: string | null; travel_end: string | null; package_amount: string; status: string; notes: string | null;
  receivable_total: string; received: string; to_collect: string; supplier_cost: string; supplier_paid: string;
  supplier_outstanding: string; other_expenses: string; cash_paid: string; cash_balance: string;
  unbilled_amount: string; expected_margin: string; last_activity: string | null; created_at: string; updated_at: string;
}

const BOOKING_SELECT = `id, booking_ref, client_name, destination, travel_start::text, travel_end::text, package_amount::text, status, notes,
  receivable_total::text, received::text, to_collect::text, supplier_cost::text, supplier_paid::text, supplier_outstanding::text,
  other_expenses::text, cash_paid::text, cash_balance::text, unbilled_amount::text, expected_margin::text, last_activity::text,
  created_at::text, updated_at::text`;
void BOOKING_SELECT;

export async function listBookings(q?: string | null, status?: string | null): Promise<BookingSummary[]> {
  const like = q?.trim() ? `%${q.trim()}%` : null;
  const st = status && ['active', 'completed', 'cancelled'].includes(status) ? status : null;
  return db()<BookingSummary>`
    select id, booking_ref, client_name, destination, travel_start::text, travel_end::text, package_amount::text, status, notes,
      receivable_total::text, received::text, to_collect::text, supplier_cost::text, supplier_paid::text, supplier_outstanding::text,
      other_expenses::text, cash_paid::text, cash_balance::text, unbilled_amount::text, expected_margin::text, last_activity::text,
      created_at::text, updated_at::text
    from skyroad.v_booking_summary
    where (${st}::text is null or status = ${st}::text)
      and (${like}::text is null or booking_ref ilike ${like}::text or client_name ilike ${like}::text or destination ilike ${like}::text)
    order by coalesce(travel_start, created_at::date) desc, id desc
    limit 1000`;
}

export async function getBooking(id: number) {
  const [b] = await db()<BookingSummary>`
    select id, booking_ref, client_name, destination, travel_start::text, travel_end::text, package_amount::text, status, notes,
      receivable_total::text, received::text, to_collect::text, supplier_cost::text, supplier_paid::text, supplier_outstanding::text,
      other_expenses::text, cash_paid::text, cash_balance::text, unbilled_amount::text, expected_margin::text, last_activity::text,
      created_at::text, updated_at::text
    from skyroad.v_booking_summary where id = ${id}::int`;
  if (!b) return null;
  const { rows: txns } = await listTxns({ booking_id: id, limit: 5000 });
  const [pkg] = await db()<{ id: string; due_date: string | null }>`
    select id::text, due_date::text from skyroad.txn where booking_id = ${id}::int and is_package_due and deleted_at is null`;
  return { booking: b, txns, packageDue: pkg ?? null };
}

export async function bookingRefs() {
  return db()<{ booking_ref: string; client_name: string; destination: string | null }>`
    select booking_ref, client_name, destination from skyroad.booking where status <> 'cancelled'
    order by created_at desc limit 2000`;
}

// ───────────────────────────── cash locations ─────────────────────────────

export interface LocationBalance {
  id: number; name: string; kind: 'hand' | 'locker' | 'other'; opening_balance: string; is_active: boolean; sort_order: number;
  received: string; paid_out: string; transfers_in: string; transfers_out: string; balance: string;
  last_count_at: string | null; last_count_diff: string | null; last_counted_amount: string | null;
}

export async function listLocations(activeOnly = false): Promise<LocationBalance[]> {
  return db()<LocationBalance>`
    select v.id, v.name, v.kind, v.opening_balance::text, v.is_active, v.sort_order, v.received::text, v.paid_out::text,
           v.transfers_in::text, v.transfers_out::text, v.balance::text,
           c.counted_at::text as last_count_at, c.difference::text as last_count_diff, c.counted_amount::text as last_counted_amount
    from skyroad.v_location_balance v
    left join lateral (select counted_at, difference, counted_amount from skyroad.cash_count
                       where location_id = v.id order by counted_at desc limit 1) c on true
    where (not ${activeOnly}::boolean or v.is_active)
    order by v.is_active desc, v.sort_order, v.id`;
}

export function parseLocationInput(get: Getter) {
  const name = text(get('name'), 60);
  if (!name) throw new UserError('Enter a location name.');
  const kind = get('kind') ?? 'other';
  if (!['hand', 'locker', 'other'].includes(kind)) throw new UserError('Choose a location type.');
  const opening = parseAmount((get('opening_balance') ?? '').trim() || '0');
  if (opening === null) throw new UserError('Enter a valid opening balance (zero or more).');
  const sort = intOrNull(get('sort_order')) ?? 10;
  return { name, kind: kind as 'hand' | 'locker' | 'other', opening_balance: opening, sort_order: sort };
}

export async function createLocation(actor: string, get: Getter) {
  const l = parseLocationInput(get);
  await withTx(actor, (tx) => tx`
    insert into skyroad.cash_location (name, kind, opening_balance, sort_order)
    values (${l.name}::text, ${l.kind}::text, ${l.opening_balance}::numeric, ${l.sort_order}::int)`);
}

export async function updateLocation(actor: string, id: number, get: Getter) {
  const l = parseLocationInput(get);
  await withTx(actor, async (tx) => {
    const rows = await tx`update skyroad.cash_location set name = ${l.name}::text, kind = ${l.kind}::text,
      opening_balance = ${l.opening_balance}::numeric, sort_order = ${l.sort_order}::int where id = ${id}::int returning id`;
    if (rows.length === 0) throw new UserError('Location not found.');
  });
}

export async function setLocationActive(actor: string, id: number, active: boolean) {
  await withTx(actor, async (tx) => {
    if (!active) {
      const [l] = await tx<{ balance: string }>`select balance::text from skyroad.v_location_balance where id = ${id}::int`;
      if (!l) throw new UserError('Location not found.');
      if (Number(l.balance) !== 0) throw new UserError('Move this location\'s cash elsewhere (balance must be ₹0.00) before deactivating it.');
    }
    await tx`update skyroad.cash_location set is_active = ${active}::boolean where id = ${id}::int`;
  });
}

// ───────────────────────────── cash verification ─────────────────────────────

/**
 * Records a physical cash count. The system balance is snapshotted inside the
 * same database transaction. Optionally posts an adjustment entry so the
 * system balance matches the counted cash.
 */
export async function recordCashCount(actor: string, get: Getter) {
  const locationId = intOrNull(get('location_id'));
  if (!locationId) throw new UserError('Choose a cash location.');
  const counted = parseAmount(get('counted_amount'));
  if (counted === null) throw new UserError('Enter the amount you counted (zero or more).');
  const notes = text(get('notes'), 500);
  const adjust = get('post_adjustment') === 'on' || get('post_adjustment') === 'true';
  return withTx(actor, async (tx) => {
    const [loc] = await tx<{ balance: string; name: string; is_active: boolean }>`
      select v.balance::text, v.name, v.is_active from skyroad.v_location_balance v where v.id = ${locationId}::int`;
    if (!loc) throw new UserError('Location not found.');
    const [count] = await tx<{ id: number; difference: string }>`
      insert into skyroad.cash_count (location_id, counted_amount, system_balance, notes, created_by)
      values (${locationId}::int, ${counted}::numeric, ${loc.balance}::numeric, ${notes}::text, ${actor}::text)
      returning id, difference::text`;
    if (adjust && Number(count.difference) !== 0) {
      if (!loc.is_active) throw new UserError('Cannot post an adjustment to an inactive location.');
      const excess = Number(count.difference) > 0;
      const [adj] = await tx<{ id: string }>`
        insert into skyroad.txn (txn_date, type, amount, location_id, category, description, notes, created_by, updated_by)
        values (${todayIST()}::date, ${excess ? 'cash_in' : 'cash_out'}::skyroad.txn_type, abs(${count.difference}::numeric),
                ${locationId}::int, ${excess ? 'Cash adjustment (excess)' : 'Cash adjustment (shortage)'}::text,
                ${'Cash count adjustment – ' + loc.name}::text, ${notes}::text, ${actor}::text, ${actor}::text)
        returning id::text`;
      await tx`update skyroad.cash_count set adjustment_txn_id = ${adj.id}::uuid where id = ${count.id}::int`;
    }
    return { difference: count.difference, systemBalance: loc.balance, counted };
  });
}

export async function listCashCounts(limit = 30) {
  return db()<{ id: number; location_name: string; counted_at: string; counted_amount: string; system_balance: string;
                difference: string; notes: string | null; adjustment_txn_id: string | null; created_by: string | null }>`
    select c.id, l.name as location_name, c.counted_at::text, c.counted_amount::text, c.system_balance::text,
           c.difference::text, c.notes, c.adjustment_txn_id::text, c.created_by
    from skyroad.cash_count c join skyroad.cash_location l on l.id = c.location_id
    order by c.counted_at desc limit ${limit}::int`;
}

// ───────────────────────────── lookups for forms ─────────────────────────────

export async function nameSuggestions() {
  // JSON text keeps the shape identical across database drivers.
  const [r] = await db()<{ clients: string; suppliers: string; providers: string }>`
    select
      coalesce((select json_agg(distinct x) from (select client_name x from skyroad.txn where client_name is not null and deleted_at is null
                                          union select client_name from skyroad.booking) s), '[]')::text as clients,
      coalesce((select json_agg(distinct supplier_name) from skyroad.txn where supplier_name is not null and deleted_at is null), '[]')::text as suppliers,
      coalesce((select json_agg(distinct service_provider) from skyroad.txn where service_provider is not null and deleted_at is null), '[]')::text as providers`;
  return {
    clients: JSON.parse(r?.clients ?? '[]') as string[],
    suppliers: JSON.parse(r?.suppliers ?? '[]') as string[],
    providers: JSON.parse(r?.providers ?? '[]') as string[],
  };
}

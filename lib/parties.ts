// Parties: a running account (khata) with individual people.
// balance > 0 → the party owes you; balance < 0 → you owe the party.
// Entries paid in cash are linked to a real Cash Out / Cash In so that
// physical cash stays correct; both are always changed together.
import type { Sql } from './sql-types';
import { db, withTx, UserError } from './db-core';
import { parseAmount, parsePositiveAmount } from './money';
import { isIsoDate, todayIST } from './dates';
import type { Getter } from './ledger';

export interface PartyBalance {
  id: number; name: string; phone: string | null; notes: string | null; account: 'business' | 'home';
  opening_balance: string; is_active: boolean; i_paid: string; they_paid: string; balance: string;
  entries: number; last_txn_date: string | null;
}

export interface PartyEntry {
  id: string; pt_no: string; party_id: number; txn_date: string; paid_by: 'me' | 'them'; amount: string;
  category: string | null; description: string | null; notes: string | null; linked_txn_id: string | null;
  linked_txn_no: string | null; location_id: number | null; location_name: string | null;
  running_balance?: string; created_at: string; updated_at: string; deleted_at?: string | null;
}

export const PARTY_CATEGORIES = ['Purchase', 'Shared expense', 'Loan given / taken', 'Settlement', 'Cash exchange', 'Gift', 'Other'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: string | undefined, max: number) => {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (s.length > max) throw new UserError(`Text is too long (max ${max} characters).`);
  return s;
};

/** Plain-language balance: "Rahul owes you ₹…" / "You owe Rahul ₹…" / "All settled". */
export function balanceWords(balance: string, name: string): { tone: 'pos' | 'neg' | 'zero'; text: string } {
  const n = Number(balance);
  if (n > 0) return { tone: 'pos', text: `${name} owes you` };
  if (n < 0) return { tone: 'neg', text: `You owe ${name}` };
  return { tone: 'zero', text: 'All settled' };
}

export async function listParties(q?: string | null, includeInactive = false): Promise<PartyBalance[]> {
  const like = q?.trim() ? `%${q.trim()}%` : null;
  return db()<PartyBalance>`
    select id, name, phone, notes, account, opening_balance::text, is_active, i_paid::text, they_paid::text,
           balance::text, entries, last_txn_date::text
    from skyroad.v_party_balance
    where (${includeInactive}::boolean or is_active)
      and (${like}::text is null or name ilike ${like}::text or phone ilike ${like}::text or notes ilike ${like}::text)
    order by is_active desc, (balance = 0), abs(balance) desc, name`;
}

export async function partySummary() {
  const [r] = await db()<{ owed_to_me: string; i_owe: string; people: number; open: number }>`
    select coalesce(sum(balance) filter (where balance > 0), 0)::numeric(14,2)::text as owed_to_me,
           coalesce(-sum(balance) filter (where balance < 0), 0)::numeric(14,2)::text as i_owe,
           count(*)::int as people, count(*) filter (where balance <> 0)::int as open
    from skyroad.v_party_balance where is_active`;
  return { owedToMe: r.owed_to_me, iOwe: r.i_owe, people: r.people, open: r.open };
}

export async function getParty(id: number) {
  const [p] = await db()<PartyBalance>`
    select id, name, phone, notes, account, opening_balance::text, is_active, i_paid::text, they_paid::text,
           balance::text, entries, last_txn_date::text
    from skyroad.v_party_balance where id = ${id}::int`;
  if (!p) return null;
  const entries = await db()<PartyEntry>`
    select e.id::text, e.pt_no, e.party_id, e.txn_date::text, e.paid_by, e.amount::text, e.category, e.description, e.notes,
           e.linked_txn_id::text, t.txn_no as linked_txn_no, t.location_id, l.name as location_name,
           e.created_at::text, e.updated_at::text,
           (p.opening_balance + sum(case when e.paid_by = 'me' then e.amount else -e.amount end)
              over (order by e.txn_date, e.created_at rows unbounded preceding))::numeric(14,2)::text as running_balance
    from skyroad.party_txn e
    join skyroad.party p on p.id = e.party_id
    left join skyroad.txn t on t.id = e.linked_txn_id
    left join skyroad.cash_location l on l.id = t.location_id
    where e.party_id = ${id}::int and e.deleted_at is null
    order by e.txn_date desc, e.created_at desc`;
  const deleted = await db()<PartyEntry>`
    select id::text, pt_no, party_id, txn_date::text, paid_by, amount::text, category, description, deleted_at::text,
           linked_txn_id::text
    from skyroad.party_txn where party_id = ${id}::int and deleted_at is not null
    order by deleted_at desc limit 50`;
  return { party: p, entries, deleted };
}

export async function getPartyEntry(id: string) {
  if (!UUID_RE.test(id)) return null;
  const [e] = await db()<PartyEntry & { party_name: string }>`
    select e.id::text, e.pt_no, e.party_id, p.name as party_name, e.txn_date::text, e.paid_by, e.amount::text, e.category,
           e.description, e.notes, e.linked_txn_id::text, t.txn_no as linked_txn_no, t.location_id, l.name as location_name,
           e.created_at::text, e.updated_at::text, e.deleted_at::text
    from skyroad.party_txn e join skyroad.party p on p.id = e.party_id
    left join skyroad.txn t on t.id = e.linked_txn_id
    left join skyroad.cash_location l on l.id = t.location_id
    where e.id = ${id}::uuid`;
  return e ?? null;
}

// ───────────────────────── parties ─────────────────────────

export function parsePartyInput(get: Getter) {
  const name = text(get('name'), 80);
  if (!name) throw new UserError('Enter the person’s name.');
  const openRaw = (get('opening_amount') ?? '').trim();
  const open = openRaw ? parseAmount(openRaw) : '0.00';
  if (open === null) throw new UserError('Enter a valid opening balance amount.');
  const dir = get('opening_dir') === 'i_owe' ? -1 : 1;
  const opening_balance = Number(open) === 0 ? '0.00' : (dir < 0 ? `-${open}` : open);
  const account = get('account') === 'business' ? 'business' : 'home';
  return { name, phone: text(get('phone'), 30), notes: text(get('notes'), 500), account, opening_balance } as const;
}

export async function saveParty(actor: string, id: number | null, get: Getter): Promise<number> {
  const p = parsePartyInput(get);
  return withTx(actor, async (tx) => {
    if (id) {
      const rows = await tx<{ id: number }>`
        update skyroad.party set name = ${p.name}::text, phone = ${p.phone}::text, notes = ${p.notes}::text,
          account = ${p.account}::text, opening_balance = ${p.opening_balance}::numeric, updated_by = ${actor}::text
        where id = ${id}::int returning id`;
      if (!rows.length) throw new UserError('Party not found.');
      // keep linked cash entries on the same side (Skyroad / Home) as the party
      await tx`update skyroad.txn set account = ${p.account}::text, updated_by = ${actor}::text
               where id in (select linked_txn_id from skyroad.party_txn where party_id = ${id}::int and linked_txn_id is not null)
                 and account <> ${p.account}::text`;
      return id;
    }
    const [r] = await tx<{ id: number }>`
      insert into skyroad.party (name, phone, notes, account, opening_balance, created_by, updated_by)
      values (${p.name}::text, ${p.phone}::text, ${p.notes}::text, ${p.account}::text, ${p.opening_balance}::numeric, ${actor}::text, ${actor}::text)
      returning id`;
    return r.id;
  });
}

export async function setPartyActive(actor: string, id: number, active: boolean) {
  await withTx(actor, async (tx) => {
    if (!active) {
      const [b] = await tx<{ balance: string }>`select balance::text from skyroad.v_party_balance where id = ${id}::int`;
      if (b && Number(b.balance) !== 0) throw new UserError('This account is not settled yet. It can be archived once the balance is ₹0.00.');
    }
    await tx`update skyroad.party set is_active = ${active}::boolean, updated_by = ${actor}::text where id = ${id}::int`;
  });
}

// ───────────────────────── entries ─────────────────────────

export interface PartyTxnInput {
  party_id: number; txn_date: string; paid_by: 'me' | 'them'; amount: string; category: string | null;
  description: string | null; notes: string | null; cash: boolean; location_id: number | null;
}

export function parsePartyTxnInput(get: Getter, today = todayIST()): PartyTxnInput {
  const party_id = Number(get('party_id'));
  if (!Number.isInteger(party_id) || party_id <= 0) throw new UserError('Choose the person.');
  const paid_by = get('paid_by');
  if (paid_by !== 'me' && paid_by !== 'them') throw new UserError('Choose who paid.');
  const amount = parsePositiveAmount(get('amount'));
  if (!amount) throw new UserError('Enter an amount greater than zero (max 2 decimals).');
  const txn_date = (get('txn_date') ?? '').trim();
  if (!isIsoDate(txn_date) || txn_date < '2000-01-01') throw new UserError('Enter a valid date.');
  if (txn_date > today) throw new UserError('Entries cannot be dated in the future.');
  const cash = get('cash') === 'on' || get('cash') === 'true';
  const loc = Number(get('location_id'));
  const location_id = cash ? (Number.isInteger(loc) && loc > 0 ? loc : null) : null;
  if (cash && !location_id) throw new UserError(paid_by === 'me' ? 'Choose which cash you paid from.' : 'Choose where you kept the cash.');
  return {
    party_id, txn_date, paid_by, amount, cash, location_id,
    category: text(get('category'), 60), description: text(get('description'), 200), notes: text(get('notes'), 1000),
  };
}

/** Inserts or updates the Cash Out / Cash In that mirrors a cash-paid party entry. */
async function upsertLinkedCash(tx: Sql, actor: string, existing: string | null, partyName: string, account: string, i: PartyTxnInput): Promise<string> {
  const type = i.paid_by === 'me' ? 'cash_out' : 'cash_in';
  const desc = `${i.paid_by === 'me' ? 'Paid' : 'Received from'} ${partyName}${i.description ? ` – ${i.description}` : ''}`.slice(0, 300);
  const category = `Party – ${i.category ?? 'Other'}`.slice(0, 60);
  if (existing) {
    await tx`update skyroad.txn set type = ${type}::skyroad.txn_type, amount = ${i.amount}::numeric, txn_date = ${i.txn_date}::date,
               location_id = ${i.location_id}::int, account = ${account}::text, description = ${desc}::text,
               category = ${category}::text, client_name = ${partyName}::text, deleted_at = null, deleted_by = null,
               updated_by = ${actor}::text
             where id = ${existing}::uuid`;
    return existing;
  }
  const [t] = await tx<{ id: string }>`
    insert into skyroad.txn (txn_date, type, amount, location_id, account, client_name, description, category, created_by, updated_by)
    values (${i.txn_date}::date, ${type}::skyroad.txn_type, ${i.amount}::numeric, ${i.location_id}::int, ${account}::text,
            ${partyName}::text, ${desc}::text, ${category}::text, ${actor}::text, ${actor}::text)
    returning id::text`;
  return t.id;
}

async function lockParty(tx: Sql, id: number) {
  const [p] = await tx<{ name: string; account: string; is_active: boolean }>`
    select name, account, is_active from skyroad.party where id = ${id}::int for update`;
  if (!p) throw new UserError('That person no longer exists.');
  return p;
}

export async function createPartyTxn(actor: string, i: PartyTxnInput, idem?: string | null) {
  const key = idem && idem.length <= 100 ? `pt:${idem}` : null;
  if (key) {
    const [dup] = await db()<{ id: string; pt_no: string }>`select id::text, pt_no from skyroad.party_txn where idempotency_key = ${key}::text`;
    if (dup) return { ...dup, duplicate: true };
  }
  return withTx(actor, async (tx) => {
    const p = await lockParty(tx, i.party_id);
    if (!p.is_active) throw new UserError(`${p.name} is archived. Restore the person first.`);
    const linked = i.cash ? await upsertLinkedCash(tx, actor, null, p.name, p.account, i) : null;
    const [row] = await tx<{ id: string; pt_no: string }>`
      insert into skyroad.party_txn (party_id, txn_date, paid_by, amount, category, description, notes, linked_txn_id,
                                     idempotency_key, created_by, updated_by)
      values (${i.party_id}::int, ${i.txn_date}::date, ${i.paid_by}::text, ${i.amount}::numeric, ${i.category}::text,
              ${i.description}::text, ${i.notes}::text, ${linked}::uuid, ${key}::text, ${actor}::text, ${actor}::text)
      returning id::text, pt_no`;
    return row;
  });
}

export async function updatePartyTxn(actor: string, id: string, i: PartyTxnInput) {
  if (!UUID_RE.test(id)) throw new UserError('Entry not found.');
  await withTx(actor, async (tx) => {
    const [cur] = await tx<{ party_id: number; linked_txn_id: string | null }>`
      select party_id, linked_txn_id::text from skyroad.party_txn where id = ${id}::uuid and deleted_at is null for update`;
    if (!cur) throw new UserError('This entry no longer exists (it may have been deleted on another device).');
    if (cur.party_id !== i.party_id) throw new UserError('An entry cannot be moved to a different person.');
    const p = await lockParty(tx, i.party_id);
    let linked: string | null = cur.linked_txn_id;
    if (i.cash) {
      linked = await upsertLinkedCash(tx, actor, cur.linked_txn_id, p.name, p.account, i);
    } else if (cur.linked_txn_id) {
      await tx`update skyroad.txn set deleted_at = now(), deleted_by = ${actor}::text where id = ${cur.linked_txn_id}::uuid and deleted_at is null`;
      linked = null;
    }
    await tx`update skyroad.party_txn set txn_date = ${i.txn_date}::date, paid_by = ${i.paid_by}::text, amount = ${i.amount}::numeric,
               category = ${i.category}::text, description = ${i.description}::text, notes = ${i.notes}::text,
               linked_txn_id = ${linked}::uuid, updated_by = ${actor}::text
             where id = ${id}::uuid`;
  });
}

export async function deletePartyTxn(actor: string, id: string) {
  if (!UUID_RE.test(id)) throw new UserError('Entry not found.');
  await withTx(actor, async (tx) => {
    const [cur] = await tx<{ linked_txn_id: string | null }>`
      update skyroad.party_txn set deleted_at = now(), deleted_by = ${actor}::text
      where id = ${id}::uuid and deleted_at is null returning linked_txn_id::text`;
    if (!cur) throw new UserError('This entry was already deleted.');
    if (cur.linked_txn_id)
      await tx`update skyroad.txn set deleted_at = now(), deleted_by = ${actor}::text where id = ${cur.linked_txn_id}::uuid and deleted_at is null`;
  });
}

export async function restorePartyTxn(actor: string, id: string) {
  if (!UUID_RE.test(id)) throw new UserError('Entry not found.');
  await withTx(actor, async (tx) => {
    const [cur] = await tx<{ linked_txn_id: string | null }>`
      update skyroad.party_txn set deleted_at = null, deleted_by = null, updated_by = ${actor}::text
      where id = ${id}::uuid and deleted_at is not null returning linked_txn_id::text`;
    if (!cur) throw new UserError('Nothing to restore.');
    if (cur.linked_txn_id)
      await tx`update skyroad.txn set deleted_at = null, deleted_by = null, updated_by = ${actor}::text where id = ${cur.linked_txn_id}::uuid`;
  });
}

/** If a cash entry belongs to a party entry, returns the party name (so it is edited from Parties). */
export async function partyOwningTxn(tx: Sql, txnId: string): Promise<{ name: string; party_id: number } | null> {
  const [exists] = await tx<{ ok: boolean }>`select to_regclass('skyroad.party_txn') is not null as ok`;
  if (!exists?.ok) return null;
  const [r] = await tx<{ name: string; party_id: number }>`
    select p.name, p.id as party_id from skyroad.party_txn e join skyroad.party p on p.id = e.party_id
    where e.linked_txn_id = ${txnId}::uuid`;
  return r ?? null;
}

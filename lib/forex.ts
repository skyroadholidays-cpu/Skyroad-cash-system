// Forex Reserve: foreign-currency holdings, kept separate from INR cash.
import { db, withTx, UserError } from './db-core';
import { parseAmount, parsePositiveAmount } from './money';
import { isIsoDate, todayIST } from './dates';
import type { Getter } from './ledger';
import type { Sql } from './sql-types';

export interface FxBalance {
  code: string; name: string; opening_balance: string; sort_order: number; is_active: boolean;
  total_in: string; total_out: string; balance: string; entries: number; last_txn_date: string | null;
  avg_in_rate: string | null; last_rate: string | null; inr_value: string | null;
}

export interface FxEntry {
  id: string; fx_no: string; currency: string; txn_date: string; direction: 'in' | 'out'; amount: string;
  rate_inr: string | null; inr_value: string | null; counterparty: string | null; purpose: string | null;
  booking_id: number | null; booking_ref: string | null; account: 'business' | 'home'; notes: string | null;
  running_balance?: string; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null;
  deleted_at?: string | null;
}

export const FX_PURPOSES = {
  in: ['Bought from money changer', 'Received from client', 'Left over after trip', 'Refund from supplier', 'Personal / home', 'Other'],
  out: ['Given to client for trip', 'Paid to supplier abroad', 'Sold to money changer', 'Used on business trip', 'Personal / home', 'Other'],
};

/** INR value shown = holding × last known rate (else average buy rate). */
export async function listFxBalances(activeOnly = false): Promise<FxBalance[]> {
  return db()<FxBalance>`
    select code, name, opening_balance::text, sort_order, is_active, total_in::text, total_out::text, balance::text,
           entries, last_txn_date::text, avg_in_rate::text, last_rate::text,
           (balance * coalesce(last_rate, avg_in_rate))::numeric(18,2)::text as inr_value
    from skyroad.v_fx_balance
    where (not ${activeOnly}::boolean or is_active)
    order by is_active desc, sort_order, code`;
}

export async function fxSummary() {
  const rows = await listFxBalances(true);
  const held = rows.filter((r) => Number(r.balance) > 0);
  const valued = held.filter((r) => r.inr_value !== null);
  const inr = valued.reduce((t, r) => t + Math.round(Number(r.inr_value) * 100), 0);
  return { currencies: held.length, inrValue: (inr / 100).toFixed(2), unvalued: held.length - valued.length, held };
}

export async function getFxCurrency(code: string) {
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const [bal] = await db()<FxBalance>`
    select code, name, opening_balance::text, sort_order, is_active, total_in::text, total_out::text, balance::text,
           entries, last_txn_date::text, avg_in_rate::text, last_rate::text,
           (balance * coalesce(last_rate, avg_in_rate))::numeric(18,2)::text as inr_value
    from skyroad.v_fx_balance where code = ${code}::text`;
  if (!bal) return null;
  const entries = await db()<FxEntry>`
    select t.id::text, t.fx_no, t.currency, t.txn_date::text, t.direction, t.amount::text, t.rate_inr::text,
           (t.amount * t.rate_inr)::numeric(18,2)::text as inr_value, t.counterparty, t.purpose, t.booking_id,
           b.booking_ref, t.account, t.notes, t.created_at::text, t.updated_at::text, t.created_by, t.updated_by,
           (c.opening_balance + sum(case when t.direction = 'in' then t.amount else -t.amount end)
              over (order by t.txn_date, t.created_at rows unbounded preceding))::numeric(18,2)::text as running_balance
    from skyroad.fx_txn t
    join skyroad.fx_currency c on c.code = t.currency
    left join skyroad.booking b on b.id = t.booking_id
    where t.currency = ${code}::text and t.deleted_at is null
    order by t.txn_date desc, t.created_at desc`;
  const deleted = await db()<FxEntry>`
    select t.id::text, t.fx_no, t.currency, t.txn_date::text, t.direction, t.amount::text, t.counterparty, t.purpose,
           t.deleted_at::text, t.account
    from skyroad.fx_txn t where t.currency = ${code}::text and t.deleted_at is not null
    order by t.deleted_at desc limit 50`;
  return { currency: bal, entries, deleted };
}

export async function getFxEntry(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [e] = await db()<FxEntry>`
    select t.id::text, t.fx_no, t.currency, t.txn_date::text, t.direction, t.amount::text, t.rate_inr::text,
           t.counterparty, t.purpose, t.booking_id, b.booking_ref, t.account, t.notes, t.created_at::text, t.updated_at::text,
           t.created_by, t.updated_by, t.deleted_at::text
    from skyroad.fx_txn t left join skyroad.booking b on b.id = t.booking_id where t.id = ${id}::uuid`;
  return e ?? null;
}

export interface FxInput {
  currency: string; txn_date: string; direction: 'in' | 'out'; amount: string; rate_inr: string | null;
  counterparty: string | null; purpose: string | null; booking_ref: string | null; account: 'business' | 'home'; notes: string | null;
}

const text = (v: string | undefined, max: number) => {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (s.length > max) throw new UserError(`Text is too long (max ${max} characters).`);
  return s;
};

export function parseFxInput(get: Getter, today = todayIST()): FxInput {
  const currency = (get('currency') ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new UserError('Choose a currency.');
  const direction = get('direction');
  if (direction !== 'in' && direction !== 'out') throw new UserError('Choose whether the currency came in or went out.');
  const amount = parsePositiveAmount(get('amount'));
  if (!amount) throw new UserError('Enter an amount greater than zero (max 2 decimals).');
  const txn_date = (get('txn_date') ?? '').trim();
  if (!isIsoDate(txn_date) || txn_date < '2000-01-01') throw new UserError('Enter a valid date.');
  if (txn_date > today) throw new UserError('Forex entries cannot be dated in the future.');
  const rateRaw = (get('rate_inr') ?? '').trim().replace(/[₹,\s]/g, '');
  let rate_inr: string | null = null;
  if (rateRaw) {
    if (!/^\d{1,9}(\.\d{1,4})?$/.test(rateRaw) || Number(rateRaw) <= 0) throw new UserError('Enter the rate as rupees for 1 unit, e.g. 83.45 (up to 4 decimals).');
    rate_inr = rateRaw;
  }
  const account = get('entry_for') === 'home' ? 'home' : 'business';
  return {
    currency, txn_date, direction, amount, rate_inr,
    counterparty: text(get('counterparty'), 120), purpose: text(get('purpose'), 80),
    booking_ref: account === 'home' ? null : text(get('booking_ref'), 40),
    account, notes: text(get('notes'), 1000),
  };
}

async function bookingId(tx: Sql, ref: string | null) {
  if (!ref) return null;
  const [b] = await tx<{ id: number }>`select id from skyroad.booking where lower(booking_ref) = lower(${ref}::text)`;
  if (!b) throw new UserError(`Booking "${ref}" was not found.`);
  return b.id;
}

export async function createFx(actor: string, input: FxInput, idem?: string | null) {
  const key = idem && idem.length <= 100 ? `fx:${idem}` : null;
  if (key) {
    const [dup] = await db()<{ id: string; fx_no: string }>`select id::text, fx_no from skyroad.fx_txn where idempotency_key = ${key}::text`;
    if (dup) return { ...dup, duplicate: true };
  }
  return withTx(actor, async (tx) => {
    const [c] = await tx<{ is_active: boolean }>`select is_active from skyroad.fx_currency where code = ${input.currency}::text`;
    if (!c) throw new UserError('Unknown currency.');
    if (!c.is_active) throw new UserError(`${input.currency} is hidden. Show it again on the Forex Reserve page first.`);
    const bid = await bookingId(tx, input.booking_ref);
    const [row] = await tx<{ id: string; fx_no: string }>`
      insert into skyroad.fx_txn (currency, txn_date, direction, amount, rate_inr, counterparty, purpose, booking_id, account, notes,
                                  idempotency_key, created_by, updated_by)
      values (${input.currency}::text, ${input.txn_date}::date, ${input.direction}::text, ${input.amount}::numeric,
              ${input.rate_inr}::numeric, ${input.counterparty}::text, ${input.purpose}::text, ${bid}::int, ${input.account}::text,
              ${input.notes}::text, ${key}::text, ${actor}::text, ${actor}::text)
      returning id::text, fx_no`;
    return row;
  });
}

export async function updateFx(actor: string, id: string, input: FxInput) {
  return withTx(actor, async (tx) => {
    const bid = await bookingId(tx, input.booking_ref);
    const rows = await tx<{ id: string }>`
      update skyroad.fx_txn set currency = ${input.currency}::text, txn_date = ${input.txn_date}::date,
        direction = ${input.direction}::text, amount = ${input.amount}::numeric, rate_inr = ${input.rate_inr}::numeric,
        counterparty = ${input.counterparty}::text, purpose = ${input.purpose}::text, booking_id = ${bid}::int,
        account = ${input.account}::text, notes = ${input.notes}::text, updated_by = ${actor}::text
      where id = ${id}::uuid and deleted_at is null returning id::text`;
    if (!rows.length) throw new UserError('This entry no longer exists (it may have been deleted on another device).');
  });
}

export async function deleteFx(actor: string, id: string) {
  await withTx(actor, async (tx) => {
    const rows = await tx`update skyroad.fx_txn set deleted_at = now(), deleted_by = ${actor}::text
                          where id = ${id}::uuid and deleted_at is null returning id`;
    if (!rows.length) throw new UserError('This entry was already deleted.');
  });
}

export async function restoreFx(actor: string, id: string) {
  await withTx(actor, async (tx) => {
    const rows = await tx`update skyroad.fx_txn set deleted_at = null, deleted_by = null, updated_by = ${actor}::text
                          where id = ${id}::uuid and deleted_at is not null returning id`;
    if (!rows.length) throw new UserError('Nothing to restore.');
  });
}

export async function saveFxCurrency(actor: string, get: Getter) {
  const code = (get('code') ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new UserError('Currency code must be 3 letters, e.g. SGD.');
  const name = text(get('name'), 60);
  if (!name) throw new UserError('Enter the currency name.');
  const opening = parseAmount((get('opening_balance') ?? '').trim() || '0');
  if (opening === null) throw new UserError('Enter a valid opening holding (zero or more).');
  const isNew = get('is_new') === '1';
  await withTx(actor, async (tx) => {
    if (isNew) {
      const [exists] = await tx`select 1 from skyroad.fx_currency where code = ${code}::text`;
      if (exists) throw new UserError(`${code} is already on the list.`);
      await tx`insert into skyroad.fx_currency (code, name, opening_balance, sort_order)
               values (${code}::text, ${name}::text, ${opening}::numeric, 50)`;
    } else {
      const rows = await tx`update skyroad.fx_currency set name = ${name}::text, opening_balance = ${opening}::numeric
                            where code = ${code}::text returning code`;
      if (!rows.length) throw new UserError('Currency not found.');
    }
  });
}

export async function setFxCurrencyActive(actor: string, code: string, active: boolean) {
  await withTx(actor, async (tx) => {
    if (!active) {
      const [b] = await tx<{ balance: string }>`select balance::text from skyroad.v_fx_balance where code = ${code}::text`;
      if (b && Number(b.balance) !== 0) throw new UserError(`You still hold ${code}. It can only be hidden when the holding is zero.`);
    }
    await tx`update skyroad.fx_currency set is_active = ${active}::boolean where code = ${code}::text`;
  });
}

/** Formats a foreign amount with its currency symbol: $1,250.00 · ¥15,000 · ₫2,500,000 */
export function fxFormat(amount: string | number | null | undefined, code: string): string {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).format(n);
  } catch {
    return `${code} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

// End-to-end tests of the application's data layer against a real, freshly
// migrated PostgreSQL database. Run with:  npm test   (see README)
import assert from 'node:assert/strict';
import { setSql, friendlyError, UserError } from '../lib/db-core';
import type { Sql } from '../lib/sql-types';
import * as auth from '../lib/auth-core';
import * as L from '../lib/ledger';
import * as I from '../lib/insights';
import { reportToCsv, sumColumn } from '../lib/csv';
import { parseAmount, inr } from '../lib/money';
import { todayIST, addDays, resolvePeriod } from '../lib/dates';

const ACTOR = 'Skyroadholidays';
let passed = 0;
const results: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    results.push(`  ✓ ${name}`);
  } catch (e) {
    results.push(`  ✗ ${name}`);
    console.log(results.join('\n'));
    console.error(e);
    process.exit(1);
  }
}
async function rejects(fn: () => Promise<unknown>, frag: string) {
  try {
    await fn();
  } catch (e) {
    const msg = friendlyError(e);
    assert.ok(msg.toLowerCase().includes(frag.toLowerCase()), `expected "${frag}" in "${msg}"`);
    return msg;
  }
  assert.fail(`expected rejection containing "${frag}"`);
}
const g = (o: Record<string, unknown>) => L.getterFrom(o);
const today = todayIST();
const yesterday = addDays(today, -1);

async function main() {
  let sql: Sql;
  let end: () => void = () => {};
  if (process.env.PGMINI_SOCKET) {
    const { connect } = await import('./pg-mini');
    const c = await connect({ path: process.env.PGMINI_SOCKET, port: 0, user: process.env.PGUSER ?? 'postgres', database: process.env.PGDATABASE ?? 'skyroad_test' });
    sql = c.sql;
    end = c.end;
  } else {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('Set TEST_DATABASE_URL to an EMPTY, freshly migrated test database (never your live one).');
    const postgres = (await import('postgres')).default;
    const pg = postgres(url, { prepare: false, max: 4, onnotice: () => {} });
    sql = pg as unknown as Sql;
    end = () => void pg.end();
  }
  setSql(sql);

  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from skyroad.txn`;
  if (n > 0) throw new Error('Refusing to run: the test database already contains transactions.');

  // ───────── money & dates
  await test('parses Indian-formatted amounts exactly', () => {
    assert.equal(parseAmount('₹1,25,000.5'), '125000.50');
    assert.equal(parseAmount('25000'), '25000.00');
    assert.equal(parseAmount('1.234'), null);
    assert.equal(parseAmount('-5'), null);
    assert.equal(parseAmount('abc'), null);
    assert.equal(inr('125000.5'), '₹1,25,000.50');
    assert.equal(inr('-9999.5'), '−₹9,999.50');
    assert.equal(inr('12345678.00'), '₹1,23,45,678.00');
    assert.equal(sumColumn([{ a: '0.10' }, { a: '0.20' }, { a: null }, { a: '-0.05' }], 'a'), '0.25');
  });
  await test('financial year and periods resolve in IST', () => {
    assert.deepEqual(resolvePeriod({ period: 'fy' }, '2026-02-10'), { key: 'fy', from: '2025-04-01', to: '2026-03-31', label: 'FY 2025-26' });
    assert.equal(resolvePeriod({ period: 'week' }, '2026-10-25').from, '2026-10-19'); // Sunday -> Monday start
    assert.equal(resolvePeriod({ period: 'month' }, '2026-02-10').to, '2026-02-28');
    assert.equal(resolvePeriod({ period: 'custom', from: '2026-05-10', to: '2026-05-01' }).from, '2026-05-01');
  });

  // ───────── auth
  await test('first-time password setup validates and only runs once', async () => {
    assert.equal(await auth.isPasswordSet(), false);
    await rejects(() => auth.setInitialPassword('short', 'short'), 'at least 8');
    await rejects(() => auth.setInitialPassword('longenough1', 'different1'), 'do not match');
    await auth.setInitialPassword('Correct-Horse-1', 'Correct-Horse-1');
    assert.equal(await auth.isPasswordSet(), true);
    await rejects(() => auth.setInitialPassword('Another-Pass-2', 'Another-Pass-2'), 'already been set');
    const [u] = await sql<{ password_hash: string }>`select password_hash from skyroad.app_user`;
    assert.ok(u.password_hash.startsWith('scrypt$') && !u.password_hash.includes('Correct-Horse-1'));
  });
  let tokenA = '', tokenB = '';
  await test('login, sessions, case-insensitive username', async () => {
    await rejects(() => auth.login('Skyroadholidays', 'wrong-password', '1.1.1.1', 'test'), 'incorrect');
    tokenA = await auth.login('skyroadholidays', 'Correct-Horse-1', '1.1.1.1', 'MacBook');
    tokenB = await auth.login('Skyroadholidays', 'Correct-Horse-1', '2.2.2.2', 'iPhone');
    const s = await auth.validateSession(tokenA);
    assert.equal(s?.username, 'Skyroadholidays');
    assert.equal(await auth.validateSession('forged-token'), null);
    const [row] = await sql<{ id: string }>`select id from skyroad.session limit 1`;
    assert.notEqual(row.id, tokenA, 'raw token must never be stored');
  });
  await test('change password signs out other devices only', async () => {
    const s = (await auth.validateSession(tokenA))!;
    await rejects(() => auth.changePassword(s, 'nope-nope', 'New-Secret-99', 'New-Secret-99'), 'current password is incorrect');
    await auth.changePassword(s, 'Correct-Horse-1', 'New-Secret-99', 'New-Secret-99');
    assert.ok(await auth.validateSession(tokenA));
    assert.equal(await auth.validateSession(tokenB), null);
    await rejects(() => auth.login('Skyroadholidays', 'Correct-Horse-1', '3.3.3.3', 't'), 'incorrect');
    assert.ok(await auth.login('Skyroadholidays', 'New-Secret-99', '3.3.3.3', 't'));
  });
  await test('expired / idle sessions are rejected', async () => {
    const t = await auth.login('Skyroadholidays', 'New-Secret-99', '4.4.4.4', 't');
    await sql`update skyroad.session set last_seen_at = now() - interval '8 days' where ip = '4.4.4.4'`;
    assert.equal(await auth.validateSession(t), null);
  });
  await test('logout destroys the session', async () => {
    const t = await auth.login('Skyroadholidays', 'New-Secret-99', '5.5.5.5', 't');
    await auth.destroySession(t);
    assert.equal(await auth.validateSession(t), null);
  });

  // ───────── locations & opening balances
  let hand = 0, locker = 0;
  await test('set opening balances', async () => {
    const locs = await L.listLocations();
    hand = locs.find((l) => l.kind === 'hand')!.id;
    locker = locs.find((l) => l.kind === 'locker')!.id;
    await L.updateLocation(ACTOR, hand, g({ name: 'Cash in Hand', kind: 'hand', opening_balance: '20,000', sort_order: '1' }));
    await L.updateLocation(ACTOR, locker, g({ name: 'Cash in Locker', kind: 'locker', opening_balance: '1,00,000', sort_order: '2' }));
    const d = await I.getDashboard(today, today);
    assert.equal(d.cashTotal, '120000.00');
    assert.equal(d.cashHand, '20000.00');
    assert.equal(d.cashLocker, '100000.00');
    assert.equal(d.inflow, '0');
  });

  // ───────── input validation
  await test('transaction form validation', async () => {
    const base = { type: 'cash_in', amount: '100', txn_date: today, location_id: String(hand) };
    assert.throws(() => L.parseTxnInput(g({ ...base, amount: '0' })), UserError);
    assert.throws(() => L.parseTxnInput(g({ ...base, amount: '-50' })), UserError);
    assert.throws(() => L.parseTxnInput(g({ ...base, amount: '10.555' })), UserError);
    assert.throws(() => L.parseTxnInput(g({ ...base, txn_date: addDays(today, 1) })), /future/);
    assert.throws(() => L.parseTxnInput(g({ ...base, location_id: '' })), /cash location/);
    assert.throws(() => L.parseTxnInput(g({ type: 'transfer', amount: '5', txn_date: today, from_location_id: '1', to_location_id: '1' })), /different/);
    assert.throws(() => L.parseTxnInput(g({ type: 'payment_due', amount: '5', txn_date: today })), /supplier/);
    const due = L.parseTxnInput(g({ type: 'payment_due', amount: '5', txn_date: today, supplier_name: 'X', location_id: String(hand), due_date: addDays(today, 30) }));
    assert.equal(due.location_id, null, 'irrelevant fields are cleared');
    assert.throws(() => L.parseTxnInput(g({ ...base, booking_ref: 'x'.repeat(41) })), /too long/);
  });

  // ───────── booking with receivable + advance
  let bali = 0;
  await test('new booking raises receivable and records advance in one step', async () => {
    const r = await L.createBooking(ACTOR,
      L.parseBookingInput(g({ booking_ref: 'SR-BALI-001', client_name: 'Mehta Family', destination: 'Bali', travel_start: addDays(today, 20), travel_end: addDays(today, 26), package_amount: '1,50,000' })),
      L.parseBookingExtras(g({ create_receivable: 'on', due_date: addDays(today, 3), advance_amount: '50000', advance_location_id: String(hand) })),
      'idem-booking-1');
    bali = r.id;
    const d = await I.getDashboard(today, today);
    assert.equal(d.toCollect, '100000.00');
    assert.equal(d.cashHand, '70000.00');
    assert.equal(d.inflow, '50000.00');
    assert.equal(d.cashTotal, '170000.00', 'receivable must not count as cash');
  });
  await test('double-submitted booking form creates one booking', async () => {
    const again = await L.createBooking(ACTOR,
      L.parseBookingInput(g({ booking_ref: 'SR-BALI-001', client_name: 'Mehta Family', package_amount: '150000' })),
      L.parseBookingExtras(g({ create_receivable: 'on', advance_amount: '50000', advance_location_id: String(hand) })), 'idem-booking-1');
    assert.equal(again.id, bali);
    assert.equal(again.duplicate, true);
    const [{ c }] = await sql<{ c: number }>`select count(*)::int c from skyroad.txn where type = 'cash_in'`;
    assert.equal(c, 1);
  });
  await test('duplicate booking reference gets a friendly error', async () => {
    await rejects(() => L.createBooking(ACTOR, L.parseBookingInput(g({ booking_ref: 'sr-bali-001', client_name: 'Someone' })),
      L.parseBookingExtras(g({}))), 'already exists');
  });

  // ───────── partial collections
  let pkgDue = '';
  await test('partial collection from the To Collect page', async () => {
    const dues = await L.listDues('collection_due', 'open');
    assert.equal(dues.length, 1);
    pkgDue = dues[0].id;
    assert.equal(dues[0].settle_status, 'partial');
    await L.settleDue(ACTOR, pkgDue, g({ amount: '30000', txn_date: today, location_id: String(locker) }), 'idem-col-1');
    const after = await L.getDue(pkgDue);
    assert.equal(after!.outstanding, '70000.00');
    assert.equal(L.statusLabel('collection_due', after!.settle_status), 'Partially Received');
  });
  await test('over-collection is blocked with the exact outstanding shown', async () => {
    const msg = await rejects(() => L.settleDue(ACTOR, pkgDue, g({ amount: '70000.01', txn_date: today, location_id: String(hand) })), 'exceeds');
    assert.ok(msg.includes('₹70,000.00'), msg);
  });
  await test('two devices collecting at the same instant cannot overshoot', async () => {
    const attempt = (k: string) => L.settleDue(ACTOR, pkgDue, g({ amount: '60000', txn_date: today, location_id: String(hand) }), k)
      .then(() => 'ok', (e) => friendlyError(e));
    const res = await Promise.all([attempt('race-a'), attempt('race-b')]);
    assert.equal(res.filter((r) => r === 'ok').length, 1, JSON.stringify(res));
    assert.ok(res.some((r) => r.includes('exceeds')));
    assert.equal((await L.getDue(pkgDue))!.outstanding, '10000.00');
  });
  await test('double-submitted collection is recorded once', async () => {
    const a = await L.settleDue(ACTOR, pkgDue, g({ amount: '10000', txn_date: today, location_id: String(hand) }), 'idem-col-2');
    const b = await L.settleDue(ACTOR, pkgDue, g({ amount: '10000', txn_date: today, location_id: String(hand) }), 'idem-col-2');
    assert.equal(a.id, b.id);
    assert.equal(b.duplicate, true);
    assert.equal((await L.getDue(pkgDue))!.settle_status, 'settled');
    assert.equal((await I.getDashboard(today, today)).toCollect, '0.00');
  });

  // ───────── supplier payables
  let hotelDue = '';
  await test('supplier payable does not touch cash; partial payment does', async () => {
    const r = await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'payment_due', amount: '90000', txn_date: today, booking_ref: 'SR-BALI-001',
      supplier_name: 'Bali Hotels Pvt Ltd', service_provider: 'Ayana Resort', due_date: yesterday, category: 'Hotel' })));
    hotelDue = r.id;
    let d = await I.getDashboard(today, today);
    assert.equal(d.toPay, '90000.00');
    assert.equal(d.cashTotal, '270000.00');
    assert.equal(d.overduePay.count, 1);
    await L.settleDue(ACTOR, hotelDue, g({ amount: '40000', txn_date: today, location_id: String(locker) }));
    d = await I.getDashboard(today, today);
    assert.equal(d.toPay, '50000.00');
    assert.equal(d.cashLocker, '90000.00');
    assert.equal(d.outflow, '40000.00');
    const pays = await L.listDues('payment_due', 'overdue');
    assert.equal(pays[0].settle_status, 'partial');
    assert.equal(L.statusLabel('payment_due', 'partial'), 'Partially Paid');
  });

  // ───────── transfers
  let transferId = '';
  await test('transfer moves cash between locations without changing total or inflow', async () => {
    const before = await I.getDashboard(today, today);
    const r = await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'transfer', amount: '50000', txn_date: today, from_location_id: String(hand), to_location_id: String(locker) })));
    transferId = r.id;
    const after = await I.getDashboard(today, today);
    assert.equal(after.cashTotal, before.cashTotal);
    assert.equal(after.inflow, before.inflow);
    assert.equal(after.outflow, before.outflow);
    assert.equal(after.cashHand, '90000.00');
    assert.equal(after.cashLocker, '140000.00');
    const loc = (await L.listLocations()).find((l) => l.id === hand)!;
    assert.equal(loc.transfers_out, '50000.00');
  });

  // ───────── edit
  await test('editing reverses the old effect and applies the new one exactly once', async () => {
    const t = await L.getTxn(transferId);
    await L.updateTxn(ACTOR, transferId, L.parseTxnInput(g({ ...t!.txn, amount: '20000', from_location_id: String(hand), to_location_id: String(locker), booking_ref: '' })));
    let d = await I.getDashboard(today, today);
    assert.equal(d.cashHand, '120000.00');
    assert.equal(d.cashLocker, '110000.00');
    assert.equal(d.cashTotal, '230000.00');
    // change a cash-in into a different location and amount
    const { rows } = await L.listTxns({ type: 'cash_in', q: 'Advance' });
    const adv = await L.getTxn(rows[0].id);
    await L.updateTxn(ACTOR, adv!.txn.id, L.parseTxnInput(g({ ...adv!.txn, amount: '45000', location_id: String(locker) })));
    d = await I.getDashboard(today, today);
    assert.equal(d.cashHand, '70000.00');
    assert.equal(d.cashLocker, '155000.00');
    assert.equal(d.toCollect, '5000.00', 'reducing a collection re-opens the receivable');
    const hist = (await L.getTxn(adv!.txn.id))!.history;
    const change = hist.find((h) => h.action === 'update')!;
    assert.deepEqual(change.changes.map((c) => c.field).sort(), ['amount', 'location_id']);
  });

  // ───────── delete / restore
  await test('soft delete recalculates everything; restore re-applies; due with payments protected', async () => {
    const { rows } = await L.listTxns({ type: 'cash_out' });
    const pay = rows[0].id;
    await L.softDeleteTxn(ACTOR, pay);
    let d = await I.getDashboard(today, today);
    assert.equal(d.toPay, '90000.00');
    assert.equal(d.cashLocker, '195000.00');
    assert.equal((await L.listDeletedTxns()).length, 1);
    await L.restoreTxn(ACTOR, pay);
    d = await I.getDashboard(today, today);
    assert.equal(d.toPay, '50000.00');
    await rejects(() => L.softDeleteTxn(ACTOR, hotelDue), 'delete those payments first');
    await rejects(() => L.softDeleteTxn(ACTOR, pay).then(() => L.softDeleteTxn(ACTOR, pay)), 'already deleted');
    await L.restoreTxn(ACTOR, pay);
  });

  // ───────── booking edits keep receivable in step
  await test('changing package amount updates the receivable; cannot go below collected', async () => {
    await L.updateBooking(ACTOR, bali, L.parseBookingInput(g({ booking_ref: 'SR-BALI-001', client_name: 'Mehta Family', destination: 'Bali', package_amount: '1,60,000', status: 'active' })), L.parseBookingExtras(g({})));
    assert.equal((await I.getDashboard(today, today)).toCollect, '15000.00');
    await rejects(() => L.updateBooking(ACTOR, bali, L.parseBookingInput(g({ booking_ref: 'SR-BALI-001', client_name: 'Mehta Family', package_amount: '100000' })), L.parseBookingExtras(g({}))), 'cannot be less than');
    const b = (await L.getBooking(bali))!;
    assert.equal(b.booking.package_amount, '160000.00', 'failed edit must roll back completely');
  });
  await test('booking-wise summary separates cash from profitability', async () => {
    await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'cash_out', amount: '2500', txn_date: today, location_id: String(hand), booking_ref: 'SR-BALI-001', category: 'Sightseeing', description: 'Airport transfer' })));
    const b = (await L.getBooking(bali))!.booking;
    assert.equal(b.package_amount, '160000.00');
    assert.equal(b.received, '145000.00');
    assert.equal(b.to_collect, '15000.00');
    assert.equal(b.supplier_cost, '90000.00');
    assert.equal(b.supplier_paid, '40000.00');
    assert.equal(b.supplier_outstanding, '50000.00');
    assert.equal(b.other_expenses, '2500.00');
    assert.equal(b.cash_paid, '42500.00');
    assert.equal(b.cash_balance, '102500.00');
    assert.equal(b.expected_margin, '67500.00');
    assert.equal(b.unbilled_amount, '0.00');
  });
  await test('payment inherits supplier and booking from its due', async () => {
    const { rows } = await L.listTxns({ type: 'cash_out', booking_id: bali });
    const settled = rows.find((r) => r.settles_id === hotelDue)!;
    assert.equal(settled.supplier_name, 'Bali Hotels Pvt Ltd');
    assert.equal(settled.booking_ref, 'SR-BALI-001');
  });
  await test('booking with transactions cannot be deleted; empty one can', async () => {
    await rejects(() => L.deleteBooking(ACTOR, bali), 'cancelled');
    const r = await L.createBooking(ACTOR, L.parseBookingInput(g({ booking_ref: 'SR-TEMP', client_name: 'Temp' })), L.parseBookingExtras(g({})));
    await L.deleteBooking(ACTOR, r.id);
    assert.equal(await L.getBooking(r.id), null);
  });

  // ───────── extra locations
  await test('custom cash location: add, deactivate rules', async () => {
    await L.createLocation(ACTOR, g({ name: 'Branch Safe', kind: 'other', opening_balance: '5000' }));
    const safe = (await L.listLocations()).find((l) => l.name === 'Branch Safe')!;
    assert.equal((await I.getDashboard(today, today)).cashOther, '5000.00');
    await rejects(() => L.setLocationActive(ACTOR, safe.id, false), 'balance must be');
    await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'transfer', amount: '5000', txn_date: today, from_location_id: String(safe.id), to_location_id: String(hand) })));
    await L.setLocationActive(ACTOR, safe.id, false);
    await rejects(() => L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'cash_in', amount: '1', txn_date: today, location_id: String(safe.id) }))), 'inactive');
    await rejects(() => L.createLocation(ACTOR, g({ name: 'branch safe', kind: 'other' })), 'already exists');
  });

  // ───────── cash verification
  await test('cash count shows shortage and can post an adjustment', async () => {
    const before = (await L.listLocations()).find((l) => l.id === hand)!.balance; // 72500.00
    assert.equal(before, '72500.00');
    const r1 = await L.recordCashCount(ACTOR, g({ location_id: String(hand), counted_amount: '72,000' }));
    assert.equal(r1.difference, '-500.00');
    assert.equal((await I.getDashboard(today, today)).discrepancies.length, 1);
    assert.equal((await L.listLocations()).find((l) => l.id === hand)!.balance, '72500.00', 'count alone changes nothing');
    await L.recordCashCount(ACTOR, g({ location_id: String(hand), counted_amount: '72000', post_adjustment: 'on', notes: 'Recount' }));
    assert.equal((await L.listLocations()).find((l) => l.id === hand)!.balance, '72000.00');
    const r3 = await L.recordCashCount(ACTOR, g({ location_id: String(hand), counted_amount: '72000' }));
    assert.equal(r3.difference, '0.00');
    assert.equal((await I.getDashboard(today, today)).discrepancies.length, 0);
    assert.equal((await L.listCashCounts()).length, 3);
  });

  // ───────── dates & periods
  await test('period filters include only their dates; transfers never count as inflow', async () => {
    await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'cash_in', amount: '1000', txn_date: yesterday, location_id: String(hand), client_name: 'Walk-in', category: 'Visa fee' })));
    const t = await I.getDashboard(today, today);
    const y = await I.getDashboard(yesterday, yesterday);
    assert.equal(y.inflow, '1000.00');
    assert.equal(y.outflow, '0');
    assert.equal(t.inflow, '145000.00');
    const all = await I.getDashboard('2000-01-01', today);
    assert.equal(all.net, '103000.00');
  });

  // ───────── dues filters
  await test('To Collect / To Pay filters', async () => {
    await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'collection_due', amount: '8000', txn_date: today, client_name: 'Kapoor Corp', due_date: today, category: 'Visa' })));
    await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'collection_due', amount: '12000', txn_date: today, client_name: 'Shah', due_date: addDays(today, 5) })));
    assert.equal((await L.listDues('collection_due', 'today')).length, 1);
    assert.equal((await L.listDues('collection_due', 'week')).length, 2 + 1); // today, +5, and Bali (+3)
    assert.equal((await L.listDues('collection_due', 'overdue')).length, 0);
    assert.equal((await L.listDues('collection_due', 'settled')).length, 0);
    assert.equal((await L.listDues('collection_due', 'open', 'kapoor')).length, 1);
    assert.equal((await L.listDues('payment_due', 'overdue')).length, 1);
  });

  // ───────── reports
  await test('every report runs and totals reconcile with the dashboard', async () => {
    const d = await I.getDashboard('2000-01-01', today);
    const p = { from: addDays(today, -40), to: today };
    for (const key of Object.keys(I.REPORTS) as I.ReportKey[]) {
      const r = await I.runReport(key, p);
      assert.ok(Array.isArray(r.rows), key);
      const csv = reportToCsv(r);
      assert.ok(csv.startsWith('﻿'), 'csv BOM');
    }
    const loc = await I.runReport('location', p);
    assert.equal(sumColumn(loc.rows, 'closing'), d.cashTotal);
    const day = await I.runReport('daybook', p);
    assert.equal(day.rows[day.rows.length - 1].closing, d.cashTotal);
    assert.equal(day.rows[0].opening, '125000.00'); // opening balances incl. Branch Safe
    const col = await I.runReport('collections', p);
    assert.equal(sumColumn(col.rows, 'outstanding'), d.toCollect);
    const pay = await I.runReport('payments', p);
    assert.equal(sumColumn(pay.rows, 'outstanding'), d.toPay);
    const reg = await I.runReport('register', p);
    assert.equal(sumColumn(reg.rows, 'received'), d.inflow);
    assert.equal(sumColumn(reg.rows, 'paid'), d.outflow);
    const mon = await I.runReport('monthly', { from: addDays(today, -400), to: today });
    assert.equal(sumColumn(mon.rows, 'net'), d.net);
    const sup = await I.runReport('supplier', p);
    assert.equal(sup.rows.find((r) => r.supplier === 'Bali Hotels Pvt Ltd')!.outstanding, '50000.00');
    const cli = await I.runReport('client', p);
    assert.equal(cli.rows.find((r) => r.client === 'Mehta Family')!.received, '145000.00');
    const bk = await I.runReport('booking', p);
    assert.equal(bk.rows[0].booking_ref, 'SR-BALI-001');
    const csv = reportToCsv(reg);
    assert.ok(csv.includes(`TOTAL`) && csv.includes(d.inflow));
  });
  await test('CSV neutralises formula injection', async () => {
    await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'cash_in', amount: '1', txn_date: today, location_id: String(hand), description: '=HYPERLINK("http://evil")' })));
    const csv = reportToCsv(await I.runReport('register', { from: today, to: today }));
    assert.ok(csv.includes(`'=HYPERLINK`));
  });

  // ───────── Home / personal and non-booking entries
  await test('Home / personal entries count as physical cash but never touch bookings or business figures', async () => {
    const before = await I.getDashboard(today, today);
    // a home entry: booking/receivable fields are ignored even if sent
    const home = await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'cash_in', entry_for: 'home', amount: '5000', txn_date: today,
      location_id: String(hand), category: 'Rent received', booking_ref: 'SR-BALI-001', settles_id: pkgDue })));
    const t = (await L.getTxn(home.id))!.txn;
    assert.equal(t.account, 'home');
    assert.equal(t.booking_id, null);
    assert.equal(t.settles_id, null);
    const after = await I.getDashboard(today, today);
    assert.equal((Number(after.cashTotal) - Number(before.cashTotal)).toFixed(2), '5000.00', 'home cash is in the locker/hand total');
    assert.equal(after.toCollect, before.toCollect, 'home entries never reduce To Collect');
    assert.equal(after.homeIn, (Number(before.homeIn) + 5000).toFixed(2));
    await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'cash_out', entry_for: 'home', amount: '1200', txn_date: today, location_id: String(hand), category: 'Groceries' })));
    assert.equal((await I.getDashboard(today, today)).homeOut, '1200.00');
    const b = (await L.getBooking(bali))!.booking;
    assert.equal(b.received, '145000.00', 'booking figures unchanged');
    // database refuses a home row linked to a booking even if the app were bypassed
    await rejects(() => sql`update skyroad.txn set booking_id = ${bali}::int where id = ${home.id}::uuid`, 'cannot be linked to a booking');
  });
  await test('Skyroad – no booking entries need no booking; "booking" entries require one', async () => {
    const r = await L.createTxn(ACTOR, L.parseTxnInput(g({ type: 'cash_in', entry_for: 'business', amount: '750', txn_date: today,
      location_id: String(hand), category: 'Commission income', booking_ref: 'SR-BALI-001' })));
    const t = (await L.getTxn(r.id))!.txn;
    assert.equal(t.account, 'business');
    assert.equal(t.booking_id, null, 'booking cleared for a no-booking entry');
    assert.throws(() => L.parseTxnInput(g({ type: 'cash_in', entry_for: 'booking', amount: '1', txn_date: today, location_id: String(hand) })), /booking reference/);
    // entry can be switched from Skyroad to Home on edit
    await L.updateTxn(ACTOR, r.id, L.parseTxnInput(g({ ...t, entry_for: 'home' })));
    assert.equal((await L.getTxn(r.id))!.txn.account, 'home');
  });
  await test('filters and reports separate Skyroad and Home', async () => {
    const homeRows = (await L.listTxns({ scope: 'home' })).rows;
    assert.ok(homeRows.length === 3 && homeRows.every((r) => r.account === 'home'));
    assert.ok((await L.listTxns({ scope: 'booking' })).rows.every((r) => r.booking_id !== null && r.account === 'business'));
    assert.ok((await L.listTxns({ scope: 'business' })).rows.every((r) => r.booking_id === null && r.account === 'business'));
    const split = await I.runReport('split', { from: addDays(today, -40), to: today });
    assert.equal(sumColumn(split.rows, 'home_in'), '5750.00');
    assert.equal(sumColumn(split.rows, 'home_out'), '1200.00');
    const all = await I.getDashboard('2000-01-01', today);
    assert.equal((Number(sumColumn(split.rows, 'biz_net')) + Number(sumColumn(split.rows, 'home_net'))).toFixed(2), all.net, 'Skyroad net + Home net = total net');
    const reg = await I.runReport('register', { from: addDays(today, -40), to: today, scope: 'home' });
    assert.equal(reg.rows.length, 3);
    assert.ok(reg.rows.every((r) => r.entry_for === 'Home / personal'));
    const mon = await I.runReport('monthly', { from: addDays(today, -40), to: today, scope: 'home' });
    assert.equal(sumColumn(mon.rows, 'net'), '4550.00');
  });

  // ───────── search & backup
  await test('global search finds clients, bookings, suppliers and txn IDs', async () => {
    const s1 = await I.globalSearch('mehta');
    assert.equal(s1.bookings.length, 1);
    assert.ok(s1.txns.length >= 3);
    const s2 = await I.globalSearch('ayana');
    assert.ok(s2.txns.some((t) => t.type === 'payment_due'));
    const any = (await L.listTxns({ limit: 1 })).rows[0];
    const s3 = await I.globalSearch(any.txn_no);
    assert.equal(s3.txns[0].txn_no, any.txn_no);
    const s4 = await I.globalSearch('Bali Hotels');
    assert.equal(s4.parties[0].outstanding, '50000.00');
  });
  await test('full JSON backup contains every business table, no secrets', async () => {
    const json = JSON.parse(await I.exportAll());
    assert.ok(json.tables.txn.length > 10);
    assert.ok(json.tables.booking.length >= 1);
    assert.ok(json.tables.audit_log.length > 10);
    assert.ok(!JSON.stringify(json).includes('scrypt$'));
  });
  await test('name suggestions for forms', async () => {
    const s = await L.nameSuggestions();
    assert.ok(s.clients.includes('Mehta Family'));
    assert.ok(s.suppliers.includes('Bali Hotels Pvt Ltd'));
  });

  // ───────── lockout last (it blocks further logins from this IP)
  await test('repeated wrong passwords lock the account for 15 minutes', async () => {
    for (let i = 0; i < 5; i++) await rejects(() => auth.login('Skyroadholidays', 'guess' + i, '9.9.9.9', 't'), 'incorrect');
    await rejects(() => auth.login('Skyroadholidays', 'New-Secret-99', '9.9.9.9', 't'), 'too many');
    // the owner on a different device is not locked out by someone else's guessing
    assert.ok(await auth.login('Skyroadholidays', 'New-Secret-99', '8.8.8.8', 't'));
    for (let i = 0; i < 20; i++) await auth.login('Skyroadholidays', 'x' + i, `7.7.${i}.1`, 't').catch(() => undefined);
    await rejects(() => auth.login('Skyroadholidays', 'New-Secret-99', '6.6.6.6', 't'), 'too many');
  });

  console.log(results.join('\n'));
  console.log(`\n${passed} application tests passed`);
  end();
  setTimeout(() => process.exit(0), 100);
}

main().catch((e) => {
  console.log(results.join('\n'));
  console.error(e);
  process.exit(1);
});

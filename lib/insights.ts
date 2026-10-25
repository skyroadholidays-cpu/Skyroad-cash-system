// Read-only views of the ledger: dashboard, reports, search, backup.
import { db } from './db-core';
import { addDays, isIsoDate, todayIST, fmtDate as fmtD } from './dates';
import { listLocations, type LocationBalance, statusLabel, type TxnType, TXN_TYPE_LABEL } from './ledger';

// ───────────────────────────── dashboard ─────────────────────────────

export interface Dashboard {
  locations: LocationBalance[];
  cashTotal: string; cashHand: string; cashLocker: string; cashOther: string;
  toCollect: string; toPay: string;
  inflow: string; outflow: string; net: string; inCount: number; outCount: number;
  overdueCollect: { count: number; amount: string };
  dueSoonCollect: { count: number; amount: string };
  overduePay: { count: number; amount: string };
  dueSoonPay: { count: number; amount: string };
  recent: { id: string; txn_no: string; txn_date: string; type: TxnType; amount: string; client_name: string | null;
            supplier_name: string | null; booking_ref: string | null; description: string | null; location_label: string | null; created_at: string }[];
  monthly: { month: string; inflow: string; outflow: string; net: string }[];
  discrepancies: { name: string; difference: string; counted_at: string }[];
  negative: { name: string; balance: string }[];
}

export async function getDashboard(from: string, to: string, today = todayIST()): Promise<Dashboard> {
  const sql = db();
  const week = addDays(today, 7);
  const locations = await listLocations();

  const [totals] = await sql<{ total: string; hand: string; locker: string; other: string }>`
    select coalesce(sum(balance), 0)::text as total,
           coalesce(sum(balance) filter (where kind = 'hand'), 0)::text as hand,
           coalesce(sum(balance) filter (where kind = 'locker'), 0)::text as locker,
           coalesce(sum(balance) filter (where kind = 'other'), 0)::text as other
    from skyroad.v_location_balance`;

  const [dues] = await sql<Record<string, string | number>>`
    select
      coalesce(sum(outstanding) filter (where type = 'collection_due'), 0)::text as to_collect,
      coalesce(sum(outstanding) filter (where type = 'payment_due'), 0)::text    as to_pay,
      count(*) filter (where type = 'collection_due' and outstanding > 0 and due_date < ${today}::date)::int as oc_n,
      coalesce(sum(outstanding) filter (where type = 'collection_due' and outstanding > 0 and due_date < ${today}::date), 0)::text as oc_a,
      count(*) filter (where type = 'collection_due' and outstanding > 0 and due_date between ${today}::date and ${week}::date)::int as sc_n,
      coalesce(sum(outstanding) filter (where type = 'collection_due' and outstanding > 0 and due_date between ${today}::date and ${week}::date), 0)::text as sc_a,
      count(*) filter (where type = 'payment_due' and outstanding > 0 and due_date < ${today}::date)::int as op_n,
      coalesce(sum(outstanding) filter (where type = 'payment_due' and outstanding > 0 and due_date < ${today}::date), 0)::text as op_a,
      count(*) filter (where type = 'payment_due' and outstanding > 0 and due_date between ${today}::date and ${week}::date)::int as sp_n,
      coalesce(sum(outstanding) filter (where type = 'payment_due' and outstanding > 0 and due_date between ${today}::date and ${week}::date), 0)::text as sp_a
    from skyroad.v_due`;

  // Net cash movement = external inflows − external outflows. Transfers are internal and excluded.
  const [flow] = await sql<{ inflow: string; outflow: string; net: string; in_n: number; out_n: number }>`
    select coalesce(sum(amount) filter (where type = 'cash_in'), 0)::text  as inflow,
           coalesce(sum(amount) filter (where type = 'cash_out'), 0)::text as outflow,
           (coalesce(sum(amount) filter (where type = 'cash_in'), 0) - coalesce(sum(amount) filter (where type = 'cash_out'), 0))::text as net,
           count(*) filter (where type = 'cash_in')::int as in_n,
           count(*) filter (where type = 'cash_out')::int as out_n
    from skyroad.txn
    where deleted_at is null and type in ('cash_in','cash_out') and txn_date between ${from}::date and ${to}::date`;

  const recent = await sql<Dashboard['recent'][number]>`
    select id::text, txn_no, txn_date::text, type::text, amount::text, client_name, supplier_name, booking_ref, description,
           case when type = 'transfer' then from_location_name || ' → ' || to_location_name else location_name end as location_label,
           created_at::text
    from skyroad.v_txn order by created_at desc limit 8`;

  const monthly = await sql<Dashboard['monthly'][number]>`
    with months as (
      select to_char(m, 'YYYY-MM') as month, m::date as start, (m + interval '1 month')::date as stop
      from generate_series(date_trunc('month', ${today}::date) - interval '11 months', date_trunc('month', ${today}::date), interval '1 month') m)
    select months.month,
           coalesce(sum(t.amount) filter (where t.type = 'cash_in'), 0)::text as inflow,
           coalesce(sum(t.amount) filter (where t.type = 'cash_out'), 0)::text as outflow,
           (coalesce(sum(t.amount) filter (where t.type = 'cash_in'), 0) - coalesce(sum(t.amount) filter (where t.type = 'cash_out'), 0))::text as net
    from months
    left join skyroad.txn t on t.deleted_at is null and t.type in ('cash_in','cash_out')
                           and t.txn_date >= months.start and t.txn_date < months.stop
    group by months.month order by months.month`;

  return {
    locations,
    cashTotal: totals.total, cashHand: totals.hand, cashLocker: totals.locker, cashOther: totals.other,
    toCollect: String(dues.to_collect), toPay: String(dues.to_pay),
    inflow: flow.inflow, outflow: flow.outflow, net: flow.net, inCount: flow.in_n, outCount: flow.out_n,
    overdueCollect: { count: Number(dues.oc_n), amount: String(dues.oc_a) },
    dueSoonCollect: { count: Number(dues.sc_n), amount: String(dues.sc_a) },
    overduePay: { count: Number(dues.op_n), amount: String(dues.op_a) },
    dueSoonPay: { count: Number(dues.sp_n), amount: String(dues.sp_a) },
    recent,
    monthly,
    discrepancies: locations
      .filter((l) => l.is_active && l.last_count_diff !== null && Number(l.last_count_diff) !== 0)
      .map((l) => ({ name: l.name, difference: l.last_count_diff!, counted_at: l.last_count_at! })),
    negative: locations.filter((l) => Number(l.balance) < 0).map((l) => ({ name: l.name, balance: l.balance })),
  };
}

// ───────────────────────────── reports ─────────────────────────────

export type ColKind = 'text' | 'money' | 'date' | 'int';
export interface Column { key: string; label: string; kind: ColKind; total?: boolean }
export interface Report {
  key: ReportKey;
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Record<string, any>[];
  linkKey?: { key: string; href: (row: Record<string, any>) => string };
}

export const REPORTS = {
  register: 'Transaction register',
  daybook: 'Opening & closing cash (day book)',
  location: 'Cash location report',
  monthly: 'Monthly cash flow',
  booking: 'Booking-wise report',
  client: 'Client-wise report',
  supplier: 'Supplier-wise report',
  collections: 'Outstanding collections',
  payments: 'Outstanding payments',
} as const;
export type ReportKey = keyof typeof REPORTS;

export interface ReportParams {
  from: string;
  to: string;
  type?: string | null;
  location_id?: number | null;
  q?: string | null;
}

export async function runReport(key: ReportKey, p: ReportParams, today = todayIST()): Promise<Report> {
  const sql = db();
  let from = isIsoDate(p.from) ? p.from : today.slice(0, 8) + '01';
  let to = isIsoDate(p.to) ? p.to : today;
  const like = p.q?.trim() ? `%${p.q.trim()}%` : null;
  if (key === 'daybook' || key === 'monthly') {
    // Day/month series: never run past today or before the first entry (e.g. "All time").
    const [{ first }] = await sql<{ first: string | null }>`select min(txn_date)::text as first from skyroad.txn where deleted_at is null`;
    if (to > today) to = today;
    if (first && from < first) from = first;
    if (!first && from < to) from = to;
    if (key === 'daybook' && from < addDays(to, -730)) from = addDays(to, -730);
    if (from > to) from = to;
  }
  const range = `${fmtD(from)} to ${fmtD(to)}`;

  switch (key) {
    case 'register': {
      const type = p.type && Object.keys(TXN_TYPE_LABEL).includes(p.type) ? p.type : null;
      const rows = await sql`
        select t.txn_date::text as date, t.txn_no, t.type::text as type, t.client_name, t.booking_ref, t.supplier_name,
               case when t.type = 'transfer' then t.from_location_name || ' → ' || t.to_location_name else t.location_name end as location,
               case when t.type = 'cash_in' then t.amount end::text as received,
               case when t.type = 'cash_out' then t.amount end::text as paid,
               case when t.type in ('transfer','collection_due','payment_due') then t.amount end::text as other_amount,
               d.settle_status, t.category, concat_ws(' · ', t.description, t.notes) as remarks, t.id::text
        from skyroad.v_txn t left join skyroad.v_due d on d.id = t.id
        where t.txn_date between ${from}::date and ${to}::date
          and (${type}::text is null or t.type::text = ${type}::text)
          and (${p.location_id ?? null}::int is null or ${p.location_id ?? null}::int in (t.location_id, t.from_location_id, t.to_location_id))
          and (${like}::text is null or t.txn_no ilike ${like}::text or t.client_name ilike ${like}::text or t.booking_ref ilike ${like}::text
               or t.supplier_name ilike ${like}::text or t.description ilike ${like}::text or t.notes ilike ${like}::text)
        order by t.txn_date, t.created_at`;
      for (const r of rows) {
        r.status = statusLabel(r.type, r.settle_status);
        r.type = TXN_TYPE_LABEL[r.type as TxnType];
      }
      return {
        key, title: REPORTS[key], subtitle: range,
        columns: [
          { key: 'date', label: 'Date', kind: 'date' }, { key: 'txn_no', label: 'Txn ID', kind: 'text' },
          { key: 'type', label: 'Type', kind: 'text' }, { key: 'client_name', label: 'Client', kind: 'text' },
          { key: 'booking_ref', label: 'Booking', kind: 'text' }, { key: 'supplier_name', label: 'Supplier', kind: 'text' },
          { key: 'location', label: 'Cash location', kind: 'text' },
          { key: 'received', label: 'Received', kind: 'money', total: true }, { key: 'paid', label: 'Paid', kind: 'money', total: true },
          { key: 'other_amount', label: 'Transfer / Due', kind: 'money' },
          { key: 'status', label: 'Status', kind: 'text' }, { key: 'remarks', label: 'Remarks', kind: 'text' },
        ],
        rows,
        linkKey: { key: 'txn_no', href: (r) => `/transactions/${r.id}` },
      };
    }

    case 'daybook': {
      // Total physical cash per day. Transfers net to zero so they are left out.
      const rows = await sql`
        with days as (select d::date as day from generate_series(${from}::date, ${to}::date, interval '1 day') d),
        opening as (
          select (select coalesce(sum(opening_balance),0) from skyroad.cash_location)
               + coalesce(sum(case when type = 'cash_in' then amount else -amount end), 0) as amt
          from skyroad.txn where deleted_at is null and type in ('cash_in','cash_out') and txn_date < ${from}::date),
        daily as (
          select days.day,
                 coalesce(sum(t.amount) filter (where t.type = 'cash_in'), 0)  as inflow,
                 coalesce(sum(t.amount) filter (where t.type = 'cash_out'), 0) as outflow
          from days left join skyroad.txn t on t.deleted_at is null and t.type in ('cash_in','cash_out') and t.txn_date = days.day
          group by days.day)
        select day::text as date,
               ((select amt from opening) + coalesce(sum(inflow - outflow) over (order by day rows between unbounded preceding and 1 preceding), 0))::text as opening,
               inflow::text, outflow::text,
               ((select amt from opening) + sum(inflow - outflow) over (order by day))::text as closing
        from daily order by day`;
      return {
        key, title: REPORTS[key], subtitle: `${range} · all cash locations combined`,
        columns: [
          { key: 'date', label: 'Date', kind: 'date' }, { key: 'opening', label: 'Opening cash', kind: 'money' },
          { key: 'inflow', label: 'Cash in', kind: 'money', total: true }, { key: 'outflow', label: 'Cash out', kind: 'money', total: true },
          { key: 'closing', label: 'Closing cash', kind: 'money' },
        ],
        rows,
      };
    }

    case 'location': {
      const rows = await sql`
        select l.name,
          (l.opening_balance + coalesce(sum(case
              when t.type = 'cash_in' and t.location_id = l.id then t.amount
              when t.type = 'cash_out' and t.location_id = l.id then -t.amount
              when t.type = 'transfer' and t.to_location_id = l.id then t.amount
              when t.type = 'transfer' and t.from_location_id = l.id then -t.amount end) filter (where t.txn_date < ${from}::date), 0))::text as opening,
          coalesce(sum(t.amount) filter (where t.type = 'cash_in' and t.location_id = l.id and t.txn_date between ${from}::date and ${to}::date), 0)::text as received,
          coalesce(sum(t.amount) filter (where t.type = 'cash_out' and t.location_id = l.id and t.txn_date between ${from}::date and ${to}::date), 0)::text as paid_out,
          coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.to_location_id = l.id and t.txn_date between ${from}::date and ${to}::date), 0)::text as transfers_in,
          coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.from_location_id = l.id and t.txn_date between ${from}::date and ${to}::date), 0)::text as transfers_out,
          (l.opening_balance + coalesce(sum(case
              when t.type = 'cash_in' and t.location_id = l.id then t.amount
              when t.type = 'cash_out' and t.location_id = l.id then -t.amount
              when t.type = 'transfer' and t.to_location_id = l.id then t.amount
              when t.type = 'transfer' and t.from_location_id = l.id then -t.amount end) filter (where t.txn_date <= ${to}::date), 0))::text as closing
        from skyroad.cash_location l
        left join skyroad.txn t on t.deleted_at is null and (t.location_id = l.id or t.from_location_id = l.id or t.to_location_id = l.id)
        where (${p.location_id ?? null}::int is null or l.id = ${p.location_id ?? null}::int)
        group by l.id order by l.sort_order, l.id`;
      return {
        key, title: REPORTS[key], subtitle: range,
        columns: [
          { key: 'name', label: 'Location', kind: 'text' }, { key: 'opening', label: 'Opening', kind: 'money', total: true },
          { key: 'received', label: 'Cash received', kind: 'money', total: true }, { key: 'paid_out', label: 'Cash paid out', kind: 'money', total: true },
          { key: 'transfers_in', label: 'Transfers in', kind: 'money', total: true }, { key: 'transfers_out', label: 'Transfers out', kind: 'money', total: true },
          { key: 'closing', label: 'Closing', kind: 'money', total: true },
        ],
        rows,
      };
    }

    case 'monthly': {
      const rows = await sql`
        with months as (
          select m::date as start, (m + interval '1 month')::date as stop
          from generate_series(date_trunc('month', ${from}::date), date_trunc('month', ${to}::date), interval '1 month') m)
        select to_char(months.start, 'YYYY-MM') as month,
               coalesce(sum(t.amount) filter (where t.type = 'cash_in'), 0)::text as inflow,
               coalesce(sum(t.amount) filter (where t.type = 'cash_out'), 0)::text as outflow,
               (coalesce(sum(t.amount) filter (where t.type = 'cash_in'), 0) - coalesce(sum(t.amount) filter (where t.type = 'cash_out'), 0))::text as net,
               count(t.id)::int as entries
        from months left join skyroad.txn t on t.deleted_at is null and t.type in ('cash_in','cash_out')
             and t.txn_date >= greatest(months.start, ${from}::date) and t.txn_date < months.stop and t.txn_date <= ${to}::date
        group by months.start order by months.start`;
      return {
        key, title: REPORTS[key], subtitle: range,
        columns: [
          { key: 'month', label: 'Month', kind: 'text' }, { key: 'inflow', label: 'Cash in', kind: 'money', total: true },
          { key: 'outflow', label: 'Cash out', kind: 'money', total: true }, { key: 'net', label: 'Net movement', kind: 'money', total: true },
          { key: 'entries', label: 'Entries', kind: 'int', total: true },
        ],
        rows,
      };
    }

    case 'booking': {
      const rows = await sql`
        select id, booking_ref, client_name, destination, travel_start::text, status, package_amount::text, received::text,
               to_collect::text, supplier_cost::text, supplier_paid::text, supplier_outstanding::text, other_expenses::text,
               cash_balance::text, expected_margin::text
        from skyroad.v_booking_summary
        where (${like}::text is null or booking_ref ilike ${like}::text or client_name ilike ${like}::text or destination ilike ${like}::text)
          and (coalesce(travel_start, created_at::date) between ${from}::date and ${to}::date or to_collect > 0 or supplier_outstanding > 0)
        order by coalesce(travel_start, created_at::date)`;
      return {
        key, title: REPORTS[key], subtitle: `Bookings travelling/created ${range}, plus any with balances outstanding`,
        columns: [
          { key: 'booking_ref', label: 'Booking', kind: 'text' }, { key: 'client_name', label: 'Client', kind: 'text' },
          { key: 'destination', label: 'Destination', kind: 'text' }, { key: 'travel_start', label: 'Travel', kind: 'date' },
          { key: 'package_amount', label: 'Package', kind: 'money', total: true }, { key: 'received', label: 'Received', kind: 'money', total: true },
          { key: 'to_collect', label: 'To collect', kind: 'money', total: true }, { key: 'supplier_cost', label: 'Supplier cost', kind: 'money', total: true },
          { key: 'supplier_paid', label: 'Supplier paid', kind: 'money', total: true }, { key: 'supplier_outstanding', label: 'To pay', kind: 'money', total: true },
          { key: 'other_expenses', label: 'Other exp.', kind: 'money', total: true }, { key: 'cash_balance', label: 'Cash balance', kind: 'money', total: true },
          { key: 'expected_margin', label: 'Expected margin', kind: 'money', total: true },
        ],
        rows,
        linkKey: { key: 'booking_ref', href: (r) => `/bookings/${r.id}` },
      };
    }

    case 'client': {
      const rows = await sql`
        select coalesce(nullif(t.client_name, ''), '(no client)') as client,
               count(distinct t.booking_id)::int as bookings,
               coalesce(sum(t.amount) filter (where t.type = 'collection_due' and t.txn_date between ${from}::date and ${to}::date), 0)::text as billed,
               coalesce(sum(t.amount) filter (where t.type = 'cash_in' and t.txn_date between ${from}::date and ${to}::date), 0)::text as received,
               coalesce(sum(d.outstanding), 0)::text as outstanding,
               max(t.txn_date) filter (where t.type = 'cash_in')::text as last_payment
        from skyroad.v_txn t left join skyroad.v_due d on d.id = t.id and d.type = 'collection_due'
        where t.type in ('cash_in','collection_due')
          and (${like}::text is null or t.client_name ilike ${like}::text)
        group by 1
        having coalesce(sum(t.amount) filter (where t.txn_date between ${from}::date and ${to}::date), 0) > 0 or coalesce(sum(d.outstanding), 0) > 0
        order by 1`;
      return {
        key, title: REPORTS[key], subtitle: `Billed and received ${range}; outstanding as of today`,
        columns: [
          { key: 'client', label: 'Client', kind: 'text' }, { key: 'bookings', label: 'Bookings', kind: 'int' },
          { key: 'billed', label: 'Billed (receivables raised)', kind: 'money', total: true },
          { key: 'received', label: 'Received', kind: 'money', total: true },
          { key: 'outstanding', label: 'Outstanding', kind: 'money', total: true }, { key: 'last_payment', label: 'Last payment', kind: 'date' },
        ],
        rows,
      };
    }

    case 'supplier': {
      const rows = await sql`
        select coalesce(nullif(t.supplier_name, ''), '(no supplier)') as supplier,
               string_agg(distinct t.service_provider, ', ') as providers,
               coalesce(sum(t.amount) filter (where t.type = 'payment_due' and t.txn_date between ${from}::date and ${to}::date), 0)::text as invoiced,
               coalesce(sum(t.amount) filter (where t.type = 'cash_out' and t.txn_date between ${from}::date and ${to}::date), 0)::text as paid,
               coalesce(sum(d.outstanding), 0)::text as outstanding,
               max(t.txn_date) filter (where t.type = 'cash_out')::text as last_payment
        from skyroad.v_txn t left join skyroad.v_due d on d.id = t.id and d.type = 'payment_due'
        where (t.type = 'payment_due' or (t.type = 'cash_out' and t.supplier_name is not null))
          and (${like}::text is null or t.supplier_name ilike ${like}::text or t.service_provider ilike ${like}::text)
        group by 1
        having coalesce(sum(t.amount) filter (where t.txn_date between ${from}::date and ${to}::date), 0) > 0 or coalesce(sum(d.outstanding), 0) > 0
        order by 1`;
      return {
        key, title: REPORTS[key], subtitle: `Invoiced and paid ${range}; outstanding as of today`,
        columns: [
          { key: 'supplier', label: 'Supplier', kind: 'text' }, { key: 'providers', label: 'Hotels / providers', kind: 'text' },
          { key: 'invoiced', label: 'Invoiced', kind: 'money', total: true }, { key: 'paid', label: 'Paid', kind: 'money', total: true },
          { key: 'outstanding', label: 'Outstanding', kind: 'money', total: true }, { key: 'last_payment', label: 'Last payment', kind: 'date' },
        ],
        rows,
      };
    }

    case 'collections':
    case 'payments': {
      const kind = key === 'collections' ? 'collection_due' : 'payment_due';
      const rows = await sql`
        select d.id::text, d.txn_no, d.client_name, d.supplier_name, d.service_provider, d.booking_ref, d.description,
               d.amount::text, d.settled::text, d.outstanding::text, d.due_date::text, d.last_settled_on::text,
               case when d.due_date is null then null else (${today}::date - d.due_date) end::int as days_overdue
        from skyroad.v_due d
        where d.type::text = ${kind}::text and d.outstanding > 0
          and (${like}::text is null or d.client_name ilike ${like}::text or d.supplier_name ilike ${like}::text or d.booking_ref ilike ${like}::text)
        order by d.due_date nulls last`;
      for (const r of rows) if (r.days_overdue !== null && r.days_overdue <= 0) r.days_overdue = null;
      const party: Column = key === 'collections'
        ? { key: 'client_name', label: 'Client', kind: 'text' }
        : { key: 'supplier_name', label: 'Supplier', kind: 'text' };
      const cols: Column[] = [
        { key: 'txn_no', label: 'Ref', kind: 'text' }, party,
        ...(key === 'payments' ? [{ key: 'service_provider', label: 'Hotel / provider', kind: 'text' as ColKind }] : []),
        { key: 'booking_ref', label: 'Booking', kind: 'text' }, { key: 'description', label: 'Description', kind: 'text' },
        { key: 'amount', label: 'Total', kind: 'money', total: true }, { key: 'settled', label: key === 'collections' ? 'Collected' : 'Paid', kind: 'money', total: true },
        { key: 'outstanding', label: 'Outstanding', kind: 'money', total: true }, { key: 'due_date', label: 'Due date', kind: 'date' },
        { key: 'last_settled_on', label: 'Last payment', kind: 'date' }, { key: 'days_overdue', label: 'Days overdue', kind: 'int' },
      ];
      return {
        key, title: REPORTS[key], subtitle: `As of ${fmtD(today)}`, columns: cols, rows,
        linkKey: { key: 'txn_no', href: (r) => `/transactions/${r.id}` },
      };
    }
  }
}

// ───────────────────────────── global search ─────────────────────────────

export async function globalSearch(q: string) {
  const term = q.trim();
  if (term.length < 1) return { bookings: [], txns: [], parties: [] };
  const like = `%${term}%`;
  const sql = db();
  const bookings = await sql<{ id: number; booking_ref: string; client_name: string; destination: string | null; to_collect: string; supplier_outstanding: string }>`
    select id, booking_ref, client_name, destination, to_collect::text, supplier_outstanding::text from skyroad.v_booking_summary
    where booking_ref ilike ${like}::text or client_name ilike ${like}::text or destination ilike ${like}::text or notes ilike ${like}::text
    order by id desc limit 20`;
  const txns = await sql<{ id: string; txn_no: string; txn_date: string; type: TxnType; amount: string; client_name: string | null;
                           supplier_name: string | null; booking_ref: string | null; description: string | null }>`
    select id::text, txn_no, txn_date::text, type::text, amount::text, client_name, supplier_name, booking_ref, description
    from skyroad.v_txn
    where txn_no ilike ${like}::text or client_name ilike ${like}::text or supplier_name ilike ${like}::text
       or service_provider ilike ${like}::text or booking_ref ilike ${like}::text or description ilike ${like}::text
       or notes ilike ${like}::text
    order by txn_date desc, created_at desc limit 30`;
  const parties = await sql<{ name: string; role: string; outstanding: string }>`
    select name, role, sum(outstanding)::text as outstanding from (
      select client_name as name, 'Client' as role, outstanding from skyroad.v_due where type = 'collection_due' and client_name ilike ${like}::text
      union all
      select supplier_name, 'Supplier', outstanding from skyroad.v_due where type = 'payment_due' and supplier_name ilike ${like}::text
    ) x group by name, role order by name limit 20`;
  return { bookings, txns, parties };
}

// ───────────────────────────── backup ─────────────────────────────

/** Full JSON export of every business table (passwords and sessions excluded). */
export async function exportAll(): Promise<string> {
  const sql = db();
  const tables: Record<string, unknown> = {};
  tables.cash_location = JSON.parse((await sql<{ d: string }>`select coalesce(json_agg(t order by t.id), '[]')::text as d from skyroad.cash_location t`)[0].d);
  tables.booking = JSON.parse((await sql<{ d: string }>`select coalesce(json_agg(t order by t.id), '[]')::text as d from skyroad.booking t`)[0].d);
  tables.txn = JSON.parse((await sql<{ d: string }>`select coalesce(json_agg(t order by t.created_at), '[]')::text as d from skyroad.txn t`)[0].d);
  tables.cash_count = JSON.parse((await sql<{ d: string }>`select coalesce(json_agg(t order by t.id), '[]')::text as d from skyroad.cash_count t`)[0].d);
  tables.audit_log = JSON.parse((await sql<{ d: string }>`select coalesce(json_agg(t order by t.id), '[]')::text as d from skyroad.audit_log t`)[0].d);
  return JSON.stringify({ app: 'skyroad-cash', format: 1, exported_at: new Date().toISOString(), tables }, null, 1);
}

import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { getDashboard } from '@/lib/insights';
import { fxSummary, fxFormat } from '@/lib/forex';
import { partySummary } from '@/lib/parties';
import { resolvePeriod, todayIST, fmtDate, fmtDateTime } from '@/lib/dates';
import { inr } from '@/lib/money';
import { TXN_TYPE_LABEL } from '@/lib/constants';
import { StatCard, Card, Money, Icon, Empty } from '@/components/ui';
import { MonthlyChart } from '@/components/BarChart';
import { AutoRefresh } from '@/components/client';

export const metadata = { title: 'Dashboard' };

const PERIODS = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' },
  { key: 'fy', label: 'This FY' }, { key: 'custom', label: 'Custom' },
];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const today = todayIST();
  const period = resolvePeriod(sp, today, 'month');
  // Forex / Parties tolerate a database step that hasn't been run yet, so the dashboard always loads.
  const optional = <T,>(p: Promise<T>) => p.catch((e: { code?: string }) => { if (e?.code === '42P01') return null; throw e; });
  const [d, fx, parties] = await Promise.all([getDashboard(period.from, period.to, today), optional(fxSummary()), optional(partySummary())]);
  const activeLocations = d.locations.filter((l) => l.is_active);

  return (
    <div className="stack">
      <AutoRefresh />
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">{fmtDate(today)} · figures update automatically on every device</p>
        </div>
        <div className="page-actions no-print">
          <div className="chips">
            {PERIODS.map((p) => (
              <Link key={p.key} href={p.key === 'custom' ? `/?period=custom&from=${period.from}&to=${period.to}` : `/?period=${p.key}`}
                    className={`chip${period.key === p.key ? ' chip-on' : ''}`}>{p.label}</Link>
            ))}
          </div>
        </div>
      </div>

      {period.key === 'custom' && (
        <form className="filters card" method="get">
          <input type="hidden" name="period" value="custom" />
          <label className="field"><span className="field-label">From</span><input type="date" name="from" defaultValue={period.from} /></label>
          <label className="field"><span className="field-label">To</span><input type="date" name="to" defaultValue={period.to} /></label>
          <button className="btn btn-primary" type="submit">Apply</button>
        </form>
      )}

      {/* Alerts first: what needs attention today */}
      {(d.overdueCollect.count > 0 || d.overduePay.count > 0 || d.dueSoonPay.count > 0 || d.dueSoonCollect.count > 0 || d.discrepancies.length > 0 || d.negative.length > 0) && (
        <div className="alerts">
          {d.negative.map((n) => (
            <div key={n.name} className="alert-row red">{Icon.alert}<span><strong>{n.name}</strong> shows a negative balance of {inr(n.balance)}. A receipt may be missing or a payment recorded against the wrong location.</span><Link href="/cash">Check</Link></div>
          ))}
          {d.discrepancies.map((x) => (
            <div key={x.name} className="alert-row red">{Icon.alert}<span>Last count of <strong>{x.name}</strong> ({fmtDateTime(x.counted_at)}) was {Number(x.difference) < 0 ? 'short' : 'over'} by {inr(x.difference.replace('-', ''))}.</span><Link href="/cash">Review</Link></div>
          ))}
          {d.overdueCollect.count > 0 && (
            <div className="alert-row red">{Icon.alert}<span><strong>{d.overdueCollect.count}</strong> overdue client collection{d.overdueCollect.count > 1 ? 's' : ''} · {inr(d.overdueCollect.amount)}</span><Link href="/collect?f=overdue">Follow up</Link></div>
          )}
          {d.overduePay.count > 0 && (
            <div className="alert-row amber">{Icon.alert}<span><strong>{d.overduePay.count}</strong> overdue supplier payment{d.overduePay.count > 1 ? 's' : ''} · {inr(d.overduePay.amount)}</span><Link href="/pay?f=overdue">View</Link></div>
          )}
          {d.dueSoonPay.count > 0 && (
            <div className="alert-row blue">{Icon.alert}<span><strong>{d.dueSoonPay.count}</strong> supplier payment{d.dueSoonPay.count > 1 ? 's' : ''} due in the next 7 days · {inr(d.dueSoonPay.amount)}</span><Link href="/pay?f=week">Plan</Link></div>
          )}
          {d.dueSoonCollect.count > 0 && (
            <div className="alert-row blue">{Icon.alert}<span><strong>{d.dueSoonCollect.count}</strong> client collection{d.dueSoonCollect.count > 1 ? 's' : ''} expected in the next 7 days · {inr(d.dueSoonCollect.amount)}</span><Link href="/collect?f=week">Remind</Link></div>
          )}
        </div>
      )}

      <div>
        <p className="stats-label">Physical cash – right now</p>
        <div className="stats" style={{ marginTop: 12 }}>
          <StatCard label="Total cash available" value={d.cashTotal} tone="cash" emphasis icon={Icon.wallet} href="/cash"
                    hint={`Across ${activeLocations.length} cash location${activeLocations.length === 1 ? '' : 's'}`} />
          {activeLocations.map((l) => (
            <StatCard key={l.id} label={l.name} value={l.balance} tone="cash" href={`/transactions/new?type=cash_in&location=${l.id}`}
                      icon={l.kind === 'hand' ? Icon.hand : l.kind === 'locker' ? Icon.locker : Icon.wallet}
                      hint={l.last_count_diff && Number(l.last_count_diff) !== 0
                        ? <span className="neg">Last count {Number(l.last_count_diff) < 0 ? 'short' : 'over'} by {inr(l.last_count_diff.replace('-', ''))}</span>
                        : Number(l.balance) < 0 ? <span className="neg">Negative – check entries</span> : 'Current balance'} />
          ))}
          <Link href="/forex" className="stat stat-net fx-stat">
            <div className="stat-top"><span className="stat-label">Forex Reserve</span><span className="stat-icon">{Icon.wallet}</span></div>
            <div className="stat-value">{fx?.currencies ? <span className="money">≈ {inr(fx.inrValue)}</span> : <span className="muted" style={{ fontSize: '1rem' }}>{fx ? 'No forex held' : 'Run 005_forex.sql'}</span>}</div>
            <div className="stat-hint">{fx?.held.length ? fx.held.slice(0, 4).map((c) => fxFormat(c.balance, c.code)).join(' · ') + (fx.held.length > 4 ? ' …' : '') : 'USD, EUR, THB, JPY, IDR, VND'}</div>
          </Link>
        </div>
      </div>

      <div>
        <p className="stats-label">Outstanding – not yet cash</p>
        <div className="stats" style={{ marginTop: 12 }}>
          <StatCard label="To collect" value={d.toCollect} tone="due" icon={Icon.collect} href="/collect" hint={d.overdueCollect.count ? <span className="neg">{inr(d.overdueCollect.amount)} overdue</span> : Number(d.homeCollect) > 0 ? `incl. Home ${inr(d.homeCollect)}` : 'Receivables'} />
          <Link href="/parties" className="stat stat-due">
            <div className="stat-top"><span className="stat-label">Parties</span><span className="stat-icon">{Icon.collect}</span></div>
            {parties ? (
              <>
                <div className="party-split">
                  <span><small>Owed to you</small><strong className="pos money">{inr(parties.owedToMe)}</strong></span>
                  <span><small>You owe</small><strong className="neg money">{inr(parties.iOwe)}</strong></span>
                </div>
                <div className="stat-hint">{parties.open ? `${parties.open} open account${parties.open === 1 ? '' : 's'}` : 'All settled'}</div>
              </>
            ) : <div className="stat-hint">Run 006_parties.sql to switch this on</div>}
          </Link>
          <StatCard label="To pay" value={d.toPay} tone="pay" icon={Icon.pay} href="/pay" hint={d.overduePay.count ? <span className="neg">{inr(d.overduePay.amount)} overdue</span> : Number(d.homePay) > 0 ? `incl. Home ${inr(d.homePay)}` : 'Payables'} />
        </div>
      </div>

      <div>
        <p className="stats-label">Cash flow – {period.label}</p>
        <div className="stats" style={{ marginTop: 12 }}>
          <StatCard label="Total cash inflow" value={d.inflow} tone="in" icon={Icon.in} href={`/transactions?type=cash_in&from=${period.from}&to=${period.to}`} hint={Number(d.homeIn) > 0 ? `incl. Home ${inr(d.homeIn)}` : `${d.inCount} receipt${d.inCount === 1 ? '' : 's'}`} />
          <StatCard label="Total cash outflow" value={d.outflow} tone="out" icon={Icon.out} href={`/transactions?type=cash_out&from=${period.from}&to=${period.to}`} hint={Number(d.homeOut) > 0 ? `incl. Home ${inr(d.homeOut)}` : `${d.outCount} payment${d.outCount === 1 ? '' : 's'}`} />
          <StatCard label="Net cash movement" value={d.net} tone="net" icon={Icon.transfer} hint="Inflow − outflow (transfers excluded)" />
        </div>
      </div>

      <div className="quick no-print">
        <Link href="/transactions/new?type=cash_in"><span className="qi qi-in">{Icon.in}</span>Add Cash In</Link>
        <Link href="/transactions/new?type=cash_out"><span className="qi qi-out">{Icon.out}</span>Add Cash Out</Link>
        <Link href="/transactions/new?type=cash_in&for=home"><span className="qi qi-booking">{Icon.hand}</span>Home / Personal</Link>
        <Link href="/bookings/new"><span className="qi qi-booking">{Icon.booking}</span>New Booking</Link>
        <Link href="/collect"><span className="qi qi-collect">{Icon.collect}</span>Record Collection</Link>
        <Link href="/pay"><span className="qi qi-pay">{Icon.pay}</span>Record Payment</Link>
        <Link href="/transactions/new?type=transfer"><span className="qi qi-transfer">{Icon.transfer}</span>Cash Transfer</Link>
      </div>

      <div className="two-col">
        <Card title="Monthly cash flow" actions={<Link href="/reports?r=monthly&period=fy" className="small">Full report</Link>}>
          <MonthlyChart data={d.monthly} />
        </Card>
        <Card title="Recent activity" actions={<Link href="/transactions" className="small">All transactions</Link>}>
          {d.recent.length === 0 ? (
            <Empty title="No entries yet">Start by setting your opening cash in <Link href="/cash">Cash &amp; Locker</Link>, then add your first entry.</Empty>
          ) : (
            <ul className="feed">
              {d.recent.map((t) => {
                const icon = t.type === 'cash_in' ? ['qi-in', Icon.in] : t.type === 'cash_out' ? ['qi-out', Icon.out] : t.type === 'transfer' ? ['qi-transfer', Icon.transfer] : t.type === 'collection_due' ? ['qi-collect', Icon.collect] : ['qi-pay', Icon.pay];
                return (
                  <li key={t.id}>
                    <span className={`fi ${icon[0]}`}>{icon[1]}</span>
                    <span className="ft">
                      <Link href={`/transactions/${t.id}`} className="row-link"><strong>{t.client_name || t.supplier_name || t.description || TXN_TYPE_LABEL[t.type]}</strong></Link>
                      <span>{t.account === 'home' ? 'Home · ' : ''}{TXN_TYPE_LABEL[t.type]} · {fmtDate(t.txn_date)}{t.booking_ref ? ` · ${t.booking_ref}` : ''}{t.location_label ? ` · ${t.location_label}` : ''}</span>
                    </span>
                    <Money value={t.amount} tone={t.type === 'cash_in' ? 'in' : t.type === 'cash_out' ? 'out' : undefined} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

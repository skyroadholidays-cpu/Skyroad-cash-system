// Shared server component for the To Collect and To Pay pages.
import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as L from '@/lib/ledger';
import { fmtDate, todayIST } from '@/lib/dates';
import { sumColumn } from '@/lib/csv';
import { Card, Chips, Empty, Flash, Money, PageHeader, StatusBadge } from '@/components/ui';
import { AutoRefresh } from '@/components/client';

const FILTERS: { key: L.DueFilter; label: string }[] = [
  { key: 'open', label: 'All outstanding' }, { key: 'overdue', label: 'Overdue' }, { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Next 7 days' }, { key: 'settled', label: 'Fully settled' }, { key: 'all', label: 'Everything' },
];

export async function DuesPage({ kind, sp }: { kind: L.DueKind; sp: Record<string, string | undefined> }) {
  await requireUser();
  const isCollect = kind === 'collection_due';
  const today = todayIST();
  const filter = (FILTERS.some((f) => f.key === sp.f) ? sp.f : 'open') as L.DueFilter;
  const scope = L.parseScope(sp.scope);
  const [rows, overdue] = await Promise.all([L.listDues(kind, filter, sp.q, today, scope), L.listDues(kind, 'overdue', null, today, scope)]);
  const base = isCollect ? '/collect' : '/pay';
  const outstanding = sumColumn(rows, 'outstanding');

  return (
    <div className="stack">
      <AutoRefresh />
      <PageHeader
        title={isCollect ? 'To Collect' : 'To Pay'}
        subtitle={isCollect ? 'Money still owed to you – clients, and Home amounts. Pending amounts are never counted as cash.' : 'Money you still owe – suppliers, salaries, office bills, and Home bills.'}
        actions={<>
          <a href={`/api/export?r=${isCollect ? 'collections' : 'payments'}&q=${encodeURIComponent(sp.q ?? '')}${scope ? `&scope=${scope}` : ''}`} className="btn btn-ghost">Export CSV</a>
          <Link href={`/transactions/new?type=${kind}`} className="btn btn-primary">+ {isCollect ? 'New amount to collect' : 'New amount to pay'}</Link>
        </>} />
      {sp.saved && <Flash>Saved {sp.saved}. The outstanding balance and cash have been updated.</Flash>}

      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className={`stat stat-${isCollect ? 'due' : 'pay'}`}><span className="stat-label">Outstanding in this view</span><span className="stat-value"><Money value={outstanding} /></span><span className="stat-hint">{rows.length} item{rows.length === 1 ? '' : 's'}</span></div>
        <div className="stat stat-out"><span className="stat-label">Overdue</span><span className="stat-value"><Money value={sumColumn(overdue, 'outstanding')} /></span><span className="stat-hint">{overdue.length} item{overdue.length === 1 ? '' : 's'} past due date</span></div>
      </div>

      <Card>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <Chips base={base} param="f" value={filter} options={FILTERS.map((f) => ({ ...f, count: f.key === 'overdue' ? overdue.length : undefined }))} keep={{ q: sp.q, scope: scope ?? undefined }} />
          <form method="get" className="row">
            <input type="hidden" name="f" value={filter} />
            <select name="scope" defaultValue={scope ?? ''} style={{ width: 'auto' }} aria-label="Entry for">
              <option value="">Skyroad + Home</option>
              <option value="skyroad">Skyroad (all)</option>
              <option value="booking">Skyroad bookings</option>
              <option value="business">Skyroad – no booking</option>
              <option value="home">Home / personal</option>
            </select>
            <input name="q" defaultValue={sp.q ?? ''} placeholder={isCollect ? 'Client or booking ref' : 'Supplier, hotel or booking'} style={{ width: 230 }} />
            <button className="btn btn-ghost" type="submit">Search</button>
          </form>
        </div>

        {rows.length === 0 ? (
          <Empty title={filter === 'open' ? (isCollect ? 'Nothing to collect' : 'Nothing to pay') : 'Nothing in this view'}>
            {isCollect ? 'Receivables are created automatically when you add a booking with a package amount.' : 'Add supplier invoices as "Payment Due" entries.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{isCollect ? 'Owed by' : 'Pay to'}</th>
                  <th>Booking</th>
                  {isCollect && <th className="num">Booking total</th>}
                  <th className="num">{isCollect ? 'Receivable' : 'Invoice'}</th>
                  <th className="num">{isCollect ? 'Collected' : 'Paid'}</th>
                  <th className="num">Outstanding</th>
                  <th>{isCollect ? 'Expected' : 'Due date'}</th>
                  <th>Last payment</th>
                  <th>Status</th>
                  <th className="no-print"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className={d.is_overdue ? 'row-overdue' : ''}>
                    <td>
                      <Link href={`/transactions/${d.id}`} className="row-link">{(isCollect ? d.client_name : d.supplier_name) || '—'}</Link>{d.account === 'home' && <> <span className="badge b-home">Home</span></>}
                      <span className="sub">{[!isCollect && d.service_provider, d.description, d.notes].filter(Boolean).join(' · ') || d.txn_no}</span>
                    </td>
                    <td>{d.booking_id ? <Link href={`/bookings/${d.booking_id}`}>{d.booking_ref}</Link> : '—'}</td>
                    {isCollect && <td className="num">{d.package_amount ? <Money value={d.package_amount} /> : '—'}</td>}
                    <td className="num"><Money value={d.amount} /></td>
                    <td className="num"><Money value={d.settled} /></td>
                    <td className="num"><strong><Money value={d.outstanding} /></strong></td>
                    <td className={d.is_overdue ? 'neg' : ''}>{fmtDate(d.due_date)}</td>
                    <td>{fmtDate(d.last_settled_on)}</td>
                    <td><StatusBadge type={d.type} settleStatus={d.settle_status} overdue={d.is_overdue} /></td>
                    <td className="no-print">
                      {Number(d.outstanding) > 0 && <Link href={`/settle/${d.id}`} className="btn btn-primary btn-sm">{isCollect ? 'Collect' : 'Pay'}</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={isCollect ? 3 : 2}>Total</td>
                  <td className="num"><Money value={sumColumn(rows, 'amount')} /></td>
                  <td className="num"><Money value={sumColumn(rows, 'settled')} /></td>
                  <td className="num"><Money value={outstanding} /></td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <p className="muted small">Today is {fmtDate(today)}. Rows marked red are past their date.</p>
    </div>
  );
}

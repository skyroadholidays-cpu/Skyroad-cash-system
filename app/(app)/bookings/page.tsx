import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as L from '@/lib/ledger';
import { fmtDate } from '@/lib/dates';
import { sumColumn } from '@/lib/csv';
import { Card, Chips, Empty, Flash, Money, PageHeader } from '@/components/ui';
import { AutoRefresh } from '@/components/client';

export const metadata = { title: 'Bookings' };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const status = ['active', 'completed', 'cancelled', 'all'].includes(sp.status ?? '') ? sp.status! : 'active';
  const rows = await L.listBookings(sp.q, status === 'all' ? null : status);

  return (
    <div className="stack">
      <AutoRefresh />
      <PageHeader title="Booking-wise cash" subtitle="Money received and paid against every booking. Package value and supplier cost are shown separately from actual cash."
        actions={<>
          <a href={`/api/export?r=booking&from=2000-01-01&to=2999-12-31&q=${encodeURIComponent(sp.q ?? '')}`} className="btn btn-ghost">Export CSV</a>
          <Link href="/bookings/new" className="btn btn-primary">+ New booking</Link>
        </>} />
      {sp.deleted && <Flash>Booking deleted.</Flash>}
      <Card>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <Chips base="/bookings" param="status" value={status} keep={{ q: sp.q }}
                 options={[{ key: 'active', label: 'Active' }, { key: 'completed', label: 'Completed' }, { key: 'cancelled', label: 'Cancelled' }, { key: 'all', label: 'All' }]} />
          <form method="get" className="row">
            <input type="hidden" name="status" value={status} />
            <input name="q" defaultValue={sp.q ?? ''} placeholder="Ref, client or destination" style={{ width: 240 }} />
            <button className="btn btn-ghost" type="submit">Search</button>
          </form>
        </div>
        {rows.length === 0 ? <Empty title="No bookings here yet"><Link href="/bookings/new">Create your first booking</Link></Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Booking</th><th>Travel</th>
                  <th className="num">Package</th><th className="num">Received</th><th className="num">To collect</th>
                  <th className="num">Supplier cost</th><th className="num">Supplier paid</th><th className="num">To pay</th>
                  <th className="num">Cash balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td><Link href={`/bookings/${b.id}`} className="row-link">{b.booking_ref}</Link><span className="sub">{b.client_name}{b.destination ? ` · ${b.destination}` : ''}</span></td>
                    <td className="num">{fmtDate(b.travel_start)}</td>
                    <td className="num"><Money value={b.package_amount} /></td>
                    <td className="num"><Money value={b.received} tone="in" /></td>
                    <td className="num">{Number(b.to_collect) > 0 ? <strong><Money value={b.to_collect} /></strong> : <span className="muted">—</span>}</td>
                    <td className="num"><Money value={b.supplier_cost} /></td>
                    <td className="num"><Money value={b.supplier_paid} tone="out" /></td>
                    <td className="num">{Number(b.supplier_outstanding) > 0 ? <strong><Money value={b.supplier_outstanding} /></strong> : <span className="muted">—</span>}</td>
                    <td className="num"><Money value={b.cash_balance} tone="auto" /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total ({rows.length})</td>
                  {(['package_amount', 'received', 'to_collect', 'supplier_cost', 'supplier_paid', 'supplier_outstanding', 'cash_balance'] as const).map((k) => (
                    <td key={k} className="num"><Money value={sumColumn(rows, k)} /></td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

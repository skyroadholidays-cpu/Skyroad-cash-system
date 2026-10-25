import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import * as L from '@/lib/ledger';
import { fmtDate } from '@/lib/dates';
import { inr } from '@/lib/money';
import { Card, Empty, Flash, Money, PageHeader, StatusBadge, TypeBadge } from '@/components/ui';
import { AutoRefresh, PrintButton } from '@/components/client';

export const metadata = { title: 'Booking' };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const found = await L.getBooking(Number(id));
  if (!found) notFound();
  const { booking: b, txns } = found;
  const dues = txns.filter((t) => t.type === 'collection_due' || t.type === 'payment_due');
  const cash = txns.filter((t) => t.type === 'cash_in' || t.type === 'cash_out');
  const travel = b.travel_start ? `${fmtDate(b.travel_start)}${b.travel_end ? ` – ${fmtDate(b.travel_end)}` : ''}` : 'Dates not set';

  return (
    <div className="stack">
      <AutoRefresh />
      <div className="print-only print-head"><strong>Skyroad Holidays – Booking statement</strong><span>{b.booking_ref}</span></div>
      <PageHeader title={b.booking_ref}
        subtitle={<>{b.client_name}{b.destination ? ` · ${b.destination}` : ''} · {travel} · <span className="badge b-transfer">{b.status}</span></>}
        actions={<>
          <PrintButton label="Print statement" />
          <Link href={`/transactions/new?type=cash_in&booking=${encodeURIComponent(b.booking_ref)}`} className="btn btn-ghost">+ Collection</Link>
          <Link href={`/transactions/new?type=payment_due&booking=${encodeURIComponent(b.booking_ref)}`} className="btn btn-ghost">+ Supplier invoice</Link>
          <Link href={`/transactions/new?type=cash_out&booking=${encodeURIComponent(b.booking_ref)}`} className="btn btn-ghost">+ Payment</Link>
          <Link href={`/bookings/${b.id}/edit`} className="btn btn-primary">Edit</Link>
        </>} />
      {sp.saved && <Flash>Booking saved.</Flash>}
      {Number(b.unbilled_amount) !== 0 && (
        <Flash tone="warn">
          {Number(b.unbilled_amount) > 0
            ? <>{inr(b.unbilled_amount)} of the package amount has not been raised as a client receivable, so it isn&apos;t in To Collect. <Link href={`/bookings/${b.id}/edit`}>Raise it</Link> or add a Collection Due.</>
            : <>Receivables raised exceed the package amount by {inr(b.unbilled_amount.replace('-', ''))}. Check the package amount.</>}
        </Flash>
      )}

      <div className="three-col">
        <Card title="Client side">
          <div className="loc-lines">
            <span>Package amount</span><span>{inr(b.package_amount)}</span>
            <span>Received (cash)</span><span className="pos">{inr(b.received)}</span>
            <span><strong>Remaining to collect</strong></span><span><strong className={Number(b.to_collect) > 0 ? 'neg' : ''}>{inr(b.to_collect)}</strong></span>
          </div>
        </Card>
        <Card title="Supplier side">
          <div className="loc-lines">
            <span>Supplier cost (invoices)</span><span>{inr(b.supplier_cost)}</span>
            <span>Paid to suppliers</span><span className="neg">{inr(b.supplier_paid)}</span>
            <span><strong>Remaining to pay</strong></span><span><strong className={Number(b.supplier_outstanding) > 0 ? 'neg' : ''}>{inr(b.supplier_outstanding)}</strong></span>
            <span>Other expenses</span><span>{inr(b.other_expenses)}</span>
          </div>
        </Card>
        <Card title="Cash & margin">
          <div className="loc-lines">
            <span>Cash received</span><span className="pos">{inr(b.received)}</span>
            <span>Cash paid</span><span className="neg">{inr(b.cash_paid)}</span>
            <span><strong>Booking cash balance</strong></span><span><Money value={b.cash_balance} tone="auto" className="strong" /></span>
            <span>Expected margin</span><span>{inr(b.expected_margin)}</span>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>Margin = package − supplier cost − other expenses. It is not cash until collected and paid.</p>
        </Card>
      </div>

      <div className="stack">
        <Card title="Receivables & supplier invoices">
          {dues.length === 0 ? <Empty title="None yet" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Ref</th><th>Party</th><th className="num">Amount</th><th className="num">Outstanding</th><th>Due</th><th>Status</th><th className="no-print"></th></tr></thead>
                <tbody>
                  {dues.map((d) => (
                    <tr key={d.id}>
                      <td><Link href={`/transactions/${d.id}`}>{d.txn_no}</Link><span className="sub"><TypeBadge type={d.type} /></span></td>
                      <td>{d.type === 'collection_due' ? d.client_name : d.supplier_name}<span className="sub">{d.service_provider ?? d.description ?? ''}</span></td>
                      <td className="num"><Money value={d.amount} /></td>
                      <td className="num"><Money value={d.outstanding} /></td>
                      <td>{fmtDate(d.due_date)}</td>
                      <td><StatusBadge type={d.type} settleStatus={d.settle_status} /></td>
                      <td className="no-print">{Number(d.outstanding) > 0 && <Link className="btn btn-ghost btn-sm" href={`/settle/${d.id}`}>{d.type === 'collection_due' ? 'Collect' : 'Pay'}</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Notes">
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }} className={b.notes ? '' : 'muted'}>{b.notes || 'No notes.'}</p>
        </Card>
      </div>

      <Card title="Complete cash history">
        {cash.length === 0 ? <Empty title="No cash received or paid yet" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Txn ID</th><th>Details</th><th>Location</th><th className="num">Received</th><th className="num">Paid</th></tr></thead>
              <tbody>
                {cash.slice().reverse().map((t) => (
                  <tr key={t.id}>
                    <td className="num">{fmtDate(t.txn_date)}</td>
                    <td><Link href={`/transactions/${t.id}`}>{t.txn_no}</Link></td>
                    <td>{t.client_name || t.supplier_name || '—'}<span className="sub">{[t.category, t.description, t.settles_txn_no && !(t.description ?? '').includes(t.settles_txn_no) && `against ${t.settles_txn_no}`].filter(Boolean).join(' · ')}</span></td>
                    <td>{t.location_name}</td>
                    <td className="num">{t.type === 'cash_in' ? <Money value={t.amount} tone="in" /> : ''}</td>
                    <td className="num">{t.type === 'cash_out' ? <Money value={t.amount} tone="out" /> : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>Totals</td><td className="num"><Money value={b.received} /></td><td className="num"><Money value={b.cash_paid} /></td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

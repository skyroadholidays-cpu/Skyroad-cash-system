import Link from 'next/link';
import { requireUser } from '@/lib/session';
import * as L from '@/lib/ledger';
import { fmtDate, isIsoDate } from '@/lib/dates';
import { TXN_TYPES, TXN_TYPE_LABEL, type TxnType } from '@/lib/constants';
import { Card, Empty, Flash, Money, PageHeader, StatusBadge, TypeBadge } from '@/components/ui';
import { AutoRefresh } from '@/components/client';

export const metadata = { title: 'Transactions' };
const PAGE = 50;

export default async function TxnListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const type = TXN_TYPES.includes(sp.type as TxnType) ? (sp.type as TxnType) : null;
  const locationId = Number(sp.location) || null;
  const [{ rows, total }, locations] = await Promise.all([
    L.listTxns({ q: sp.q, type, location_id: locationId, from: isIsoDate(sp.from) ? sp.from : null, to: isIsoDate(sp.to) ? sp.to : null, limit: PAGE, offset: (page - 1) * PAGE }),
    L.listLocations(),
  ]);
  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== 'page' && k !== 'deleted') u.set(k, v);
    u.set('page', String(p));
    return `/transactions?${u}`;
  };
  const exportQs = new URLSearchParams({ r: 'register', from: sp.from || '2000-01-01', to: sp.to || '2999-12-31', ...(type ? { type } : {}), ...(locationId ? { location: String(locationId) } : {}), ...(sp.q ? { q: sp.q } : {}) });

  return (
    <div className="stack">
      <AutoRefresh />
      <PageHeader title="Transactions" subtitle={`${total} entr${total === 1 ? 'y' : 'ies'}`}
        actions={<>
          <a href={`/api/export?${exportQs}`} className="btn btn-ghost">Export CSV</a>
          <Link href="/transactions/new" className="btn btn-primary">+ New entry</Link>
        </>} />
      {sp.deleted && <Flash>Entry deleted and all balances recalculated. You can restore it from Settings → Trash.</Flash>}
      <Card>
        <form className="filters" method="get">
          <label className="field grow"><span className="field-label">Search</span><input name="q" defaultValue={sp.q ?? ''} placeholder="Client, booking, supplier, txn ID, notes…" /></label>
          <label className="field"><span className="field-label">Type</span>
            <select name="type" defaultValue={type ?? ''}>
              <option value="">All types</option>
              {TXN_TYPES.map((t) => <option key={t} value={t}>{TXN_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Cash location</span>
            <select name="location" defaultValue={locationId ?? ''}>
              <option value="">All</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">From</span><input type="date" name="from" defaultValue={sp.from ?? ''} /></label>
          <label className="field"><span className="field-label">To</span><input type="date" name="to" defaultValue={sp.to ?? ''} /></label>
          <button className="btn btn-primary" type="submit">Filter</button>
          {Object.keys(sp).some((k) => ['q', 'type', 'location', 'from', 'to'].includes(k) && sp[k]) && <Link href="/transactions" className="btn btn-ghost">Clear</Link>}
        </form>

        {rows.length === 0 ? <Empty title="No transactions match">Try clearing the filters.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Txn ID</th><th>Type</th><th>Client / Supplier</th><th>Booking</th><th>Location</th>
                  <th className="num">Received</th><th className="num">Paid</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const isDue = t.type === 'collection_due' || t.type === 'payment_due';
                  return (
                    <tr key={t.id}>
                      <td className="num">{fmtDate(t.txn_date)}</td>
                      <td><Link href={`/transactions/${t.id}`} className="row-link">{t.txn_no}</Link></td>
                      <td><TypeBadge type={t.type} /></td>
                      <td>{t.client_name || t.supplier_name || '—'}<span className="sub">{t.description || t.category || ''}</span></td>
                      <td>{t.booking_id ? <Link href={`/bookings/${t.booking_id}`}>{t.booking_ref}</Link> : '—'}</td>
                      <td>{t.type === 'transfer' ? `${t.from_location_name} → ${t.to_location_name}` : t.location_name ?? '—'}</td>
                      <td className="num">{t.type === 'cash_in' ? <Money value={t.amount} tone="in" /> : ''}</td>
                      <td className="num">{t.type === 'cash_out' ? <Money value={t.amount} tone="out" /> : ''}</td>
                      <td>
                        {isDue || t.type === 'transfer' ? <><Money value={t.amount} /><br /></> : null}
                        <StatusBadge type={t.type} settleStatus={t.settle_status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="pager">
            <span className="muted">Page {page} of {Math.ceil(total / PAGE)}</span>
            <span className="row">
              {page > 1 && <Link href={qs(page - 1)} className="btn btn-ghost btn-sm">← Newer</Link>}
              {page * PAGE < total && <Link href={qs(page + 1)} className="btn btn-ghost btn-sm">Older →</Link>}
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}

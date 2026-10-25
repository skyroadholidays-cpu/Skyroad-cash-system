import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { globalSearch } from '@/lib/insights';
import { fmtDate } from '@/lib/dates';
import { Card, Empty, Money, PageHeader, TypeBadge } from '@/components/ui';

export const metadata = { title: 'Search' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const { q = '' } = await searchParams;
  const r = await globalSearch(q.slice(0, 100));
  const nothing = !r.bookings.length && !r.txns.length && !r.parties.length;

  return (
    <div className="stack">
      <PageHeader title={q ? `Results for “${q}”` : 'Search'} subtitle="Clients, bookings, suppliers, hotels, transaction IDs and notes." />
      <form method="get" className="row">
        <input name="q" defaultValue={q} autoFocus placeholder="Search…" style={{ maxWidth: 420 }} />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>
      {q && nothing && <Empty title="No matches">Try part of a name, a booking reference or a transaction ID like SR-001001.</Empty>}

      {r.parties.length > 0 && (
        <Card title="Clients & suppliers with outstanding balances">
          <table><tbody>
            {r.parties.map((p) => (
              <tr key={p.role + p.name}>
                <td><strong>{p.name}</strong><span className="sub">{p.role}</span></td>
                <td className="num"><Money value={p.outstanding} /> outstanding</td>
                <td><Link href={`${p.role === 'Client' ? '/collect' : '/pay'}?f=all&q=${encodeURIComponent(p.name)}`}>View</Link></td>
              </tr>
            ))}
          </tbody></table>
        </Card>
      )}

      {r.bookings.length > 0 && (
        <Card title="Bookings">
          <table><tbody>
            {r.bookings.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/bookings/${b.id}`} className="row-link">{b.booking_ref}</Link><span className="sub">{b.client_name}{b.destination ? ` · ${b.destination}` : ''}</span></td>
                <td className="num">To collect <Money value={b.to_collect} /></td>
                <td className="num">To pay <Money value={b.supplier_outstanding} /></td>
              </tr>
            ))}
          </tbody></table>
        </Card>
      )}

      {r.txns.length > 0 && (
        <Card title="Transactions">
          <div className="table-wrap"><table><tbody>
            {r.txns.map((t) => (
              <tr key={t.id}>
                <td className="num">{fmtDate(t.txn_date)}</td>
                <td><Link href={`/transactions/${t.id}`} className="row-link">{t.txn_no}</Link></td>
                <td><TypeBadge type={t.type} /></td>
                <td>{t.client_name || t.supplier_name || '—'}<span className="sub">{[t.booking_ref, t.description].filter(Boolean).join(' · ')}</span></td>
                <td className="num"><Money value={t.amount} /></td>
              </tr>
            ))}
          </tbody></table></div>
        </Card>
      )}
    </div>
  );
}

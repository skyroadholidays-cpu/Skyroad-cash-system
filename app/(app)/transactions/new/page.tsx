import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { todayIST } from '@/lib/dates';
import { TXN_TYPES, type TxnType } from '@/lib/constants';
import { TxnForm, type Source } from '@/components/TxnForm';
import { Card, Flash, PageHeader } from '@/components/ui';
import { createTxnAction } from '@/app/actions';
import { loadTxnFormData } from '../form-data';

export const metadata = { title: 'New entry' };

export default async function NewTxnPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const type = (TXN_TYPES.includes(sp.type as TxnType) ? sp.type : 'cash_in') as TxnType;
  const data = await loadTxnFormData();
  const loc = data.locations.find((l) => String(l.id) === sp.location);
  const src = ['booking', 'dues', 'location', 'business', 'home'].includes(sp.source ?? '') ? sp.source as Source : undefined;
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHeader title={loc ? `New entry – ${loc.name}` : 'New entry'} subtitle="Record money in, money out, a transfer, or something owed."
                  actions={loc ? <Link href={`/transactions?location=${loc.id}`} className="btn btn-ghost">See {loc.name} entries</Link> : undefined} />
      {sp.saved && <Flash>Saved {sp.saved}. Add the next one below.</Flash>}
      {data.locations.length === 0 && <Flash tone="warn">No active cash locations. <Link href="/cash">Add one first</Link>.</Flash>}
      <Card>
        <TxnForm key={data.idem} action={createTxnAction} mode="create" today={todayIST()}
                 values={{ type, booking_ref: sp.booking ?? '', settles_id: sp.settles ?? '', entry_for: sp.for === 'home' || sp.for === 'business' || sp.for === 'booking' ? sp.for : undefined,
                           source: src ?? (sp.for === 'home' || sp.for === 'business' ? sp.for : undefined),
                           location_id: loc?.id ?? null, from_location_id: loc?.id ?? null }}
                 locations={data.locations} bookings={data.bookings} dues={data.dues} suggestions={data.suggestions} idem={data.idem} />
      </Card>
    </div>
  );
}

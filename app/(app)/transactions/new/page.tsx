import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { todayIST } from '@/lib/dates';
import { TXN_TYPES, type TxnType } from '@/lib/constants';
import { TxnForm } from '@/components/TxnForm';
import { Card, Flash, PageHeader } from '@/components/ui';
import { createTxnAction } from '@/app/actions';
import { loadTxnFormData } from '../form-data';

export const metadata = { title: 'New entry' };

export default async function NewTxnPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const type = (TXN_TYPES.includes(sp.type as TxnType) ? sp.type : 'cash_in') as TxnType;
  const data = await loadTxnFormData();
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHeader title="New entry" subtitle="Record money in, money out, a transfer, or something owed." />
      {sp.saved && <Flash>Saved {sp.saved}. Add the next one below.</Flash>}
      {data.locations.length === 0 && <Flash tone="warn">No active cash locations. <Link href="/cash">Add one first</Link>.</Flash>}
      <Card>
        <TxnForm key={data.idem} action={createTxnAction} mode="create" today={todayIST()}
                 values={{ type, booking_ref: sp.booking ?? '', settles_id: sp.settles ?? '' }}
                 locations={data.locations} bookings={data.bookings} dues={data.dues} suggestions={data.suggestions} idem={data.idem} />
      </Card>
    </div>
  );
}

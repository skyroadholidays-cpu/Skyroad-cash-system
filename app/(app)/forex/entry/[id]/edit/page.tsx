import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/session';
import { getFxEntry, listFxBalances } from '@/lib/forex';
import { bookingRefs } from '@/lib/ledger';
import { todayIST } from '@/lib/dates';
import { Card, Flash, PageHeader } from '@/components/ui';
import { FxForm } from '@/components/FxForm';
import { updateFxAction } from '@/app/actions';

export const metadata = { title: 'Edit forex entry' };

export default async function EditFxPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [e, all, bookings] = await Promise.all([getFxEntry(id), listFxBalances(), bookingRefs()]);
  if (!e) notFound();
  const bal = all.find((c) => c.code === e.currency)?.balance ?? '0';
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHeader title={`Edit ${e.fx_no}`} subtitle="Saving recalculates the holding. The change is kept in the audit log."
                  actions={<Link href={`/forex/${e.currency}`} className="btn btn-ghost">Cancel</Link>} />
      {e.deleted_at ? <Flash tone="warn">This entry is deleted. Restore it from the {e.currency} page first.</Flash> : (
        <Card>
          <FxForm action={updateFxAction} mode="edit" idem={randomUUID()} today={todayIST()} balance={bal} values={e}
                  currencies={all.filter((c) => c.is_active || c.code === e.currency).map((c) => ({ code: c.code, name: c.name }))}
                  bookings={bookings.map((b) => ({ booking_ref: b.booking_ref, client_name: b.client_name }))} />
        </Card>
      )}
    </div>
  );
}

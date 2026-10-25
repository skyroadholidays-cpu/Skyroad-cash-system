import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/session';
import * as L from '@/lib/ledger';
import { BookingForm } from '@/components/BookingForm';
import { Card, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { updateBookingAction, deleteBookingAction } from '@/app/actions';

export const metadata = { title: 'Edit booking' };

export default async function EditBookingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const found = await L.getBooking(Number(id));
  if (!found) notFound();
  const [locations, names] = await Promise.all([L.listLocations(true), L.nameSuggestions()]);
  const b = found.booking;
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHeader title={`Edit ${b.booking_ref}`} actions={<Link href={`/bookings/${b.id}`} className="btn btn-ghost">Cancel</Link>} />
      <Card>
        <BookingForm action={updateBookingAction} booking={b} hasPackageDue={!!found.packageDue} packageDueDate={found.packageDue?.due_date}
                     locations={locations} idem={randomUUID()} clients={names.clients} />
      </Card>
      {found.txns.length === 0 && (
        <Card title="Delete booking">
          <p className="muted small">This booking has no transactions, so it can be deleted permanently.</p>
          <ActionForm action={deleteBookingAction} confirm={`Permanently delete booking ${b.booking_ref}?`}>
            <input type="hidden" name="id" value={b.id} />
            <SubmitButton className="btn btn-danger" pendingText="Deleting…">Delete booking</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}

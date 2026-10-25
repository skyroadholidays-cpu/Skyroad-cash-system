import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/session';
import * as L from '@/lib/ledger';
import { BookingForm } from '@/components/BookingForm';
import { Card, PageHeader } from '@/components/ui';
import { createBookingAction } from '@/app/actions';

export const metadata = { title: 'New booking' };

export default async function NewBookingPage() {
  await requireUser();
  const [locations, names] = await Promise.all([L.listLocations(true), L.nameSuggestions()]);
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHeader title="New booking" subtitle="Creates the booking, raises the client receivable and (optionally) records an advance – in one step." />
      <Card>
        <BookingForm action={createBookingAction} locations={locations} idem={randomUUID()} clients={names.clients} />
      </Card>
    </div>
  );
}

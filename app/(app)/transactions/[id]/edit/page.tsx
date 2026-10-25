import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { todayIST } from '@/lib/dates';
import * as L from '@/lib/ledger';
import { TxnForm, type TxnFormDue } from '@/components/TxnForm';
import { Card, Flash, PageHeader } from '@/components/ui';
import { updateTxnAction } from '@/app/actions';
import { loadTxnFormData } from '../../form-data';

export const metadata = { title: 'Edit entry' };

export default async function EditTxnPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const found = await L.getTxn(id);
  if (!found) notFound();
  const t = found.txn;
  if (t.deleted_at) {
    return (
      <div className="stack" style={{ maxWidth: 860 }}>
        <PageHeader title={`Edit ${t.txn_no}`} />
        <Flash tone="warn">This entry is deleted. <Link href={`/transactions/${t.id}`}>Restore it</Link> before editing.</Flash>
      </div>
    );
  }
  const data = await loadTxnFormData();

  // Make the due this entry already settles selectable, with its own amount counted as available.
  let dues: TxnFormDue[] = data.dues.map((d) => ({ ...d }));
  if (t.settles_id) {
    const linked = await L.getDue(t.settles_id);
    if (linked) {
      const available = (Number(linked.outstanding) + Number(t.amount)).toFixed(2);
      dues = dues.filter((d) => d.id !== linked.id);
      dues.unshift({ id: linked.id, type: linked.type as TxnFormDue['type'], txn_no: linked.txn_no, booking_ref: linked.booking_ref,
        client_name: linked.client_name, supplier_name: linked.supplier_name, service_provider: linked.service_provider,
        outstanding: available, due_date: linked.due_date, description: linked.description });
    }
  }
  // Keep an inactive location visible if this entry already uses it.
  const locations = [...data.locations];
  for (const [lid, name] of [[t.location_id, t.location_name], [t.from_location_id, t.from_location_name], [t.to_location_id, t.to_location_name]] as const) {
    if (lid && !locations.some((l) => l.id === lid)) locations.push({ id: lid, name: `${name} (inactive)`, balance: '0' });
  }

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHeader title={`Edit ${t.txn_no}`} subtitle="Saving replaces the old figures – every balance is recalculated and the change is kept in the history."
                  actions={<Link href={`/transactions/${t.id}`} className="btn btn-ghost">Cancel</Link>} />
      {t.is_package_due && <Flash tone="warn">This is the booking&apos;s package receivable. Change the amount from the <Link href={`/bookings/${t.booking_id}/edit`}>booking</Link> so they stay in step.</Flash>}
      <Card>
        <TxnForm key={data.idem} action={updateTxnAction} mode="edit" today={todayIST()} values={t}
                 locations={locations} bookings={data.bookings} dues={dues} suggestions={data.suggestions} idem={data.idem} />
      </Card>
    </div>
  );
}

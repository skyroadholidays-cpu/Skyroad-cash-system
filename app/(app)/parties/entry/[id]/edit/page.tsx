import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/session';
import { getPartyEntry, getParty } from '@/lib/parties';
import { listLocations } from '@/lib/ledger';
import { todayIST } from '@/lib/dates';
import { Card, Flash, PageHeader } from '@/components/ui';
import { PartyEntryForm } from '@/components/PartyEntryForm';
import { updatePartyTxnAction } from '@/app/actions';

export const metadata = { title: 'Edit party entry' };

export default async function EditPartyEntryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const e = await getPartyEntry(id);
  if (!e) notFound();
  const [data, locations] = await Promise.all([getParty(e.party_id), listLocations(true)]);
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHeader title={`Edit ${e.pt_no}`} subtitle={`Account with ${e.party_name}. Saving recalculates the balance${e.linked_txn_id ? ' and updates its cash entry' : ''}.`}
                  actions={<Link href={`/parties/${e.party_id}`} className="btn btn-ghost">Cancel</Link>} />
      {e.deleted_at ? <Flash tone="warn">This entry is deleted. Restore it from {e.party_name}&apos;s page first.</Flash> : (
        <Card>
          <PartyEntryForm action={updatePartyTxnAction} mode="edit" idem={randomUUID()} today={todayIST()}
                          partyId={e.party_id} partyName={e.party_name} balance={data?.party.balance ?? '0'} values={e}
                          locations={locations.map((l) => ({ id: l.id, name: l.name, balance: l.balance }))} />
        </Card>
      )}
    </div>
  );
}

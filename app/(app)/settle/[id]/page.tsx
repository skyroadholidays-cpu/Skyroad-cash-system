import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/session';
import * as L from '@/lib/ledger';
import { fmtDate, todayIST } from '@/lib/dates';
import { inr } from '@/lib/money';
import { Card, PageHeader, Flash } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { settleAction } from '@/app/actions';

export const metadata = { title: 'Record payment' };

export default async function SettlePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [due, locations] = await Promise.all([L.getDue(id), L.listLocations(true)]);
  if (!due) notFound();
  const isCollect = due.type === 'collection_due';
  const back = isCollect ? '/collect' : '/pay';
  const today = todayIST();
  const party = isCollect ? due.client_name : [due.supplier_name, due.service_provider].filter(Boolean).join(' · ');

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <PageHeader title={isCollect ? 'Record collection' : 'Record supplier payment'}
                  subtitle={<>{party || '—'}{due.booking_ref ? ` · ${due.booking_ref}` : ''} · <Link href={`/transactions/${due.id}`}>{due.txn_no}</Link></>}
                  actions={<Link href={back} className="btn btn-ghost">Back</Link>} />
      <Card>
        <div className="kv" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', marginBottom: 18 }}>
          <div><span>Total</span><strong>{inr(due.amount)}</strong></div>
          <div><span>{isCollect ? 'Collected' : 'Paid'}</span><strong className="pos">{inr(due.settled)}</strong></div>
          <div><span>Outstanding</span><strong className="neg">{inr(due.outstanding)}</strong></div>
        </div>
        {Number(due.outstanding) <= 0 ? (
          <Flash>This is fully {isCollect ? 'collected' : 'paid'}. Nothing left to record.</Flash>
        ) : (
          <ActionForm action={settleAction} className="form">
            <input type="hidden" name="due_id" value={due.id} />
            <input type="hidden" name="idem" value={randomUUID()} />
            <div className="grid">
              <label className="field field-amount">
                <span className="field-label">Amount {isCollect ? 'received' : 'paid'} (₹)</span>
                <input name="amount" inputMode="decimal" defaultValue={due.outstanding} required autoFocus autoComplete="off" />
                <span className="field-hint">Full amount pre-filled. Change it for a part payment.</span>
              </label>
              <label className="field">
                <span className="field-label">Date</span>
                <input type="date" name="txn_date" defaultValue={today} max={today} required />
              </label>
              <label className="field">
                <span className="field-label">{isCollect ? 'Cash kept in' : 'Paid from'}</span>
                <select name="location_id" required>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name} — {inr(l.balance)}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Category</span>
                <input name="category" defaultValue={isCollect ? 'Client collection' : 'Supplier payment'} list="dl-settle-cat" />
                <datalist id="dl-settle-cat">
                  {(isCollect ? L.CATEGORIES.cash_in : L.CATEGORIES.cash_out).map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label className="field field-wide">
                <span className="field-label">Notes / remarks</span>
                <textarea name="notes" rows={2} placeholder={isCollect ? 'e.g. received by Nambi at office, receipt #…' : 'e.g. paid to hotel rep, voucher #…'} />
              </label>
            </div>
            {due.due_date && <p className="muted small" style={{ marginTop: 12 }}>{isCollect ? 'Expected by' : 'Due by'} {fmtDate(due.due_date)}.</p>}
            <div className="form-actions">
              <SubmitButton>{isCollect ? 'Save collection' : 'Save payment'}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}

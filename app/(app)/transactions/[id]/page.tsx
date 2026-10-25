import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import * as L from '@/lib/ledger';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { inr } from '@/lib/money';
import { Card, Flash, Money, PageHeader, StatusBadge, TypeBadge } from '@/components/ui';
import { ENTRY_FOR_LABEL, entryForOf } from '@/lib/constants';
import { partyOwningTxn } from '@/lib/parties';
import { db } from '@/lib/db-core';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { deleteTxnAction, restoreTxnAction } from '@/app/actions';

export const metadata = { title: 'Transaction' };

const FIELD_LABEL: Record<string, string> = {
  amount: 'Amount', txn_date: 'Date', type: 'Type', booking_id: 'Booking', client_name: 'Client', supplier_name: 'Supplier',
  service_provider: 'Provider', description: 'Description', category: 'Category', notes: 'Notes', location_id: 'Cash location',
  from_location_id: 'From location', to_location_id: 'To location', settles_id: 'Settles', due_date: 'Due date', deleted_at: 'Deleted',
};

export default async function TxnPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const found = await L.getTxn(id);
  if (!found) notFound();
  const { txn: t, settlements, history } = found;
  const owner = await partyOwningTxn(db(), t.id);
  const isDue = t.type === 'collection_due' || t.type === 'payment_due';
  const deleted = !!t.deleted_at;
  const effect =
    t.type === 'cash_in' ? <>Added <strong>{inr(t.amount)}</strong> to <strong>{t.location_name}</strong>.</> :
    t.type === 'cash_out' ? <>Took <strong>{inr(t.amount)}</strong> out of <strong>{t.location_name}</strong>.</> :
    t.type === 'transfer' ? <>Moved <strong>{inr(t.amount)}</strong> from <strong>{t.from_location_name}</strong> to <strong>{t.to_location_name}</strong>. Total cash unchanged.</> :
    <>Recorded as {t.type === 'collection_due' ? 'owed by the client' : 'owed to the supplier'}. No physical cash has moved for this entry itself.</>;

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <PageHeader
        title={t.txn_no}
        subtitle={<><TypeBadge type={t.type} /> &nbsp;<StatusBadge type={t.type} settleStatus={t.settle_status} /></>}
        actions={owner ? <Link href={`/parties/${owner.party_id}`} className="btn btn-ghost">Belongs to {owner.name} – open party account</Link> : !deleted ? (
          <>
            {isDue && t.settle_status !== 'settled' && (
              <Link href={`/settle/${t.id}`} className="btn btn-primary">{t.type === 'collection_due' ? 'Record collection' : 'Record payment'}</Link>
            )}
            <Link href={`/transactions/${t.id}/edit`} className="btn btn-ghost">Edit</Link>
            <ActionForm action={deleteTxnAction} confirm={`Delete ${t.txn_no} (${inr(t.amount)})? All balances will be recalculated. You can restore it later from Settings → Trash.`}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="next" value="/transactions" />
              <SubmitButton className="btn btn-danger" pendingText="Deleting…">Delete</SubmitButton>
            </ActionForm>
          </>
        ) : undefined}
      />
      {sp.saved && <Flash>Saved. All balances and totals have been updated.</Flash>}
      {sp.restored && <Flash>Restored. Balances have been recalculated.</Flash>}
      {deleted && (
        <div className="alert alert-warn">
          Deleted {fmtDateTime(t.deleted_at)}{t.deleted_by ? ` by ${t.deleted_by}` : ''}. It is excluded from every balance and report.
          <ActionForm action={restoreTxnAction}>
            <input type="hidden" name="id" value={t.id} />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="Restoring…">Restore this entry</SubmitButton>
          </ActionForm>
        </div>
      )}

      <div className="two-col">
        <Card title="Details">
          <dl className="dl">
            <dt>Amount</dt><dd><Money value={t.amount} tone={t.type === 'cash_in' ? 'in' : t.type === 'cash_out' ? 'out' : undefined} className="strong" /></dd>
            <dt>Effect on cash</dt><dd>{effect}</dd>
            <dt>{isDue ? 'Date raised' : 'Date'}</dt><dd>{fmtDate(t.txn_date)}</dd>
            {isDue && <><dt>{t.type === 'collection_due' ? 'Expected collection' : 'Payment due'}</dt><dd>{fmtDate(t.due_date)}</dd></>}
            {t.type !== 'transfer' && <><dt>Entry for</dt><dd>{t.account === 'home' ? <span className="badge b-home">{ENTRY_FOR_LABEL.home}</span> : ENTRY_FOR_LABEL[entryForOf(t)]}</dd></>}
            <dt>Booking</dt><dd>{t.booking_id ? <Link href={`/bookings/${t.booking_id}`}>{t.booking_ref}</Link> : '—'}</dd>
            <dt>Client</dt><dd>{t.client_name || '—'}</dd>
            <dt>Supplier</dt><dd>{t.supplier_name || '—'}{t.service_provider ? ` · ${t.service_provider}` : ''}</dd>
            {t.settles_id && <><dt>Settles</dt><dd><Link href={`/transactions/${t.settles_id}`}>{t.settles_txn_no}</Link></dd></>}
            <dt>Category</dt><dd>{t.category || '—'}</dd>
            <dt>Description</dt><dd>{t.description || '—'}</dd>
            <dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{t.notes || '—'}</dd>
            <dt>Created</dt><dd>{fmtDateTime(t.created_at)}{t.created_by ? ` · ${t.created_by}` : ''}</dd>
            <dt>Last updated</dt><dd>{fmtDateTime(t.updated_at)}{t.updated_by ? ` · ${t.updated_by}` : ''}</dd>
          </dl>
        </Card>

        <div className="stack">
          {isDue && (
            <Card title={t.type === 'collection_due' ? 'Collections received' : 'Payments made'}>
              <div className="kv" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 12 }}>
                <div><span>Total</span><strong>{inr(t.amount)}</strong></div>
                <div><span>Settled</span><strong className="pos">{inr(t.settled)}</strong></div>
                <div><span>Outstanding</span><strong className={Number(t.outstanding) > 0 ? 'neg' : ''}>{inr(t.outstanding)}</strong></div>
              </div>
              {settlements.length === 0 ? <p className="muted small">Nothing recorded yet.</p> : (
                <table>
                  <tbody>
                    {settlements.map((s) => (
                      <tr key={s.id}>
                        <td><Link href={`/transactions/${s.id}`}>{s.txn_no}</Link><span className="sub">{fmtDate(s.txn_date)} · {s.location_name}</span></td>
                        <td className="num"><Money value={s.amount} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
          <Card title="Change history">
            <ul className="history">
              {history.map((h, i) => (
                <li key={i}>
                  <strong>{h.action === 'insert' ? 'Created' : h.action === 'soft_delete' ? 'Deleted' : h.action === 'restore' ? 'Restored' : 'Edited'}</strong>
                  <span className="muted"> · {fmtDateTime(h.at)}{h.actor ? ` · ${h.actor}` : ''}</span>
                  {h.changes.length > 0 && h.action === 'update' && (
                    <div className="small">
                      {h.changes.map((c) => (
                        <div key={c.field}>{FIELD_LABEL[c.field] ?? c.field}: <code>{String(c.from ?? '—')}</code> → <code>{String(c.to ?? '—')}</code></div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/session';
import { getParty, balanceWords } from '@/lib/parties';
import { listLocations } from '@/lib/ledger';
import { fmtDate, fmtDateTime, todayIST } from '@/lib/dates';
import { inr } from '@/lib/money';
import { Card, Empty, Flash, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { AutoRefresh, PrintButton } from '@/components/client';
import { PartyEntryForm } from '@/components/PartyEntryForm';
import { PartyForm } from '@/components/PartyForm';
import { createPartyTxnAction, deletePartyTxnAction, restorePartyTxnAction, savePartyAction, togglePartyAction } from '@/app/actions';

export const metadata = { title: 'Party account' };

export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const [data, locations] = await Promise.all([getParty(Number(id)), listLocations(true)]);
  if (!data) notFound();
  const { party: p, entries, deleted } = data;
  const w = balanceWords(p.balance, p.name);
  const idem = randomUUID();
  const today = todayIST();

  return (
    <div className="stack">
      <AutoRefresh />
      <div className="print-only print-head"><strong>Skyroad Holidays – Account with {p.name}</strong><span>{fmtDate(today)}</span></div>
      <PageHeader title={p.name}
        subtitle={<><Link href="/parties">← All parties</Link>{p.phone ? ` · ${p.phone}` : ''} · {p.account === 'business' ? 'Skyroad business' : 'Home / personal'}{!p.is_active && ' · Archived'}</>}
        actions={<><PrintButton label="Print statement" /><a href="#add" className="btn btn-primary">+ Add entry</a></>} />
      {sp.added && <Flash>Saved {sp.added}. Balance updated.</Flash>}
      {sp.updated && <Flash>Entry updated. Balance recalculated.</Flash>}
      {sp.saved && <Flash>Saved.</Flash>}
      {sp.deleted && <Flash>Entry deleted (and its cash entry, if any). You can restore it below.</Flash>}
      {sp.restored && <Flash>Entry restored.</Flash>}

      <div className="stats">
        <div className={`stat ${w.tone === 'neg' ? 'stat-out' : 'stat-in'} stat-emphasis`}>
          <span className="stat-label">{w.text}</span>
          <span className="stat-value">{inr(p.balance.replace('-', ''))}</span>
          <span className="stat-hint">{w.tone === 'pos' ? 'Positive balance – they need to pay you' : w.tone === 'neg' ? 'Negative balance – you need to pay them' : 'Nothing pending either way'}</span>
        </div>
        <div className="stat stat-out"><span className="stat-label">You paid (total)</span><span className="stat-value">{inr(p.i_paid)}</span><span className="stat-hint">{p.entries} entries</span></div>
        <div className="stat stat-in"><span className="stat-label">{p.name} paid (total)</span><span className="stat-value">{inr(p.they_paid)}</span>
          <span className="stat-hint">{Number(p.opening_balance) !== 0 ? `Opening: ${Number(p.opening_balance) > 0 ? `${p.name} owed you` : `you owed ${p.name}`} ${inr(p.opening_balance.replace('-', ''))}` : 'Started at ₹0.00'}</span></div>
      </div>

      <Card title="Account statement">
        {entries.length === 0 ? <Empty title="No entries yet">Add the first one below.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Ref</th><th>Details</th><th className="num">You paid</th><th className="num">{p.name} paid</th><th className="num">Balance</th><th className="no-print"></th></tr></thead>
              <tbody>
                {entries.map((e) => {
                  const b = Number(e.running_balance);
                  return (
                    <tr key={e.id}>
                      <td className="num">{fmtDate(e.txn_date)}</td>
                      <td>{e.pt_no}{e.linked_txn_id && <span className="sub"><Link href={`/transactions/${e.linked_txn_id}`}>Cash · {e.location_name}</Link></span>}</td>
                      <td>{e.description || '—'}<span className="sub">{[e.category, e.notes].filter(Boolean).join(' · ')}</span></td>
                      <td className="num">{e.paid_by === 'me' ? inr(e.amount) : ''}</td>
                      <td className="num">{e.paid_by === 'them' ? inr(e.amount) : ''}</td>
                      <td className={`num ${b > 0 ? 'pos' : b < 0 ? 'neg' : ''}`}>
                        <strong>{inr(Math.abs(b).toFixed(2))}</strong>
                        <span className="sub">{b > 0 ? 'they owe' : b < 0 ? 'you owe' : 'settled'}</span>
                      </td>
                      <td className="no-print">
                        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <Link href={`/parties/entry/${e.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
                          <ActionForm action={deletePartyTxnAction} confirm={`Delete ${e.pt_no} (${inr(e.amount)})?${e.linked_txn_id ? ' Its cash entry will be removed too.' : ''} You can restore it later.`}>
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="party_id" value={p.id} />
                            <SubmitButton className="btn btn-danger btn-sm" pendingText="…">Delete</SubmitButton>
                          </ActionForm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {p.is_active && (
        <Card title="Add entry" className="no-print">
          <div id="add" />
          <PartyEntryForm key={idem} action={createPartyTxnAction} mode="create" idem={idem} today={today}
                          partyId={p.id} partyName={p.name} balance={p.balance} values={{}}
                          locations={locations.map((l) => ({ id: l.id, name: l.name, balance: l.balance }))} />
        </Card>
      )}

      {deleted.length > 0 && (
        <Card title="Deleted entries" className="no-print">
          <table><tbody>
            {deleted.map((e) => (
              <tr key={e.id}>
                <td>{e.pt_no}<span className="sub">{fmtDate(e.txn_date)} · {e.paid_by === 'me' ? 'You paid' : `${p.name} paid`} {inr(e.amount)} · {e.description ?? ''}</span></td>
                <td className="muted small">Deleted {fmtDateTime(e.deleted_at)}</td>
                <td>
                  <ActionForm action={restorePartyTxnAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="party_id" value={p.id} />
                    <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">Restore</SubmitButton>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody></table>
        </Card>
      )}

      <Card title="Person details" className="no-print">
        <PartyForm action={savePartyAction} party={p} />
        <hr />
        <ActionForm action={togglePartyAction} confirm={p.is_active ? `Archive ${p.name}? (Only possible when the balance is ₹0.00.)` : undefined}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="active" value={String(!p.is_active)} />
          <SubmitButton className="btn btn-ghost btn-sm">{p.is_active ? 'Archive this person' : 'Restore this person'}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}

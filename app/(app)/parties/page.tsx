import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { listParties, balanceWords } from '@/lib/parties';
import { fmtDate } from '@/lib/dates';
import { inr } from '@/lib/money';
import { sumColumn } from '@/lib/csv';
import { Card, Empty, Flash, PageHeader } from '@/components/ui';
import { AutoRefresh } from '@/components/client';
import { PartyForm } from '@/components/PartyForm';
import { savePartyAction } from '@/app/actions';

export const metadata = { title: 'Parties' };

export default async function PartiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const showAll = sp.show === 'all';
  const rows = await listParties(sp.q, showAll);
  const active = rows.filter((r) => r.is_active);
  const owedToMe = sumColumn(active.filter((r) => Number(r.balance) > 0), 'balance');
  const iOwe = sumColumn(active.filter((r) => Number(r.balance) < 0).map((r) => ({ v: r.balance.replace('-', '') })), 'v');

  return (
    <div className="stack">
      <AutoRefresh />
      <PageHeader title="Parties" subtitle="Running accounts with people – who paid what, and who owes whom."
                  actions={<a href="#add-person" className="btn btn-primary">+ Add person</a>} />
      {sp.archived && <Flash>Person archived. Show archived to see them again.</Flash>}

      <div className="stats">
        <div className="stat stat-in"><span className="stat-label">Owed to you</span><span className="stat-value money pos">{inr(owedToMe)}</span><span className="stat-hint">{active.filter((r) => Number(r.balance) > 0).length} people</span></div>
        <div className="stat stat-out"><span className="stat-label">You owe</span><span className="stat-value money neg">{inr(iOwe)}</span><span className="stat-hint">{active.filter((r) => Number(r.balance) < 0).length} people</span></div>
      </div>

      <Card>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <form method="get" className="row">
            <input name="q" defaultValue={sp.q ?? ''} placeholder="Search name or phone" style={{ width: 240 }} />
            {showAll && <input type="hidden" name="show" value="all" />}
            <button className="btn btn-ghost" type="submit">Search</button>
          </form>
          <Link href={showAll ? '/parties' : '/parties?show=all'} className="small">{showAll ? 'Hide archived' : 'Show archived'}</Link>
        </div>
        {rows.length === 0 ? <Empty title="No people yet">Add someone below to start a running account.</Empty> : (
          <div className="party-list">
            {rows.map((p) => {
              const w = balanceWords(p.balance, p.name);
              return (
                <Link key={p.id} href={`/parties/${p.id}`} className={`party-row${p.is_active ? '' : ' archived'}`}>
                  <span className="party-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                  <span className="party-main">
                    <strong>{p.name}</strong>
                    <span className="muted small">{[p.account === 'business' ? 'Skyroad' : 'Home', p.phone, p.entries ? `${p.entries} entries · last ${fmtDate(p.last_txn_date)}` : 'No entries yet', !p.is_active && 'Archived'].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="party-bal">
                    <span className={`small ${w.tone === 'pos' ? 'pos' : w.tone === 'neg' ? 'neg' : 'muted'}`}>{w.text}</span>
                    {w.tone !== 'zero' && <strong className={w.tone}>{inr(p.balance.replace('-', ''))}</strong>}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Add a person">
        <div id="add-person" />
        <PartyForm action={savePartyAction} />
      </Card>
    </div>
  );
}

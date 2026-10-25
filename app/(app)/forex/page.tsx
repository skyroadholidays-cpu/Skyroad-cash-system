import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { listFxBalances, fxFormat } from '@/lib/forex';
import { fmtDate } from '@/lib/dates';
import { inr } from '@/lib/money';
import { Card, Flash, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { AutoRefresh } from '@/components/client';
import { saveFxCurrencyAction, toggleFxCurrencyAction } from '@/app/actions';

export const metadata = { title: 'Forex Reserve' };

export default async function ForexPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const all = await listFxBalances();
  const active = all.filter((c) => c.is_active);
  const valued = active.filter((c) => c.inr_value !== null && Number(c.balance) > 0);
  const totalInr = (valued.reduce((t, c) => t + Math.round(Number(c.inr_value) * 100), 0) / 100).toFixed(2);

  return (
    <div className="stack">
      <AutoRefresh />
      <PageHeader title="Forex Reserve"
        subtitle={<>Foreign currency you hold. Approximate value <strong>{inr(totalInr)}</strong>{valued.length < active.filter((c) => Number(c.balance) > 0).length ? ' (currencies without a rate are not included)' : ''}. Kept separate from your rupee cash.</>}
        actions={<Link href={`/forex/${active[0]?.code ?? 'USD'}#add`} className="btn btn-primary">+ Forex entry</Link>} />
      {sp.saved && <Flash>Saved.</Flash>}

      <div className="fx-grid">
        {active.map((c) => (
          <Link key={c.code} href={`/forex/${c.code}`} className="fx-card">
            <div className="fx-top">
              <span className="fx-code">{c.code}</span>
              <span className="muted small">{c.name}</span>
            </div>
            <div className={`fx-bal${Number(c.balance) === 0 ? ' muted' : ''}`}>{fxFormat(c.balance, c.code)}</div>
            <div className="fx-meta">
              <span>{c.inr_value !== null && Number(c.balance) > 0 ? `≈ ${inr(c.inr_value)}` : Number(c.balance) > 0 ? 'No rate yet' : 'Nothing held'}</span>
              <span>{c.entries ? `${c.entries} entr${c.entries === 1 ? 'y' : 'ies'} · last ${fmtDate(c.last_txn_date)}` : 'No entries yet'}</span>
            </div>
          </Link>
        ))}
      </div>

      <Card title="Manage currencies">
        <p className="muted small" style={{ marginTop: -6 }}>Set the amount you already hold as the <strong>opening holding</strong>; every entry builds on it.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th className="num">Opening holding</th><th></th><th></th></tr></thead>
            <tbody>
              {all.map((c) => (
                <tr key={c.code}>
                  <td><strong>{c.code}</strong></td>
                  <td colSpan={3} style={{ padding: 0 }}>
                    <ActionForm action={saveFxCurrencyAction} className="row">
                      <input type="hidden" name="code" value={c.code} />
                      <input name="name" defaultValue={c.name} required maxLength={60} style={{ flex: '2 1 160px', width: 'auto' }} aria-label="Name" />
                      <input name="opening_balance" defaultValue={c.opening_balance} inputMode="decimal" style={{ flex: '1 1 140px', width: 'auto', textAlign: 'right' }} aria-label="Opening holding" />
                      <SubmitButton className="btn btn-ghost btn-sm">Save</SubmitButton>
                    </ActionForm>
                  </td>
                  <td>
                    <ActionForm action={toggleFxCurrencyAction}>
                      <input type="hidden" name="code" value={c.code} />
                      <input type="hidden" name="active" value={String(!c.is_active)} />
                      <SubmitButton className="btn btn-link small">{c.is_active ? 'Hide' : 'Show'}</SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <hr />
        <p className="section-label">Add a currency</p>
        <ActionForm action={saveFxCurrencyAction} className="row">
          <input type="hidden" name="is_new" value="1" />
          <input name="code" placeholder="Code, e.g. SGD" required maxLength={3} style={{ flex: '0 1 140px', width: 'auto', textTransform: 'uppercase' }} />
          <input name="name" placeholder="Name, e.g. Singapore Dollar" required maxLength={60} style={{ flex: '2 1 220px', width: 'auto' }} />
          <input name="opening_balance" placeholder="Opening holding 0.00" inputMode="decimal" style={{ flex: '1 1 160px', width: 'auto' }} />
          <SubmitButton className="btn btn-primary">Add currency</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}

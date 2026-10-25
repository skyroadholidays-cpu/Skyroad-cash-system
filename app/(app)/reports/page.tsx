import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { runReport, REPORTS, type ReportKey } from '@/lib/insights';
import * as L from '@/lib/ledger';
import { resolvePeriod, todayIST, fmtDate, fmtMonth, fmtDateTime } from '@/lib/dates';
import { sumColumn, sumInt } from '@/lib/csv';
import { TXN_TYPES, TXN_TYPE_LABEL } from '@/lib/constants';
import { Card, Empty, Money } from '@/components/ui';
import { PrintButton } from '@/components/client';

export const metadata = { title: 'Reports' };

const PERIOD_OPTS = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' },
  { key: 'fy', label: 'This FY' }, { key: 'all', label: 'All time' }, { key: 'custom', label: 'Custom' },
];
const NO_PERIOD: ReportKey[] = ['collections', 'payments'];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const key = (Object.keys(REPORTS).includes(sp.r ?? '') ? sp.r : 'register') as ReportKey;
  const today = todayIST();
  const period = resolvePeriod(sp, today, 'month');
  const locationId = Number(sp.location) || null;
  const [report, locations] = await Promise.all([
    runReport(key, { from: period.from, to: period.to, type: sp.type, location_id: locationId, q: sp.q, scope: sp.scope }, today),
    L.listLocations(),
  ]);
  const params = new URLSearchParams({ r: key, from: period.from, to: period.to });
  if (sp.type) params.set('type', sp.type);
  if (locationId) params.set('location', String(locationId));
  if (sp.q) params.set('q', sp.q);
  if (sp.scope) params.set('scope', sp.scope);
  const showTotals = report.columns.some((c) => c.total) && report.rows.length > 0;

  return (
    <div className="stack">
      <div className="print-only print-head">
        <div><strong style={{ fontSize: '14pt' }}>Skyroad Holidays</strong><br />{report.title}</div>
        <div style={{ textAlign: 'right' }}>{report.subtitle}<br /><span className="muted">Printed {fmtDateTime(new Date().toISOString())} by {user.username}</span></div>
      </div>

      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="muted">Every figure is calculated live from your entries.</p>
        </div>
        <div className="page-actions">
          <a href={`/api/export?${params}`} className="btn btn-ghost">Export Excel / CSV</a>
          <PrintButton />
        </div>
      </div>

      <div className="chips no-print">
        {(Object.keys(REPORTS) as ReportKey[]).map((k) => (
          <Link key={k} href={`/reports?r=${k}&period=${period.key}${period.key === 'custom' ? `&from=${period.from}&to=${period.to}` : ''}`} className={`chip${k === key ? ' chip-on' : ''}`}>{REPORTS[k]}</Link>
        ))}
      </div>

      <Card>
        <form className="filters" method="get">
          <input type="hidden" name="r" value={key} />
          {!NO_PERIOD.includes(key) && (
            <>
              <label className="field"><span className="field-label">Period</span>
                <select name="period" defaultValue={period.key}>
                  {PERIOD_OPTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </label>
              <label className="field"><span className="field-label">From (custom)</span><input type="date" name="from" defaultValue={period.from} /></label>
              <label className="field"><span className="field-label">To (custom)</span><input type="date" name="to" defaultValue={period.to} /></label>
            </>
          )}
          {key === 'register' && (
            <label className="field"><span className="field-label">Type</span>
              <select name="type" defaultValue={sp.type ?? ''}>
                <option value="">All</option>
                {TXN_TYPES.map((t) => <option key={t} value={t}>{TXN_TYPE_LABEL[t]}</option>)}
              </select>
            </label>
          )}
          {(key === 'register' || key === 'monthly') && (
            <label className="field"><span className="field-label">Entry for</span>
              <select name="scope" defaultValue={sp.scope ?? ''}>
                <option value="">Everything</option>
                <option value="skyroad">Skyroad (all)</option>
                <option value="booking">Skyroad bookings</option>
                <option value="business">Skyroad – no booking</option>
                <option value="home">Home / personal</option>
              </select>
            </label>
          )}
          {(key === 'register' || key === 'location') && (
            <label className="field"><span className="field-label">Location</span>
              <select name="location" defaultValue={locationId ?? ''}>
                <option value="">All</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          {['register', 'booking', 'client', 'supplier', 'collections', 'payments'].includes(key) && (
            <label className="field grow"><span className="field-label">{key === 'client' ? 'Client' : key === 'supplier' ? 'Supplier' : 'Search'}</span><input name="q" defaultValue={sp.q ?? ''} /></label>
          )}
          <button type="submit" className="btn btn-primary">Run report</button>
        </form>
        {!NO_PERIOD.includes(key) && <p className="muted small no-print" style={{ marginTop: -4 }}>Showing {period.label} ({fmtDate(period.from)} – {fmtDate(period.to)}). To use your own dates, set Period to “Custom”.</p>}

        <div className="card-head" style={{ marginTop: 6 }}>
          <div><h2>{report.title}</h2><p className="muted small" style={{ margin: 0 }}>{report.subtitle} · {report.rows.length} row{report.rows.length === 1 ? '' : 's'}</p></div>
        </div>

        {report.rows.length === 0 ? <Empty title="Nothing to show for these filters" /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>{report.columns.map((c) => <th key={c.key} className={c.kind === 'money' || c.kind === 'int' ? 'num' : ''}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={i}>
                    {report.columns.map((c) => {
                      const v = row[c.key];
                      let content: React.ReactNode = v ?? '—';
                      if (c.kind === 'money') content = v === null || v === undefined ? '' : <Money value={v} />;
                      else if (c.kind === 'date') content = fmtDate(v);
                      else if (c.key === 'month') content = fmtMonth(v);
                      else if (c.kind === 'int') content = v ?? '';
                      if (report.linkKey && report.linkKey.key === c.key) content = <Link href={report.linkKey.href(row)}>{content}</Link>;
                      return <td key={c.key} className={c.kind === 'money' || c.kind === 'int' ? 'num' : ''}>{content}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
              {showTotals && (
                <tfoot>
                  <tr>
                    {report.columns.map((c, i) => (
                      <td key={c.key} className={c.kind === 'money' || c.kind === 'int' ? 'num' : ''}>
                        {i === 0 ? 'Total' : !c.total ? '' : c.kind === 'int' ? sumInt(report.rows, c.key) : <Money value={sumColumn(report.rows, c.key)} />}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

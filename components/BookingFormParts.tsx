'use client';
// Interactive pieces of the booking form: linked travel dates and repeatable advance rows.
import { useState } from 'react';
import { inr, parseAmount } from '@/lib/money';

/** Travel start / end: the end-date picker can't go earlier than the start date. */
export function TravelDates({ start, end }: { start?: string | null; end?: string | null }) {
  const [from, setFrom] = useState(start ?? '');
  const [to, setTo] = useState(end ?? '');
  return (
    <>
      <label className="field">
        <span className="field-label">Travel start</span>
        <input type="date" name="travel_start" value={from}
               onChange={(e) => { const v = e.target.value; setFrom(v); if (to && v && to < v) setTo(v); }} />
      </label>
      <label className="field">
        <span className="field-label">Travel end</span>
        <input type="date" name="travel_end" value={to} min={from || undefined}
               onChange={(e) => setTo(e.target.value)} />
        {from && <span className="field-hint">Dates before {from.split('-').reverse().join('/')} are not allowed.</span>}
      </label>
    </>
  );
}

type Row = { key: number; amount: string; date: string; loc: string };

/** Advances already received: one row per payment, add more with "+". */
export function AdvanceRows({ locations, today }: { locations: { id: number; name: string }[]; today: string }) {
  const blank = (key: number): Row => ({ key, amount: '', date: today, loc: '' });
  const [rows, setRows] = useState<Row[]>([blank(0)]);
  const [next, setNext] = useState(1);
  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const total = rows.reduce((t, r) => t + Math.round(Number(parseAmount(r.amount) ?? 0) * 100), 0);

  return (
    <div className="advances">
      <input type="hidden" name="advance_count" value={rows.length} />
      {rows.map((r, i) => (
        <div className="advance-row" key={r.key}>
          <span className="advance-n">{i + 1}</span>
          <label className="field">
            <span className="field-label">Amount (₹)</span>
            <input name={`advance_amount_${i}`} inputMode="decimal" placeholder="0.00" autoComplete="off"
                   value={r.amount} onChange={(e) => update(r.key, { amount: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Received on</span>
            <input type="date" name={`advance_date_${i}`} max={today} value={r.date}
                   onChange={(e) => update(r.key, { date: e.target.value })} />
          </label>
          <label className="field">
            <span className="field-label">Cash kept in</span>
            <select name={`advance_location_id_${i}`} value={r.loc} onChange={(e) => update(r.key, { loc: e.target.value })}>
              <option value="">—</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          {rows.length > 1 && (
            <button type="button" className="btn btn-link small advance-remove" aria-label={`Remove advance ${i + 1}`}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button>
          )}
        </div>
      ))}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows((r) => [...r, blank(next)]); setNext(next + 1); }}>
          + Add another advance
        </button>
        {total > 0 && <span className="small muted">Total advances: <strong>{inr((total / 100).toFixed(2))}</strong></span>}
      </div>
    </div>
  );
}

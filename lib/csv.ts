import type { Report } from './insights';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection from free-text fields.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV that opens cleanly in Excel: UTF-8 BOM (so ₹ and Indian names render),
 * plain numbers for money (so Excel can total them), ISO dates, and a totals row.
 */
export function reportToCsv(r: Report): string {
  const lines: string[] = [];
  lines.push(cell(`Skyroad Holidays – ${r.title}`));
  lines.push(cell(r.subtitle));
  lines.push('');
  lines.push(r.columns.map((c) => cell(c.kind === 'money' ? `${c.label} (INR)` : c.label)).join(','));
  for (const row of r.rows) lines.push(r.columns.map((c) => cell(row[c.key])).join(','));
  if (r.columns.some((c) => c.total) && r.rows.length) {
    lines.push(r.columns.map((c, i) => (i === 0 ? 'TOTAL' : !c.total ? '' : c.kind === 'int' ? String(sumInt(r.rows, c.key)) : sumColumn(r.rows, c.key))).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Exact decimal sum of 2-dp strings using integer paise (no float drift). */
export function sumColumn(rows: Record<string, any>[], key: string): string {
  let paise = 0n;
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined || v === '') continue;
    const s = String(v);
    const neg = s.startsWith('-');
    const [i, f = ''] = s.replace('-', '').split('.');
    const p = BigInt(i || '0') * 100n + BigInt((f + '00').slice(0, 2));
    paise += neg ? -p : p;
  }
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const str = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return neg ? `-${str}` : str;
}

/** Integer column sum. */
export function sumInt(rows: Record<string, any>[], key: string): number {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

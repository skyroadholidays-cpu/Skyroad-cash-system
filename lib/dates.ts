// Date helpers. The business runs on India time, so "today", weeks, months
// and the financial year (1 April – 31 March) are all computed in IST.
// Dates are plain "YYYY-MM-DD" strings throughout.

export const TZ = 'Asia/Kolkata';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type PeriodKey = 'today' | 'week' | 'month' | 'fy' | 'custom' | 'all';

export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
  label: string;
}

export function financialYearStart(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** Resolves ?period=…&from=…&to=… into a concrete date range. */
export function resolvePeriod(params: { period?: string; from?: string; to?: string }, today = todayIST(), fallback: PeriodKey = 'month'): Period {
  const key = (['today', 'week', 'month', 'fy', 'custom', 'all'] as const).includes(params.period as PeriodKey)
    ? (params.period as PeriodKey)
    : fallback;
  switch (key) {
    case 'today':
      return { key, from: today, to: today, label: 'Today' };
    case 'week': {
      const d = new Date(`${today}T00:00:00Z`);
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      const from = addDays(today, -dow);
      return { key, from, to: addDays(from, 6), label: 'This week' };
    }
    case 'fy': {
      const from = financialYearStart(today);
      const y = Number(from.slice(0, 4));
      return { key, from, to: `${y + 1}-03-31`, label: `FY ${y}-${String(y + 1).slice(2)}` };
    }
    case 'all':
      return { key, from: '2000-01-01', to: '2999-12-31', label: 'All time' };
    case 'custom': {
      let from = isIsoDate(params.from) ? params.from : today.slice(0, 8) + '01';
      let to = isIsoDate(params.to) ? params.to : today;
      if (to < from) [from, to] = [to, from];
      return { key, from, to, label: `${fmtDate(from)} – ${fmtDate(to)}` };
    }
    case 'month':
    default: {
      const from = today.slice(0, 8) + '01';
      const d = new Date(`${from}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      return { key: 'month', from, to: d.toISOString().slice(0, 10), label: 'This month' };
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-10-25 -> 25 Oct 2026 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  if (!ISO_DATE.test(s)) return String(iso);
  const [y, m, d] = s.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** Timestamp text from Postgres -> "25 Oct 2026, 7:41 pm" in IST */
export function fmtDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  // Postgres text: "2026-10-25 02:37:08.541175+00" → ISO "2026-10-25T02:37:08.541+00:00"
  const iso = String(ts).trim()
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
    .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(ts);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
}

/** 2026-10 -> Oct 2026 */
export function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

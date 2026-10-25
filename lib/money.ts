// Money helpers. Amounts travel as exact decimal strings ("125000.50");
// all arithmetic happens in PostgreSQL numeric. Nothing here uses floats
// for money maths.

const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/;

/** Parses user input like "₹1,25,000.5" into "125000.50". Returns null if invalid. */
export function parseAmount(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '');
  if (!AMOUNT_RE.test(s)) return null;
  const [i, f = ''] = s.split('.');
  const intPart = i.replace(/^0+(?=\d)/, '');
  return `${intPart}.${(f + '00').slice(0, 2)}`;
}

/** Same as parseAmount but must be > 0. */
export function parsePositiveAmount(input: unknown): string | null {
  const a = parseAmount(input);
  if (a === null) return null;
  return /^0+\.00$/.test(a) ? null : a;
}

function groupIndian(int: string): string {
  if (int.length <= 3) return int;
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** Formats a decimal string/number as Indian Rupees: ₹1,25,000.00 */
export function inr(value: string | number | null | undefined, opts: { sign?: boolean; symbol?: boolean } = {}): string {
  const symbol = opts.symbol === false ? '' : '₹';
  if (value === null || value === undefined || value === '') return `${symbol}0.00`;
  let s = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  const [i, f = ''] = s.split('.');
  const frac = (f + '00').slice(0, 2);
  const isZero = /^0*$/.test(i) && /^0*$/.test(frac);
  const body = `${symbol}${groupIndian(i.replace(/^0+(?=\d)/, '') || '0')}.${frac}`;
  if (neg && !isZero) return `−${body}`;
  if (opts.sign && !isZero) return `+${body}`;
  return body;
}

/** Compact form for chart labels: ₹1.2L, ₹3.4Cr, ₹950 */
export function inrShort(value: string | number): string {
  const n = Number(value);
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(0)}K`;
  return `${sign}₹${a.toFixed(0)}`;
}

/** Sign of a decimal string without float conversion: -1, 0, 1 */
export function signOf(value: string | null | undefined): -1 | 0 | 1 {
  if (!value) return 0;
  const s = String(value).trim();
  if (/^-?0*(\.0*)?$/.test(s)) return 0;
  return s.startsWith('-') ? -1 : 1;
}

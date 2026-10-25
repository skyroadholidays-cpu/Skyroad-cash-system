// Presentational building blocks (server-safe: no hooks).
import Link from 'next/link';
import type { ReactNode } from 'react';
import { inr, signOf } from '@/lib/money';
import { TXN_TYPE_LABEL, statusLabel, type TxnType } from '@/lib/constants';

export function Money({ value, sign, tone, className = '' }: { value: string | number | null | undefined; sign?: boolean; tone?: 'auto' | 'in' | 'out'; className?: string }) {
  const s = signOf(value == null ? null : String(value));
  const t = tone === 'in' ? 'pos' : tone === 'out' ? 'neg' : tone === 'auto' ? (s > 0 ? 'pos' : s < 0 ? 'neg' : '') : '';
  return <span className={`money ${t} ${className}`}>{inr(value, { sign })}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone, href, icon, emphasis }: {
  label: string; value: string; hint?: ReactNode; tone?: 'cash' | 'in' | 'out' | 'due' | 'pay' | 'net'; href?: string; icon?: ReactNode; emphasis?: boolean;
}) {
  const body = (
    <>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value"><Money value={value} tone={tone === 'net' ? 'auto' : undefined} /></div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  );
  const cls = `stat stat-${tone ?? 'cash'}${emphasis ? ' stat-emphasis' : ''}`;
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

const TYPE_CLASS: Record<TxnType, string> = {
  cash_in: 'b-in', cash_out: 'b-out', transfer: 'b-transfer', collection_due: 'b-due', payment_due: 'b-pay',
};

export function TypeBadge({ type }: { type: TxnType }) {
  return <span className={`badge ${TYPE_CLASS[type]}`}>{TXN_TYPE_LABEL[type]}</span>;
}

export function StatusBadge({ type, settleStatus, overdue }: { type: TxnType; settleStatus?: string | null; overdue?: boolean }) {
  const label = statusLabel(type, settleStatus);
  const cls = overdue ? 's-overdue' : settleStatus === 'settled' || type === 'cash_in' || type === 'cash_out' || type === 'transfer' ? 's-done' : settleStatus === 'partial' ? 's-partial' : 's-pending';
  return <span className={`status ${cls}`}>{overdue ? `Overdue · ${label}` : label}</span>;
}

export function Flash({ children, tone = 'ok' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'error' }) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Simple filter chips that keep other query params. */
export function Chips({ base, param, value, options, keep = {} }: {
  base: string; param: string; value: string; options: { key: string; label: string; count?: number }[]; keep?: Record<string, string | undefined>;
}) {
  return (
    <div className="chips">
      {options.map((o) => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(keep)) if (v) qs.set(k, v);
        qs.set(param, o.key);
        return (
          <Link key={o.key} href={`${base}?${qs}`} className={`chip${o.key === value ? ' chip-on' : ''}`}>
            {o.label}{o.count !== undefined && <span className="chip-count">{o.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}

export const Icon = {
  in: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7" /></svg>,
  out: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>,
  transfer: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>,
  booking: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 3v4M16 3v4" /></svg>,
  collect: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 10l3-3 3 3" transform="rotate(180 12 12)" /></svg>,
  pay: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></svg>,
  locker: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="11" r="3" /><path d="M12 8v1M12 13v1M8 21v-2M16 21v-2" /></svg>,
  hand: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>,
  wallet: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7H5a2 2 0 0 1 0-4h13v4" /><path d="M3 5v14a2 2 0 0 0 2 2h15V7" /><circle cx="16" cy="14" r="1.2" /></svg>,
  alert: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
};

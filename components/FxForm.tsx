'use client';
import { useState } from 'react';
import { ActionForm, SubmitButton } from './ActionForm';
import { inr, parseAmount } from '@/lib/money';
import type { FormState } from '@/app/actions';

const PURPOSES = {
  in: ['Bought from money changer', 'Received from client', 'Left over after trip', 'Refund from supplier', 'Personal / home', 'Other'],
  out: ['Given to client for trip', 'Paid to supplier abroad', 'Sold to money changer', 'Used on business trip', 'Personal / home', 'Other'],
};

export interface FxFormValues {
  id?: string; currency: string; direction?: 'in' | 'out'; txn_date?: string; amount?: string; rate_inr?: string | null;
  counterparty?: string | null; purpose?: string | null; booking_ref?: string | null; account?: string | null; notes?: string | null;
}

export function FxForm({ action, values, currencies, balance, today, idem, bookings, mode }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  values: FxFormValues;
  currencies: { code: string; name: string }[];
  balance: string;          // current holding of values.currency (for the "after" hint)
  today: string;
  idem: string;
  bookings: { booking_ref: string; client_name: string }[];
  mode: 'create' | 'edit';
}) {
  const [direction, setDirection] = useState<'in' | 'out'>(values.direction ?? 'in');
  const [amount, setAmount] = useState(values.amount ?? '');
  const [rate, setRate] = useState(values.rate_inr ?? '');
  const [home, setHome] = useState(values.account === 'home');
  const parsed = parseAmount(amount);
  const after = parsed ? Number(balance) + (direction === 'in' ? 1 : -1) * Number(parsed) : null;
  const rateOk = /^\d{1,9}(\.\d{1,4})?$/.test(rate.replace(/[₹,\s]/g, ''));
  const inrValue = parsed && rateOk ? (Number(parsed) * Number(rate.replace(/[₹,\s]/g, ''))).toFixed(2) : null;

  return (
    <ActionForm action={action} className="form">
      <input type="hidden" name="idem" value={idem} />
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="entry_for" value={home ? 'home' : 'business'} />

      <div className="type-picker">
        <label className={`type-opt t-cash_in${direction === 'in' ? ' on' : ''}`}>
          <input type="radio" name="dir_choice" checked={direction === 'in'} onChange={() => setDirection('in')} />Received / bought
        </label>
        <label className={`type-opt t-cash_out${direction === 'out' ? ' on' : ''}`}>
          <input type="radio" name="dir_choice" checked={direction === 'out'} onChange={() => setDirection('out')} />Given / spent / sold
        </label>
      </div>

      <div className="grid" style={{ marginTop: 14 }}>
        <label className="field">
          <span className="field-label">Currency</span>
          <select name="currency" defaultValue={values.currency}>
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} – {c.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" name="txn_date" defaultValue={values.txn_date ?? today} max={today} required />
        </label>
        <label className="field field-amount">
          <span className="field-label">Amount (in the foreign currency)</span>
          <input name="amount" inputMode="decimal" required placeholder="0.00" autoComplete="off" value={amount}
                 onChange={(e) => setAmount(e.target.value)} autoFocus={mode === 'create'} />
          {after !== null && mode === 'create' && (
            <span className={`field-hint${after < 0 ? ' warn' : ''}`}>
              {after < 0 ? `You only hold ${balance} – this is more than you have.` : `Holding after this: ${after.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
            </span>
          )}
        </label>
        <label className="field">
          <span className="field-label">Rate – ₹ for 1 unit (optional)</span>
          <input name="rate_inr" inputMode="decimal" placeholder="e.g. 83.45" autoComplete="off" value={rate}
                 onChange={(e) => setRate(e.target.value)} />
          <span className="field-hint">{inrValue ? `≈ ${inr(inrValue)}` : 'Used to show the approximate rupee value.'}</span>
        </label>
        <label className="field">
          <span className="field-label">{direction === 'in' ? 'Received / bought from' : 'Given / paid / sold to'}</span>
          <input name="counterparty" defaultValue={values.counterparty ?? ''} maxLength={120} placeholder={direction === 'in' ? 'e.g. Thomas Cook, client name' : 'e.g. client name, hotel'} />
        </label>
        <label className="field">
          <span className="field-label">Purpose</span>
          <input name="purpose" list={`fx-purpose-${direction}`} defaultValue={values.purpose ?? ''} key={direction} maxLength={80} placeholder="Choose or type" />
          <datalist id="fx-purpose-in">{PURPOSES.in.map((p) => <option key={p} value={p} />)}</datalist>
          <datalist id="fx-purpose-out">{PURPOSES.out.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="check field-wide">
          <input type="checkbox" checked={home} onChange={(e) => setHome(e.target.checked)} />
          <span>This is <strong>Home / personal</strong> forex (not Skyroad)</span>
        </label>
        {!home && (
          <label className="field">
            <span className="field-label">Booking reference (optional)</span>
            <input name="booking_ref" list="fx-bookings" defaultValue={values.booking_ref ?? ''} maxLength={40} autoComplete="off" />
            <datalist id="fx-bookings">{bookings.map((b) => <option key={b.booking_ref} value={b.booking_ref}>{b.client_name}</option>)}</datalist>
          </label>
        )}
        <label className="field field-wide">
          <span className="field-label">Notes</span>
          <textarea name="notes" rows={2} defaultValue={values.notes ?? ''} maxLength={1000} />
        </label>
      </div>
      <div className="form-actions">
        <SubmitButton>{mode === 'create' ? 'Save forex entry' : 'Save changes'}</SubmitButton>
      </div>
    </ActionForm>
  );
}

'use client';
import { useState } from 'react';
import { ActionForm, SubmitButton } from './ActionForm';
import { inr, parseAmount } from '@/lib/money';
import type { FormState } from '@/app/actions';

const CATEGORIES = ['Purchase', 'Shared expense', 'Loan given / taken', 'Settlement', 'Cash exchange', 'Gift', 'Other'];

export interface PartyEntryValues {
  id?: string; paid_by?: 'me' | 'them'; txn_date?: string; amount?: string; category?: string | null;
  description?: string | null; notes?: string | null; linked_txn_id?: string | null; location_id?: number | null;
}

export function PartyEntryForm({ action, partyId, partyName, balance, values, locations, today, idem, mode }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  partyId: number; partyName: string; balance: string;
  values: PartyEntryValues;
  locations: { id: number; name: string; balance: string }[];
  today: string; idem: string; mode: 'create' | 'edit';
}) {
  const [paidBy, setPaidBy] = useState<'me' | 'them'>(values.paid_by ?? 'me');
  const [amount, setAmount] = useState(values.amount ?? '');
  const [cash, setCash] = useState(!!values.linked_txn_id);
  const parsed = parseAmount(amount);
  const after = parsed && mode === 'create' ? Number(balance) + (paidBy === 'me' ? 1 : -1) * Number(parsed) : null;
  const afterText = after === null ? null
    : after > 0 ? `${partyName} will owe you ${inr(after.toFixed(2))}`
    : after < 0 ? `You will owe ${partyName} ${inr((-after).toFixed(2))}`
    : 'Account will be fully settled';

  return (
    <ActionForm action={action} className="form">
      <input type="hidden" name="idem" value={idem} />
      <input type="hidden" name="party_id" value={partyId} />
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <input type="hidden" name="paid_by" value={paidBy} />

      <div className="type-picker">
        <label className={`type-opt t-cash_out${paidBy === 'me' ? ' on' : ''}`}>
          <input type="radio" name="paid_choice" checked={paidBy === 'me'} onChange={() => setPaidBy('me')} />I paid
        </label>
        <label className={`type-opt t-cash_in${paidBy === 'them' ? ' on' : ''}`}>
          <input type="radio" name="paid_choice" checked={paidBy === 'them'} onChange={() => setPaidBy('them')} />{partyName} paid
        </label>
      </div>
      <p className="type-help">
        {paidBy === 'me'
          ? `You paid for ${partyName}, lent money, or paid them back – ${partyName} owes you this much more.`
          : `${partyName} paid for you, lent you money, or paid you back – you owe ${partyName} this much more.`}
      </p>

      <div className="grid">
        <label className="field field-amount">
          <span className="field-label">Amount (₹)</span>
          <input name="amount" inputMode="decimal" required placeholder="0.00" autoComplete="off" value={amount}
                 onChange={(e) => setAmount(e.target.value)} autoFocus={mode === 'create'} />
          <span className="field-hint">{afterText ?? (parsed ? inr(parsed) : 'Only the part that counts between you two')}</span>
        </label>
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" name="txn_date" defaultValue={values.txn_date ?? today} max={today} required />
        </label>
        <label className="field field-wide">
          <span className="field-label">What was it for?</span>
          <input name="description" defaultValue={values.description ?? ''} maxLength={200} placeholder="e.g. Dinner at Marriott, flight tickets, cash returned" />
        </label>
        <label className="field">
          <span className="field-label">Type</span>
          <input name="category" list="party-cats" defaultValue={values.category ?? ''} maxLength={60} placeholder="Choose or type" />
          <datalist id="party-cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <div className="field">
          <label className="check" style={{ marginTop: 24 }}>
            <input type="checkbox" name="cash" checked={cash} onChange={(e) => setCash(e.target.checked)} />
            <span>{paidBy === 'me' ? 'Paid in cash from my cash' : 'Received in cash'}<br />
              <span className="muted small">Also records a Cash {paidBy === 'me' ? 'Out' : 'In'} so your cash balance stays right</span></span>
          </label>
        </div>
        {cash && (
          <label className="field">
            <span className="field-label">{paidBy === 'me' ? 'Paid from' : 'Cash kept in'}</span>
            <select name="location_id" defaultValue={values.location_id ?? ''} required>
              <option value="">—</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name} — {inr(l.balance)}</option>)}
            </select>
          </label>
        )}
        <label className="field field-wide">
          <span className="field-label">Notes</span>
          <textarea name="notes" rows={2} defaultValue={values.notes ?? ''} maxLength={1000} />
        </label>
      </div>
      <div className="form-actions">
        <SubmitButton>{mode === 'create' ? 'Save entry' : 'Save changes'}</SubmitButton>
      </div>
    </ActionForm>
  );
}

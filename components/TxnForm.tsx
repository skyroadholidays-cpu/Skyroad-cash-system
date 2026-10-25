'use client';
import { useMemo, useState } from 'react';
import { ActionForm, SubmitButton } from './ActionForm';
import { CATEGORIES, TXN_TYPES, TXN_TYPE_LABEL, type TxnType } from '@/lib/constants';
import { inr, parseAmount } from '@/lib/money';
import type { FormState } from '@/app/actions';

export interface TxnFormLocation { id: number; name: string; balance: string }
export interface TxnFormDue {
  id: string; type: 'collection_due' | 'payment_due'; txn_no: string; booking_ref: string | null; client_name: string | null;
  supplier_name: string | null; service_provider: string | null; outstanding: string; due_date: string | null; description: string | null;
}
export interface TxnFormValues {
  id?: string; type?: TxnType; txn_date?: string; amount?: string; booking_ref?: string | null; client_name?: string | null;
  supplier_name?: string | null; service_provider?: string | null; description?: string | null; category?: string | null;
  notes?: string | null; location_id?: number | null; from_location_id?: number | null; to_location_id?: number | null;
  settles_id?: string | null; due_date?: string | null; is_package_due?: boolean;
}

const HELP: Record<TxnType, string> = {
  cash_in: 'Money physically received. Increases the chosen cash location.',
  cash_out: 'Money physically paid out. Decreases the chosen cash location.',
  transfer: 'Moving your own cash between locations. Total cash stays the same.',
  collection_due: 'Money a client owes you. Does not change physical cash until collected.',
  payment_due: 'Money you owe a supplier. Does not change physical cash until paid.',
};

export function TxnForm({ action, mode, values, locations, bookings, dues, suggestions, idem, today }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  mode: 'create' | 'edit';
  values: TxnFormValues;
  locations: TxnFormLocation[];
  bookings: { booking_ref: string; client_name: string; destination: string | null }[];
  dues: TxnFormDue[];
  suggestions: { clients: string[]; suppliers: string[]; providers: string[] };
  idem: string;
  today: string;
}) {
  const [type, setType] = useState<TxnType>(values.type ?? 'cash_in');
  const [amount, setAmount] = useState(values.amount ?? '');
  const [bookingRef, setBookingRef] = useState(values.booking_ref ?? '');
  const initialBooking = bookings.find((b) => b.booking_ref.toLowerCase() === (values.booking_ref ?? '').toLowerCase());
  const [client, setClient] = useState(values.client_name ?? (mode === 'create' && initialBooking ? initialBooking.client_name : ''));
  const [supplier, setSupplier] = useState(values.supplier_name ?? '');
  const [locationId, setLocationId] = useState(String(values.location_id ?? locations[0]?.id ?? ''));
  const [fromId, setFromId] = useState(String(values.from_location_id ?? locations[0]?.id ?? ''));
  const [toId, setToId] = useState(String(values.to_location_id ?? locations[1]?.id ?? ''));
  // Opened from a booking ("+ Collection"): pre-select its only open receivable/invoice.
  const [settlesId, setSettlesId] = useState(() => {
    if (values.settles_id) return values.settles_id;
    const kind = values.type === 'cash_in' ? 'collection_due' : values.type === 'cash_out' ? 'payment_due' : null;
    if (mode !== 'create' || !initialBooking || !kind) return '';
    const open = dues.filter((d) => d.type === kind && d.booking_ref?.toLowerCase() === initialBooking.booking_ref.toLowerCase());
    return open.length === 1 ? open[0].id : '';
  });

  const isCash = type === 'cash_in' || type === 'cash_out';
  const dueKind = type === 'cash_in' ? 'collection_due' : type === 'cash_out' ? 'payment_due' : null;
  const parsed = parseAmount(amount);

  const matchingDues = useMemo(() => {
    if (!dueKind) return [];
    return dues.filter((d) => d.type === dueKind && (!bookingRef || !d.booking_ref || d.booking_ref.toLowerCase() === bookingRef.toLowerCase()) || d.id === settlesId);
  }, [dues, dueKind, bookingRef, settlesId]);
  const selectedDue = dues.find((d) => d.id === settlesId);

  function onBooking(v: string) {
    setBookingRef(v);
    const b = bookings.find((x) => x.booking_ref.toLowerCase() === v.trim().toLowerCase());
    if (b && !client) setClient(b.client_name);
    // pick the booking's only open due automatically on new entries
    if (b && mode === 'create' && dueKind) {
      const open = dues.filter((d) => d.type === dueKind && d.booking_ref?.toLowerCase() === b.booking_ref.toLowerCase());
      setSettlesId(open.length === 1 ? open[0].id : '');
    }
  }
  function onDue(id: string) {
    setSettlesId(id);
    const d = dues.find((x) => x.id === id);
    if (!d) return;
    if (d.booking_ref) setBookingRef(d.booking_ref);
    if (d.client_name && !client) setClient(d.client_name);
    if (d.supplier_name && !supplier) setSupplier(d.supplier_name);
    if (!amount) setAmount(d.outstanding);
  }
  function onType(t: TxnType) {
    setType(t);
    setSettlesId('');
  }

  const loc = (id: string) => locations.find((l) => String(l.id) === id);
  const after = (id: string, delta: -1 | 1) => {
    const l = loc(id);
    if (!l || !parsed) return null;
    const v = Number(l.balance) + delta * Number(parsed);
    return v;
  };
  const outAfter = type === 'cash_out' ? after(locationId, -1) : type === 'transfer' ? after(fromId, -1) : null;
  const overDue = selectedDue && parsed && Number(parsed) > Number(selectedDue.outstanding);

  return (
    <ActionForm action={action} className="form">
      <input type="hidden" name="idem" value={idem} />
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <fieldset className="type-picker" disabled={values.is_package_due}>
        <legend className="sr-only">Transaction type</legend>
        {TXN_TYPES.map((t) => (
          <label key={t} className={`type-opt t-${t}${type === t ? ' on' : ''}`}>
            <input type="radio" name="type" value={t} checked={type === t} onChange={() => onType(t)} />
            {TXN_TYPE_LABEL[t]}
          </label>
        ))}
      </fieldset>
      {values.is_package_due && <input type="hidden" name="type" value="collection_due" />}
      <p className="type-help">{HELP[type]}</p>

      <div className="grid">
        <label className="field field-amount">
          <span className="field-label">Amount (₹)</span>
          <input name="amount" inputMode="decimal" autoComplete="off" required placeholder="0.00" value={amount}
                 onChange={(e) => setAmount(e.target.value)} autoFocus={mode === 'create'} />
          <span className="field-hint">{parsed ? inr(parsed) : amount ? <span className="neg">Enter a valid amount (max 2 decimals)</span> : 'e.g. 25000 or 1,25,000.50'}</span>
        </label>
        <label className="field">
          <span className="field-label">{type === 'collection_due' || type === 'payment_due' ? 'Date raised' : 'Transaction date'}</span>
          <input type="date" name="txn_date" required defaultValue={values.txn_date ?? today}
                 max={isCash || type === 'transfer' ? today : undefined} />
        </label>

        {isCash && (
          <label className="field">
            <span className="field-label">{type === 'cash_in' ? 'Received into' : 'Paid from'}</span>
            <select name="location_id" value={locationId} onChange={(e) => setLocationId(e.target.value)} required>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name} — {inr(l.balance)}</option>)}
            </select>
            {outAfter !== null && outAfter < 0 && <span className="field-hint warn">This would take {loc(locationId)?.name} below zero ({inr(outAfter.toFixed(2))}). Check the location.</span>}
          </label>
        )}

        {type === 'transfer' && (
          <>
            <label className="field">
              <span className="field-label">From</span>
              <select name="from_location_id" value={fromId} onChange={(e) => setFromId(e.target.value)} required>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name} — {inr(l.balance)}</option>)}
              </select>
              {outAfter !== null && outAfter < 0 && <span className="field-hint warn">Only {inr(loc(fromId)?.balance)} is recorded here.</span>}
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <select name="to_location_id" value={toId} onChange={(e) => setToId(e.target.value)} required>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name} — {inr(l.balance)}</option>)}
              </select>
              {fromId === toId && <span className="field-hint warn">Choose two different locations.</span>}
            </label>
          </>
        )}

        {(type === 'collection_due' || type === 'payment_due') && (
          <label className="field">
            <span className="field-label">{type === 'collection_due' ? 'Expected collection date' : 'Payment due date'}</span>
            <input type="date" name="due_date" defaultValue={values.due_date ?? ''} />
          </label>
        )}

        {type !== 'transfer' && (
          <label className="field">
            <span className="field-label">Booking reference</span>
            <input name="booking_ref" list="dl-bookings" value={bookingRef} onChange={(e) => onBooking(e.target.value)}
                   placeholder="Optional – e.g. SR-BALI-001" autoComplete="off" readOnly={values.is_package_due} />
          </label>
        )}

        {isCash && (
          <label className="field field-wide">
            <span className="field-label">{type === 'cash_in' ? 'Against client receivable' : 'Against supplier invoice'}</span>
            <select name="settles_id" value={settlesId} onChange={(e) => onDue(e.target.value)}>
              <option value="">{type === 'cash_in' ? '— Not against a receivable (e.g. walk-in sale) —' : '— Not against an invoice (other expense) —'}</option>
              {matchingDues.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.txn_no} · {d.booking_ref ?? 'no booking'} · {(type === 'cash_in' ? d.client_name : [d.supplier_name, d.service_provider].filter(Boolean).join(' / ')) ?? ''} · {inr(d.outstanding)} outstanding
                </option>
              ))}
            </select>
            {selectedDue && (
              <span className={`field-hint${overDue ? ' warn' : ''}`}>
                {overDue ? `More than the ${inr(selectedDue.outstanding)} outstanding – reduce the amount.` : `${inr(selectedDue.outstanding)} outstanding on ${selectedDue.txn_no}. Partial amounts are fine.`}
              </span>
            )}
          </label>
        )}

        {(type === 'cash_in' || type === 'collection_due' || type === 'cash_out') && (
          <label className="field">
            <span className="field-label">Client name{type === 'cash_out' ? ' (e.g. for refunds)' : ''}</span>
            <input name="client_name" list="dl-clients" value={client} onChange={(e) => setClient(e.target.value)} autoComplete="off" />
          </label>
        )}

        {(type === 'cash_out' || type === 'payment_due') && (
          <>
            <label className="field">
              <span className="field-label">Supplier</span>
              <input name="supplier_name" list="dl-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} autoComplete="off"
                     required={type === 'payment_due'} />
            </label>
            <label className="field">
              <span className="field-label">Hotel / service provider</span>
              <input name="service_provider" list="dl-providers" defaultValue={values.service_provider ?? ''} autoComplete="off" />
            </label>
          </>
        )}

        <label className="field">
          <span className="field-label">Category</span>
          <input name="category" list={`dl-cat-${type}`} defaultValue={values.category ?? ''} key={`cat-${type}`} autoComplete="off" placeholder="Choose or type" />
        </label>
        <label className="field field-wide">
          <span className="field-label">Description / purpose</span>
          <input name="description" defaultValue={values.description ?? ''} maxLength={300} />
        </label>
        <label className="field field-wide">
          <span className="field-label">Notes / remarks</span>
          <textarea name="notes" rows={2} defaultValue={values.notes ?? ''} maxLength={2000} />
        </label>
      </div>

      <datalist id="dl-bookings">{bookings.map((b) => <option key={b.booking_ref} value={b.booking_ref}>{b.client_name}{b.destination ? ` – ${b.destination}` : ''}</option>)}</datalist>
      <datalist id="dl-clients">{suggestions.clients.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="dl-suppliers">{suggestions.suppliers.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="dl-providers">{suggestions.providers.map((c) => <option key={c} value={c} />)}</datalist>
      {TXN_TYPES.map((t) => <datalist key={t} id={`dl-cat-${t}`}>{CATEGORIES[t].map((c) => <option key={c} value={c} />)}</datalist>)}

      <div className="form-actions">
        <SubmitButton>{mode === 'create' ? `Save ${TXN_TYPE_LABEL[type]}` : 'Save changes'}</SubmitButton>
        {mode === 'create' && <SubmitButton className="btn btn-ghost" name="and_new" value="1">Save & add another</SubmitButton>}
      </div>
    </ActionForm>
  );
}

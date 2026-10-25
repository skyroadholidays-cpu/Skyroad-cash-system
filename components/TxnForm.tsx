'use client';
import { useMemo, useState } from 'react';
import { ActionForm, SubmitButton } from './ActionForm';
import { CATEGORIES, HOME_CATEGORIES, TXN_TYPES, TXN_TYPE_LABEL, ENTRY_FOR_LABEL, ENTRY_FOR_HELP, entryForOf, type EntryFor, type TxnType } from '@/lib/constants';
import { inr, parseAmount } from '@/lib/money';
import type { FormState } from '@/app/actions';

export interface TxnFormLocation { id: number; name: string; balance: string }
export interface TxnFormDue {
  id: string; type: 'collection_due' | 'payment_due'; txn_no: string; booking_ref: string | null; client_name: string | null;
  supplier_name: string | null; service_provider: string | null; outstanding: string; due_date: string | null; description: string | null;
  account?: string | null;
}
export interface TxnFormValues {
  id?: string; type?: TxnType; txn_date?: string; amount?: string; booking_ref?: string | null; client_name?: string | null;
  supplier_name?: string | null; service_provider?: string | null; description?: string | null; category?: string | null;
  notes?: string | null; location_id?: number | null; from_location_id?: number | null; to_location_id?: number | null;
  settles_id?: string | null; due_date?: string | null; is_package_due?: boolean; account?: string | null;
  entry_for?: EntryFor;
  source?: Source;
}

/** For Cash In / Cash Out: where the money came from / went to. */
export type Source = 'booking' | 'dues' | 'location' | 'business' | 'home';
const SOURCE_LABEL: Record<'cash_in' | 'cash_out', Record<Source, string>> = {
  cash_in: {
    booking: 'A booking (client payment)',
    dues: 'Past dues / money owed to me',
    location: 'Another cash location (Skyroad / Home locker…)',
    business: 'Other Skyroad income',
    home: 'Home / personal money',
  },
  cash_out: {
    booking: 'A booking expense / supplier',
    dues: 'Paying a pending bill / dues',
    location: 'Moved to another cash location',
    business: 'Other Skyroad expense (salary, office…)',
    home: 'Home / personal spending',
  },
};
const SOURCE_HELP: Record<'cash_in' | 'cash_out', Record<Source, string>> = {
  cash_in: {
    booking: 'Cash received for a travel booking. It reduces what the client still owes.',
    dues: 'Cash received against something already pending (Skyroad or Home). Pick it below.',
    location: 'Cash moved here from another of your locations – recorded as a transfer, so total cash stays the same.',
    business: 'Skyroad money not tied to a booking – commission, other business income.',
    home: 'Your own money. Counted in physical cash, kept out of Skyroad figures.',
  },
  cash_out: {
    booking: 'Cash paid for a travel booking – a supplier, hotel or other booking cost.',
    dues: 'Cash paid against a pending bill (Skyroad or Home). Pick it below.',
    location: 'Cash moved from here to another of your locations – recorded as a transfer, so total cash stays the same.',
    business: 'Skyroad cost not tied to a booking – salary, rent, office expenses.',
    home: 'Your own spending. Kept out of Skyroad figures.',
  },
};

function initialSource(v: TxnFormValues): Source {
  if (v.source) return v.source;
  if (v.settles_id) return v.booking_ref && v.account !== 'home' ? 'booking' : 'dues';
  return v.entry_for ?? entryForOf(v);
}

const HELP: Record<TxnType, string> = {
  cash_in: 'Money physically received. Increases the chosen cash location.',
  cash_out: 'Money physically paid out. Decreases the chosen cash location.',
  transfer: 'Moving your own cash between locations. Total cash stays the same.',
  collection_due: 'Money someone owes you. Does not change physical cash until it is collected.',
  payment_due: 'Money you owe – a supplier, salary, rent or a bill. Does not change physical cash until it is paid.',
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
  const [entryForState, setEntryFor] = useState<EntryFor>(values.entry_for ?? entryForOf(values));
  const [source, setSource] = useState<Source>(() => initialSource(values));
  const [amount, setAmount] = useState(values.amount ?? '');
  const [bookingRef, setBookingRef] = useState(values.booking_ref ?? '');
  const initialBooking = bookings.find((b) => b.booking_ref.toLowerCase() === (values.booking_ref ?? '').toLowerCase());
  const [client, setClient] = useState(values.client_name ?? (mode === 'create' && initialBooking ? initialBooking.client_name : ''));
  const [supplier, setSupplier] = useState(values.supplier_name ?? '');
  const [locationId, setLocationId] = useState(String(values.location_id ?? locations[0]?.id ?? ''));
  const [fromId, setFromId] = useState(String(values.from_location_id ?? locations[0]?.id ?? ''));
  const [toId, setToId] = useState(String(values.to_location_id ?? locations.find((l) => String(l.id) !== String(values.from_location_id ?? locations[0]?.id))?.id ?? ''));
  // the "other" location when cash came from / went to another location (a transfer)
  const [otherId, setOtherId] = useState(() => String(locations.find((l) => String(l.id) !== String(values.location_id ?? locations[0]?.id))?.id ?? ''));
  // Opened from a booking ("+ Collection"): pre-select its only open receivable/invoice.
  const [settlesId, setSettlesId] = useState(() => {
    if (values.settles_id) return values.settles_id;
    const kind = values.type === 'cash_in' ? 'collection_due' : values.type === 'cash_out' ? 'payment_due' : null;
    if (mode !== 'create' || !initialBooking || !kind) return '';
    const open = dues.filter((d) => d.type === kind && d.booking_ref?.toLowerCase() === initialBooking.booking_ref.toLowerCase());
    return open.length === 1 ? open[0].id : '';
  });

  const isCash = type === 'cash_in' || type === 'cash_out';
  const cashKind = type === 'cash_out' ? 'cash_out' : 'cash_in';
  const isMove = isCash && source === 'location';            // cash came from / went to another location
  const submitType: TxnType = isMove ? 'transfer' : type;
  const hasEntryFor = type !== 'transfer' && !isMove;
  const dueSelected = dues.find((d) => d.id === settlesId);
  const entryFor: EntryFor = !isCash ? entryForState
    : source === 'dues' ? (dueSelected ? (dueSelected.account === 'home' ? 'home' : dueSelected.booking_ref ? 'booking' : 'business') : 'business')
    : source === 'location' ? 'business'
    : source;
  const isHome = hasEntryFor && entryFor === 'home';
  const needsBooking = hasEntryFor && entryFor === 'booking' && !(isCash && source === 'dues');
  const showPicker = isCash && (source === 'booking' || source === 'dues');
  const catKey = isHome ? `dl-cat-home-${type}` : `dl-cat-${type}`;
  const dueKind = type === 'cash_in' ? 'collection_due' : type === 'cash_out' ? 'payment_due' : null;
  const parsed = parseAmount(amount);

  const matchingDues = useMemo(() => {
    if (!dueKind) return [];
    // "Past dues" lists everything pending (Skyroad and Home); "A booking" lists that booking's Skyroad dues.
    if (source === 'dues') return dues.filter((d) => d.type === dueKind || d.id === settlesId);
    return dues.filter((d) => (d.type === dueKind && d.account !== 'home'
      && (!bookingRef || !d.booking_ref || d.booking_ref.toLowerCase() === bookingRef.toLowerCase())) || d.id === settlesId);
  }, [dues, dueKind, bookingRef, settlesId, source]);
  const selectedDue = dues.find((d) => d.id === settlesId);

  function onBooking(v: string) {
    setBookingRef(v);
    if (v.trim() && hasEntryFor) { setEntryFor('booking'); if (isCash && source !== 'dues') setSource('booking'); }
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
  function onSource(s2: Source) {
    setSource(s2);
    setSettlesId('');
    if (s2 !== 'booking') setBookingRef('');
    if (s2 === 'location' && otherId === locationId) setOtherId(String(locations.find((l) => String(l.id) !== locationId)?.id ?? ''));
  }
  function onEntryFor(e: EntryFor) {
    setEntryFor(e);
    if (e !== 'booking') setBookingRef('');
    setSettlesId('');
  }

  const loc = (id: string) => locations.find((l) => String(l.id) === id);
  const after = (id: string, delta: -1 | 1) => {
    const l = loc(id);
    if (!l || !parsed) return null;
    const v = Number(l.balance) + delta * Number(parsed);
    return v;
  };
  const outAfter = isMove ? (type === 'cash_out' ? after(locationId, -1) : after(otherId, -1))
    : type === 'cash_out' ? after(locationId, -1) : type === 'transfer' ? after(fromId, -1) : null;
  const overDue = selectedDue && parsed && Number(parsed) > Number(selectedDue.outstanding);

  return (
    <ActionForm action={action} className="form">
      <input type="hidden" name="idem" value={idem} />
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <fieldset className="type-picker" disabled={values.is_package_due}>
        <legend className="sr-only">Transaction type</legend>
        {TXN_TYPES.map((t) => (
          <label key={t} className={`type-opt t-${t}${type === t ? ' on' : ''}`}>
            <input type="radio" name="type_choice" value={t} checked={type === t} onChange={() => onType(t)} />
            {TXN_TYPE_LABEL[t]}
          </label>
        ))}
      </fieldset>
      <input type="hidden" name="type" value={submitType} />
      <p className="type-help">{HELP[type]}</p>

      {isCash && (
        <>
          <fieldset className="type-picker entry-for source-picker">
            <legend className="field-label" style={{ width: '100%', marginBottom: 6 }}>{type === 'cash_in' ? 'Where did this money come from?' : 'Where did this money go?'}</legend>
            {(['booking', 'dues', 'location', 'business', 'home'] as Source[]).map((s2) => (
              <label key={s2} className={`type-opt e-${s2 === 'dues' ? 'booking' : s2 === 'location' ? 'business' : s2}${source === s2 ? ' on' : ''}`}>
                <input type="radio" name="source" value={s2} checked={source === s2} onChange={() => onSource(s2)} />
                {SOURCE_LABEL[cashKind][s2]}
              </label>
            ))}
          </fieldset>
          <p className="type-help">{SOURCE_HELP[cashKind][source]}</p>
        </>
      )}

      {hasEntryFor && !isCash && (
        <fieldset className="type-picker entry-for" disabled={values.is_package_due}>
          <legend className="field-label" style={{ width: '100%', marginBottom: 6 }}>Entry for</legend>
          {(['booking', 'business', 'home'] as EntryFor[]).map((e) => (
            <label key={e} className={`type-opt e-${e}${entryFor === e ? ' on' : ''}`}>
              <input type="radio" name="entry_for_choice" value={e} checked={entryFor === e} onChange={() => onEntryFor(e)} />
              {ENTRY_FOR_LABEL[e]}
            </label>
          ))}
        </fieldset>
      )}
      {hasEntryFor && <input type="hidden" name="entry_for" value={entryFor} />}
      {hasEntryFor && !isCash && <p className="type-help">{ENTRY_FOR_HELP[entryFor]}</p>}

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
            {!isMove && outAfter !== null && outAfter < 0 && <span className="field-hint warn">This would take {loc(locationId)?.name} below zero ({inr(outAfter.toFixed(2))}). Check the location.</span>}
          </label>
        )}

        {isMove && (
          <label className="field">
            <span className="field-label">{type === 'cash_in' ? 'Taken from' : 'Moved to'}</span>
            <select value={otherId} onChange={(e) => setOtherId(e.target.value)} required>
              {locations.filter((l) => String(l.id) !== locationId).map((l) => <option key={l.id} value={l.id}>{l.name} — {inr(l.balance)}</option>)}
            </select>
            <input type="hidden" name="from_location_id" value={type === 'cash_in' ? otherId : locationId} />
            <input type="hidden" name="to_location_id" value={type === 'cash_in' ? locationId : otherId} />
            {outAfter !== null && outAfter < 0 && <span className="field-hint warn">Only {inr(loc(type === 'cash_in' ? otherId : locationId)?.balance)} is recorded there.</span>}
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

        {type !== 'transfer' && needsBooking && (
          <label className="field">
            <span className="field-label">Booking reference{isCash ? ' *' : ''}</span>
            <input name="booking_ref" list="dl-bookings" value={bookingRef} onChange={(e) => onBooking(e.target.value)}
                   placeholder="Optional – e.g. SR-BALI-001" autoComplete="off" readOnly={values.is_package_due} />
          </label>
        )}

        {showPicker && (
          <label className="field field-wide">
            <span className="field-label">{source === 'dues' ? (type === 'cash_in' ? 'Which pending amount was paid to you? *' : 'Which pending bill are you paying? *') : isHome
              ? (type === 'cash_in' ? 'Against a home amount owed to you' : 'Against a home bill / amount you owe')
              : (type === 'cash_in' ? 'Against client receivable' : 'Against supplier invoice / amount due')}</span>
            <select name="settles_id" value={settlesId} onChange={(e) => onDue(e.target.value)} required={source === 'dues'}>
              <option value="">{source === 'dues' ? '— Choose —' : type === 'cash_in' ? '— Not against a pending amount —' : '— Not against a pending bill —'}</option>
              {matchingDues.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.account === 'home' ? 'HOME · ' : ''}{d.txn_no} · {d.booking_ref ?? 'no booking'} · {(type === 'cash_in' ? d.client_name : [d.supplier_name, d.service_provider].filter(Boolean).join(' / ')) ?? ''} · {inr(d.outstanding)} outstanding
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

        {(type === 'collection_due' || (isCash && !isHome && !isMove)) && (
          <label className="field">
            <span className="field-label">{type === 'collection_due' ? (isHome ? 'Owed by (person)' : 'Owed by (client / person)') : `Client name${type === 'cash_out' ? ' (e.g. for refunds)' : ''}`}</span>
            <input name="client_name" list="dl-clients" value={client} onChange={(e) => setClient(e.target.value)} autoComplete="off" />
          </label>
        )}

        {(type === 'payment_due' || (type === 'cash_out' && !isHome && !isMove)) && (
          <>
            <label className="field">
              <span className="field-label">{type === 'payment_due' ? 'Pay to (supplier / employee / payee)' : 'Supplier / payee'}</span>
              <input name="supplier_name" list="dl-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} autoComplete="off"
                     required={type === 'payment_due'} />
            </label>
            {!isHome && <label className="field">
              <span className="field-label">Hotel / service provider</span>
              <input name="service_provider" list="dl-providers" defaultValue={values.service_provider ?? ''} autoComplete="off" />
            </label>}
          </>
        )}

        <label className="field">
          <span className="field-label">Category</span>
          <input name="category" list={isMove ? 'dl-cat-transfer' : catKey} defaultValue={values.category ?? ''} key={isMove ? 'mv' : catKey} autoComplete="off" placeholder="Choose or type" />
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
      {(['cash_in', 'cash_out', 'collection_due', 'payment_due'] as const).map((t) => <datalist key={t} id={`dl-cat-home-${t}`}>{HOME_CATEGORIES[t].map((c) => <option key={c} value={c} />)}</datalist>)}

      <div className="form-actions">
        <SubmitButton>{mode === 'create' ? (isMove ? 'Save transfer' : `Save ${TXN_TYPE_LABEL[type]}${isHome ? ' (Home)' : ''}`) : 'Save changes'}</SubmitButton>
        {mode === 'create' && <SubmitButton className="btn btn-ghost" name="and_new" value="1">Save & add another</SubmitButton>}
      </div>
    </ActionForm>
  );
}

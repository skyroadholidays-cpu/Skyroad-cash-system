// Booking create/edit form. Rendered on the server; ActionForm adds the
// client-side submit handling.
import { ActionForm, SubmitButton } from './ActionForm';
import type { FormState } from '@/app/actions';
import type { BookingSummary } from '@/lib/ledger';

export function BookingForm({ action, booking, hasPackageDue, packageDueDate, locations, idem, clients }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  booking?: BookingSummary;
  hasPackageDue?: boolean;
  packageDueDate?: string | null;
  locations: { id: number; name: string }[];
  idem: string;
  clients: string[];
}) {
  const editing = !!booking;
  return (
    <ActionForm action={action} className="form">
      <input type="hidden" name="idem" value={idem} />
      {booking && <input type="hidden" name="id" value={booking.id} />}
      <div className="grid">
        <label className="field">
          <span className="field-label">Booking reference *</span>
          <input name="booking_ref" required maxLength={40} defaultValue={booking?.booking_ref ?? ''} placeholder="e.g. SR-BALI-001" autoFocus={!editing} autoComplete="off" />
        </label>
        <label className="field">
          <span className="field-label">Client or company *</span>
          <input name="client_name" required maxLength={120} defaultValue={booking?.client_name ?? ''} list="dl-booking-clients" autoComplete="off" />
          <datalist id="dl-booking-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="field field-wide">
          <span className="field-label">Destination / tour</span>
          <input name="destination" maxLength={120} defaultValue={booking?.destination ?? ''} placeholder="e.g. Bali honeymoon, 6N/7D" />
        </label>
        <label className="field">
          <span className="field-label">Travel start</span>
          <input type="date" name="travel_start" defaultValue={booking?.travel_start ?? ''} />
        </label>
        <label className="field">
          <span className="field-label">Travel end</span>
          <input type="date" name="travel_end" defaultValue={booking?.travel_end ?? ''} />
        </label>
        <label className="field field-amount">
          <span className="field-label">Total package amount (₹)</span>
          <input name="package_amount" inputMode="decimal" defaultValue={booking?.package_amount ?? ''} placeholder="0.00" autoComplete="off" />
          <span className="field-hint">What the client pays in total. This is a receivable, not cash, until collected.</span>
        </label>
        <label className="field">
          <span className="field-label">Status</span>
          <select name="status" defaultValue={booking?.status ?? 'active'}>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>

        {hasPackageDue ? (
          <label className="field">
            <span className="field-label">Expected collection date</span>
            <input type="date" name="due_date" defaultValue={packageDueDate ?? ''} />
            <span className="field-hint">The client receivable updates automatically when you change the package amount.</span>
          </label>
        ) : (
          <div className="field field-wide">
            <label className="check">
              <input type="checkbox" name="create_receivable" defaultChecked={!editing} />
              <span><strong>Raise the package amount as a client receivable</strong><br /><span className="muted small">Adds it to To Collect so you can track part payments against it.</span></span>
            </label>
            <label className="field" style={{ marginTop: 10, maxWidth: 280 }}>
              <span className="field-label">Expected collection date</span>
              <input type="date" name="due_date" defaultValue="" />
            </label>
          </div>
        )}

        {!editing && (
          <fieldset className="field-wide card" style={{ boxShadow: 'none', background: 'var(--line-2)', border: 0 }}>
            <p className="section-label">Advance received now (optional)</p>
            <div className="grid">
              <label className="field">
                <span className="field-label">Advance amount (₹)</span>
                <input name="advance_amount" inputMode="decimal" placeholder="0.00" autoComplete="off" />
              </label>
              <label className="field">
                <span className="field-label">Cash kept in</span>
                <select name="advance_location_id" defaultValue="">
                  <option value="">—</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            </div>
          </fieldset>
        )}

        <label className="field field-wide">
          <span className="field-label">Notes / remarks</span>
          <textarea name="notes" rows={3} defaultValue={booking?.notes ?? ''} maxLength={2000} />
        </label>
      </div>
      <div className="form-actions">
        <SubmitButton>{editing ? 'Save booking' : 'Create booking'}</SubmitButton>
      </div>
    </ActionForm>
  );
}

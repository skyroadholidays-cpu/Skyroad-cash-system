// Add / edit a person. Server component; ActionForm handles submitting.
import { ActionForm, SubmitButton } from './ActionForm';
import type { FormState } from '@/app/actions';
import type { PartyBalance } from '@/lib/parties';

export function PartyForm({ action, party }: { action: (s: FormState, fd: FormData) => Promise<FormState>; party?: PartyBalance }) {
  const ob = Number(party?.opening_balance ?? 0);
  return (
    <ActionForm action={action} className="form">
      {party && <input type="hidden" name="id" value={party.id} />}
      <div className="grid">
        <label className="field">
          <span className="field-label">Name *</span>
          <input name="name" required maxLength={80} defaultValue={party?.name ?? ''} placeholder="e.g. Rahul Mehta" />
        </label>
        <label className="field">
          <span className="field-label">Phone</span>
          <input name="phone" maxLength={30} inputMode="tel" defaultValue={party?.phone ?? ''} />
        </label>
        <label className="field">
          <span className="field-label">Balance already pending (₹)</span>
          <input name="opening_amount" inputMode="decimal" placeholder="0.00" defaultValue={ob ? Math.abs(ob).toFixed(2) : ''} />
          <span className="field-hint">Leave empty if you are starting fresh.</span>
        </label>
        <label className="field">
          <span className="field-label">Who owes whom?</span>
          <select name="opening_dir" defaultValue={ob < 0 ? 'i_owe' : 'they_owe'}>
            <option value="they_owe">They owe me</option>
            <option value="i_owe">I owe them</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">This account is</span>
          <select name="account" defaultValue={party?.account ?? 'home'}>
            <option value="home">Home / personal</option>
            <option value="business">Skyroad business</option>
          </select>
          <span className="field-hint">Cash paid or received through this person is filed on this side.</span>
        </label>
        <label className="field field-wide">
          <span className="field-label">Notes</span>
          <textarea name="notes" rows={2} maxLength={500} defaultValue={party?.notes ?? ''} />
        </label>
      </div>
      <div className="form-actions"><SubmitButton>{party ? 'Save person' : 'Add person'}</SubmitButton></div>
    </ActionForm>
  );
}

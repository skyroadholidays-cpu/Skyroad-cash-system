// Shared constants – safe to import from client components.

export type TxnType = 'cash_in' | 'cash_out' | 'transfer' | 'collection_due' | 'payment_due';
export const TXN_TYPES: TxnType[] = ['cash_in', 'cash_out', 'transfer', 'collection_due', 'payment_due'];
export const TXN_TYPE_LABEL: Record<TxnType, string> = {
  cash_in: 'Cash In',
  cash_out: 'Cash Out',
  transfer: 'Transfer',
  collection_due: 'Collection Due',
  payment_due: 'Payment Due',
};

export const CATEGORIES: Record<TxnType, string[]> = {
  cash_in: ['Client collection', 'Advance received', 'Visa fee', 'Insurance premium', 'Commission income',
    'Refund from supplier', 'Owner capital', 'Cash withdrawn from bank', 'Cash adjustment (excess)', 'Other income'],
  cash_out: ['Supplier payment', 'Hotel payment', 'Flight tickets', 'Transport', 'Visa fees', 'Insurance',
    'Sightseeing', 'Client refund', 'Office expense', 'Salary / wages', 'Owner drawings', 'Deposited to bank',
    'Cash adjustment (shortage)', 'Other expense'],
  transfer: ['Internal transfer'],
  collection_due: ['Package payment', 'Visa', 'Insurance', 'Flights', 'Hotel', 'Add-on services', 'Other'],
  payment_due: ['Hotel', 'Flights', 'Transport', 'Visa', 'Insurance', 'Sightseeing', 'Cruise', 'DMC / tour operator', 'Other'],
};

/** Who an entry belongs to. Stored as `account`; "booking" vs "business" is whether a booking is attached. */
export type Account = 'business' | 'home';
export type EntryFor = 'booking' | 'business' | 'home';
export const ENTRY_FOR_LABEL: Record<EntryFor, string> = {
  booking: 'Skyroad booking',
  business: 'Skyroad – no booking',
  home: 'Home / personal',
};
export const ENTRY_FOR_HELP: Record<EntryFor, string> = {
  booking: 'Money for a specific travel booking.',
  business: 'Skyroad money not tied to a booking – office expenses, commission, other business income.',
  home: 'Your own home or personal money. Counted in physical cash, but kept out of all Skyroad business figures.',
};

/** Category suggestions for Home / personal entries. */
export const HOME_CATEGORIES: Record<'cash_in' | 'cash_out', string[]> = {
  cash_in: ['Home income', 'Rent received', 'Family / gift', 'Interest / dividend', 'Personal funds added', 'Other income'],
  cash_out: ['Household expense', 'Groceries', 'Bills & utilities', 'Family / personal', 'Medical', 'Personal withdrawal', 'Other expense'],
};

/** Derives the "Entry for" choice from a saved entry. */
export function entryForOf(t: { account?: string | null; booking_ref?: string | null; booking_id?: number | null }): EntryFor {
  if (t.account === 'home') return 'home';
  return t.booking_ref || t.booking_id ? 'booking' : 'business';
}

/** "Payment status" shown to the user. Always derived, never typed in, so it cannot go stale. */
export function statusLabel(type: TxnType, settleStatus?: string | null): string {
  switch (type) {
    case 'cash_in': return 'Received';
    case 'cash_out': return 'Paid';
    case 'transfer': return 'Completed';
    case 'collection_due':
      return settleStatus === 'settled' ? 'Received' : settleStatus === 'partial' ? 'Partially Received' : 'Pending';
    case 'payment_due':
      return settleStatus === 'settled' ? 'Paid' : settleStatus === 'partial' ? 'Partially Paid' : 'Pending';
  }
}


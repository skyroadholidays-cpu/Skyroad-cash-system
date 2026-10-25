import 'server-only';
import { randomUUID } from 'node:crypto';
import * as L from '@/lib/ledger';

/** Everything the transaction form needs, fetched in parallel. */
export async function loadTxnFormData() {
  const [locations, bookings, dues, suggestions] = await Promise.all([
    L.listLocations(true), L.bookingRefs(), L.openDuesForPicker(), L.nameSuggestions(),
  ]);
  return {
    locations: locations.map((l) => ({ id: l.id, name: l.name, balance: l.balance })),
    bookings,
    dues,
    suggestions,
    idem: randomUUID(),
  };
}

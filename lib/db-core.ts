import type { Sql, DbError } from './sql-types';

let current: Sql | null = null;

export function setSql(sql: Sql) {
  current = sql;
}

export function db(): Sql {
  if (!current) throw new Error('Database client not initialised – import "@/lib/server" in server code.');
  return current;
}

/** Runs fn in a database transaction, tagging every audit-log row with the actor. */
export async function withTx<T>(actor: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx`select set_config('skyroad.actor', ${actor}::text, true)`;
    return fn(tx);
  });
}

/** A user-facing error: its message is safe to show on screen. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  txn_amount_check: 'Amount must be greater than zero.',
  txn_cash_shape: 'Cash In / Cash Out entries need a cash location.',
  txn_transfer_shape: 'A transfer needs two different cash locations.',
  txn_due_shape: 'Collection Due / Payment Due entries do not move cash, so they cannot have a cash location.',
  txn_package_due_shape: 'Package receivables must belong to a booking.',
  txn_one_package_due: 'This booking already has a package receivable.',
  booking_ref_uq: 'That booking reference already exists.',
  booking_check: 'Travel end date cannot be before the start date.',
  booking_package_amount_check: 'Package amount must be zero or more.',
  cash_location_name_uq: 'A cash location with that name already exists.',
  cash_location_opening_balance_check: 'Opening balance cannot be negative.',
  cash_location_name_check: 'Location name must be 1–60 characters.',
  booking_booking_ref_check: 'Booking reference must be 1–40 characters.',
  booking_client_name_check: 'Client name is required.',
};

/** Converts database errors into messages that make sense to the user. */
export function friendlyError(e: unknown): string {
  if (e instanceof UserError) return e.message;
  const err = e as DbError;
  if (err?.code === 'P0001' || err?.code === 'P0002') return formatAmountsInMessage(err.message);
  if (err?.constraint_name && CONSTRAINT_MESSAGES[err.constraint_name]) return CONSTRAINT_MESSAGES[err.constraint_name];
  if (err?.code === '23503') return 'This record is linked to other entries and cannot be changed that way.';
  if (err?.code === '23505') return 'That record already exists.';
  if (err?.code === '22003') return 'That amount is too large.';
  console.error(e);
  return 'Something went wrong while saving. Nothing was changed – please try again.';
}

// "only 59999.50 is outstanding" -> "only ₹59,999.50 is outstanding"
function formatAmountsInMessage(msg: string): string {
  return msg.replace(/(?<![\w-])(\d+\.\d{2})(?!\d)/g, (m) => {
    const [i, f] = m.split('.');
    return '₹' + groupIndian(i) + '.' + f;
  });
}

function groupIndian(int: string): string {
  if (int.length <= 3) return int;
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest + ',' + last3;
}

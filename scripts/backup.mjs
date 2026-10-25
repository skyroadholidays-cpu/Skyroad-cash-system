// Saves a full JSON backup of every business table into ./backups/.
// Usage: npm run backup      (same content as Settings → Download full backup)
import { mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import { connectOptions } from './_env.mjs';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Put it in .env.local (see .env.example).');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, connectOptions());
const TABLES = { cash_location: 'id', booking: 'id', txn: 'created_at', cash_count: 'id', fx_currency: 'sort_order', fx_txn: 'created_at', party: 'id', party_txn: 'created_at', audit_log: 'id' };
try {
  const tables = {};
  for (const [t, order] of Object.entries(TABLES)) {
    // table and column names come from the fixed list above
    const [r] = await sql.unsafe(`select coalesce(json_agg(x order by x.${order}), '[]')::text as d from skyroad.${t} x`);
    tables[t] = JSON.parse(r.d);
  }
  const now = new Date().toISOString();
  mkdirSync('backups', { recursive: true });
  const file = `backups/skyroad-cash-backup-${now.slice(0, 19).replace(/[:T]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify({ app: 'skyroad-cash', format: 1, exported_at: now, tables }, null, 1));
  console.log(`✓ Saved ${file} (${tables.txn.length} transactions, ${tables.booking.length} bookings)`);
} catch (e) {
  console.error('Backup failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

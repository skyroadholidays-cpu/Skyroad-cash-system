// Applies every db/migrations/*.sql file that has not been applied yet, in order,
// each inside its own transaction.   Usage: npm run db:migrate
import { readdirSync, readFileSync } from 'node:fs';
import postgres from 'postgres';
import { connectOptions } from './_env.mjs';

const url = process.argv[2] === '--test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Put it in .env.local (see .env.example).');
  process.exit(1);
}
const sql = postgres(url, connectOptions());

try {
  await sql.unsafe(`create schema if not exists skyroad;
    create table if not exists skyroad.schema_migrations (name text primary key, applied_at timestamptz not null default now());
    alter table skyroad.schema_migrations enable row level security;`);
  const done = new Set((await sql`select name from skyroad.schema_migrations`).map((r) => r.name));
  const files = readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    process.stdout.write(`Applying ${f} … `);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(`db/migrations/${f}`, 'utf8'));
      await tx`insert into skyroad.schema_migrations (name) values (${f})`;
    });
    console.log('done');
    applied++;
  }
  console.log(applied ? `✓ ${applied} migration(s) applied.` : '✓ Database is already up to date.');
} catch (e) {
  console.error('\nMigration failed – nothing from the failing file was applied.\n', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}

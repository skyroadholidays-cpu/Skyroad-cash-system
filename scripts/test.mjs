// Runs the full test suite against a SEPARATE, disposable database:
//   1. resets the skyroad schema in TEST_DATABASE_URL
//   2. applies the migrations
//   3. runs db/tests/business_rules.sql (50 database-level checks)
//   4. runs tests/app.test.ts (application-level tests)
// It refuses to touch DATABASE_URL or any database holding real records.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
import { connectOptions } from './_env.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('Set TEST_DATABASE_URL in .env.local to an EMPTY test database (a second free Supabase project works).');
  process.exit(1);
}
if (url === process.env.DATABASE_URL) {
  console.error('Refusing: TEST_DATABASE_URL is the same as your live DATABASE_URL.');
  process.exit(1);
}
const sql = postgres(url, connectOptions());
try {
  const [state] = await sql`select
      exists (select 1 from information_schema.tables where table_schema = 'skyroad' and table_name = 'txn') as has_schema,
      exists (select 1 from information_schema.tables where table_schema = 'skyroad' and table_name = '_test_marker') as is_test`;
  if (state.has_schema && !state.is_test) {
    const [{ n }] = await sql`select count(*)::int as n from skyroad.txn`;
    if (n > 0) throw new Error('Refusing: the test database contains real-looking records and no test marker.');
  }
  await sql.unsafe('drop schema if exists skyroad cascade');
  console.log('• schema reset');
} finally {
  await sql.end();
}

execFileSync('node', ['scripts/migrate.mjs', '--test'], { stdio: 'inherit' });

const sql2 = postgres(url, connectOptions());
try {
  await sql2.unsafe('create table skyroad._test_marker (at timestamptz default now())');
  // The SQL suite uses psql meta-commands; strip them and run the body.
  const body = readFileSync('db/tests/business_rules.sql', 'utf8').split('\n').filter((l) => !l.startsWith('\\')).join('\n');
  const notices = [];
  const sql3 = postgres(url, { ...connectOptions(), onnotice: (n) => notices.push(n.message) });
  await sql3.unsafe(body);
  await sql3.end();
  const passed = notices.filter((m) => m.startsWith('PASS')).length;
  console.log(`✓ ${passed} database business-rule checks passed`);
} finally {
  await sql2.end();
}

execFileSync('npx', ['tsx', 'tests/app.test.ts'], { stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url } });

import 'server-only';
import postgres from 'postgres';
import { setSql } from './db-core';
import type { Sql } from './sql-types';

// One shared client per server instance (survives hot reloads in dev).
const g = globalThis as unknown as { __skyroadSql?: ReturnType<typeof postgres> };

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. See README → Environment variables.');
  return postgres(url, {
    // Supabase's connection pooler (port 6543) does not support prepared statements.
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: process.env.DATABASE_SSL === 'disable' ? false : 'require',
    onnotice: () => {},
  });
}

let initialised = false;
export function ensureDb() {
  if (initialised) return;
  g.__skyroadSql ??= create();
  setSql(g.__skyroadSql as unknown as Sql);
  initialised = true;
}

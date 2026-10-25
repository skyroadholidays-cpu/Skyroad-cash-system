// The tiny subset of the `postgres` (porsager) client API this app uses.
// Keeping to this subset lets the data layer run against the real driver in
// production and against a minimal wire-protocol client in tests.
//
// House rules for queries (keep both drivers returning identical shapes):
//  * every interpolated value gets an explicit cast: ${x}::numeric, ::date, ::int, ::uuid, ::text
//  * dates/timestamps are returned as text (::text / to_char), never as Date objects
//  * numeric money is returned as text and only formatted, never float-parsed for arithmetic
//  * counts are cast ::int
export type Row = Record<string, any>;

export interface Sql {
  <T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

export interface DbError extends Error {
  code?: string;
  constraint_name?: string;
  detail?: string;
}

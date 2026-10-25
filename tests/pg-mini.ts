// TEST-ONLY minimal PostgreSQL client (wire protocol v3, trust auth, Unix
// socket or TCP). Implements the same tiny API surface as lib/sql-types.ts
// so the app's data layer can be exercised against a real database where the
// `postgres` npm package is not installable. Production uses `postgres`.
//
// It is deliberately strict: it throws if a query returns a Date/timestamp
// column, enforcing the house rule that dates come back as text so both
// drivers return identical shapes.
import net from 'node:net';
import type { Sql } from '../lib/sql-types';

type Pending = { resolve: (rows: any[]) => void; reject: (e: any) => void; rows: any[]; fields: { name: string; oid: number }[]; error?: any };

class Conn {
  private sock: net.Socket;
  private buf = Buffer.alloc(0);
  private queue: Pending[] = [];
  private ready: Promise<void>;
  private onReady!: () => void;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(opts: { path?: string; host?: string; port: number; user: string; database: string }) {
    this.sock = opts.path ? net.createConnection({ path: opts.path }) : net.createConnection({ host: opts.host, port: opts.port });
    this.ready = new Promise((r) => (this.onReady = r));
    this.sock.on('data', (d) => this.onData(Buffer.from(d)));
    this.sock.on('connect', () => {
      const params = Buffer.from(`user\0${opts.user}\0database\0${opts.database}\0client_encoding\0UTF8\0\0`);
      const len = Buffer.alloc(8);
      len.writeInt32BE(8 + params.length, 0);
      len.writeInt32BE(196608, 4);
      this.sock.write(Buffer.concat([len, params]));
    });
  }

  private msg(type: string, body: Buffer) {
    const h = Buffer.alloc(5);
    h.write(type, 0);
    h.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([h, body]);
  }
  private cstr(s: string) { return Buffer.from(s + '\0'); }
  private i16(n: number) { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; }
  private i32(n: number) { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 5) {
      const type = String.fromCharCode(this.buf[0]);
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) return;
      const body = this.buf.subarray(5, len + 1);
      this.buf = this.buf.subarray(len + 1);
      this.handle(type, body);
    }
  }

  private handle(type: string, body: Buffer) {
    const cur = this.queue[0];
    switch (type) {
      case 'R':
        if (body.readInt32BE(0) !== 0) throw new Error('pg-mini only supports trust auth');
        break;
      case 'Z':
        if (cur) {
          this.queue.shift();
          cur.error ? cur.reject(cur.error) : cur.resolve(cur.rows);
        } else this.onReady();
        break;
      case 'T': {
        const n = body.readInt16BE(0);
        let off = 2;
        cur.fields = [];
        for (let i = 0; i < n; i++) {
          const end = body.indexOf(0, off);
          const name = body.toString('utf8', off, end);
          off = end + 1;
          const oid = body.readInt32BE(off + 6);
          off += 18;
          cur.fields.push({ name, oid });
        }
        break;
      }
      case 'D': {
        const n = body.readInt16BE(0);
        let off = 2;
        const row: Record<string, any> = {};
        for (let i = 0; i < n; i++) {
          const l = body.readInt32BE(off);
          off += 4;
          const f = cur.fields[i];
          if (l === -1) row[f.name] = null;
          else {
            row[f.name] = this.parse(f.oid, body.toString('utf8', off, off + l), f.name);
            off += l;
          }
        }
        cur.rows.push(row);
        break;
      }
      case 'E': {
        const err: any = new Error();
        let off = 0;
        while (body[off] !== 0) {
          const code = String.fromCharCode(body[off]);
          const end = body.indexOf(0, off + 1);
          const val = body.toString('utf8', off + 1, end);
          off = end + 1;
          if (code === 'M') err.message = val;
          if (code === 'C') err.code = val;
          if (code === 'n') err.constraint_name = val;
          if (code === 'D') err.detail = val;
        }
        if (cur) cur.error = err;
        else throw err;
        break;
      }
      default:
        break; // 1,2,C,n,S,K,N,s,I
    }
  }

  private parse(oid: number, v: string, name: string) {
    switch (oid) {
      case 16: return v === 't';
      case 21: case 23: case 26: return Number(v);
      case 114: case 3802: return JSON.parse(v);
      case 1082: case 1114: case 1184:
        throw new Error(`pg-mini: column "${name}" returned a date/timestamp; cast it ::text (house rule)`);
      default: return v; // int8, numeric, text, uuid … as strings, like the postgres driver
    }
  }

  async waitReady() { await this.ready; }

  query(text: string, params: unknown[]): Promise<any[]> {
    const run = () => new Promise<any[]>((resolve, reject) => {
      this.queue.push({ resolve, reject, rows: [], fields: [] });
      const vals = params.map((p) => (p === null || p === undefined ? null : typeof p === 'boolean' ? (p ? 'true' : 'false') : String(p)));
      const bindParts: Buffer[] = [this.cstr(''), this.cstr(''), this.i16(0), this.i16(vals.length)];
      for (const v of vals) {
        if (v === null) bindParts.push(this.i32(-1));
        else { const b = Buffer.from(v); bindParts.push(this.i32(b.length), b); }
      }
      bindParts.push(this.i16(0));
      this.sock.write(Buffer.concat([
        this.msg('P', Buffer.concat([this.cstr(''), this.cstr(text), this.i16(0)])),
        this.msg('B', Buffer.concat(bindParts)),
        this.msg('D', Buffer.concat([Buffer.from('P'), this.cstr('')])),
        this.msg('E', Buffer.concat([this.cstr(''), this.i32(0)])),
        this.msg('S', Buffer.alloc(0)),
      ]));
    });
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  end() { this.sock.write(this.msg('X', Buffer.alloc(0))); this.sock.end(); }
}

function build(strings: TemplateStringsArray, values: unknown[]) {
  let text = strings[0];
  for (let i = 1; i < strings.length; i++) text += `$${i}` + strings[i];
  return text;
}

export async function connect(opts: { path?: string; host?: string; port: number; user: string; database: string }) {
  const conns: Conn[] = [];
  const open = async () => { const c = new Conn(opts); await c.waitReady(); conns.push(c); return c; };
  const main = await open();
  const make = (c: Conn): Sql => {
    const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => c.query(build(strings, values), values)) as Sql;
    fn.begin = async <T>(cb: (tx: Sql) => Promise<T>): Promise<T> => {
      const tc = await open();
      const tx = make(tc);
      await tc.query('begin', []);
      try {
        const r = await cb(tx);
        await tc.query('commit', []);
        return r;
      } catch (e) {
        await tc.query('rollback', []).catch(() => undefined);
        throw e;
      } finally {
        tc.end();
      }
    };
    return fn;
  };
  return { sql: make(main), end: () => conns.forEach((c) => { try { c.end(); } catch { /* closed */ } }) };
}

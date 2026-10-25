-- Skyroad Holidays – Cash Management System
-- Migration 001: core schema
--
-- Design principles
--  * Every balance is DERIVED from the txn table (views below). Nothing is
--    stored as a running total, so edits/deletes can never leave totals stale.
--  * Money is numeric(14,2) – exact decimal, never floating point.
--  * Dues (Collection Due / Payment Due) are obligations, not cash. Cash only
--    moves on cash_in, cash_out and transfer rows.
--  * Partial collections/payments are cash rows that point at a due via
--    settles_id. A trigger stops settlements from exceeding the due.
--  * Deletes are soft (deleted_at) and fully audited; they can be restored.
--  * Everything lives in its own schema "skyroad" so Supabase's public REST
--    API never exposes it; RLS is enabled as a second lock.

create schema if not exists skyroad;
set search_path = skyroad, public;

-- ───────────────────────────── auth ─────────────────────────────
create table app_user (
  id                  serial primary key,
  username            text not null,
  password_hash       text,                       -- null until first set
  password_changed_at timestamptz,
  created_at          timestamptz not null default now()
);
create unique index app_user_username_uq on app_user (lower(username));

create table session (
  id           text primary key,                  -- sha256(token), never the token itself
  user_id      int  not null references app_user(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text,
  ip           text
);
create index session_user_idx on session(user_id);

create table login_attempt (
  id       bigserial primary key,
  username text,
  ip       text,
  success  boolean not null,
  at       timestamptz not null default now()
);
create index login_attempt_at_idx on login_attempt(at);

-- ─────────────────────────── cash locations ───────────────────────────
create table cash_location (
  id              serial primary key,
  name            text not null check (length(trim(name)) between 1 and 60),
  kind            text not null check (kind in ('hand','locker','other')),
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  is_active       boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index cash_location_name_uq on cash_location (lower(name));

-- The two standard locations. Opening balances start at 0 – you enter your
-- real figures in Cash Locations → Edit.
insert into cash_location (name, kind, sort_order) values
  ('Cash in Hand',   'hand',   1),
  ('Cash in Locker', 'locker', 2);

-- ────────────────────────────── bookings ──────────────────────────────
create table booking (
  id             serial primary key,
  booking_ref    text not null check (length(trim(booking_ref)) between 1 and 40),
  client_name    text not null check (length(trim(client_name)) between 1 and 120),
  destination    text,
  travel_start   date,
  travel_end     date,
  package_amount numeric(14,2) not null default 0 check (package_amount >= 0 and package_amount < 1e12),
  status         text not null default 'active' check (status in ('active','completed','cancelled')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,
  updated_by     text,
  check (travel_end is null or travel_start is null or travel_end >= travel_start)
);
create unique index booking_ref_uq on booking (lower(booking_ref));

-- ──────────────────────────── transactions ────────────────────────────
create type txn_type as enum ('cash_in','cash_out','transfer','collection_due','payment_due');

create sequence txn_no_seq start 1001;

create table txn (
  id               uuid primary key default gen_random_uuid(),
  txn_no           text not null unique default ('SR-' || lpad(nextval('skyroad.txn_no_seq')::text, 6, '0')),
  txn_date         date not null,
  type             txn_type not null,
  amount           numeric(14,2) not null check (amount > 0 and amount < 1e12),
  booking_id       int references booking(id) on delete restrict,
  client_name      text,
  supplier_name    text,
  service_provider text,                 -- hotel / transporter / airline etc.
  description      text,
  category         text,
  notes            text,
  location_id      int references cash_location(id),       -- cash_in / cash_out
  from_location_id int references cash_location(id),       -- transfer
  to_location_id   int references cash_location(id),       -- transfer
  settles_id       uuid references txn(id) on delete restrict, -- cash row settling a due
  due_date         date,                 -- expected collection / payment due date
  is_package_due   boolean not null default false,  -- auto-created receivable for a booking's package
  idempotency_key  text unique,          -- blocks double submissions
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       text,
  updated_by       text,
  deleted_at       timestamptz,
  deleted_by       text,

  -- shape rules per type
  constraint txn_cash_shape check (
    type not in ('cash_in','cash_out')
    or (location_id is not null and from_location_id is null and to_location_id is null)),
  constraint txn_transfer_shape check (
    type <> 'transfer'
    or (from_location_id is not null and to_location_id is not null
        and from_location_id <> to_location_id
        and location_id is null and settles_id is null)),
  constraint txn_due_shape check (
    type not in ('collection_due','payment_due')
    or (location_id is null and from_location_id is null and to_location_id is null and settles_id is null)),
  constraint txn_package_due_shape check (
    not is_package_due or (type = 'collection_due' and booking_id is not null))
);
create index txn_date_idx      on txn(txn_date) where deleted_at is null;
create index txn_booking_idx   on txn(booking_id) where deleted_at is null;
create index txn_settles_idx   on txn(settles_id) where deleted_at is null;
create index txn_type_idx      on txn(type) where deleted_at is null;
create unique index txn_one_package_due on txn(booking_id) where is_package_due and deleted_at is null;

-- ─────────────────────────── cash verification ───────────────────────────
create table cash_count (
  id              serial primary key,
  location_id     int not null references cash_location(id),
  counted_at      timestamptz not null default now(),
  counted_amount  numeric(14,2) not null check (counted_amount >= 0),
  system_balance  numeric(14,2) not null,
  difference      numeric(14,2) generated always as (counted_amount - system_balance) stored,
  adjustment_txn_id uuid references txn(id),
  notes           text,
  created_by      text
);

-- ─────────────────────────────── audit ───────────────────────────────
create table audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text,
  table_name text not null,
  record_id  text not null,
  action     text not null,          -- insert / update / delete / soft_delete / restore
  old_data   jsonb,
  new_data   jsonb
);
create index audit_log_record_idx on audit_log(table_name, record_id);
create index audit_log_at_idx on audit_log(at desc);

create or replace function audit_row() returns trigger language plpgsql as $$
declare
  act text := lower(tg_op);
  rid text;
begin
  if tg_op = 'DELETE' then rid := old.id::text; else rid := new.id::text; end if;
  if tg_op = 'UPDATE' and tg_table_name = 'txn' then
    if old.deleted_at is null and new.deleted_at is not null then act := 'soft_delete';
    elsif old.deleted_at is not null and new.deleted_at is null then act := 'restore';
    end if;
  end if;
  insert into skyroad.audit_log(actor, table_name, record_id, action, old_data, new_data)
  values (nullif(current_setting('skyroad.actor', true), ''), tg_table_name, rid, act,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

create trigger audit_txn      after insert or update or delete on txn           for each row execute function audit_row();
create trigger audit_booking  after insert or update or delete on booking       for each row execute function audit_row();
create trigger audit_location after insert or update or delete on cash_location for each row execute function audit_row();
create trigger audit_count    after insert or update or delete on cash_count    for each row execute function audit_row();

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch_txn      before update on txn           for each row execute function touch_updated_at();
create trigger touch_booking  before update on booking       for each row execute function touch_updated_at();
create trigger touch_location before update on cash_location for each row execute function touch_updated_at();

-- ───────────────────── integrity guard on txn changes ─────────────────────
-- Enforces the business rules that a CHECK constraint cannot:
--  * a settlement must point at an active due of the matching kind
--  * total settlements can never exceed the due amount (row-locked, so two
--    devices recording a payment at the same moment cannot overshoot)
--  * a due cannot be reduced below / deleted while settlements exist
--  * a due with settlements cannot change type
create or replace function txn_guard() returns trigger language plpgsql as $$
declare
  tgt        skyroad.txn;
  settled    numeric(14,2);
  is_active  boolean := (new.deleted_at is null);
begin
  -- Hard deletes are blocked entirely: use soft delete.
  if tg_op = 'DELETE' then
    raise exception 'Transactions cannot be hard-deleted; use soft delete' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and old.type <> new.type
     and exists (select 1 from skyroad.txn p where p.settles_id = old.id and p.deleted_at is null) then
    raise exception 'This due has payments recorded against it, so its type cannot change' using errcode = 'P0001';
  end if;

  -- settlement checks
  if new.settles_id is not null and is_active then
    select * into tgt from skyroad.txn where id = new.settles_id for update;
    if not found or tgt.deleted_at is not null then
      raise exception 'The due being settled no longer exists' using errcode = 'P0001';
    end if;
    if (new.type = 'cash_in' and tgt.type <> 'collection_due')
       or (new.type = 'cash_out' and tgt.type <> 'payment_due')
       or new.type not in ('cash_in','cash_out') then
      raise exception 'Collections must settle a Collection Due and payments a Payment Due' using errcode = 'P0001';
    end if;
    select coalesce(sum(amount),0) into settled from skyroad.txn
      where settles_id = tgt.id and deleted_at is null and id <> new.id;
    if settled + new.amount > tgt.amount then
      raise exception 'Amount exceeds the outstanding balance of %: only % is outstanding',
        tgt.txn_no, to_char(tgt.amount - settled, 'FM999999999990.00') using errcode = 'P0002';
    end if;
    -- inherit linkage so every payment is traceable to its booking
    if new.booking_id is null then new.booking_id := tgt.booking_id; end if;
    if new.client_name is null or new.client_name = '' then new.client_name := tgt.client_name; end if;
    if new.supplier_name is null or new.supplier_name = '' then new.supplier_name := tgt.supplier_name; end if;
    if new.service_provider is null or new.service_provider = '' then new.service_provider := tgt.service_provider; end if;
  end if;

  -- due checks (amount reduced, deleted)
  if tg_op = 'UPDATE' and new.type in ('collection_due','payment_due') then
    select coalesce(sum(amount),0) into settled from skyroad.txn
      where settles_id = new.id and deleted_at is null;
    if not is_active and settled > 0 then
      raise exception 'This due has % recorded against it. Delete those payments first.',
        to_char(settled, 'FM999999999990.00') using errcode = 'P0001';
    end if;
    if is_active and new.amount < settled then
      raise exception 'Amount cannot be less than the % already settled',
        to_char(settled, 'FM999999999990.00') using errcode = 'P0002';
    end if;
  end if;

  -- inactive locations cannot receive new cash rows
  if is_active and (tg_op = 'INSERT' or old.deleted_at is not null
       or new.location_id is distinct from old.location_id
       or new.from_location_id is distinct from old.from_location_id
       or new.to_location_id is distinct from old.to_location_id) then
    if exists (select 1 from skyroad.cash_location l
               where l.id in (new.location_id, new.from_location_id, new.to_location_id)
                 and not l.is_active) then
      raise exception 'That cash location is inactive' using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

create trigger txn_guard_iu before insert or update on txn for each row execute function txn_guard();
create trigger txn_guard_d  before delete on txn for each row execute function txn_guard();

-- ─────────────────────────────── views ───────────────────────────────
-- Active transactions only
create view v_txn as
select t.*,
       b.booking_ref,
       l.name  as location_name,
       lf.name as from_location_name,
       lt.name as to_location_name,
       d.txn_no as settles_txn_no
from txn t
left join booking b        on b.id = t.booking_id
left join cash_location l  on l.id = t.location_id
left join cash_location lf on lf.id = t.from_location_id
left join cash_location lt on lt.id = t.to_location_id
left join txn d            on d.id = t.settles_id
where t.deleted_at is null;

-- Dues with derived settlement figures and status
create view v_due as
select t.*,
       coalesce(s.settled, 0)::numeric(14,2)              as settled,
       (t.amount - coalesce(s.settled, 0))::numeric(14,2) as outstanding,
       s.last_settled_on,
       coalesce(s.settle_count, 0)                        as settle_count,
       case when coalesce(s.settled,0) = 0 then 'pending'
            when s.settled >= t.amount then 'settled'
            else 'partial' end                            as settle_status
from v_txn t
left join lateral (
  select sum(p.amount) as settled, max(p.txn_date) as last_settled_on, count(*) as settle_count
  from txn p where p.settles_id = t.id and p.deleted_at is null
) s on true
where t.type in ('collection_due','payment_due');

-- Current balance of every cash location
create view v_location_balance as
select l.id, l.name, l.kind, l.opening_balance, l.is_active, l.sort_order,
       coalesce(sum(t.amount) filter (where t.type = 'cash_in'  and t.location_id = l.id), 0)::numeric(14,2)      as received,
       coalesce(sum(t.amount) filter (where t.type = 'cash_out' and t.location_id = l.id), 0)::numeric(14,2)      as paid_out,
       coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.to_location_id = l.id), 0)::numeric(14,2)   as transfers_in,
       coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.from_location_id = l.id), 0)::numeric(14,2) as transfers_out,
       (l.opening_balance
        + coalesce(sum(t.amount) filter (where t.type = 'cash_in'  and t.location_id = l.id), 0)
        - coalesce(sum(t.amount) filter (where t.type = 'cash_out' and t.location_id = l.id), 0)
        + coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.to_location_id = l.id), 0)
        - coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.from_location_id = l.id), 0)
       )::numeric(14,2) as balance
from cash_location l
left join txn t on t.deleted_at is null
               and (t.location_id = l.id or t.from_location_id = l.id or t.to_location_id = l.id)
group by l.id;

-- Booking-wise money picture. Cash flow and profitability kept separate.
create view v_booking_summary as
select b.*,
       coalesce(x.receivable_total, 0)::numeric(14,2)     as receivable_total,   -- raised to client
       coalesce(x.received, 0)::numeric(14,2)             as received,           -- cash actually in
       coalesce(x.to_collect, 0)::numeric(14,2)           as to_collect,         -- outstanding receivables
       coalesce(x.supplier_cost, 0)::numeric(14,2)        as supplier_cost,      -- supplier invoices raised
       coalesce(x.supplier_paid, 0)::numeric(14,2)        as supplier_paid,      -- cash paid against invoices
       coalesce(x.supplier_outstanding, 0)::numeric(14,2) as supplier_outstanding,
       coalesce(x.other_expenses, 0)::numeric(14,2)       as other_expenses,     -- cash out not against an invoice
       coalesce(x.cash_paid, 0)::numeric(14,2)            as cash_paid,          -- all cash out
       (coalesce(x.received,0) - coalesce(x.cash_paid,0))::numeric(14,2) as cash_balance,
       (b.package_amount - coalesce(x.receivable_total,0))::numeric(14,2) as unbilled_amount,
       (b.package_amount - coalesce(x.supplier_cost,0) - coalesce(x.other_expenses,0))::numeric(14,2) as expected_margin,
       x.last_activity
from booking b
left join lateral (
  select
    sum(t.amount) filter (where t.type = 'collection_due')                              as receivable_total,
    sum(t.amount) filter (where t.type = 'cash_in')                                     as received,
    sum(t.amount) filter (where t.type = 'payment_due')                                 as supplier_cost,
    sum(t.amount) filter (where t.type = 'cash_out' and t.settles_id is not null)       as supplier_paid,
    sum(t.amount) filter (where t.type = 'cash_out' and t.settles_id is null)           as other_expenses,
    sum(t.amount) filter (where t.type = 'cash_out')                                    as cash_paid,
    max(t.txn_date)                                                                     as last_activity,
    (select coalesce(sum(d.outstanding),0) from v_due d where d.booking_id = b.id and d.type = 'collection_due') as to_collect,
    (select coalesce(sum(d.outstanding),0) from v_due d where d.booking_id = b.id and d.type = 'payment_due')    as supplier_outstanding
  from txn t
  where t.booking_id = b.id and t.deleted_at is null
) x on true;

-- ───────────────────────── lock down Supabase API ─────────────────────────
alter table app_user      enable row level security;
alter table session       enable row level security;
alter table login_attempt enable row level security;
alter table cash_location enable row level security;
alter table booking       enable row level security;
alter table txn           enable row level security;
alter table cash_count    enable row level security;
alter table audit_log     enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema skyroad from anon, authenticated';
    execute 'revoke all on all tables in schema skyroad from anon, authenticated';
  end if;
end $$;

-- the single login account (password is set on first launch)
insert into app_user (username) values ('Skyroadholidays');

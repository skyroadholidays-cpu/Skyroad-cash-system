-- Migration 005: Forex Reserve
-- Tracks foreign-currency notes you hold (USD, THB, JPY, EUR, IDR, VND, …).
-- Kept separate from INR cash: nothing here changes INR balances, To Collect
-- or To Pay. Safe to run more than once.

set search_path = skyroad, public;

create table if not exists fx_currency (
  code            text primary key check (code ~ '^[A-Z]{3}$'),
  name            text not null,
  opening_balance numeric(18,2) not null default 0 check (opening_balance >= 0),
  sort_order      int not null default 10,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

insert into fx_currency (code, name, sort_order) values
  ('USD', 'US Dollar', 1), ('EUR', 'Euro', 2), ('THB', 'Thai Baht', 3),
  ('JPY', 'Japanese Yen', 4), ('IDR', 'Indonesian Rupiah', 5), ('VND', 'Vietnamese Dong', 6)
on conflict (code) do nothing;

create sequence if not exists fx_no_seq start 101;

create table if not exists fx_txn (
  id              uuid primary key default gen_random_uuid(),
  fx_no           text not null unique default ('FX-' || lpad(nextval('skyroad.fx_no_seq')::text, 6, '0')),
  currency        text not null references fx_currency(code),
  txn_date        date not null,
  direction       text not null check (direction in ('in', 'out')),
  amount          numeric(18,2) not null check (amount > 0 and amount < 1e15),
  rate_inr        numeric(14,4) check (rate_inr is null or rate_inr > 0),  -- INR for 1 unit (optional)
  counterparty    text,          -- bought from / sold or given to
  purpose         text,          -- category, e.g. Bought from money changer, Given to client
  booking_id      int references booking(id) on delete restrict,
  account         text not null default 'business' check (account in ('business', 'home')),
  notes           text,
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text,
  updated_by      text,
  deleted_at      timestamptz,
  deleted_by      text,
  constraint fx_home_no_booking check (account <> 'home' or booking_id is null)
);
create index if not exists fx_txn_currency_idx on fx_txn(currency, txn_date) where deleted_at is null;

-- Never hold a negative amount of a currency. Row-locks the currency so two
-- devices can't both spend the last notes.
create or replace function fx_guard() returns trigger language plpgsql as $$
declare
  bal numeric(18,2);
  cur text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Forex entries cannot be hard-deleted; use delete (it can be restored)' using errcode = 'P0001';
  end if;
  for cur in select distinct c from unnest(array[new.currency, case when tg_op = 'UPDATE' then old.currency end]) c where c is not null loop
    perform 1 from skyroad.fx_currency where code = cur for update;
    select fc.opening_balance
           + coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end), 0)
      into bal
      from skyroad.fx_currency fc
      left join skyroad.fx_txn t on t.currency = fc.code and t.deleted_at is null and t.id <> new.id
     where fc.code = cur
     group by fc.opening_balance;
    if new.deleted_at is null and new.currency = cur then
      bal := bal + case when new.direction = 'in' then new.amount else -new.amount end;
    end if;
    if bal < 0 then
      raise exception 'Not enough % – this would leave a balance of %', cur, to_char(bal, 'FM999999999999990.00') using errcode = 'P0002';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists fx_guard_iu on fx_txn;
drop trigger if exists fx_guard_d on fx_txn;
create trigger fx_guard_iu before insert or update on fx_txn for each row execute function fx_guard();
create trigger fx_guard_d  before delete on fx_txn for each row execute function fx_guard();

-- Lowering an opening balance must not push a currency below zero either.
create or replace function fx_currency_guard() returns trigger language plpgsql as $$
declare bal numeric(18,2);
begin
  select new.opening_balance + coalesce(sum(case when direction = 'in' then amount else -amount end), 0) into bal
    from skyroad.fx_txn where currency = new.code and deleted_at is null;
  if bal < 0 then
    raise exception 'That opening balance would leave % at %', new.code, to_char(bal, 'FM999999999999990.00') using errcode = 'P0002';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists fx_currency_guard_u on fx_currency;
create trigger fx_currency_guard_u before update on fx_currency for each row execute function fx_currency_guard();

drop trigger if exists touch_fx_txn on fx_txn;
create trigger touch_fx_txn before update on fx_txn for each row execute function touch_updated_at();
drop trigger if exists audit_fx_txn on fx_txn;
create trigger audit_fx_txn after insert or update or delete on fx_txn for each row execute function audit_row();
drop trigger if exists audit_fx_currency on fx_currency;

-- audit_row() uses NEW.id/OLD.id; currencies are keyed by code, so give them a small wrapper.
create or replace function audit_fx_currency_row() returns trigger language plpgsql as $$
begin
  insert into skyroad.audit_log(actor, table_name, record_id, action, old_data, new_data)
  values (nullif(current_setting('skyroad.actor', true), ''), 'fx_currency',
          coalesce(new.code, old.code), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
create trigger audit_fx_currency after insert or update or delete on fx_currency for each row execute function audit_fx_currency_row();

-- Soft-delete / restore labels in the audit log
create or replace function audit_row() returns trigger language plpgsql as $$
declare
  act text := lower(tg_op);
  rid text;
begin
  if tg_op = 'DELETE' then rid := old.id::text; else rid := new.id::text; end if;
  if tg_op = 'UPDATE' and tg_table_name in ('txn', 'fx_txn', 'party_txn') then
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

create or replace view v_fx_balance as
select c.code, c.name, c.opening_balance, c.sort_order, c.is_active,
       coalesce(sum(t.amount) filter (where t.direction = 'in'), 0)::numeric(18,2)  as total_in,
       coalesce(sum(t.amount) filter (where t.direction = 'out'), 0)::numeric(18,2) as total_out,
       (c.opening_balance + coalesce(sum(case when t.direction = 'in' then t.amount else -t.amount end), 0))::numeric(18,2) as balance,
       count(t.id)::int as entries,
       max(t.txn_date) as last_txn_date,
       -- weighted average INR rate of everything bought/received with a rate
       (sum(t.amount * t.rate_inr) filter (where t.direction = 'in' and t.rate_inr is not null)
        / nullif(sum(t.amount) filter (where t.direction = 'in' and t.rate_inr is not null), 0))::numeric(14,4) as avg_in_rate,
       (array_agg(t.rate_inr order by t.txn_date desc, t.created_at desc) filter (where t.rate_inr is not null))[1] as last_rate
from fx_currency c
left join fx_txn t on t.currency = c.code and t.deleted_at is null
group by c.code;

alter table fx_currency enable row level security;
alter table fx_txn enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema skyroad from anon, authenticated';
  end if;
end $$;

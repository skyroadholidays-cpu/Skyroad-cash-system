-- Migration 006: Parties – a running account (khata) with individual people.
-- Every entry is either "I paid" (they owe me more) or "They paid" (I owe them
-- more). Balance > 0 means the party owes you; < 0 means you owe the party.
-- An entry can optionally be linked to a real Cash Out / Cash In so physical
-- cash stays correct. Safe to run more than once.

set search_path = skyroad, public;

create table if not exists party (
  id              serial primary key,
  name            text not null check (length(trim(name)) between 1 and 80),
  phone           text,
  notes           text,
  account         text not null default 'home' check (account in ('business', 'home')),
  opening_balance numeric(14,2) not null default 0,   -- + they owe you, − you owe them
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text,
  updated_by      text
);
create unique index if not exists party_name_uq on party (lower(name));

create sequence if not exists party_txn_no_seq start 101;

create table if not exists party_txn (
  id              uuid primary key default gen_random_uuid(),
  pt_no           text not null unique default ('PT-' || lpad(nextval('skyroad.party_txn_no_seq')::text, 6, '0')),
  party_id        int not null references party(id) on delete restrict,
  txn_date        date not null,
  paid_by         text not null check (paid_by in ('me', 'them')),
  amount          numeric(14,2) not null check (amount > 0 and amount < 1e12),
  category        text,
  description     text,
  notes           text,
  linked_txn_id   uuid references txn(id) on delete restrict,   -- the matching Cash Out / Cash In, if paid in cash
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text,
  updated_by      text,
  deleted_at      timestamptz,
  deleted_by      text
);
create index if not exists party_txn_party_idx on party_txn(party_id, txn_date) where deleted_at is null;
create unique index if not exists party_txn_linked_uq on party_txn(linked_txn_id) where linked_txn_id is not null;

create or replace function party_txn_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Party entries cannot be hard-deleted; use delete (it can be restored)' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists party_txn_guard_d on party_txn;
create trigger party_txn_guard_d before delete on party_txn for each row execute function party_txn_guard();

drop trigger if exists touch_party on party;
create trigger touch_party before update on party for each row execute function touch_updated_at();
drop trigger if exists touch_party_txn on party_txn;
create trigger touch_party_txn before update on party_txn for each row execute function touch_updated_at();
drop trigger if exists audit_party on party;
create trigger audit_party after insert or update or delete on party for each row execute function audit_row();
drop trigger if exists audit_party_txn on party_txn;
create trigger audit_party_txn after insert or update or delete on party_txn for each row execute function audit_row();

-- soft delete / restore labels for party entries too
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

create or replace view v_party_balance as
select p.id, p.name, p.phone, p.notes, p.account, p.opening_balance, p.is_active, p.created_at,
       coalesce(sum(t.amount) filter (where t.paid_by = 'me'), 0)::numeric(14,2)   as i_paid,
       coalesce(sum(t.amount) filter (where t.paid_by = 'them'), 0)::numeric(14,2) as they_paid,
       (p.opening_balance
        + coalesce(sum(t.amount) filter (where t.paid_by = 'me'), 0)
        - coalesce(sum(t.amount) filter (where t.paid_by = 'them'), 0))::numeric(14,2) as balance,
       count(t.id)::int as entries,
       max(t.txn_date) as last_txn_date
from party p
left join party_txn t on t.party_id = p.id and t.deleted_at is null
group by p.id;

alter table party enable row level security;
alter table party_txn enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema skyroad from anon, authenticated';
  end if;
end $$;

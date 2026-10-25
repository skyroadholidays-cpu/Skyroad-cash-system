-- Migration 003: allow Collection Due / Payment Due for Home / personal and
-- for Skyroad entries without a booking (salaries, office rent, other income).
--
-- Rules after this migration:
--   * Home entries may be Cash In, Cash Out, Collection Due or Payment Due
--     (never a Transfer, never linked to a booking).
--   * A payment/collection always takes the account of the due it settles,
--     so Home dues are only ever settled by Home cash and vice versa.

set search_path = skyroad, public;

-- Safe to run more than once.
alter table txn drop constraint if exists txn_home_shape;
alter table txn add constraint txn_home_shape check (
  account <> 'home' or (type <> 'transfer' and booking_id is null));

-- Re-create the guard with one addition: settlements inherit the due's account.
create or replace function txn_guard() returns trigger language plpgsql as $$
declare
  tgt        skyroad.txn;
  settled    numeric(14,2);
  is_active  boolean := (new.deleted_at is null);
begin
  if tg_op = 'DELETE' then
    raise exception 'Transactions cannot be hard-deleted; use soft delete' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and old.type <> new.type
     and exists (select 1 from skyroad.txn p where p.settles_id = old.id and p.deleted_at is null) then
    raise exception 'This due has payments recorded against it, so its type cannot change' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and new.type in ('collection_due','payment_due') and old.account <> new.account
     and exists (select 1 from skyroad.txn p where p.settles_id = old.id and p.deleted_at is null) then
    raise exception 'This due has payments recorded against it, so it cannot be moved between Skyroad and Home' using errcode = 'P0001';
  end if;

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
    new.account := tgt.account;
    if tgt.account = 'home' then
      new.booking_id := null;
    elsif new.booking_id is null then
      new.booking_id := tgt.booking_id;
    end if;
    if new.client_name is null or new.client_name = '' then new.client_name := tgt.client_name; end if;
    if new.supplier_name is null or new.supplier_name = '' then new.supplier_name := tgt.supplier_name; end if;
    if new.service_provider is null or new.service_provider = '' then new.service_provider := tgt.service_provider; end if;
  end if;

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

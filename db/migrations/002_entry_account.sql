-- Migration 002: separate Skyroad business money from Home / personal money.
--
-- Every entry now belongs to an account:
--   'business' – Skyroad Holidays (with or without a booking)
--   'home'     – home / personal cash kept in the same locker or wallet
-- Home entries are plain Cash In / Cash Out: never linked to a booking or a
-- receivable/payable, so they can never affect To Collect, To Pay or any
-- booking's figures. Physical cash balances still include them, because the
-- notes sit in the same locker.

set search_path = skyroad, public;

-- Safe to run more than once.
alter table txn add column if not exists account text not null default 'business';
alter table txn drop constraint if exists txn_account_check;
alter table txn add constraint txn_account_check check (account in ('business', 'home'));
do $$ begin
  -- only add the original rule if migration 003 hasn't already replaced it
  if not exists (select 1 from pg_constraint where conname = 'txn_home_shape') then
    alter table skyroad.txn add constraint txn_home_shape check (
      account <> 'home'
      or (type in ('cash_in', 'cash_out') and booking_id is null and settles_id is null));
  end if;
end $$;

create index if not exists txn_account_idx on txn(account) where deleted_at is null;

-- Views that use t.* must be rebuilt so they include the new column.
drop view if exists v_booking_summary;
drop view if exists v_due;
drop view if exists v_txn;

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

create view v_booking_summary as
select b.*,
       coalesce(x.receivable_total, 0)::numeric(14,2)     as receivable_total,
       coalesce(x.received, 0)::numeric(14,2)             as received,
       coalesce(x.to_collect, 0)::numeric(14,2)           as to_collect,
       coalesce(x.supplier_cost, 0)::numeric(14,2)        as supplier_cost,
       coalesce(x.supplier_paid, 0)::numeric(14,2)        as supplier_paid,
       coalesce(x.supplier_outstanding, 0)::numeric(14,2) as supplier_outstanding,
       coalesce(x.other_expenses, 0)::numeric(14,2)       as other_expenses,
       coalesce(x.cash_paid, 0)::numeric(14,2)            as cash_paid,
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

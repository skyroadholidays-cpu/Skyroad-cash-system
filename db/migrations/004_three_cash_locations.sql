-- Migration 004: three standard cash locations
--   Cash in Hand · Cash in Skyroad Locker · Cash in Home Locker
-- Renames the original "Cash in Locker" (only if you haven't renamed it
-- yourself) and adds "Cash in Home Locker" with a ₹0.00 opening balance.
-- Existing entries and balances are untouched.

set search_path = skyroad, public;

update cash_location set name = 'Cash in Skyroad Locker', sort_order = 2
where lower(name) = 'cash in locker'
  and not exists (select 1 from cash_location where lower(name) = 'cash in skyroad locker');

insert into cash_location (name, kind, opening_balance, sort_order)
select 'Cash in Home Locker', 'locker', 0, 3
where not exists (select 1 from cash_location where lower(name) = 'cash in home locker');

update cash_location set sort_order = 1 where lower(name) = 'cash in hand';

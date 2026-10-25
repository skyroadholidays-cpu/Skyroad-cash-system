-- Business-rule test suite. Run against an EMPTY freshly migrated database:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/business_rules.sql
-- Everything runs inside a transaction that is rolled back at the end,
-- so it never leaves test data behind.
\set QUIET on
\pset tuples_only on
\pset format unaligned
set search_path = skyroad, public;
begin;
select set_config('skyroad.actor', 'test-suite', true);

create function pg_temp.eq(label text, got numeric, want numeric) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'PASS %', label;
end $$;
create function pg_temp.eqt(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice 'PASS %', label;
end $$;
-- runs sql, expects it to fail with a message containing frag
create function pg_temp.fails(label text, sql text, frag text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(lower(frag) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL % – wrong error: %', label, sqlerrm;
    end if;
    raise notice 'PASS % (blocked: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL % – statement was allowed', label;
end $$;
create function pg_temp.bal(loc text) returns numeric language sql as $$
  select balance from skyroad.v_location_balance where name = loc $$;
create function pg_temp.total() returns numeric language sql as $$
  select sum(balance) from skyroad.v_location_balance $$;

-- ── opening balances
update cash_location set opening_balance = 10000 where name = 'Cash in Hand';
update cash_location set opening_balance = 50000 where name = 'Cash in Skyroad Locker';
select pg_temp.eq('opening total', pg_temp.total(), 60000);

-- ── booking + package receivable: physical cash must not move (rule 3)
insert into booking (booking_ref, client_name, destination, package_amount)
values ('SR-BALI-01', 'Mehta Family', 'Bali', 100000);
insert into txn (txn_date, type, amount, booking_id, client_name, is_package_due, due_date)
select current_date, 'collection_due', 100000, id, client_name, true, current_date + 5 from booking where booking_ref = 'SR-BALI-01';
select pg_temp.eq('receivable does not add cash', pg_temp.total(), 60000);
select pg_temp.eq('to collect = 100000', (select sum(outstanding) from v_due where type='collection_due'), 100000);

-- ── partial collection #1 into hand (rule 1, 8)
insert into txn (txn_date, type, amount, location_id, settles_id, category)
select current_date, 'cash_in', 40000.50, l.id, d.id, 'Client collection'
from cash_location l, txn d where l.name='Cash in Hand' and d.is_package_due;
select pg_temp.eq('hand after collection', pg_temp.bal('Cash in Hand'), 50000.50);
select pg_temp.eq('outstanding after partial', (select outstanding from v_due where is_package_due), 59999.50);
select pg_temp.eqt('status partial', (select settle_status from v_due where is_package_due), 'partial');
select pg_temp.eqt('collection inherits booking', (select b.booking_ref from txn t join booking b on b.id=t.booking_id where t.type='cash_in'), 'SR-BALI-01');

-- ── overpayment blocked
select pg_temp.fails('overpayment blocked',
  $q$ insert into skyroad.txn (txn_date,type,amount,location_id,settles_id)
      select current_date,'cash_in',60000,l.id,d.id from skyroad.cash_location l, skyroad.txn d
      where l.name='Cash in Hand' and d.is_package_due $q$, 'exceeds the outstanding');

-- ── collection #2 settles exactly
insert into txn (txn_date, type, amount, location_id, settles_id)
select current_date, 'cash_in', 59999.50, l.id, d.id from cash_location l, txn d where l.name='Cash in Skyroad Locker' and d.is_package_due;
select pg_temp.eqt('status settled', (select settle_status from v_due where is_package_due), 'settled');
select pg_temp.eq('to collect = 0', (select sum(outstanding) from v_due where type='collection_due'), 0);
select pg_temp.eq('locker after collection', pg_temp.bal('Cash in Skyroad Locker'), 109999.50);

-- ── supplier payable: no cash effect (rule 4), partial payment (rule 2, 8)
insert into txn (txn_date, type, amount, booking_id, supplier_name, service_provider, due_date)
select current_date, 'payment_due', 70000, id, 'Bali Hotels Pvt', 'Ayana Resort', current_date - 1 from booking where booking_ref='SR-BALI-01';
select pg_temp.eq('payable does not reduce cash', pg_temp.total(), 160000);
insert into txn (txn_date, type, amount, location_id, settles_id)
select current_date, 'cash_out', 30000, l.id, d.id from cash_location l, txn d where l.name='Cash in Skyroad Locker' and d.type='payment_due';
select pg_temp.eq('locker after supplier payment', pg_temp.bal('Cash in Skyroad Locker'), 79999.50);
select pg_temp.eq('to pay = 40000', (select sum(outstanding) from v_due where type='payment_due'), 40000);
select pg_temp.eqt('payment inherits supplier', (select supplier_name from txn where type='cash_out'), 'Bali Hotels Pvt');

-- ── transfer: total unchanged (rule 5)
insert into txn (txn_date, type, amount, from_location_id, to_location_id)
select current_date, 'transfer', 50000, f.id, t.id from cash_location f, cash_location t where f.name='Cash in Hand' and t.name='Cash in Skyroad Locker';
select pg_temp.eq('hand after transfer', pg_temp.bal('Cash in Hand'), 0.50);
select pg_temp.eq('locker after transfer', pg_temp.bal('Cash in Skyroad Locker'), 129999.50);
select pg_temp.eq('total unchanged by transfer', pg_temp.total(), 130000);
select pg_temp.fails('transfer to same location blocked',
  $q$ insert into skyroad.txn (txn_date,type,amount,from_location_id,to_location_id) values (current_date,'transfer',1,1,1) $q$, 'txn_transfer_shape');

-- ── edit reverses old effect, applies new once (rule 6)
update txn set amount = 30000.50 where type='cash_in' and amount = 40000.50;
select pg_temp.eq('hand after edit', pg_temp.bal('Cash in Hand'), -9999.50);
select pg_temp.eq('outstanding after edit', (select outstanding from v_due where is_package_due), 10000);
update txn set location_id = (select id from cash_location where name='Cash in Skyroad Locker') where type='cash_in' and amount = 30000.50;
select pg_temp.eq('hand after moving location', pg_temp.bal('Cash in Hand'), -40000);
select pg_temp.eq('total after location edit', pg_temp.total(), 120000);

-- ── soft delete recalculates (rule 7); restore re-applies
update txn set deleted_at = now() where type='cash_out';
select pg_temp.eq('to pay after deleting payment', (select sum(outstanding) from v_due where type='payment_due'), 70000);
select pg_temp.eq('locker after deleting payment', pg_temp.bal('Cash in Skyroad Locker'), 190000);
update txn set deleted_at = null where type='cash_out';
select pg_temp.eq('locker after restore', pg_temp.bal('Cash in Skyroad Locker'), 160000);

-- ── due protection
select pg_temp.fails('cannot delete due with payments',
  $q$ update skyroad.txn set deleted_at = now() where type='payment_due' $q$, 'delete those payments first');
select pg_temp.fails('cannot reduce due below settled',
  $q$ update skyroad.txn set amount = 20000 where type='payment_due' $q$, 'cannot be less than');
select pg_temp.fails('hard delete blocked',
  $q$ delete from skyroad.txn where type='transfer' $q$, 'cannot be hard-deleted');
select pg_temp.fails('cash-out cannot settle a receivable',
  $q$ insert into skyroad.txn (txn_date,type,amount,location_id,settles_id)
      select current_date,'cash_out',1,1,id from skyroad.txn where is_package_due $q$, 'must settle');
select pg_temp.fails('due type change blocked once paid',
  $q$ update skyroad.txn set type='collection_due' where type='payment_due' $q$, 'type cannot change');

-- ── restore that would overpay is blocked
update txn set deleted_at = now() where type='cash_out';
insert into txn (txn_date, type, amount, location_id, settles_id)
select current_date, 'cash_out', 70000, l.id, d.id from cash_location l, txn d where l.name='Cash in Skyroad Locker' and d.type='payment_due';
select pg_temp.fails('restore that would overpay blocked',
  $q$ update skyroad.txn set deleted_at = null where type='cash_out' and amount = 30000 $q$, 'exceeds the outstanding');

-- ── validation
select pg_temp.fails('zero amount blocked',
  $q$ insert into skyroad.txn (txn_date,type,amount,location_id) values (current_date,'cash_in',0,1) $q$, 'txn_amount_check');
select pg_temp.fails('negative amount blocked',
  $q$ insert into skyroad.txn (txn_date,type,amount,location_id) values (current_date,'cash_in',-5,1) $q$, 'txn_amount_check');
select pg_temp.fails('cash row needs location',
  $q$ insert into skyroad.txn (txn_date,type,amount) values (current_date,'cash_in',5) $q$, 'txn_cash_shape');
select pg_temp.fails('due cannot carry a location',
  $q$ insert into skyroad.txn (txn_date,type,amount,location_id) values (current_date,'payment_due',5,1) $q$, 'txn_due_shape');

-- ── duplicate submission blocked (rule 11)
insert into txn (txn_date,type,amount,location_id,idempotency_key) values (current_date,'cash_in',500,1,'form-abc');
select pg_temp.fails('duplicate submission blocked',
  $q$ insert into skyroad.txn (txn_date,type,amount,location_id,idempotency_key) values (current_date,'cash_in',500,1,'form-abc') $q$, 'idempotency_key');

-- ── inactive location
update cash_location set is_active = false where name = 'Cash in Hand';
select pg_temp.fails('inactive location blocked',
  $q$ insert into skyroad.txn (txn_date,type,amount,location_id) values (current_date,'cash_in',5,1) $q$, 'inactive');
update cash_location set is_active = true where name = 'Cash in Hand';

-- ── booking summary keeps cash and profitability apart (rule 10)
select pg_temp.eq('booking received', (select received from v_booking_summary), 90000);
select pg_temp.eq('booking to collect', (select to_collect from v_booking_summary), 10000);
select pg_temp.eq('booking supplier cost', (select supplier_cost from v_booking_summary), 70000);
select pg_temp.eq('booking supplier paid', (select supplier_paid from v_booking_summary), 70000);
select pg_temp.eq('booking supplier outstanding', (select supplier_outstanding from v_booking_summary), 0);
select pg_temp.eq('booking cash balance', (select cash_balance from v_booking_summary), 20000);
select pg_temp.eq('booking expected margin', (select expected_margin from v_booking_summary), 30000);
select pg_temp.eq('booking unbilled', (select unbilled_amount from v_booking_summary), 0);

-- ── audit trail (rule 12)
select pg_temp.eq('audit has soft deletes', (select count(*) from audit_log where action='soft_delete'), 2);
select pg_temp.eq('audit has restores', (select count(*) from audit_log where action='restore'), 1);
select pg_temp.eqt('audit actor recorded', (select distinct actor from audit_log where table_name='txn' limit 1), 'test-suite');

\echo 'ALL BUSINESS RULE TESTS PASSED'
rollback;

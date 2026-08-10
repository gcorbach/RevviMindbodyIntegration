begin;

select plan(26);

select has_table('public', 'class_booking_write_locks', 'Customer/Class writes use a durable lock');
select has_table('public', 'class_booking_reconciliation_queue', 'unknown outcomes have a durable reconciliation queue');
select has_function(
  'public', 'claim_class_booking_attempt',
  array['uuid','uuid','text','text','class_provider_attempt_type','text','text','text','text','text','text','text','timestamp with time zone','timestamp with time zone'],
  'Booking and provider attempt are claimed atomically'
);

insert into public.class_businesses (id, slug, display_name, status)
values ('36000000-0000-4000-8000-000000000001', 'issue-36', 'Issue 36', 'active');
insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values (
  '36000000-0000-4000-8000-000000000011', '36000000-0000-4000-8000-000000000001',
  'sandbox', '-36001', 'active', now()
);
insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values (
  '36000000-0000-4000-8000-000000000021', '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000011', 'rosebank', 'Rosebank', 'Africa/Johannesburg', '7', true
);
insert into public.class_revvi_customers (
  id, memberstack_customer_id, email, first_name, last_name, subscription_status, memberstack_plan_ids
) values (
  '36000000-0000-4000-8000-000000000031', 'member-36-a', 'a@example.com',
  'Ava', 'Ndlovu', 'active', array['plan-revvi']
);
insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values (
  '36000000-0000-4000-8000-000000000041', '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000021', 'revvi-yoga', 'Revvi Yoga',
  'approved_unpaid', array['plan-revvi'], 'draft'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  status, validated_at, validation_evidence_digest, mode_verified_at, mode_evidence_digest
) values (
  '36000000-0000-4000-8000-000000000051', '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000041', 'approved_unpaid',
  '36000000-0000-4000-8000-000000000011', '36000000-0000-4000-8000-000000000021',
  'draft', now(), repeat('a', 64), now(), repeat('b', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000051', 'location', '7'),
  ('36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000051', 'program', '11'),
  ('36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000051', 'class_description', '13'),
  ('36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000051', 'session_type', '23');
update public.class_offer_provider_mappings set status = 'active'
where id = '36000000-0000-4000-8000-000000000051';
update public.class_revvi_offers set status = 'active'
where id = '36000000-0000-4000-8000-000000000041';

select * from public.persist_class_customer_provider_profile(
  '36000000-0000-4000-8000-000000000001', '36000000-0000-4000-8000-000000000031',
  '36000000-0000-4000-8000-000000000011', '-36001', 'rss-36-a', 'unique-36-a'
);

insert into public.class_booking_quotes (
  id, business_id, offer_id, mapping_id, mapping_version, integration_id, location_id,
  customer_id, customer_provider_profile_id, provider_site_id, provider_location_id,
  provider_class_id, provider_class_schedule_id, provider_client_id, provider_client_unique_id,
  fulfilment_mode, subtotal, discount_total, tax_total, grand_total, currency,
  provider_calculation, quote_fingerprint, expires_at
) values
(
  '36000000-0000-4000-8000-000000000061', '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000041', '36000000-0000-4000-8000-000000000051',
  (select mapping_version from public.class_offer_provider_mappings where id = '36000000-0000-4000-8000-000000000051'),
  '36000000-0000-4000-8000-000000000011', '36000000-0000-4000-8000-000000000021',
  '36000000-0000-4000-8000-000000000031',
  (select id from public.class_customer_provider_profiles where provider_client_id = 'rss-36-a'),
  '-36001', '7', '771', '991', 'rss-36-a', 'unique-36-a',
  'approved_unpaid', 0, 0, 0, 0, 'ZAR', 'approved_unpaid', repeat('c', 64), now() + interval '5 minutes'
),
(
  '36000000-0000-4000-8000-000000000062', '36000000-0000-4000-8000-000000000001',
  '36000000-0000-4000-8000-000000000041', '36000000-0000-4000-8000-000000000051',
  (select mapping_version from public.class_offer_provider_mappings where id = '36000000-0000-4000-8000-000000000051'),
  '36000000-0000-4000-8000-000000000011', '36000000-0000-4000-8000-000000000021',
  '36000000-0000-4000-8000-000000000031',
  (select id from public.class_customer_provider_profiles where provider_client_id = 'rss-36-a'),
  '-36001', '7', '771', '991', 'rss-36-a', 'unique-36-a',
  'approved_unpaid', 0, 0, 0, 0, 'ZAR', 'approved_unpaid', repeat('d', 64), now() + interval '5 minutes'
);

create temporary table issue_36_claims (name text primary key, payload jsonb not null);
insert into issue_36_claims values (
  'first', public.claim_class_booking_attempt(
    '36000000-0000-4000-8000-000000000061', '36000000-0000-4000-8000-000000000031',
    '550e8400-e29b-41d4-a716-446655440036', repeat('e', 64), 'approved_unpaid_booking', repeat('f', 64),
    '991', '13', '11', '23', 'Revvi Yoga', 'Maya', now() + interval '1 day', now() + interval '25 hours'
  )
);

select is((select payload->>'shouldWrite' from issue_36_claims where name = 'first'), 'true', 'the first claim owns the provider write');
select is((select count(*)::int from public.class_bookings), 1, 'one local Booking is created before the provider write');
select is((select count(*)::int from public.class_booking_provider_attempts), 1, 'one pending provider attempt is created atomically');
select is((select status::text from public.class_booking_quotes where id = '36000000-0000-4000-8000-000000000061'), 'consumed', 'the claimed quote is consumed once');
select is((select count(*)::int from public.class_booking_provider_attempt_history), 1, 'the initial pending attempt is in append-only history');
select is((select count(*)::int from public.class_booking_write_locks where status = 'active'), 1, 'the Customer/Class write lock is active before Mindbody');
select is((select count(*)::int from public.class_booking_write_locks where token_digest = repeat('f', 64)), 0, 'the raw write token is never stored');

insert into issue_36_claims values (
  'duplicate', public.claim_class_booking_attempt(
    '36000000-0000-4000-8000-000000000061', '36000000-0000-4000-8000-000000000031',
    '550e8400-e29b-41d4-a716-446655440036', repeat('e', 64), 'approved_unpaid_booking', repeat('1', 64),
    '991', '13', '11', '23', 'Revvi Yoga', 'Maya', now() + interval '1 day', now() + interval '25 hours'
  )
);
select is((select payload->>'shouldWrite' from issue_36_claims where name = 'duplicate'), 'false', 'a duplicate idempotency key cannot own another provider write');
select is(
  (select payload#>>'{booking,id}' from issue_36_claims where name = 'duplicate'),
  (select payload#>>'{booking,id}' from issue_36_claims where name = 'first'),
  'a duplicate returns the same local Booking'
);

select throws_ok(
  $$select public.claim_class_booking_attempt(
    '36000000-0000-4000-8000-000000000061', '36000000-0000-4000-8000-000000000031',
    '550e8400-e29b-41d4-a716-446655440036', repeat('9', 64), 'approved_unpaid_booking', repeat('1', 64),
    '991', '13', '11', '23', 'Revvi Yoga', 'Maya', now() + interval '1 day', now() + interval '25 hours'
  )$$,
  'Class Booking idempotency key conflicts with an existing request',
  'one idempotency key cannot be rebound to another request fingerprint'
);

insert into issue_36_claims values (
  'blocked', public.claim_class_booking_attempt(
    '36000000-0000-4000-8000-000000000062', '36000000-0000-4000-8000-000000000031',
    '550e8400-e29b-41d4-a716-446655440037', repeat('8', 64), 'approved_unpaid_booking', repeat('7', 64),
    '991', '13', '11', '23', 'Revvi Yoga', 'Maya', now() + interval '1 day', now() + interval '25 hours'
  )
);
select is((select payload->>'shouldWrite' from issue_36_claims where name = 'blocked'), 'false', 'a concurrent key for the same Customer/Class is blocked');
select is((select status::text from public.class_booking_quotes where id = '36000000-0000-4000-8000-000000000062'), 'open', 'a blocked claim does not consume its quote');

select public.finalize_class_booking_attempt(
  '36000000-0000-4000-8000-000000000001',
  ((select payload#>>'{booking,id}' from issue_36_claims where name = 'first'))::uuid,
  ((select payload#>>'{attempt,id}' from issue_36_claims where name = 'first'))::uuid,
  repeat('f', 64), 'unknown', 'unknown', 'not_required', null,
  null, null, null, null, null, null, null, null, null,
  'PROVIDER_OUTCOME_UNKNOWN', 'Mindbody may have accepted the Class Booking.', false
);
select is((select count(*)::int from public.class_booking_reconciliation_queue where status = 'queued'), 1, 'unknown is atomically queued for reconciliation');
select is((select count(*)::int from public.class_booking_write_locks where status = 'active'), 1, 'unknown retains the Customer/Class write lock');
select is((select count(*)::int from public.class_booking_provider_attempt_history), 2, 'the unknown transition is appended to history');

select throws_ok(
  $$select public.complete_class_booking_reconciliation(
    '36000000-0000-4000-8000-000000000001',
    (select id from public.class_bookings limit 1),
    (select id from public.class_booking_provider_attempts limit 1),
    'confirmed', null, null, null, null, null, null, null, null, null, null
  )$$,
  'authoritative Mindbody evidence is required to reconcile a confirmed Class Booking',
  'reconciliation cannot claim confirmation without authoritative evidence'
);

select public.complete_class_booking_reconciliation(
  '36000000-0000-4000-8000-000000000001',
  ((select payload#>>'{booking,id}' from issue_36_claims where name = 'first'))::uuid,
  ((select payload#>>'{attempt,id}' from issue_36_claims where name = 'first'))::uuid,
  'confirmed', 'visit-36', null, null, null, null, null, null, null, null, null
);
select is((select provider_visit_id from public.class_bookings limit 1), 'visit-36', 'reconciliation persists the distinct Visit ID');
select is((select status::text from public.class_booking_provider_attempts limit 1), 'reconciled', 'authoritative evidence reconciles the provider attempt');
select is((select count(*)::int from public.class_booking_write_locks where status = 'active'), 0, 'authoritative reconciliation releases the write lock');
select is((select status::text from public.class_booking_reconciliation_queue limit 1), 'completed', 'the reconciliation queue records completion');

insert into issue_36_claims values (
  'after-reconciliation', public.claim_class_booking_attempt(
    '36000000-0000-4000-8000-000000000062', '36000000-0000-4000-8000-000000000031',
    '550e8400-e29b-41d4-a716-446655440038', repeat('6', 64), 'approved_unpaid_booking', repeat('5', 64),
    '991', '13', '11', '23', 'Revvi Yoga', 'Maya', now() + interval '1 day', now() + interval '25 hours'
  )
);
select is((select payload->>'shouldWrite' from issue_36_claims where name = 'after-reconciliation'), 'true', 'only completed reconciliation permits a later intentional write');

select is(has_table_privilege('authenticated', 'public.class_booking_write_locks', 'insert'), false, 'browser sessions cannot fabricate write locks');
select is(has_function_privilege(
  'authenticated',
  'public.claim_class_booking_attempt(uuid,uuid,text,text,class_provider_attempt_type,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone)',
  'EXECUTE'
), false, 'browser sessions cannot claim provider writes');

select * from finish();
rollback;

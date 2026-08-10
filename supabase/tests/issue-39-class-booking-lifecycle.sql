begin;

select plan(39);

select has_table('public', 'class_cancellation_evidence', 'cancellation uses a controlled-evidence ledger');
select has_table('public', 'class_cancellation_write_locks', 'cancellation has a durable provider-write lock');
select has_table('public', 'class_lifecycle_reconciliation_queue', 'Class lifecycle reads have their own queue');
select has_table('public', 'class_mindbody_webhook_events', 'Mindbody webhook message identities are durable');
select has_table('public', 'class_mindbody_webhook_diagnostics', 'temporary webhook diagnostics are separate');
select has_table('public', 'class_booking_support_actions', 'staff lifecycle resolutions are audited');
select has_view('public', 'class_booking_support_cases', 'operations has a Class-specific support view');
select has_column('public', 'class_offer_provider_mappings', 'cancellation_enabled', 'each mapping has a server-owned cancellation gate');
select has_function('public', 'list_upcoming_class_bookings', array['uuid','integer'], 'upcoming Bookings use a Customer-scoped read function');
select has_function('public', 'claim_class_booking_cancellation', array['uuid','uuid','text','text'], 'cancellation claims one serialized provider write');
select has_function(
  'public', 'record_class_entitlement_restoration_read',
  array['uuid','uuid','class_provider_attempt_status','text'],
  'exact entitlement restoration reads are recorded independently'
);
select has_function(
  'public', 'persist_class_entitlement_restoration_baseline',
  array['uuid','uuid','uuid','text','boolean','boolean','boolean','numeric','timestamp with time zone'],
  'the exact pre-write entitlement baseline is persisted under the cancellation lock'
);
select has_function('public', 'enqueue_class_lifecycle_24_hour_sweep', array[]::text[], 'the 24-hour reconciliation sweep is callable');
select has_function('public', 'purge_expired_class_mindbody_webhook_diagnostics', array[]::text[], '48-hour webhook diagnostics have a deletion job');

insert into public.class_businesses (id, slug, display_name, status)
values ('39000000-0000-4000-8000-000000000001', 'issue-39', 'Issue 39 Studio', 'active');
insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values (
  '39000000-0000-4000-8000-000000000011', '39000000-0000-4000-8000-000000000001',
  'sandbox', '-39001', 'active', now()
);
insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values (
  '39000000-0000-4000-8000-000000000021', '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000011', 'rosebank', 'Rosebank', 'Africa/Johannesburg', '7', true
);
insert into public.class_revvi_customers (
  id, memberstack_customer_id, email, first_name, last_name, subscription_status, memberstack_plan_ids
) values
  ('39000000-0000-4000-8000-000000000031', 'member-39-a', 'a39@example.com', 'Ava', 'Ndlovu', 'active', array['plan-revvi']),
  ('39000000-0000-4000-8000-000000000032', 'member-39-b', 'b39@example.com', 'Ben', 'Dube', 'active', array['plan-revvi']);
insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values (
  '39000000-0000-4000-8000-000000000041', '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000021', 'unpaid-yoga', 'Unpaid Yoga',
  'approved_unpaid', array['plan-revvi'], 'draft'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  status, validated_at, validation_evidence_digest
) values (
  '39000000-0000-4000-8000-000000000051', '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000041', 'approved_unpaid',
  '39000000-0000-4000-8000-000000000011', '39000000-0000-4000-8000-000000000021',
  'draft', now(), repeat('a', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000051', 'location', '7'),
  ('39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000051', 'program', '11'),
  ('39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000051', 'class_description', '13'),
  ('39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000051', 'session_type', '23');
update public.class_offer_provider_mappings set status = 'active', approved_unpaid_enabled = true
where id = '39000000-0000-4000-8000-000000000051';
insert into public.class_approved_unpaid_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
)
select mapping.business_id, mapping.id, mapping.mapping_version, evidence.kind,
  encode(extensions.digest(mapping.id::text || evidence.kind::text, 'sha256'), 'hex'), now()
from public.class_offer_provider_mappings mapping
cross join unnest(enum_range(null::public.class_approved_unpaid_evidence_kind)) evidence(kind)
where mapping.id = '39000000-0000-4000-8000-000000000051';
update public.class_offer_provider_mappings
set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
where id = '39000000-0000-4000-8000-000000000051';
update public.class_revvi_offers set status = 'active'
where id = '39000000-0000-4000-8000-000000000041';

select is(
  public.class_cancellation_operation_verified(
    '39000000-0000-4000-8000-000000000051', 'cancellation'
  ), false,
  'the cancellation flag and generic mode proof cannot open a provider removal write'
);
update public.class_offer_provider_mappings set cancellation_enabled = true
where id = '39000000-0000-4000-8000-000000000051';
insert into public.class_cancellation_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
  evidence_digest, verified_at
)
select mapping.business_id, mapping.id, mapping.mapping_version, evidence.kind, 'sandbox',
  encode(extensions.digest('cancel:' || mapping.id::text || evidence.kind::text, 'sha256'), 'hex'), now()
from public.class_offer_provider_mappings mapping
cross join unnest(enum_range(null::public.class_cancellation_evidence_kind)) evidence(kind)
where mapping.id = '39000000-0000-4000-8000-000000000051';
select ok(
  public.class_cancellation_operation_verified(
    '39000000-0000-4000-8000-000000000051', 'cancellation'
  ),
  'the deliberate flag plus current roster and reconciliation evidence opens only the proven operation'
);

select * from public.persist_class_customer_provider_profile(
  '39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000031',
  '39000000-0000-4000-8000-000000000011', '-39001', 'rss-39-a', 'unique-39-a'
);
insert into public.class_booking_quotes (
  id, business_id, offer_id, mapping_id, mapping_version, integration_id, location_id,
  customer_id, customer_provider_profile_id, provider_site_id, provider_location_id,
  provider_class_id, provider_class_schedule_id, provider_client_id, provider_client_unique_id,
  fulfilment_mode, subtotal, discount_total, tax_total, grand_total, currency,
  provider_calculation, quote_fingerprint, expires_at
) values (
  '39000000-0000-4000-8000-000000000061', '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000041', '39000000-0000-4000-8000-000000000051',
  (select mapping_version from public.class_offer_provider_mappings where id = '39000000-0000-4000-8000-000000000051'),
  '39000000-0000-4000-8000-000000000011', '39000000-0000-4000-8000-000000000021',
  '39000000-0000-4000-8000-000000000031',
  (select id from public.class_customer_provider_profiles where provider_client_id = 'rss-39-a'),
  '-39001', '7', '771', '991', 'rss-39-a', 'unique-39-a',
  'approved_unpaid', 0, 0, 0, 0, 'ZAR', 'approved_unpaid', repeat('c', 64), now() + interval '5 minutes'
);
create temporary table issue_39_booking_claim as
select public.claim_class_booking_attempt(
  '39000000-0000-4000-8000-000000000061', '39000000-0000-4000-8000-000000000031',
  '550e8400-e29b-41d4-a716-446655440039', repeat('d', 64), 'approved_unpaid_booking', repeat('e', 64),
  '991', '13', '11', '23', 'Unpaid Yoga', 'Maya',
  now() + interval '2 days', now() + interval '49 hours'
) as payload;
select public.finalize_class_booking_attempt(
  '39000000-0000-4000-8000-000000000001',
  ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid,
  ((select payload#>>'{attempt,id}' from issue_39_booking_claim))::uuid,
  repeat('e', 64), 'confirmed', 'confirmed', 'not_required', 'request-book-39',
  'visit-39', 'roster-39', null, null, null, null, null, null, null,
  null, null, true
);

select is(
  (select count(*)::integer from public.list_upcoming_class_bookings(
    '39000000-0000-4000-8000-000000000031', 20
  )), 1,
  'the owning Customer sees its future confirmed Booking'
);
select is(
  (select count(*)::integer from public.list_upcoming_class_bookings(
    '39000000-0000-4000-8000-000000000032', 20
  )), 0,
  'another Customer cannot retrieve the Booking'
);
select is(
  (select cancellation_state from public.list_upcoming_class_bookings(
    '39000000-0000-4000-8000-000000000031', 20
  )), 'requestable',
  'upcoming history exposes only the evidence-backed cancellation state'
);
update public.class_bookings set start_datetime = now() - interval '1 second'
where id = ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid;
select is(
  (select count(*)::integer from public.list_upcoming_class_bookings(
    '39000000-0000-4000-8000-000000000031', 20
  )), 0,
  'a Booking that has started is not returned as upcoming'
);
update public.class_bookings set start_datetime = now() + interval '2 days'
where id = ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid;
select throws_ok(
  $$select public.claim_class_booking_cancellation(
    ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid,
    '39000000-0000-4000-8000-000000000032',
    'Another Customer requested cancellation', repeat('f', 64)
  )$$,
  'Class Booking was not found for this Customer',
  'another Customer cannot claim cancellation of this Booking'
);

create temporary table issue_39_cancel_claim as
select public.claim_class_booking_cancellation(
  ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid,
  '39000000-0000-4000-8000-000000000031',
  'Revvi Customer requested cancellation', repeat('f', 64)
) as payload;
select is((select payload->>'shouldWrite' from issue_39_cancel_claim), 'true', 'the owner claims exactly one cancellation write');
select is(
  (select payload#>>'{attempt,type}' from issue_39_cancel_claim), 'cancellation',
  'a roster Booking selects RemoveClientFromClass rather than waitlist removal'
);
select is(
  (select status::text from public.class_bookings
   where id = ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid),
  'cancel_pending',
  'claiming the provider write makes cancellation pending'
);
select is(
  (select public.claim_class_booking_cancellation(
    ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid,
    '39000000-0000-4000-8000-000000000031',
    'Revvi Customer requested cancellation', repeat('1', 64)
  )->>'shouldWrite'), 'false',
  'repeated cancellation returns the stored attempt without another provider write'
);

select public.finalize_class_booking_cancellation(
  '39000000-0000-4000-8000-000000000001',
  ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid,
  ((select payload#>>'{attempt,id}' from issue_39_cancel_claim))::uuid,
  repeat('f', 64), 'unknown', false,
  null, null, null, 'CANCELLATION_STATUS_UNKNOWN'
);
select is(
  (select status::text from public.class_bookings
   where id = ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid),
  'unknown',
  'an ambiguous removal never restores the prior local Booking state'
);
select is(
  (select count(*)::integer from public.class_cancellation_write_locks
   where booking_id = ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid and status = 'active'),
  1,
  'an ambiguous cancellation retains its provider-write lock'
);
select is(
  (select count(*)::integer from public.class_lifecycle_reconciliation_queue
   where booking_id = ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid
     and purpose = 'cancellation' and status = 'queued'),
  1,
  'an ambiguous cancellation is queued for read-only reconciliation'
);
select public.reconcile_class_booking_cancellation_from_read(
  '39000000-0000-4000-8000-000000000001',
  ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid,
  ((select payload#>>'{attempt,id}' from issue_39_cancel_claim))::uuid,
  true, null
);
select ok(
  (select status = 'cancelled' and cancellation_status = 'reconciled'
      and cancelled_at is not null and restoration_status is null and refund_status is null
   from public.class_bookings
   where id = ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid),
  'authoritative cancellation is recorded without inventing refund or restoration'
);
select is(
  (select count(*)::integer from public.class_cancellation_write_locks
   where booking_id = ((select payload#>>'{booking,id}' from issue_39_booking_claim))::uuid and status = 'active'),
  0,
  'authoritative reconciliation releases the cancellation write lock'
);

create temporary table issue_39_webhook_first as
select public.enqueue_class_mindbody_webhook(
  'message-39', repeat('1', 64), 'classRosterBooking.cancelled', 1,
  now(), 'transaction-39', '-39001', '7', '771', 'rss-39-a', 'unique-39-a',
  'roster-39', null, null
) as payload;
select is((select payload->>'duplicate' from issue_39_webhook_first), 'false', 'the first verified webhook delivery is durably queued');
select is(
  (select public.enqueue_class_mindbody_webhook(
    'message-39', repeat('1', 64), 'classRosterBooking.cancelled', 1,
    now(), 'transaction-39', '-39001', '7', '771', 'rss-39-a', 'unique-39-a',
    'roster-39', null, null
  )->>'duplicate'), 'true',
  'a duplicate stable message ID is acknowledged without a second event'
);
select is((select count(*)::integer from public.class_mindbody_webhook_events), 1, 'webhook dedupe stores one typed event row');
select is((select count(*)::integer from public.claim_class_mindbody_webhook_batch(10)), 1, 'the asynchronous worker claims queued webhook events');
select public.process_class_mindbody_webhook((select id from public.class_mindbody_webhook_events));
select is((select status::text from public.class_mindbody_webhook_events), 'processed', 'webhook processing completes independently of intake');

select ok(
  exists (
    select 1 from cron.job
    where jobname = 'class-lifecycle-24-hour-sweep'
      and schedule = '17 * * * *'
  ),
  'an hourly scheduler enqueues each due Booking for a full 24-hour read sweep'
);
select ok(
  exists (
    select 1 from cron.job
    where jobname = 'class-mindbody-webhook-diagnostics-retention'
  ),
  'temporary webhook diagnostics have an operating retention schedule'
);
select ok(
  exists (
    select 1 from cron.job
    where jobname = 'class-lifecycle-worker-dispatch' and schedule = '* * * * *'
  ),
  'the asynchronous webhook and lifecycle worker has a minute dispatcher'
);

update public.class_revvi_offers set status = 'inactive'
where id = '39000000-0000-4000-8000-000000000041';
update public.class_offer_provider_mappings set status = 'disabled'
where id = '39000000-0000-4000-8000-000000000051';
select ok(
  (select not cancellation_enabled from public.class_offer_provider_mappings
   where id = '39000000-0000-4000-8000-000000000051')
  and not exists (
    select 1 from public.class_cancellation_evidence
    where mapping_id = '39000000-0000-4000-8000-000000000051' and status = 'verified'
  ),
  'a material mapping change closes cancellation and revokes stale evidence'
);

select * from finish();
rollback;

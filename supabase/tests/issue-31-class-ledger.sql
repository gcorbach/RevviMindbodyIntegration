begin;

select plan(78);

select has_type('public', 'class_offer_fulfilment_mode', 'Class Offer fulfilment modes are closed and typed');
select has_type('public', 'class_booking_status', 'Class Booking states are closed and typed');
select has_type('public', 'class_provider_attempt_status', 'provider attempt states are closed and typed');
select is(
  enum_range(null::public.class_booking_status)::text,
  '{pending,requires_action,confirmed,waitlisted,cancel_pending,cancelled,duplicate,failed,unknown}',
  'Class Booking states match the binding PRD vocabulary'
);
select is(
  enum_range(null::public.class_payment_status)::text,
  '{not_required,pending,requires_action,authorized,paid,failed,unknown}',
  'Class payment states match the binding PRD vocabulary'
);
select is(
  enum_range(null::public.class_provider_attempt_status)::text,
  '{pending,requires_action,confirmed,failed,unknown,reconciled}',
  'provider attempt states match the binding PRD vocabulary'
);

select has_table('public', 'class_businesses', 'the production Class ledger owns Businesses');
select has_table('public', 'class_business_integrations', 'the production Class ledger owns Business integrations');
select has_table('public', 'class_business_locations', 'the production Class ledger owns Locations');
select has_table('public', 'class_revvi_customers', 'the production Class ledger owns Revvi Customer mappings');
select has_table('public', 'class_business_customer_access', 'Class tenant Customer access is independent from the Appointment prototype');
select has_table('public', 'class_business_staff_access', 'Class tenant staff access is independent from the Appointment prototype');
select has_table('public', 'class_customer_provider_profiles', 'Mindbody Client identity is scoped to one Class integration');
select has_table('public', 'class_revvi_offers', 'the production Class ledger owns Revvi Offers');
select has_table('public', 'class_offer_provider_mappings', 'Revvi Offers have typed provider mappings');
select has_table('public', 'class_offer_inventory_allowlist', 'approved Class inventory uses stable allowlist records');
select has_table('public', 'class_booking_quotes', 'provider-calculated quotes are typed records');
select has_table('public', 'class_bookings', 'Class Bookings are separate from Appointment attempts');
select has_table('public', 'class_booking_provider_attempts', 'provider writes have durable attempts');
select has_table('public', 'class_booking_provider_attempt_history', 'provider attempts have append-only history');
select has_table('public', 'class_booking_provider_diagnostics', 'temporary provider diagnostics use an allowlisted store');
select has_table('public', 'class_booking_support_locks', 'support reconciliation uses explicit locks');

select hasnt_column(
  'public',
  'class_bookings',
  'provider_appointment_id',
  'Appointment identifiers are not part of the production Class Booking ledger'
);
select hasnt_column(
  'public',
  'class_booking_provider_diagnostics',
  'provider_payload',
  'temporary diagnostics prohibit arbitrary provider payloads'
);
select hasnt_column(
  'public',
  'class_revvi_customers',
  'provider_client_id',
  'a global Revvi Customer does not own a Site-scoped provider Client ID'
);
select hasnt_column(
  'public',
  'class_revvi_customers',
  'provider_client_unique_id',
  'a global Revvi Customer does not own a Site-scoped provider Client Unique ID'
);
select ok(
  not ('class' = any(enum_range(null::public.class_inventory_entity_kind)::text[])),
  'time-specific Class.Id cannot be a durable Offer allowlist entity'
);

insert into public.class_businesses (id, slug, display_name, status) values
  ('31000000-0000-0000-0000-000000000001', 'class-partner-a', 'Class Partner A', 'active'),
  ('31000000-0000-0000-0000-000000000002', 'class-partner-b', 'Class Partner B', 'active');

insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values
  (
    '31000000-0000-0000-0000-000000000011',
    '31000000-0000-0000-0000-000000000001',
    'sandbox', 'site-a', 'active', now()
  ),
  (
    '31000000-0000-0000-0000-000000000012',
    '31000000-0000-0000-0000-000000000002',
    'sandbox', 'site-b', 'active', now()
  );

insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, provider_location_id, enabled
) values
  (
    '31000000-0000-0000-0000-000000000021',
    '31000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000011',
    'studio-a', 'Studio A', 'location-a', true
  ),
  (
    '31000000-0000-0000-0000-000000000022',
    '31000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000012',
    'studio-b', 'Studio B', 'location-b', true
  );

insert into public.class_revvi_customers (
  id, auth_user_id, memberstack_customer_id
) values
  (
    '31000000-0000-0000-0000-000000000031',
    '10000000-0000-0000-0000-000000000001',
    'class-member-1'
  ),
  (
    '31000000-0000-0000-0000-000000000032',
    '10000000-0000-0000-0000-000000000004',
    'class-member-4'
  );

insert into public.class_business_customer_access (business_id, customer_id) values (
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000031'
);

insert into public.class_business_staff_access (business_id, user_id) values (
  '31000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002'
);

insert into public.class_customer_provider_profiles (
  id, business_id, customer_id, integration_id, provider_site_id,
  provider_client_id, provider_client_unique_id
) values (
  '31000000-0000-0000-0000-000000000033',
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000031',
  '31000000-0000-0000-0000-000000000011',
  'site-a', 'client-a', 'client-a-unique'
);

select throws_like(
  $$insert into public.class_customer_provider_profiles (
      business_id, customer_id, integration_id, provider_site_id,
      provider_client_id, provider_client_unique_id
    ) values (
      '31000000-0000-0000-0000-000000000002',
      '31000000-0000-0000-0000-000000000031',
      '31000000-0000-0000-0000-000000000012',
      'site-b', 'client-b', 'client-b-unique'
    )$$,
  '%violates foreign key constraint%',
  'a provider Client profile cannot cross into a Business without Customer access'
);

insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids
) values
  (
    '31000000-0000-0000-0000-000000000041',
    '31000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000021',
    'revvi-yoga', 'Revvi Yoga', 'purchase_pricing_option', array['plan-revvi']
  ),
  (
    '31000000-0000-0000-0000-000000000042',
    '31000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000022',
    'revvi-pilates', 'Revvi Pilates', 'existing_entitlement', array['plan-revvi']
  ),
  (
    '31000000-0000-0000-0000-000000000043',
    '31000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000022',
    'revvi-spin', 'Revvi Spin', 'purchase_pricing_option', array['plan-revvi']
  ),
  (
    '31000000-0000-0000-0000-000000000044',
    '31000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000021',
    'revvi-barre', 'Revvi Barre', 'purchase_pricing_option', array['plan-revvi']
  );

insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  provider_service_product_id, validated_at, validation_evidence_digest
) values (
  '31000000-0000-0000-0000-000000000051',
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000041',
  'purchase_pricing_option',
  '31000000-0000-0000-0000-000000000011',
  '31000000-0000-0000-0000-000000000021',
  'service-product-a', now(), repeat('a', 64)
);

insert into public.class_offer_inventory_allowlist (
  id, business_id, mapping_id, entity_kind, provider_entity_id
) values (
  '31000000-0000-0000-0000-000000000061',
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000051',
  'class_description', 'yoga-description-a'
);

update public.class_offer_provider_mappings
set status = 'active'
where id = '31000000-0000-0000-0000-000000000051';

update public.class_revvi_offers
set status = 'active'
where id = '31000000-0000-0000-0000-000000000041';

insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  validated_at, validation_evidence_digest
) values (
  '31000000-0000-0000-0000-000000000052',
  '31000000-0000-0000-0000-000000000002',
  '31000000-0000-0000-0000-000000000042',
  'existing_entitlement',
  '31000000-0000-0000-0000-000000000012',
  '31000000-0000-0000-0000-000000000022',
  now(), repeat('b', 64)
);

insert into public.class_booking_quotes (
  id, business_id, offer_id, mapping_id, integration_id, location_id, customer_id,
  customer_provider_profile_id,
  provider_site_id, provider_location_id, provider_class_id, provider_class_schedule_id,
  provider_client_id, provider_client_unique_id, provider_service_product_id,
  fulfilment_mode, subtotal, discount_total, tax_total, grand_total, currency,
  provider_calculation, quote_fingerprint, expires_at
) values (
  '31000000-0000-0000-0000-000000000071',
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000041',
  '31000000-0000-0000-0000-000000000051',
  '31000000-0000-0000-0000-000000000011',
  '31000000-0000-0000-0000-000000000021',
  '31000000-0000-0000-0000-000000000031',
  '31000000-0000-0000-0000-000000000033',
  'site-a', 'location-a', 'class-occurrence-a', 'schedule-a',
  'client-a', 'client-a-unique', 'service-product-a',
  'purchase_pricing_option', 150.00, 25.00, 0.00, 125.00, 'ZAR',
  'checkout_test_cart', repeat('7', 64),
  now() + interval '10 minutes'
);

select lives_ok(
  $$insert into public.class_booking_quotes (
      id, business_id, offer_id, mapping_id, integration_id, location_id,
      customer_id, customer_provider_profile_id, provider_site_id,
      provider_location_id, provider_class_id, provider_client_id,
      provider_service_product_id, fulfilment_mode, subtotal, discount_total,
      tax_total, grand_total, currency, provider_calculation, quote_fingerprint,
      expires_at
    ) values (
      '31000000-0000-0000-0000-000000000072',
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000041',
      '31000000-0000-0000-0000-000000000051',
      '31000000-0000-0000-0000-000000000011',
      '31000000-0000-0000-0000-000000000021',
      '31000000-0000-0000-0000-000000000031',
      '31000000-0000-0000-0000-000000000033',
      'site-a', 'location-a', 'class-occurrence-without-unique-id', 'client-a',
      'service-product-a', 'purchase_pricing_option',
      150.00, 25.00, 0.00, 125.00, 'ZAR', 'checkout_test_cart',
      repeat('6', 64), now() + interval '10 minutes'
    )$$,
  'a Quote can persist a valid Client.Id when optional Client.UniqueId is absent'
);

select throws_ok(
  $$insert into public.class_booking_quotes (
      business_id, offer_id, mapping_id, integration_id, location_id,
      customer_id, customer_provider_profile_id, provider_site_id,
      provider_location_id, provider_class_id, provider_client_id,
      provider_client_unique_id, provider_service_product_id, fulfilment_mode,
      subtotal, discount_total, tax_total, grand_total, currency,
      provider_calculation, quote_fingerprint, expires_at
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000041',
      '31000000-0000-0000-0000-000000000051',
      '31000000-0000-0000-0000-000000000011',
      '31000000-0000-0000-0000-000000000021',
      '31000000-0000-0000-0000-000000000031',
      '31000000-0000-0000-0000-000000000033',
      'site-a', 'location-a', 'class-occurrence-wrong-unique-id', 'client-a',
      'wrong-unique-id', 'service-product-a', 'purchase_pricing_option',
      150.00, 25.00, 0.00, 125.00, 'ZAR', 'checkout_test_cart',
      repeat('5', 64), now() + interval '10 minutes'
    )$$,
  'Quote Client Unique ID must match its Site-scoped provider profile',
  'a supplied Client.UniqueId cannot contradict the provider profile'
);

insert into public.class_bookings (
  id, business_id, offer_id, quote_id, customer_id, location_id, idempotency_key,
  provider_site_id, provider_location_id,
  provider_class_id, provider_class_schedule_id, provider_class_description_id,
  provider_program_id, provider_session_type_id, provider_client_id,
  provider_client_unique_id, provider_service_product_id, start_datetime,
  price_amount, currency
) values (
  '31000000-0000-0000-0000-000000000081',
  '31000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000041',
  '31000000-0000-0000-0000-000000000071',
  '31000000-0000-0000-0000-000000000031',
  '31000000-0000-0000-0000-000000000021',
  'issue-31-booking-idempotency-a',
  'site-a', 'location-a',
  'class-occurrence-a', 'schedule-a', 'yoga-description-a', 'program-a',
  'session-type-a', 'client-a', 'client-a-unique', 'service-product-a',
  now() + interval '1 day', 125.00, 'ZAR'
);

select is(
  (select status::text from public.class_offer_provider_mappings where id = '31000000-0000-0000-0000-000000000051'),
  'active',
  'a complete validated Class mapping can activate'
);
select is(
  (select status::text from public.class_revvi_offers where id = '31000000-0000-0000-0000-000000000041'),
  'active',
  'a Revvi Offer activates only after its Class mapping is ready'
);
select is(
  (select count(*)::int from public.class_offer_inventory_allowlist where mapping_id = '31000000-0000-0000-0000-000000000051'),
  1,
  'the active Offer is backed by stable approved class-family inventory'
);

select throws_like(
  $$insert into public.class_offer_inventory_allowlist (
      business_id, mapping_id, entity_kind, provider_entity_id
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000051',
      'class', 'occurrence-must-not-map'
    )$$,
  '%invalid input value for enum class_inventory_entity_kind%',
  'a time-specific Class.Id cannot be inserted into the stable allowlist'
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set status = 'active'
    where id = '31000000-0000-0000-0000-000000000052'$$,
  'active Class mapping requires stable approved inventory',
  'an incomplete provider mapping fails closed'
);
select throws_ok(
  $$update public.class_revvi_offers
    set status = 'active'
    where id = '31000000-0000-0000-0000-000000000042'$$,
  'active Revvi Offer requires one complete active Class mapping',
  'an Offer with an incomplete mapping fails closed'
);
insert into public.class_offer_inventory_allowlist (
  id, business_id, mapping_id, entity_kind, provider_entity_id
) values (
  '31000000-0000-0000-0000-000000000062',
  '31000000-0000-0000-0000-000000000002',
  '31000000-0000-0000-0000-000000000052',
  'class_description', 'pilates-description-b'
);
update public.class_businesses
set status = 'disabled'
where id = '31000000-0000-0000-0000-000000000002';
select throws_ok(
  $$update public.class_offer_provider_mappings
    set status = 'active'
    where id = '31000000-0000-0000-0000-000000000052'$$,
  'active Class mapping requires an active Business',
  'a disabled Business cannot activate a new Class mapping'
);
select throws_like(
  $$insert into public.class_revvi_offers (
      business_id, location_id, slug, display_name, fulfilment_mode, eligible_memberstack_plan_ids
    ) values (
      '31000000-0000-0000-0000-000000000002',
      '31000000-0000-0000-0000-000000000022',
      'unknown-mode', 'Unknown Mode', 'magic', array['plan-revvi']
    )$$,
  '%invalid input value for enum class_offer_fulfilment_mode%',
  'unknown fulfilment modes fail closed'
);
select throws_like(
  $$insert into public.class_offer_provider_mappings (
      business_id, offer_id, fulfilment_mode, integration_id, location_id
    ) values (
      '31000000-0000-0000-0000-000000000002',
      '31000000-0000-0000-0000-000000000043',
      'purchase_pricing_option',
      '31000000-0000-0000-0000-000000000012',
      '31000000-0000-0000-0000-000000000022'
    )$$,
  '%violates check constraint%',
  'purchase mode fails closed without one Service.ProductId'
);
select throws_like(
  $$insert into public.class_offer_provider_mappings (
      business_id, offer_id, fulfilment_mode, integration_id, location_id,
      provider_service_product_id
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000044',
      'purchase_pricing_option',
      '31000000-0000-0000-0000-000000000011',
      '31000000-0000-0000-0000-000000000021',
      'service-product-a'
    )$$,
  '%violates unique constraint%',
  'a dedicated paid Service.ProductId cannot be shared by two Offers at one Location'
);
select throws_ok(
  $$update public.class_revvi_offers
    set business_id = '31000000-0000-0000-0000-000000000002'
    where id = '31000000-0000-0000-0000-000000000041'$$,
  'Class ledger business ownership is immutable',
  'Class ledger tenant ownership cannot be reassigned'
);
select throws_ok(
  $$delete from public.class_offer_inventory_allowlist
    where id = '31000000-0000-0000-0000-000000000061'$$,
  'approved inventory is immutable while its Class mapping is active',
  'active Offer inventory cannot drift'
);
select throws_ok(
  $$update public.class_business_integrations
    set status = 'disabled', activated_at = null
    where id = '31000000-0000-0000-0000-000000000011'$$,
  'an integration with active Class mappings cannot be disabled',
  'an integration cannot be disabled beneath an active Class mapping'
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set provider_service_product_id = 'different-product'
    where id = '31000000-0000-0000-0000-000000000051'$$,
  'active Class mapping configuration is immutable',
  'an active paid Offer cannot drift to another Service.ProductId'
);
select throws_ok(
  $$update public.class_revvi_offers
    set eligible_memberstack_plan_ids = array['different-plan']
    where id = '31000000-0000-0000-0000-000000000041'$$,
  'active Revvi Offer configuration is immutable',
  'active Offer eligibility cannot drift to different Memberstack plans'
);
select throws_ok(
  $$update public.class_business_locations
    set enabled = false
    where id = '31000000-0000-0000-0000-000000000021'$$,
  'a Location with active Class mappings cannot be disabled',
  'an active Offer cannot be stranded by disabling its Location'
);
select throws_ok(
  $$update public.class_businesses
    set status = 'disabled'
    where id = '31000000-0000-0000-0000-000000000001'$$,
  'a Business with active Revvi Offers cannot be disabled',
  'an active Offer cannot be stranded by disabling its Business'
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set status = 'disabled'
    where id = '31000000-0000-0000-0000-000000000051'$$,
  'an active Revvi Offer must be disabled before its Class mapping',
  'an active Offer cannot be left pointing at a disabled mapping'
);
select throws_like(
  $$insert into public.class_bookings (
      business_id, offer_id, quote_id, customer_id, location_id, idempotency_key,
      provider_site_id, provider_location_id, provider_class_id, start_datetime
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000041',
      '31000000-0000-0000-0000-000000000071',
      '31000000-0000-0000-0000-000000000031',
      '31000000-0000-0000-0000-000000000021',
      'issue-31-wrong-class-idempotency',
      'site-a', 'location-a', 'different-class-occurrence', now() + interval '1 day'
    )$$,
  '%violates foreign key constraint%',
  'a Booking cannot substitute a different Class.Id after quoting'
);
select throws_like(
  $$insert into public.class_bookings (
      business_id, offer_id, quote_id, customer_id, location_id, idempotency_key,
      provider_site_id, provider_location_id, provider_class_id, start_datetime
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000041',
      '31000000-0000-0000-0000-000000000071',
      '31000000-0000-0000-0000-000000000031',
      '31000000-0000-0000-0000-000000000021',
      'issue-31-wrong-site-idempotency',
      'wrong-site', 'location-a', 'class-occurrence-a', now() + interval '1 day'
    )$$,
  '%violates foreign key constraint%',
  'a Booking provider Site must match its Quote and integration'
);
select throws_like(
  $$insert into public.class_bookings (
      business_id, offer_id, quote_id, customer_id, location_id, idempotency_key,
      provider_site_id, provider_location_id, provider_class_id, start_datetime
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000041',
      '31000000-0000-0000-0000-000000000071',
      '31000000-0000-0000-0000-000000000031',
      '31000000-0000-0000-0000-000000000022',
      'issue-31-wrong-location-idempotency',
      'site-a', 'location-b', 'class-occurrence-a', now() + interval '1 day'
    )$$,
  '%violates foreign key constraint%',
  'a Booking Location must match its Offer and Quote'
);

select throws_like(
  $$insert into public.class_booking_provider_attempts (
      business_id, booking_id, attempt_type, idempotency_key,
      request_fingerprint, error_message
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000081',
      'purchase_booking', 'issue-31-secret-attempt', repeat('c', 64),
      'provider sourcePassword leaked'
    )$$,
  '%violates check constraint%',
  'normalized provider errors reject secret-bearing text'
);
select lives_ok(
  $$insert into public.class_booking_provider_attempts (
      id, business_id, booking_id, attempt_type, idempotency_key, request_fingerprint
    ) values (
      '31000000-0000-0000-0000-000000000091',
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000081',
      'purchase_booking', 'issue-31-provider-write-a', repeat('c', 64)
    )$$,
  'a valid provider attempt is recorded'
);
select is(
  (select count(*)::int from public.class_booking_provider_attempt_history where attempt_id = '31000000-0000-0000-0000-000000000091'),
  1,
  'creating an attempt records its initial durable history'
);
select throws_like(
  $$insert into public.class_booking_provider_attempts (
      business_id, booking_id, attempt_type, idempotency_key, request_fingerprint
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000081',
      'purchase_booking', 'issue-31-provider-write-a', repeat('d', 64)
    )$$,
  '%violates unique constraint%',
  'a repeated provider-write idempotency key cannot create another attempt'
);
select throws_like(
  $$insert into public.class_booking_provider_diagnostics (
      business_id, attempt_id, diagnostic_kind, endpoint_name, created_at, expires_at
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000091',
      'response_summary', 'CheckoutShoppingCart', now(), now() + interval '49 hours'
    )$$,
  '%violates check constraint%',
  'provider diagnostics cannot outlive the 48-hour retention window'
);
select lives_ok(
  $$insert into public.class_booking_provider_diagnostics (
      id, business_id, attempt_id, diagnostic_kind, endpoint_name, created_at, expires_at
    ) values (
      '31000000-0000-0000-0000-000000000092',
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000091',
      'response_summary', 'CheckoutShoppingCart', now() - interval '2 hours', now() - interval '1 hour'
    )$$,
  'an expired allowlisted diagnostic can be selected for retention cleanup'
);
select is(
  (select count(*)::int from cron.job where jobname = 'class-provider-diagnostics-retention'),
  1,
  'the 48-hour diagnostics deletion job is scheduled'
);
select is(
  public.purge_expired_class_provider_diagnostics(),
  1::bigint,
  'the retention job deletes expired provider diagnostics'
);
select lives_ok(
  $$update public.class_booking_provider_attempts
    set status = 'requires_action'
    where id = '31000000-0000-0000-0000-000000000091'$$,
  'a valid provider attempt transition succeeds'
);
select is(
  (select count(*)::int from public.class_booking_provider_attempt_history where attempt_id = '31000000-0000-0000-0000-000000000091'),
  2,
  'each provider attempt transition appends history'
);
select throws_ok(
  $$update public.class_booking_provider_attempts
    set status = 'pending'
    where id = '31000000-0000-0000-0000-000000000091'$$,
  'invalid Class provider attempt transition from requires_action to pending',
  'provider attempts cannot transition backwards'
);
select throws_ok(
  $$delete from public.class_booking_provider_attempt_history
    where attempt_id = '31000000-0000-0000-0000-000000000091'$$,
  'Class provider attempt history is append-only',
  'provider attempt history cannot be erased'
);
select throws_ok(
  $$update public.class_bookings
    set status = 'cancel_pending'
    where id = '31000000-0000-0000-0000-000000000081'$$,
  'invalid Class Booking transition from pending to cancel_pending',
  'Class Bookings cannot enter cancellation before provider submission'
);
select throws_ok(
  $$update public.class_bookings
    set payment_status = 'paid'
    where id = '31000000-0000-0000-0000-000000000081'$$,
  'invalid Class payment transition from unknown to paid',
  'Class payment facts cannot skip provider evidence'
);
select throws_like(
  $$insert into public.class_booking_quotes (
      business_id, offer_id, mapping_id, integration_id, location_id, customer_id,
      customer_provider_profile_id,
      provider_site_id, provider_location_id, provider_class_id, provider_client_id,
      provider_client_unique_id,
      provider_service_product_id, fulfilment_mode, subtotal, discount_total,
      tax_total, grand_total, currency, provider_calculation, quote_fingerprint,
      expires_at
    ) values (
      '31000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000041',
      '31000000-0000-0000-0000-000000000051',
      '31000000-0000-0000-0000-000000000011',
      '31000000-0000-0000-0000-000000000021',
      '31000000-0000-0000-0000-000000000031',
      '31000000-0000-0000-0000-000000000033',
      'site-a', 'location-a', 'class-occurrence-late', 'client-a', 'client-a-unique',
      'service-product-a',
      'purchase_pricing_option', 150.00, 25.00, 0.00, 125.00, 'ZAR',
      'checkout_test_cart', repeat('8', 64), now() + interval '20 minutes'
    )$$,
  '%violates check constraint%',
  'provider-calculated Quotes are short-lived'
);

select is(
  has_table_privilege('authenticated', 'public.class_bookings', 'insert'),
  false,
  'browser sessions cannot write Class Bookings directly'
);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '10000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'app_metadata', json_build_object('memberstack_customer_id', 'class-member-1')
  )::text,
  false
);
set role authenticated;

select is((select count(*)::int from public.class_businesses), 1, 'a Revvi Customer sees only its approved partner Business');
select is((select count(*)::int from public.class_business_locations), 1, 'a Revvi Customer sees only the selected partner Location');
select is((select count(*)::int from public.class_revvi_offers), 1, 'a Revvi Customer sees only active eligible-scope Offers');
select is((select count(*)::int from public.class_bookings), 1, 'a Revvi Customer sees only its own Class Bookings');
select is((select count(*)::int from public.class_offer_provider_mappings), 0, 'provider mapping details are hidden from Customers');
select is((select count(*)::int from public.class_business_integrations), 0, 'provider integration details are hidden from Customers');
select is((select count(*)::int from public.class_customer_provider_profiles), 0, 'Site-scoped provider Client profiles are hidden from Customers');

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '10000000-0000-0000-0000-000000000004',
    'role', 'authenticated',
    'app_metadata', json_build_object('memberstack_customer_id', 'class-member-4')
  )::text,
  false
);
select is((select count(*)::int from public.class_businesses), 0, 'a Customer without a partner grant cannot cross tenant boundaries');

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '10000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  false
);
select is((select count(*)::int from public.class_businesses), 1, 'partner staff are scoped to their own Business');
select is((select count(*)::int from public.class_offer_provider_mappings), 1, 'partner staff can inspect their own Class mapping');
select is((select count(*)::int from public.class_customer_provider_profiles), 1, 'partner staff can inspect only their Site-scoped Customer profiles');

set role postgres;

select * from finish();
rollback;

begin;

select plan(24);

select has_table('public', 'class_client_resolution_support_work', 'ambiguous Client resolution has durable support work');
select has_table('public', 'class_quote_provider_diagnostics', 'quote provider calls have bounded diagnostics');
select has_function('public', 'resolve_class_booking_quote_context', array['uuid', 'uuid'], 'quote context resolves atomically');
select has_function('public', 'persist_class_customer_provider_profile', array['uuid', 'uuid', 'uuid', 'text', 'text', 'text'], 'Site-scoped Client identity persists atomically');
select has_column('public', 'class_booking_quotes', 'mapping_version', 'quotes bind the exact Offer mapping version');

insert into public.class_businesses (id, slug, display_name, status)
values ('35000000-0000-4000-8000-000000000001', 'issue-35', 'Issue 35', 'active');
insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at,
  allow_client_creation, client_creation_evidence_digest
) values (
  '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  'sandbox', '-35001', 'active', now(), false, null
);
insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values (
  '35000000-0000-4000-8000-000000000021', '35000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000011', 'rosebank', 'Rosebank', 'Africa/Johannesburg', '7', true
);
insert into public.class_revvi_customers (
  id, memberstack_customer_id, email, first_name, last_name, subscription_status, memberstack_plan_ids
) values
  ('35000000-0000-4000-8000-000000000031', 'member-35-a', 'a@example.com', 'Ava', 'Ndlovu', 'active', array['plan-revvi']),
  ('35000000-0000-4000-8000-000000000032', 'member-35-b', 'b@example.com', 'Bo', 'Dube', 'active', array['plan-revvi']);
insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status, cancellation_policy_text, cancellation_policy_certainty
) values (
  '35000000-0000-4000-8000-000000000041', '35000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000021', 'revvi-yoga', 'Revvi Yoga',
  'purchase_pricing_option', array['plan-revvi'], 'draft', 'Cancel with the studio.', 'studio_reported'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  provider_service_product_id, status, validated_at, validation_evidence_digest,
  mode_verified_at, mode_evidence_digest
) values (
  '35000000-0000-4000-8000-000000000051', '35000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000041', 'purchase_pricing_option',
  '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000021',
  'product-revvi', 'draft', now(), repeat('a', 64), now(), repeat('b', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000051', 'location', '7'),
  ('35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000051', 'program', '11'),
  ('35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000051', 'class_description', '13'),
  ('35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000051', 'session_type', '23');
update public.class_offer_provider_mappings set status = 'active' where id = '35000000-0000-4000-8000-000000000051';
update public.class_revvi_offers set status = 'active' where id = '35000000-0000-4000-8000-000000000041';

select is(
  (select count(*)::int from public.resolve_class_booking_quote_context(
    '35000000-0000-4000-8000-000000000041', '35000000-0000-4000-8000-000000000031'
  )), 1, 'active exact Offer quote context resolves once'
);
select is(
  (select provider_site_id from public.resolve_class_booking_quote_context(
    '35000000-0000-4000-8000-000000000041', '35000000-0000-4000-8000-000000000031'
  )), '-35001', 'quote context stays scoped to the Business Mindbody Site'
);
select ok(
  (select mode_evidence_verified from public.resolve_class_booking_quote_context(
    '35000000-0000-4000-8000-000000000041', '35000000-0000-4000-8000-000000000031'
  )), 'mode-specific controlled evidence is explicit'
);
update public.class_revvi_offers set status = 'inactive'
where id = '35000000-0000-4000-8000-000000000041';
update public.class_offer_provider_mappings set status = 'draft'
where id = '35000000-0000-4000-8000-000000000051';
update public.class_offer_provider_mappings
set provider_service_product_id = 'changed-product'
where id = '35000000-0000-4000-8000-000000000051';
select is(
  (select mode_evidence_digest from public.class_offer_provider_mappings
   where id = '35000000-0000-4000-8000-000000000051'),
  null,
  'a material Offer mapping change invalidates its mode evidence'
);
update public.class_offer_provider_mappings
set provider_service_product_id = 'product-revvi'
where id = '35000000-0000-4000-8000-000000000051';
update public.class_offer_provider_mappings
set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
where id = '35000000-0000-4000-8000-000000000051';
update public.class_offer_provider_mappings set status = 'active'
where id = '35000000-0000-4000-8000-000000000051';
update public.class_revvi_offers set status = 'active'
where id = '35000000-0000-4000-8000-000000000041';

select is(
  (select provider_client_id from public.persist_class_customer_provider_profile(
    '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000031',
    '35000000-0000-4000-8000-000000000011', '-35001', 'rss-35-a', 'unique-35-a'
  )), 'rss-35-a', 'the Site-scoped Client RSSID is persisted'
);
select is(
  (select provider_client_unique_id from public.persist_class_customer_provider_profile(
    '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000031',
    '35000000-0000-4000-8000-000000000011', '-35001', 'rss-35-a', 'unique-35-a'
  )), 'unique-35-a', 'replaying the exact identity is safe'
);
select throws_ok(
  $$select * from public.persist_class_customer_provider_profile(
    '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000031',
    '35000000-0000-4000-8000-000000000011', '-35001', 'attacker-rssid', 'attacker-unique'
  )$$,
  'existing Site-scoped Client identity cannot be overwritten',
  'a stored Client identity cannot be reassigned'
);

insert into public.class_booking_quotes (
  id, business_id, offer_id, mapping_id, mapping_version, integration_id, location_id,
  customer_id, customer_provider_profile_id, provider_site_id, provider_location_id,
  provider_class_id, provider_client_id, provider_client_unique_id,
  provider_service_product_id, fulfilment_mode, subtotal, discount_total, tax_total,
  grand_total, currency, provider_calculation, quote_fingerprint, expires_at
) values (
  '35000000-0000-4000-8000-000000000061', '35000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000041', '35000000-0000-4000-8000-000000000051',
  (select mapping_version from public.class_offer_provider_mappings where id = '35000000-0000-4000-8000-000000000051'),
  '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000021',
  '35000000-0000-4000-8000-000000000031',
  (select id from public.class_customer_provider_profiles where provider_client_id = 'rss-35-a'),
  '-35001', '7', '771', 'rss-35-a', 'unique-35-a', 'product-revvi',
  'purchase_pricing_option', 120, 20, 15, 115, 'ZAR', 'checkout_test_cart', repeat('c', 64), now() + interval '5 minutes'
);
select is((select status::text from public.class_booking_quotes where id = '35000000-0000-4000-8000-000000000061'), 'open', 'a Test cart creates only an open quote');
select is((select count(*)::int from public.class_bookings where quote_id = '35000000-0000-4000-8000-000000000061'), 0, 'a Test cart never creates or confirms a Booking');

select throws_ok(
  $$insert into public.class_bookings (
    business_id, offer_id, quote_id, customer_id, location_id, idempotency_key,
    provider_site_id, provider_location_id, provider_class_id, start_datetime
  ) values (
    '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000041',
    '35000000-0000-4000-8000-000000000061', '35000000-0000-4000-8000-000000000032',
    '35000000-0000-4000-8000-000000000021', 'issue-35-customer-substitution',
    '-35001', '7', '771', now() + interval '1 day'
  )$$,
  '23503', null,
  'a quote cannot be consumed by another Customer'
);
select throws_ok(
  $$insert into public.class_bookings (
    business_id, offer_id, quote_id, customer_id, location_id, idempotency_key,
    provider_site_id, provider_location_id, provider_class_id, start_datetime
  ) values (
    '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000041',
    '35000000-0000-4000-8000-000000000061', '35000000-0000-4000-8000-000000000031',
    '35000000-0000-4000-8000-000000000021', 'issue-35-class-substitution',
    '-35001', '7', '772', now() + interval '1 day'
  )$$,
  '23503', null,
  'a quote cannot be consumed against another Class occurrence'
);
select throws_ok(
  $$update public.class_booking_quotes set mapping_version = 99
    where id = '35000000-0000-4000-8000-000000000061'$$,
  'Quote ownership and binding facts are immutable',
  'mapping-version binding cannot be altered after quote creation'
);

insert into public.class_client_resolution_support_work (
  business_id, integration_id, customer_id, reason_code, candidate_count
) values (
  '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000011',
  '35000000-0000-4000-8000-000000000032', 'MULTIPLE_EXACT_CLIENTS', 2
);
insert into public.class_quote_provider_diagnostics (
  business_id, offer_id, location_id, mapping_id, customer_id, endpoint_name,
  request_id, status_code, duration_ms, success
) values (
  '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000041',
  '35000000-0000-4000-8000-000000000021', '35000000-0000-4000-8000-000000000051',
  '35000000-0000-4000-8000-000000000031', 'sale/checkoutshoppingcart',
  'request-35', 200, 25, true
);
select is((select count(*)::int from public.class_quote_provider_diagnostics where expires_at <= created_at + interval '48 hours'), 1, 'quote diagnostics expire within 48 hours');
select is((select count(*)::int from public.class_client_resolution_support_work where status = 'open'), 1, 'ambiguity creates open support work');
select is(has_table_privilege('authenticated', 'public.class_client_resolution_support_work', 'insert'), false, 'browser sessions cannot fabricate Client support work');
select is(has_table_privilege('authenticated', 'public.class_quote_provider_diagnostics', 'insert'), false, 'browser sessions cannot fabricate quote diagnostics');
select is(has_function_privilege('authenticated', 'public.persist_class_customer_provider_profile(uuid,uuid,uuid,text,text,text)', 'EXECUTE'), false, 'browser sessions cannot persist provider identities');

select throws_ok(
  $$update public.class_business_integrations set allow_client_creation = true
    where id = '35000000-0000-4000-8000-000000000011'$$,
  '23514', null,
  'Client creation cannot be enabled without an evidence digest'
);

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'app_metadata', json_build_object())::text, false);
set role authenticated;
select is((select count(*)::int from public.class_client_resolution_support_work), 0, 'Customers cannot read Client ambiguity support work');
set role postgres;

select * from finish();
rollback;

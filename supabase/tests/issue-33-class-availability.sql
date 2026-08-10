begin;

select plan(16);

select has_table('public', 'class_availability_provider_diagnostics', 'Class read diagnostics have bounded storage');
select has_function('public', 'resolve_class_availability_context', array['text', 'uuid', 'uuid', 'uuid'], 'availability context is resolved atomically');
select has_function('public', 'purge_expired_class_provider_diagnostics', 'one retention function covers Class provider diagnostics');
select is(
  (select count(*)::int from pg_enum item
   join pg_type type on type.oid = item.enumtypid
   where type.typname = 'class_inventory_entity_kind' and item.enumlabel = 'class'),
  0,
  'time-specific Class IDs cannot be stored in the Offer inventory allowlist'
);

insert into public.class_businesses (id, slug, display_name, status)
values
  ('33000000-0000-4000-8000-000000000001', 'issue-33-a', 'Issue 33 A', 'active'),
  ('33000000-0000-4000-8000-000000000002', 'issue-33-b', 'Issue 33 B', 'active');

insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values
  ('33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000001', 'sandbox', '-33001', 'active', now()),
  ('33000000-0000-4000-8000-000000000012', '33000000-0000-4000-8000-000000000002', 'sandbox', '-33002', 'active', now());

insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values
  ('33000000-0000-4000-8000-000000000021', '33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000011', 'rosebank', 'Rosebank', 'Africa/Johannesburg', '7', true),
  ('33000000-0000-4000-8000-000000000022', '33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000012', 'sea-point', 'Sea Point', 'Africa/Johannesburg', '8', true);

insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values
  ('33000000-0000-4000-8000-000000000031', '33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000021', 'revvi-yoga', 'Revvi Yoga', 'purchase_pricing_option', array['plan-revvi'], 'draft'),
  ('33000000-0000-4000-8000-000000000032', '33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000022', 'revvi-pilates', 'Revvi Pilates', 'approved_unpaid', array['plan-revvi'], 'draft');

insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  provider_service_product_id, status, validated_at, validation_evidence_digest
) values
  ('33000000-0000-4000-8000-000000000041', '33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000031', 'purchase_pricing_option', '33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000021', 'product-revvi', 'draft', now(), repeat('a', 64)),
  ('33000000-0000-4000-8000-000000000042', '33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000032', 'approved_unpaid', '33000000-0000-4000-8000-000000000012', '33000000-0000-4000-8000-000000000022', null, 'draft', now(), repeat('b', 64));

insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000041', 'location', '7'),
  ('33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000041', 'program', '11'),
  ('33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000041', 'class_description', '13'),
  ('33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000041', 'session_type', '23'),
  ('33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000041', 'class_schedule', '17'),
  ('33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000042', 'location', '8'),
  ('33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000042', 'program', '12'),
  ('33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000042', 'class_description', '14'),
  ('33000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000042', 'session_type', '24');

update public.class_offer_provider_mappings set status = 'active'
where id in ('33000000-0000-4000-8000-000000000041', '33000000-0000-4000-8000-000000000042');
update public.class_revvi_offers set status = 'active'
where id = '33000000-0000-4000-8000-000000000031';

select is(
  (select count(*)::int from public.resolve_class_availability_context(
    'issue-33-a',
    '33000000-0000-4000-8000-000000000021',
    '33000000-0000-4000-8000-000000000031',
    null
  )),
  1,
  'an exact active Business, Location, Offer, integration, and mapping resolve once'
);
select is(
  (select provider_site_id from public.resolve_class_availability_context(
    'issue-33-a',
    '33000000-0000-4000-8000-000000000021',
    '33000000-0000-4000-8000-000000000031',
    null
  )),
  '-33001',
  'the provider Site remains scoped to the selected Business'
);
select is(
  (select inventory_allowlist -> 'classDescription' from public.resolve_class_availability_context(
    'issue-33-a',
    '33000000-0000-4000-8000-000000000021',
    '33000000-0000-4000-8000-000000000031',
    null
  )),
  '["13"]'::jsonb,
  'stable Class Description IDs are returned as the Offer allowlist'
);
select is(
  (select inventory_allowlist -> 'classSchedule' from public.resolve_class_availability_context(
    'issue-33-a',
    '33000000-0000-4000-8000-000000000021',
    '33000000-0000-4000-8000-000000000031',
    null
  )),
  '["17"]'::jsonb,
  'Class Schedule narrowing is optional and explicit'
);
select is(
  (select count(*)::int from public.resolve_class_availability_context(
    'issue-33-a',
    '33000000-0000-4000-8000-000000000022',
    '33000000-0000-4000-8000-000000000031',
    null
  )),
  0,
  'a Location from another Business cannot be substituted'
);
select is(
  (select count(*)::int from public.resolve_class_availability_context(
    'issue-33-b',
    '33000000-0000-4000-8000-000000000021',
    '33000000-0000-4000-8000-000000000031',
    null
  )),
  0,
  'a Business slug cannot be mixed with another tenant Offer'
);

insert into public.class_availability_provider_diagnostics (
  business_id, offer_id, location_id, mapping_id, endpoint_name, request_id,
  status_code, duration_ms, success, error_code
) values (
  '33000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000031',
  '33000000-0000-4000-8000-000000000021',
  '33000000-0000-4000-8000-000000000041',
  'class/classes', 'request-33', 200, 25, true, null
);
select is(
  (select count(*)::int from public.class_availability_provider_diagnostics
   where expires_at <= created_at + interval '48 hours'),
  1,
  'temporary availability diagnostics cannot outlive 48 hours'
);
select is(
  has_table_privilege('authenticated', 'public.class_availability_provider_diagnostics', 'insert'),
  false,
  'browser sessions cannot fabricate provider diagnostics'
);

select set_config(
  'request.jwt.claims',
  json_build_object('role', 'authenticated', 'app_metadata', json_build_object())::text,
  false
);
set role authenticated;
select is((select count(*)::int from public.class_availability_provider_diagnostics), 0, 'Customers cannot read provider diagnostics');

select set_config(
  'request.jwt.claims',
  json_build_object('role', 'authenticated', 'app_metadata', json_build_object('platform_operations', true))::text,
  false
);
select is((select count(*)::int from public.class_availability_provider_diagnostics), 1, 'platform operations can read provider diagnostics');

set role postgres;

insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values (
  '33000000-0000-4000-8000-000000000033',
  '33000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000021',
  'unsafe-inventory', 'Unsafe Inventory', 'approved_unpaid', array['plan-revvi'], 'draft'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  status, validated_at, validation_evidence_digest
) values (
  '33000000-0000-4000-8000-000000000043',
  '33000000-0000-4000-8000-000000000001',
  '33000000-0000-4000-8000-000000000033',
  'approved_unpaid',
  '33000000-0000-4000-8000-000000000011',
  '33000000-0000-4000-8000-000000000021',
  'draft', now(), repeat('c', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values ('33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000043', 'program', '11');
select throws_ok(
  $$update public.class_offer_provider_mappings set status = 'active'
    where id = '33000000-0000-4000-8000-000000000043'$$,
  'active Class mapping requires Location, Program, Class Description, and Session Type inventory',
  'an incomplete inventory allowlist cannot activate'
);

select throws_ok(
  $$insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
    values ('33000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000041', 'location', '8')$$,
  'approved inventory is immutable while its Class mapping is active',
  'active Offer inventory remains immutable'
);

select * from finish();
rollback;

begin;

select plan(12);

select has_table('public', 'class_offer_families', 'Class families are stored as first-class Offer configuration');
select has_table('public', 'class_family_provider_mappings', 'Class family mappings preserve correlated provider tuples');
select has_table('public', 'class_offer_pricing_options', 'paid Offers have an explicit Mindbody Product set');
select has_function(
  'public',
  'resolve_class_availability_families',
  array['uuid', 'uuid', 'uuid'],
  'the family catalogue is resolved through one scoped database function'
);
select has_column(
  'public',
  'class_booking_quotes',
  'class_family_id',
  'quotes can persist the selected Class family'
);

insert into public.class_businesses (id, slug, display_name, status)
values
  ('43000000-0000-4000-8000-000000000001', 'issue-43-a', 'Issue 43 A', 'active'),
  ('43000000-0000-4000-8000-000000000002', 'issue-43-b', 'Issue 43 B', 'active');

insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values
  ('43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000001', 'sandbox', '-43001', 'active', now()),
  ('43000000-0000-4000-8000-000000000012', '43000000-0000-4000-8000-000000000002', 'sandbox', '-43002', 'active', now());

insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values
  ('43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000011', 'rosebank', 'Rosebank', 'Africa/Johannesburg', '4301', true),
  ('43000000-0000-4000-8000-000000000022', '43000000-0000-4000-8000-000000000002', '43000000-0000-4000-8000-000000000012', 'sea-point', 'Sea Point', 'Africa/Johannesburg', '4302', true);

insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values
  ('43000000-0000-4000-8000-000000000031', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000021', 'issue-43-yoga', 'Issue 43 Yoga', 'approved_unpaid', array['plan-issue-43'], 'draft');

insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  provider_service_product_id, status, validated_at, validation_evidence_digest
) values
  ('43000000-0000-4000-8000-000000000041', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000031', 'approved_unpaid', '43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000021', null, 'draft', now(), repeat('4', 64));

insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000041', 'location', '4301'),
  ('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000041', 'program', '4311'),
  ('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000041', 'class_description', '4313'),
  ('43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000041', 'session_type', '4323');

update public.class_offer_provider_mappings
set status = 'active'
where id = '43000000-0000-4000-8000-000000000041';
update public.class_offer_provider_mappings
set approved_unpaid_enabled = true
where id = '43000000-0000-4000-8000-000000000041';
insert into public.class_approved_unpaid_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
)
select
  mapping.business_id, mapping.id, mapping.mapping_version, evidence.kind,
  encode(extensions.digest(mapping.id::text || evidence.kind::text, 'sha256'), 'hex'), now()
from public.class_offer_provider_mappings mapping
cross join unnest(enum_range(null::public.class_approved_unpaid_evidence_kind)) evidence(kind)
where mapping.id = '43000000-0000-4000-8000-000000000041'
  and evidence.kind <> 'booking_reconciliation';
insert into public.class_approved_unpaid_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
)
select business_id, id, mapping_version, 'booking_reconciliation', repeat('5', 64), now()
from public.class_offer_provider_mappings
where id = '43000000-0000-4000-8000-000000000041';
update public.class_offer_provider_mappings
set mode_verified_at = now(), mode_evidence_digest = repeat('6', 64)
where id = '43000000-0000-4000-8000-000000000041';
update public.class_revvi_offers
set status = 'active'
where id = '43000000-0000-4000-8000-000000000031';

insert into public.class_offer_families (
  id, business_id, offer_id, location_id, mapping_id, slug, display_name, description, display_order, status
) values
  ('43000000-0000-4000-8000-000000000051', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000031', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000041', 'morning-flow', 'Morning Flow', 'Early morning sessions', 2, 'draft'),
  ('43000000-0000-4000-8000-000000000052', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000031', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000041', 'evening-flow', 'Evening Flow', 'After-work sessions', 1, 'draft');

insert into public.class_family_provider_mappings (
  id, business_id, class_family_id, provider_location_id, provider_class_description_id,
  provider_program_id, provider_session_type_id, provider_class_schedule_id, status
) values
  ('43000000-0000-4000-8000-000000000061', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000051', '4301', '4313', '4311', '4323', '4306', 'active'),
  ('43000000-0000-4000-8000-000000000062', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000052', '4301', '4313', '4311', '4323', null, 'active');

update public.class_offer_families
set status = 'active'
where id in (
  '43000000-0000-4000-8000-000000000051',
  '43000000-0000-4000-8000-000000000052'
);

select is(
  (select count(*)::int from public.resolve_class_availability_families(
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000021',
    '43000000-0000-4000-8000-000000000031'
  )),
  2,
  'the scoped catalogue returns every active family for the selected Offer'
);
select is(
  (select family_slug from public.resolve_class_availability_families(
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000021',
    '43000000-0000-4000-8000-000000000031'
  ) limit 1),
  'evening-flow',
  'families are ordered by their configured display order'
);
select is(
  (select provider_mappings -> 0 ->> 'providerClassScheduleId'
   from public.resolve_class_availability_families(
     '43000000-0000-4000-8000-000000000001',
     '43000000-0000-4000-8000-000000000021',
     '43000000-0000-4000-8000-000000000031'
   ) where family_id = '43000000-0000-4000-8000-000000000051'),
  '4306',
  'the family result preserves the correlated provider schedule tuple'
);
select is(
  (select count(*)::int from public.resolve_class_availability_families(
    '43000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000022',
    '43000000-0000-4000-8000-000000000031'
  )),
  0,
  'a Location from another Business cannot resolve the families'
);
select is(
  (select count(*)::int from public.resolve_class_availability_families(
    '43000000-0000-4000-8000-000000000002',
    '43000000-0000-4000-8000-000000000021',
    '43000000-0000-4000-8000-000000000031'
  )),
  0,
  'a Business from another tenant cannot resolve the families'
);

insert into public.class_offer_families (
  id, business_id, offer_id, location_id, mapping_id, slug, display_name, display_order, status
) values (
  '43000000-0000-4000-8000-000000000053', '43000000-0000-4000-8000-000000000001', '43000000-0000-4000-8000-000000000031', '43000000-0000-4000-8000-000000000021', '43000000-0000-4000-8000-000000000041', 'missing-provider-map', 'Missing Provider Map', 3, 'draft'
);
select throws_ok(
  $$update public.class_offer_families set status = 'active' where id = '43000000-0000-4000-8000-000000000053'$$,
  'an active Class family requires an active provider mapping',
  'a family without an active provider mapping cannot activate'
);

select throws_ok(
  $$insert into public.class_family_provider_mappings (
      business_id, class_family_id, provider_location_id, provider_class_description_id,
      provider_program_id, provider_session_type_id, status
    ) values (
      '43000000-0000-4000-8000-000000000002',
      '43000000-0000-4000-8000-000000000051',
      '4302', '4313', '4311', '4323', 'draft'
    )$$,
  'insert or update on table "class_family_provider_mappings" violates foreign key constraint "class_family_provider_mappings_business_id_class_family_id_fkey"',
  'a family provider mapping cannot cross the Business boundary'
);

select * from finish();
rollback;

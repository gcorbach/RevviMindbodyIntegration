begin;

select plan(38);

create function pg_temp.issue_41_create_pilot_scope(
  candidate_business_id uuid,
  candidate_integration_id uuid,
  candidate_location_id uuid,
  candidate_offer_id uuid,
  candidate_mapping_id uuid,
  candidate_slug text,
  candidate_site_id text,
  candidate_provider_location_id text,
  candidate_mode public.class_offer_fulfilment_mode,
  candidate_product_id text,
  candidate_plan_id text
)
returns void
language plpgsql
as $$
begin
  insert into public.class_businesses (id, slug, display_name, status)
  values (candidate_business_id, candidate_slug, candidate_slug, 'active');
  insert into public.class_business_integrations (
    id, business_id, environment, provider_site_id, status, activated_at,
    mindbody_api_product, chargeable_location_count
  ) values (
    candidate_integration_id, candidate_business_id, 'sandbox', candidate_site_id,
    'active', now(), 'public_api_consumer_booking', 1
  );
  insert into public.class_business_locations (
    id, business_id, integration_id, slug, display_name, timezone,
    provider_location_id, enabled
  ) values (
    candidate_location_id, candidate_business_id, candidate_integration_id,
    candidate_slug || '-location', candidate_slug || ' Location',
    'Africa/Johannesburg', candidate_provider_location_id, true
  );
  insert into public.class_revvi_offers (
    id, business_id, location_id, slug, display_name, fulfilment_mode,
    eligible_memberstack_plan_ids, status
  ) values (
    candidate_offer_id, candidate_business_id, candidate_location_id,
    candidate_slug || '-offer', candidate_slug || ' Offer', candidate_mode,
    array[candidate_plan_id], 'draft'
  );
  insert into public.class_offer_provider_mappings (
    id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
    provider_service_product_id, status, validated_at, validation_evidence_digest
  ) values (
    candidate_mapping_id, candidate_business_id, candidate_offer_id, candidate_mode,
    candidate_integration_id, candidate_location_id, candidate_product_id,
    'draft', now(), repeat('a', 64)
  );
  insert into public.class_offer_inventory_allowlist (
    business_id, mapping_id, entity_kind, provider_entity_id
  ) values
    (candidate_business_id, candidate_mapping_id, 'location', candidate_provider_location_id),
    (candidate_business_id, candidate_mapping_id, 'program', '11'),
    (candidate_business_id, candidate_mapping_id, 'class_description', '13'),
    (candidate_business_id, candidate_mapping_id, 'session_type', '23');
end;
$$;

select has_table('public', 'class_pilot_evidence', 'controlled Class pilot evidence is durable');
select has_table('public', 'class_pilot_readiness', 'Class pilot activation has an environment-scoped ledger');
select has_column('public', 'class_offer_provider_mappings', 'pilot_write_enabled', 'each Offer mapping has a fail-closed write gate');
select has_column('public', 'class_business_integrations', 'mindbody_api_product', 'the confirmed Mindbody API product is typed');
select has_column('public', 'class_business_integrations', 'chargeable_location_count', 'the effective commercial Location count is typed');
select hasnt_column('public', 'class_pilot_evidence', 'payload', 'raw provider payloads are not retained as readiness evidence');
select has_function('public', 'record_class_pilot_evidence', array['uuid','class_pilot_evidence_kind','text','text','text','timestamp with time zone'], 'operators record typed digest-only evidence');
select has_function('public', 'activate_class_pilot', array['uuid'], 'operators activate one exact Offer mapping');
select has_function('public', 'deactivate_class_pilot', array['uuid','text'], 'operators can fail closed without deleting evidence');
select has_function('public', 'revoke_class_pilot_evidence', array['uuid','text'], 'operators can revoke a controlled proof');
select has_function('public', 'assert_class_pilot_write_ready', array['uuid'], 'the provider-write seam checks pilot activation');
select is(
  (select count(*) from public.class_pilot_readiness),
  0::bigint,
  'seed data never claims controlled Class pilot readiness'
);
select is(
  (select count(*) from public.class_offer_provider_mappings where pilot_write_enabled),
  0::bigint,
  'seed data never opens a Class provider-write gate'
);

do $$ begin
  perform pg_temp.issue_41_create_pilot_scope(
    '41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000011',
    '41000000-0000-4000-8000-000000000021', '41000000-0000-4000-8000-000000000041',
    '41000000-0000-4000-8000-000000000051', 'issue-41', '-41001', '7',
    'existing_entitlement', null, 'plan-revvi-pilot'
  );
end $$;
update public.class_offer_provider_mappings set status = 'active'
where id = '41000000-0000-4000-8000-000000000051';
insert into public.class_existing_entitlement_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
)
select mapping.business_id, mapping.id, mapping.mapping_version, evidence.kind,
  encode(extensions.digest(mapping.id::text || evidence.kind::text, 'sha256'), 'hex'), now()
from public.class_offer_provider_mappings mapping
cross join unnest(enum_range(null::public.class_existing_entitlement_evidence_kind)) evidence(kind)
where mapping.id = '41000000-0000-4000-8000-000000000051';
update public.class_offer_provider_mappings
set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
where id = '41000000-0000-4000-8000-000000000051';
update public.class_revvi_offers set status = 'active'
where id = '41000000-0000-4000-8000-000000000041';

select is(
  (select pilot_write_enabled from public.class_offer_provider_mappings where id = '41000000-0000-4000-8000-000000000051'),
  false,
  'a fully configured Offer remains write-disabled before pilot evidence'
);
select throws_ok(
  $$select public.activate_class_pilot('41000000-0000-4000-8000-000000000051')$$,
  'Class pilot evidence is incomplete',
  'missing controlled evidence blocks activation'
);
select throws_ok(
  $$select public.assert_class_pilot_write_ready('41000000-0000-4000-8000-000000000051')$$,
  'Class pilot is not active for this Offer mapping',
  'the provider-write boundary fails closed before activation'
);

select lives_ok(
  $$select public.record_class_pilot_evidence(
    '41000000-0000-4000-8000-000000000051', evidence.kind,
    encode(extensions.digest('issue-41:' || evidence.kind::text, 'sha256'), 'hex'),
    'controlled/issue-41/' || evidence.kind::text, 'platform-operations', now()
  ) from unnest(enum_range(null::public.class_pilot_evidence_kind)) evidence(kind)$$,
  'each mandatory readiness fact can be recorded as a typed digest-only reference'
);
select is(
  (select count(*)::integer from public.class_pilot_evidence where mapping_id = '41000000-0000-4000-8000-000000000051' and revoked_at is null),
  cardinality(enum_range(null::public.class_pilot_evidence_kind)),
  'every mandatory evidence kind is present exactly once'
);
select throws_ok(
  $$update public.class_pilot_evidence set artifact_digest = repeat('f', 64)
    where mapping_id = '41000000-0000-4000-8000-000000000051'
      and evidence_kind = 'site_activation'$$,
  'Class pilot evidence facts are immutable; revoke and record a new result',
  'controlled evidence cannot be rewritten after recording'
);
select lives_ok(
  $$select public.activate_class_pilot('41000000-0000-4000-8000-000000000051')$$,
  'the exact verified mapping activates only after every controlled check'
);
select is(
  (select pilot_write_enabled from public.class_offer_provider_mappings where id = '41000000-0000-4000-8000-000000000051'),
  true,
  'activation opens the provider-write gate for the exact mapping'
);
select lives_ok(
  $$select public.assert_class_pilot_write_ready('41000000-0000-4000-8000-000000000051')$$,
  'the provider-write boundary accepts the activated mapping'
);
select lives_ok(
  $$select public.revoke_class_pilot_evidence(
    (select id from public.class_pilot_evidence
     where mapping_id = '41000000-0000-4000-8000-000000000051'
       and evidence_kind = 'site_activation' and revoked_at is null),
    'Site Activation proof expired'
  )$$,
  'revoking one required proof immediately fails the pilot closed'
);
select is(
  (select pilot_write_enabled from public.class_offer_provider_mappings where id = '41000000-0000-4000-8000-000000000051'),
  false,
  'evidence revocation closes the provider-write gate'
);
select throws_ok(
  $$select public.assert_class_pilot_write_ready('41000000-0000-4000-8000-000000000051')$$,
  'Class pilot is not active for this Offer mapping',
  'revoked evidence cannot satisfy the write boundary'
);
select lives_ok(
  $$select public.record_class_pilot_evidence(
    '41000000-0000-4000-8000-000000000051', 'site_activation', repeat('c', 64),
    'controlled/issue-41/site_activation-rerun', 'platform-operations', now()
  )$$,
  'a fresh controlled run can replace revoked evidence without rewriting history'
);
select lives_ok(
  $$select public.activate_class_pilot('41000000-0000-4000-8000-000000000051')$$,
  'the exact mapping can be reactivated after fresh complete evidence'
);
select lives_ok(
  $$select public.deactivate_class_pilot('41000000-0000-4000-8000-000000000051', 'rollback drill')$$,
  'operators can fail closed without deleting the readiness ledger'
);
select is(
  (select pilot_write_enabled from public.class_offer_provider_mappings where id = '41000000-0000-4000-8000-000000000051'),
  false,
  'deactivation closes the provider-write gate'
);
select lives_ok(
  $$select public.activate_class_pilot('41000000-0000-4000-8000-000000000051')$$,
  'unchanged controlled configuration can be reactivated after a rollback drill'
);
select lives_ok(
  $$update public.class_business_integrations
    set chargeable_location_count = 2
    where id = '41000000-0000-4000-8000-000000000011'$$,
  'an effective chargeable Location change is recorded as configuration drift'
);
select is(
  (select pilot_write_enabled from public.class_offer_provider_mappings where id = '41000000-0000-4000-8000-000000000051'),
  false,
  'commercial configuration drift immediately closes the provider-write gate'
);
select is(
  (select status::text from public.class_pilot_readiness where mapping_id = '41000000-0000-4000-8000-000000000051'),
  'disabled',
  'configuration drift is visible in the readiness ledger'
);
select throws_ok(
  $$select public.assert_class_pilot_write_ready('41000000-0000-4000-8000-000000000051')$$,
  'Class pilot is not active for this Offer mapping',
  'the runtime digest also rejects evidence from the previous configuration'
);

do $$ begin
  perform pg_temp.issue_41_create_pilot_scope(
    '41900000-0000-4000-8000-000000000001', '41900000-0000-4000-8000-000000000011',
    '41900000-0000-4000-8000-000000000021', '41900000-0000-4000-8000-000000000041',
    '41900000-0000-4000-8000-000000000051', 'issue-41-paid', '-41901', '98',
    'purchase_pricing_option', 'product-419', 'plan-revvi-paid'
  );
end $$;
update public.class_offer_provider_mappings set status = 'active'
where id = '41900000-0000-4000-8000-000000000051';
update public.class_offer_provider_mappings
set paid_payment_route = 'mindbody_alternative_payment',
    paid_payment_method_id = 801, paid_checkout_location_id = 98
where id = '41900000-0000-4000-8000-000000000051';
insert into public.class_paid_pricing_option_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
  payment_route, payment_method_id, checkout_location_id, evidence_digest, verified_at
)
select mapping.business_id, mapping.id, mapping.mapping_version, evidence.kind, 'sandbox',
  mapping.paid_payment_route, mapping.paid_payment_method_id, mapping.paid_checkout_location_id,
  encode(extensions.digest(mapping.id::text || evidence.kind::text, 'sha256'), 'hex'), now()
from public.class_offer_provider_mappings mapping
cross join unnest(enum_range(null::public.class_paid_pricing_option_evidence_kind)) evidence(kind)
where mapping.id = '41900000-0000-4000-8000-000000000051';
update public.class_offer_provider_mappings
set paid_pricing_option_enabled = true,
    mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
where id = '41900000-0000-4000-8000-000000000051';
update public.class_revvi_offers set status = 'active'
where id = '41900000-0000-4000-8000-000000000041';

select throws_ok(
  $$select public.activate_class_pilot('41900000-0000-4000-8000-000000000051')$$,
  'Class pilot evidence is incomplete',
  'paid mode proof alone cannot bypass the complete pilot evidence package'
);
select lives_ok(
  $$select public.record_class_pilot_evidence(
    '41900000-0000-4000-8000-000000000051', evidence.kind,
    encode(extensions.digest('issue-41-paid:' || evidence.kind::text, 'sha256'), 'hex'),
    'controlled/issue-41-paid/' || evidence.kind::text, 'platform-operations', now()
  ) from unnest(enum_range(null::public.class_pilot_evidence_kind)) evidence(kind)$$,
  'paid fulfilment still requires every typed pilot proof'
);
select lives_ok(
  $$select public.activate_class_pilot('41900000-0000-4000-8000-000000000051')$$,
  'a fully approved paid mode can pass the same exact pilot gate'
);
select is(
  (select pilot_write_enabled from public.class_offer_provider_mappings
   where id = '41900000-0000-4000-8000-000000000051'),
  true,
  'pilot activation opens only the already approved paid mapping'
);

select * from finish();
rollback;

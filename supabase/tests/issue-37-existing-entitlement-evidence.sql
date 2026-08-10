begin;

select plan(32);

select has_table(
  'public', 'class_existing_entitlement_evidence',
  'existing-entitlement activation has a dedicated controlled-evidence ledger'
);
select has_column(
  'public', 'class_existing_entitlement_evidence', 'evidence_kind',
  'controlled evidence records each required behavior separately'
);
select hasnt_column(
  'public', 'class_existing_entitlement_evidence', 'payload',
  'raw sandbox provider payloads are not stored'
);

insert into public.class_businesses (id, slug, display_name, status)
values ('37000000-0000-4000-8000-000000000001', 'issue-37', 'Issue 37', 'active');
insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values (
  '37000000-0000-4000-8000-000000000011', '37000000-0000-4000-8000-000000000001',
  'sandbox', '-37001', 'active', now()
);
insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values (
  '37000000-0000-4000-8000-000000000021', '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000011', 'rosebank', 'Rosebank', 'Africa/Johannesburg', '7', true
);
insert into public.class_revvi_customers (
  id, memberstack_customer_id, email, first_name, last_name, subscription_status, memberstack_plan_ids
) values (
  '37000000-0000-4000-8000-000000000031', 'member-37-a', 'a37@example.com',
  'Ava', 'Ndlovu', 'active', array['plan-revvi']
);
insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values (
  '37000000-0000-4000-8000-000000000041', '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000021', 'revvi-yoga-pass', 'Revvi Yoga Pass',
  'existing_entitlement', array['plan-revvi'], 'draft'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  status, validated_at, validation_evidence_digest
) values (
  '37000000-0000-4000-8000-000000000051', '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000041', 'existing_entitlement',
  '37000000-0000-4000-8000-000000000011', '37000000-0000-4000-8000-000000000021',
  'draft', now(), repeat('a', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051', 'location', '7'),
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051', 'program', '11'),
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051', 'class_description', '13'),
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051', 'session_type', '23');
update public.class_offer_provider_mappings set status = 'active'
where id = '37000000-0000-4000-8000-000000000051';
update public.class_revvi_offers set status = 'active'
where id = '37000000-0000-4000-8000-000000000041';
create temporary table issue_37_mapping_version as
select mapping_version as original_version
from public.class_offer_provider_mappings
where id = '37000000-0000-4000-8000-000000000051';

select is(
  (select mode_evidence_verified from public.resolve_class_booking_quote_context(
    '37000000-0000-4000-8000-000000000041', '37000000-0000-4000-8000-000000000031'
  )), false,
  'an active mapping remains unusable before mode-specific sandbox evidence is complete'
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '37000000-0000-4000-8000-000000000051'$$,
  'explicit selection, pass deduction, and reconciliation evidence are required',
  'one generic digest cannot activate existing-entitlement fulfilment'
);

insert into public.class_existing_entitlement_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
) values (
  '37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051',
  (select original_version from issue_37_mapping_version),
  'explicit_client_service_selection', repeat('1', 64), now()
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '37000000-0000-4000-8000-000000000051'$$,
  'explicit selection, pass deduction, and reconciliation evidence are required',
  'partial controlled evidence cannot activate the mode'
);
insert into public.class_existing_entitlement_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
) values
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051',
   (select original_version from issue_37_mapping_version),
   'pass_deduction', repeat('2', 64), now()),
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051',
   (select original_version from issue_37_mapping_version),
   'booking_reconciliation', repeat('3', 64), now());

select lives_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '37000000-0000-4000-8000-000000000051'$$,
  'all three controlled proofs activate the exact existing-entitlement mode'
);
select is(
  (select mapping_version from public.class_offer_provider_mappings
   where id = '37000000-0000-4000-8000-000000000051'),
  (select original_version from issue_37_mapping_version),
  'recording evidence does not move it to an untested mapping version'
);
select ok(
  (select mode_evidence_verified from public.resolve_class_booking_quote_context(
    '37000000-0000-4000-8000-000000000041', '37000000-0000-4000-8000-000000000031'
  )),
  'quote context exposes the mode only after all controlled proofs exist'
);
select is(
  (select count(*)::integer from public.class_existing_entitlement_evidence
   where mapping_id = '37000000-0000-4000-8000-000000000051' and status = 'verified'), 3,
  'selection, deduction, and reconciliation remain separate evidence records'
);
select throws_like(
  $$insert into public.class_existing_entitlement_evidence (
      business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
    ) values (
      '37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051',
      (select original_version from issue_37_mapping_version),
      'pass_deduction', repeat('4', 64), now()
    )$$,
  '%violates unique constraint%',
  'two active proofs cannot ambiguously represent one required behavior'
);
select throws_like(
  $$insert into public.class_existing_entitlement_evidence (
      business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
      evidence_digest, verified_at
    ) values (
      '37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051',
      (select original_version from issue_37_mapping_version),
      'pass_deduction', 'production', repeat('5', 64), now()
    )$$,
  'evidence environment must match the mapping integration',
  'an evidence row cannot mislabel the environment it actually verified'
);
select throws_ok(
  $$insert into public.class_existing_entitlement_evidence (
      business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
    ) values (
      '37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051', 99,
      'pass_deduction', repeat('6', 64), now()
    )$$,
  'existing-entitlement evidence requires the current active validated mapping',
  'evidence for another mapping version cannot activate this Offer'
);
select throws_ok(
  $$update public.class_existing_entitlement_evidence set evidence_digest = repeat('7', 64)
    where mapping_id = '37000000-0000-4000-8000-000000000051'
      and evidence_kind = 'pass_deduction' and status = 'verified'$$,
  'controlled existing-entitlement evidence is append-only except for revocation',
  'verified sandbox proof cannot be rewritten'
);
select throws_ok(
  $$delete from public.class_existing_entitlement_evidence
    where mapping_id = '37000000-0000-4000-8000-000000000051'
      and evidence_kind = 'booking_reconciliation' and status = 'verified'$$,
  'controlled existing-entitlement evidence is append-only except for revocation',
  'verified sandbox proof cannot be deleted'
);
select lives_ok(
  $$update public.class_existing_entitlement_evidence
    set status = 'revoked', revoked_at = now(), revocation_reason = 'FIXTURE_INVALIDATED'
    where mapping_id = '37000000-0000-4000-8000-000000000051'
      and evidence_kind = 'pass_deduction' and status = 'verified'$$,
  'operations can explicitly revoke invalid controlled evidence'
);
select is(
  (select mode_evidence_digest from public.class_offer_provider_mappings
   where id = '37000000-0000-4000-8000-000000000051'), null,
  'revoking one required proof immediately disables the mapping mode'
);
select is(
  (select mode_evidence_verified from public.resolve_class_booking_quote_context(
    '37000000-0000-4000-8000-000000000041', '37000000-0000-4000-8000-000000000031'
  )), false,
  'disabled evidence cannot authorize a new quote or Booking write'
);
select ok(
  not has_table_privilege('authenticated', 'public.class_existing_entitlement_evidence', 'INSERT'),
  'browser-authenticated users cannot manufacture activation evidence'
);
select ok(
  has_table_privilege('service_role', 'public.class_existing_entitlement_evidence', 'INSERT')
    and not has_table_privilege('service_role', 'public.class_existing_entitlement_evidence', 'DELETE'),
  'only the trusted service role can record or revoke evidence and it cannot delete history'
);

insert into public.class_existing_entitlement_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
) select
  business_id, id, mapping_version, 'pass_deduction', repeat('a', 64), now()
from public.class_offer_provider_mappings
where id = '37000000-0000-4000-8000-000000000051';
select lives_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '37000000-0000-4000-8000-000000000051'$$,
  'replacement controlled proof can re-enable the unchanged mapping version'
);
select ok(
  (select mode_evidence_verified from public.resolve_class_booking_quote_context(
    '37000000-0000-4000-8000-000000000041', '37000000-0000-4000-8000-000000000031'
  )),
  'replacement proof restores the unchanged Offer fulfilment mode'
);

insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values (
  '37000000-0000-4000-8000-000000000012', '37000000-0000-4000-8000-000000000001',
  'production', '-37002', 'active', now()
);
insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values (
  '37000000-0000-4000-8000-000000000022', '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000012', 'sandton', 'Sandton', 'Africa/Johannesburg', '8', true
);
insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values (
  '37000000-0000-4000-8000-000000000042', '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000022', 'production-pass', 'Production Pass',
  'existing_entitlement', array['plan-revvi'], 'draft'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  status, validated_at, validation_evidence_digest
) values (
  '37000000-0000-4000-8000-000000000052', '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000042', 'existing_entitlement',
  '37000000-0000-4000-8000-000000000012', '37000000-0000-4000-8000-000000000022',
  'draft', now(), repeat('8', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000052', 'location', '8'),
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000052', 'program', '11'),
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000052', 'class_description', '13'),
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000052', 'session_type', '23');
update public.class_offer_provider_mappings set status = 'active'
where id = '37000000-0000-4000-8000-000000000052';
select throws_ok(
  $$insert into public.class_existing_entitlement_evidence (
      business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
      evidence_digest, verified_at
    ) select
      business_id, id, mapping_version, 'pass_deduction', 'production', repeat('9', 64), now()
    from public.class_offer_provider_mappings
    where id = '37000000-0000-4000-8000-000000000052'$$,
  'production existing-entitlement evidence requires reviewed sandbox promotion',
  'a production integration cannot accept evidence merely labelled sandbox'
);

select lives_ok(
  $$insert into public.class_existing_entitlement_evidence (
      business_id, mapping_id, mapping_version, evidence_kind, evidence_environment, evidence_digest,
      verified_at, source_evidence_id, production_equivalence_digest
    )
    select
      target.business_id, target.id, target.mapping_version, source.evidence_kind, 'production',
      encode(extensions.digest(target.id::text || source.evidence_kind::text, 'sha256'), 'hex'),
      now(), source.id,
      encode(extensions.digest('reviewed-production-equivalence-' || source.evidence_kind::text, 'sha256'), 'hex')
    from public.class_offer_provider_mappings target
    cross join public.class_existing_entitlement_evidence source
    where target.id = '37000000-0000-4000-8000-000000000052'
      and source.mapping_id = '37000000-0000-4000-8000-000000000051'
      and source.status = 'verified'$$,
  'production evidence is promoted only from each matching verified sandbox proof'
);
select lives_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('c', 64)
    where id = '37000000-0000-4000-8000-000000000052'$$,
  'reviewed promoted proofs can verify the production mapping version'
);
update public.class_revvi_offers set status = 'active'
where id = '37000000-0000-4000-8000-000000000042';
select ok(
  (select mode_evidence_verified from public.resolve_class_booking_quote_context(
    '37000000-0000-4000-8000-000000000042', '37000000-0000-4000-8000-000000000031'
  )),
  'production quote context opens only after reviewed sandbox promotion'
);

update public.class_revvi_offers set status = 'inactive'
where id = '37000000-0000-4000-8000-000000000041';
update public.class_offer_provider_mappings set status = 'draft'
where id = '37000000-0000-4000-8000-000000000051';
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values (
  '37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000051',
  'class_schedule', 'schedule-37-new'
);
select ok(
  (select mapping_version from public.class_offer_provider_mappings
   where id = '37000000-0000-4000-8000-000000000051')
    > (select original_version from issue_37_mapping_version),
  'deactivation and an Approved Class inventory change advance the mapping version'
);
select is(
  (select count(*)::integer from public.class_existing_entitlement_evidence evidence
   join public.class_offer_provider_mappings mapping on mapping.id = evidence.mapping_id
   where mapping.id = '37000000-0000-4000-8000-000000000051'
     and evidence.mapping_version = mapping.mapping_version
     and evidence.status = 'verified'), 0,
  'old sandbox proof cannot follow changed Approved Class inventory'
);
update public.class_offer_provider_mappings set status = 'active'
where id = '37000000-0000-4000-8000-000000000051';
update public.class_revvi_offers set status = 'active'
where id = '37000000-0000-4000-8000-000000000041';
select is(
  (select mode_evidence_verified from public.resolve_class_booking_quote_context(
    '37000000-0000-4000-8000-000000000041', '37000000-0000-4000-8000-000000000031'
  )), false,
  'deactivate, mutate inventory, and reactivate remains fail-closed without new proofs'
);

update public.class_existing_entitlement_evidence
set status = 'revoked', revoked_at = now(), revocation_reason = 'SOURCE_FIXTURE_INVALIDATED'
where mapping_id = '37000000-0000-4000-8000-000000000051'
  and evidence_kind = 'explicit_client_service_selection'
  and status = 'verified';
select is(
  (select status::text from public.class_existing_entitlement_evidence
   where mapping_id = '37000000-0000-4000-8000-000000000052'
     and evidence_kind = 'explicit_client_service_selection'), 'revoked',
  'revoking sandbox proof cascades to its promoted production proof'
);
select is(
  (select mode_evidence_digest from public.class_offer_provider_mappings
   where id = '37000000-0000-4000-8000-000000000052'), null,
  'a cascaded source revocation immediately disables the production mapping'
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('d', 64)
    where id = '37000000-0000-4000-8000-000000000052'$$,
  'explicit selection, pass deduction, and reconciliation evidence are required',
  'a production mapping cannot reactivate after one promoted source is revoked'
);

select * from finish();
rollback;

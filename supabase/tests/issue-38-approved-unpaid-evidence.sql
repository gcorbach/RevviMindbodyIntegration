begin;

select plan(39);

select has_table(
  'public', 'class_approved_unpaid_evidence',
  'approved-unpaid activation has a dedicated controlled-evidence ledger'
);
select has_column(
  'public', 'class_offer_provider_mappings', 'approved_unpaid_enabled',
  'approved-unpaid writes have a server-owned per-Offer feature flag'
);
select has_column(
  'public', 'class_bookings', 'fulfilment_mode',
  'each local Booking records the mode fixed by its quote'
);
select has_function(
  'public', 'record_class_booking_reconciliation_observation',
  array['uuid','uuid','uuid','text','text','text','text','text','text','text','text','text','text','text'],
  'unresolved reconciliation can persist distinct provider evidence without releasing the write lock'
);

insert into public.class_businesses (id, slug, display_name, status)
values ('38000000-0000-4000-8000-000000000001', 'issue-38', 'Issue 38', 'active');
insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values (
  '38000000-0000-4000-8000-000000000011', '38000000-0000-4000-8000-000000000001',
  'sandbox', '-38001', 'active', now()
);
insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values (
  '38000000-0000-4000-8000-000000000021', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000011', 'rosebank', 'Rosebank', 'Africa/Johannesburg', '7', true
);
insert into public.class_revvi_customers (
  id, memberstack_customer_id, email, first_name, last_name, subscription_status, memberstack_plan_ids
) values (
  '38000000-0000-4000-8000-000000000031', 'member-38-a', 'a38@example.com',
  'Ava', 'Ndlovu', 'active', array['plan-revvi']
);
insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values (
  '38000000-0000-4000-8000-000000000041', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000021', 'approved-unpaid-yoga', 'Approved Unpaid Yoga',
  'approved_unpaid', array['plan-revvi'], 'draft'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  status, validated_at, validation_evidence_digest
) values (
  '38000000-0000-4000-8000-000000000051', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000041', 'approved_unpaid',
  '38000000-0000-4000-8000-000000000011', '38000000-0000-4000-8000-000000000021',
  'draft', now(), repeat('a', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000051', 'location', '7'),
  ('38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000051', 'program', '11'),
  ('38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000051', 'class_description', '13'),
  ('38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000051', 'session_type', '23');
update public.class_offer_provider_mappings set status = 'active'
where id = '38000000-0000-4000-8000-000000000051';
select throws_ok(
  $$update public.class_revvi_offers set status = 'active'
    where id = '38000000-0000-4000-8000-000000000041'$$,
  'an approved-unpaid Revvi Offer requires its active feature flag and controlled evidence',
  'the Revvi Offer cannot become active before mode-specific evidence exists'
);

select throws_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '38000000-0000-4000-8000-000000000051'$$,
  'the approved-unpaid feature flag must be active',
  'generic evidence cannot bypass the disabled mode-specific feature flag'
);
select lives_ok(
  $$update public.class_offer_provider_mappings set approved_unpaid_enabled = true
    where id = '38000000-0000-4000-8000-000000000051'$$,
  'operations can deliberately enable the server-owned feature flag without opening writes'
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '38000000-0000-4000-8000-000000000051'$$,
  'written approval, permissions, roster, notification, cancellation, and reconciliation evidence are required',
  'the feature flag alone cannot activate approved-unpaid fulfilment'
);
select throws_ok(
  $$insert into public.class_approved_unpaid_evidence (
      business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
      evidence_digest, verified_at
    ) select business_id, id, mapping_version, 'written_business_approval', 'production',
        repeat('1', 64), now()
      from public.class_offer_provider_mappings
      where id = '38000000-0000-4000-8000-000000000051'$$,
  'evidence environment must match the mapping integration',
  'controlled evidence cannot mislabel the provider environment'
);

insert into public.class_approved_unpaid_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
)
select
  mapping.business_id, mapping.id, mapping.mapping_version, evidence.kind,
  encode(extensions.digest(mapping.id::text || evidence.kind::text, 'sha256'), 'hex'), now()
from public.class_offer_provider_mappings mapping
cross join unnest(enum_range(null::public.class_approved_unpaid_evidence_kind)) evidence(kind)
where mapping.id = '38000000-0000-4000-8000-000000000051'
  and evidence.kind <> 'booking_reconciliation';
select throws_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '38000000-0000-4000-8000-000000000051'$$,
  'written approval, permissions, roster, notification, cancellation, and reconciliation evidence are required',
  'partial controlled evidence keeps the mode closed'
);
insert into public.class_approved_unpaid_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_digest, verified_at
)
select business_id, id, mapping_version, 'booking_reconciliation', repeat('6', 64), now()
from public.class_offer_provider_mappings
where id = '38000000-0000-4000-8000-000000000051';
select lives_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '38000000-0000-4000-8000-000000000051'$$,
  'the active flag plus every controlled proof can activate the exact mapping version'
);
select lives_ok(
  $$update public.class_revvi_offers set status = 'active'
    where id = '38000000-0000-4000-8000-000000000041'$$,
  'the Revvi Offer can activate only after its mapping gate is complete'
);
select is(
  (select count(*)::integer from public.class_approved_unpaid_evidence
   where mapping_id = '38000000-0000-4000-8000-000000000051' and status = 'verified'), 6,
  'written approval and all five provider behaviors remain separate evidence records'
);
select ok(
  (select approved_unpaid_enabled and mode_verified_at is not null
   from public.class_offer_provider_mappings
   where id = '38000000-0000-4000-8000-000000000051'),
  'the mapping records both independent activation gates'
);
select throws_ok(
  $$update public.class_approved_unpaid_evidence set evidence_digest = repeat('7', 64)
    where mapping_id = '38000000-0000-4000-8000-000000000051'
      and evidence_kind = 'provider_permissions'$$,
  'controlled approved-unpaid evidence is append-only except for revocation',
  'written and sandbox evidence cannot be rewritten after verification'
);

select * from public.persist_class_customer_provider_profile(
  '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000031',
  '38000000-0000-4000-8000-000000000011', '-38001', 'rss-38-a', 'unique-38-a'
);
insert into public.class_booking_quotes (
  id, business_id, offer_id, mapping_id, mapping_version, integration_id, location_id,
  customer_id, customer_provider_profile_id, provider_site_id, provider_location_id,
  provider_class_id, provider_class_schedule_id, provider_client_id, provider_client_unique_id,
  fulfilment_mode, subtotal, discount_total, tax_total, grand_total, currency,
  provider_calculation, quote_fingerprint, expires_at
) values (
  '38000000-0000-4000-8000-000000000061', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000041', '38000000-0000-4000-8000-000000000051',
  (select mapping_version from public.class_offer_provider_mappings where id = '38000000-0000-4000-8000-000000000051'),
  '38000000-0000-4000-8000-000000000011', '38000000-0000-4000-8000-000000000021',
  '38000000-0000-4000-8000-000000000031',
  (select id from public.class_customer_provider_profiles where provider_client_id = 'rss-38-a'),
  '-38001', '7', '771', '991', 'rss-38-a', 'unique-38-a',
  'approved_unpaid', 0, 0, 0, 0, 'ZAR', 'approved_unpaid', repeat('8', 64), now() + interval '5 minutes'
);
create temporary table issue_38_claim as
select public.claim_class_booking_attempt(
  '38000000-0000-4000-8000-000000000061', '38000000-0000-4000-8000-000000000031',
  '550e8400-e29b-41d4-a716-446655440038', repeat('9', 64), 'approved_unpaid_booking', repeat('a', 64),
  '991', '13', '11', '23', 'Approved Unpaid Yoga', 'Maya',
  now() + interval '1 day', now() + interval '25 hours'
) as payload;
select is((select payload->>'shouldWrite' from issue_38_claim), 'true', 'an evidenced approved-unpaid quote can claim one provider write');
select is(
  (select fulfilment_mode::text from public.class_bookings limit 1), 'approved_unpaid',
  'the local Booking records the deliberate quote mode'
);
select is(
  (select payment_status::text from public.class_bookings limit 1), 'not_required',
  'approved unpaid is recorded as payment not required rather than paid'
);
select throws_like(
  $$update public.class_bookings
    set status = 'confirmed', provider_visit_id = 'visit-38',
        provider_sale_id = 'sale-38', provider_transaction_id = 'transaction-38'
    where id = ((select payload#>>'{booking,id}' from issue_38_claim))::uuid$$,
  '%violates check constraint "class_approved_unpaid_confirmation_is_nonfinancial"%',
  'sale and transaction identifiers cannot turn an unpaid Booking into confirmed success'
);
select throws_like(
  $$update public.class_bookings
    set status = 'waitlisted', provider_waitlist_entry_id = 'waitlist-38'
    where id = ((select payload#>>'{booking,id}' from issue_38_claim))::uuid$$,
  '%violates check constraint "class_approved_unpaid_confirmation_is_nonfinancial"%',
  'an unexpected waitlist result cannot satisfy the approved-unpaid roster contract'
);
select throws_ok(
  $$update public.class_bookings set fulfilment_mode = 'existing_entitlement'
    where id = ((select payload#>>'{booking,id}' from issue_38_claim))::uuid$$,
  'a Class Booking fulfilment mode is immutable',
  'the deliberate unpaid mode cannot be relabelled after the provider attempt'
);
select lives_ok(
  $$update public.class_bookings
    set status = 'confirmed', provider_visit_id = 'visit-38', confirmed_at = now()
    where id = ((select payload#>>'{booking,id}' from issue_38_claim))::uuid$$,
  'an exact Visit can confirm the nonfinancial roster Booking'
);
select ok(
  (select provider_visit_id = 'visit-38'
      and provider_client_service_id is null
      and provider_service_product_id is null
      and provider_sale_id is null
      and provider_transaction_id is null
      and provider_payment_id is null
   from public.class_bookings limit 1),
  'Visit evidence is stored without fabricating entitlement, sale, transaction, or payment IDs'
);

insert into public.class_booking_quotes (
  id, business_id, offer_id, mapping_id, mapping_version, integration_id, location_id,
  customer_id, customer_provider_profile_id, provider_site_id, provider_location_id,
  provider_class_id, provider_class_schedule_id, provider_client_id, provider_client_unique_id,
  fulfilment_mode, subtotal, discount_total, tax_total, grand_total, currency,
  provider_calculation, quote_fingerprint, expires_at
) values (
  '38000000-0000-4000-8000-000000000062', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000041', '38000000-0000-4000-8000-000000000051',
  (select mapping_version from public.class_offer_provider_mappings where id = '38000000-0000-4000-8000-000000000051'),
  '38000000-0000-4000-8000-000000000011', '38000000-0000-4000-8000-000000000021',
  '38000000-0000-4000-8000-000000000031',
  (select id from public.class_customer_provider_profiles where provider_client_id = 'rss-38-a'),
  '-38001', '7', '772', '992', 'rss-38-a', 'unique-38-a',
  'approved_unpaid', 0, 0, 0, 0, 'ZAR', 'approved_unpaid', repeat('9', 64), now() + interval '5 minutes'
);
create temporary table issue_38_contaminated_claim as
select public.claim_class_booking_attempt(
  '38000000-0000-4000-8000-000000000062', '38000000-0000-4000-8000-000000000031',
  '550e8400-e29b-41d4-a716-446655440039', repeat('c', 64), 'approved_unpaid_booking', repeat('d', 64),
  '992', '13', '11', '23', 'Approved Unpaid Yoga', 'Maya',
  now() + interval '2 days', now() + interval '49 hours'
) as payload;
select lives_ok(
  $$select public.record_class_booking_reconciliation_observation(
    '38000000-0000-4000-8000-000000000001',
    ((select payload#>>'{booking,id}' from issue_38_contaminated_claim))::uuid,
    ((select payload#>>'{attempt,id}' from issue_38_contaminated_claim))::uuid,
    repeat('d', 64), null, null, null, null, null,
    'sale-unexpected', null, 'transaction-failed', null,
    'APPROVED_UNPAID_FINANCIAL_EVIDENCE'
  )$$,
  'unresolved reconciliation persists contamination without claiming confirmation'
);
select is(
  (select status::text from public.class_bookings
   where id = ((select payload#>>'{booking,id}' from issue_38_contaminated_claim))::uuid), 'unknown',
  'financial contamination keeps the approved-unpaid Booking attempt unknown'
);
select ok(
  (select provider_sale_id = 'sale-unexpected'
      and provider_transaction_id = 'transaction-failed'
      and error_code = 'APPROVED_UNPAID_FINANCIAL_EVIDENCE'
   from public.class_bookings
   where id = ((select payload#>>'{booking,id}' from issue_38_contaminated_claim))::uuid),
  'present Sale and Transaction references are stored distinctly with the typed error'
);
select is(
  (select count(*)::integer from public.class_booking_write_locks
   where booking_id = ((select payload#>>'{booking,id}' from issue_38_contaminated_claim))::uuid
     and status = 'active'), 1,
  'recording unresolved evidence retains the Customer/Class write lock'
);

insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values (
  '38000000-0000-4000-8000-000000000012', '38000000-0000-4000-8000-000000000001',
  'production', '-38002', 'active', now()
);
insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values (
  '38000000-0000-4000-8000-000000000022', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000012', 'sandton', 'Sandton', 'Africa/Johannesburg', '8', true
);
insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values (
  '38000000-0000-4000-8000-000000000042', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000022', 'production-unpaid-yoga', 'Production Unpaid Yoga',
  'approved_unpaid', array['plan-revvi'], 'draft'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  status, validated_at, validation_evidence_digest
) values (
  '38000000-0000-4000-8000-000000000052', '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000042', 'approved_unpaid',
  '38000000-0000-4000-8000-000000000012', '38000000-0000-4000-8000-000000000022',
  'draft', now(), repeat('b', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000052', 'location', '8'),
  ('38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000052', 'program', '11'),
  ('38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000052', 'class_description', '13'),
  ('38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000052', 'session_type', '23');
update public.class_offer_provider_mappings set status = 'active'
where id = '38000000-0000-4000-8000-000000000052';
select throws_ok(
  $$insert into public.class_approved_unpaid_evidence (
      business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
      evidence_digest, verified_at
    ) select business_id, id, mapping_version, 'provider_permissions', 'production', repeat('c', 64), now()
      from public.class_offer_provider_mappings
      where id = '38000000-0000-4000-8000-000000000052'$$,
  'production approved-unpaid evidence requires reviewed sandbox promotion',
  'production cannot claim approval or provider proof without sandbox lineage'
);
select lives_ok(
  $$insert into public.class_approved_unpaid_evidence (
      business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
      evidence_digest, verified_at, source_evidence_id, production_equivalence_digest
    )
    select
      target.business_id, target.id, target.mapping_version, source.evidence_kind, 'production',
      encode(extensions.digest(target.id::text || source.evidence_kind::text, 'sha256'), 'hex'),
      now(), source.id,
      encode(extensions.digest('approved-unpaid-production-' || source.evidence_kind::text, 'sha256'), 'hex')
    from public.class_offer_provider_mappings target
    cross join public.class_approved_unpaid_evidence source
    where target.id = '38000000-0000-4000-8000-000000000052'
      and source.mapping_id = '38000000-0000-4000-8000-000000000051'
      and source.status = 'verified'$$,
  'each production proof is promoted from matching current sandbox evidence'
);
select lives_ok(
  $$update public.class_offer_provider_mappings
    set approved_unpaid_enabled = true,
        mode_verified_at = now(),
        mode_evidence_digest = repeat('d', 64)
    where id = '38000000-0000-4000-8000-000000000052'$$,
  'reviewed sandbox lineage and the production flag can activate production'
);
select is(
  (select count(*)::integer from public.class_approved_unpaid_evidence
   where mapping_id = '38000000-0000-4000-8000-000000000052'
     and evidence_environment = 'production' and status = 'verified'), 6,
  'production evidence records its actual environment'
);

update public.class_approved_unpaid_evidence
set status = 'revoked', revoked_at = now(), revocation_reason = 'BUSINESS_APPROVAL_WITHDRAWN'
where mapping_id = '38000000-0000-4000-8000-000000000051'
  and evidence_kind = 'written_business_approval'
  and status = 'verified';
select is(
  (select status::text from public.class_approved_unpaid_evidence
   where mapping_id = '38000000-0000-4000-8000-000000000052'
     and evidence_kind = 'written_business_approval'), 'revoked',
  'withdrawing written Business approval revokes its promoted production proof'
);
select is(
  (select approved_unpaid_enabled from public.class_offer_provider_mappings
   where id = '38000000-0000-4000-8000-000000000052'), false,
  'source revocation immediately disables the production feature flag'
);
select is(
  (select approved_unpaid_enabled from public.class_offer_provider_mappings
   where id = '38000000-0000-4000-8000-000000000051'), false,
  'withdrawing approval also disables the sandbox mapping that owned it'
);
select is(
  (select status::text from public.class_revvi_offers
   where id = '38000000-0000-4000-8000-000000000041'), 'inactive',
  'closing the mapping gate deactivates the approved-unpaid Revvi Offer'
);
update public.class_revvi_offers set status = 'inactive'
where id = '38000000-0000-4000-8000-000000000041';
update public.class_offer_provider_mappings
set status = 'draft'
where id = '38000000-0000-4000-8000-000000000051';
select is(
  (select count(*)::integer from public.class_approved_unpaid_evidence
   where mapping_id = '38000000-0000-4000-8000-000000000052' and status = 'verified'), 0,
  'sandbox mapping deactivation revokes every stale promoted production proof'
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set approved_unpaid_enabled = true,
        mode_verified_at = now(),
        mode_evidence_digest = repeat('e', 64)
    where id = '38000000-0000-4000-8000-000000000052'$$,
  'written approval, permissions, roster, notification, cancellation, and reconciliation evidence are required',
  'production cannot reactivate while its promoted approval source is revoked'
);
select is(
  has_table_privilege('authenticated', 'public.class_approved_unpaid_evidence', 'insert'), false,
  'browser sessions cannot fabricate approval or sandbox evidence'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.record_class_booking_reconciliation_observation(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ), false,
  'browser sessions cannot fabricate unresolved provider observations'
);

select * from finish();
rollback;

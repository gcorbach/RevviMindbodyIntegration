begin;

select plan(17);

select ok(
  'mindbody_sandbox_cash' = any(enum_range(null::public.class_paid_payment_route)::text[]),
  'the fictitious Cash route is typed separately from production payment routes'
);
select has_column('public', 'class_offer_provider_mappings', 'sandbox_demo_write_enabled',
  'the hosted sandbox write lane has an explicit operator flag');
select has_column('public', 'class_offer_provider_mappings', 'sandbox_demo_customer_id',
  'the hosted sandbox lane is bound to one designated test Customer');
select has_column('public', 'class_offer_provider_mappings', 'sandbox_demo_evidence_digest',
  'the hosted sandbox lane retains only a controlled evidence digest');
select has_function('public', 'persist_class_sandbox_demo_restoration_baseline',
  'the exact pre-cancellation sandbox ClientService state has a durable write boundary');
select has_function('public', 'record_class_sandbox_demo_restoration',
  'sandbox ClientService restoration is recorded separately from cancellation');
select has_table('public', 'class_site_99_staff_operation_leases',
  'Site -99 temporary staff-token operations use a durable cross-request lease');
select has_function('public', 'claim_site_99_staff_operation_lease',
  'the durable Site -99 staff-operation lease has an atomic claim boundary');
select has_function('public', 'release_site_99_staff_operation_lease',
  'the durable Site -99 staff-operation lease has a holder-bound release boundary');
select is(
  public.claim_site_99_staff_operation_lease('57000000-0000-4000-8000-000000000071', 90),
  true,
  'the first Edge request claims the Site -99 staff-operation lease'
);
select is(
  public.claim_site_99_staff_operation_lease('57000000-0000-4000-8000-000000000072', 90),
  false,
  'a concurrent Edge request cannot replace an active Site -99 staff-operation lease'
);
select is(
  public.release_site_99_staff_operation_lease('57000000-0000-4000-8000-000000000071'),
  true,
  'only the holder can release the Site -99 staff-operation lease'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '57000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'issue-57-demo@example.test', crypt('Issue57Demo123!', gen_salt('bf')), now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.class_revvi_customers (id, auth_user_id, memberstack_customer_id)
values (
  '57000000-0000-4000-8000-000000000011',
  '57000000-0000-4000-8000-000000000001', 'issue-57-demo-customer'
);
insert into public.class_businesses (id, slug, display_name, status)
values ('57000000-0000-4000-8000-000000000021', 'issue-57', 'Issue 57', 'active');
insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values (
  '57000000-0000-4000-8000-000000000031',
  '57000000-0000-4000-8000-000000000021', 'sandbox', '-99', 'active', now()
);
insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values (
  '57000000-0000-4000-8000-000000000041',
  '57000000-0000-4000-8000-000000000021',
  '57000000-0000-4000-8000-000000000031',
  'clubville', 'Clubville', 'Africa/Johannesburg', '1', true
);
insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values (
  '57000000-0000-4000-8000-000000000051',
  '57000000-0000-4000-8000-000000000021',
  '57000000-0000-4000-8000-000000000041',
  'sandbox-yoga', 'Sandbox Yoga', 'purchase_pricing_option', array['plan-demo'], 'draft'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  provider_service_product_id, status, validated_at, validation_evidence_digest
) values (
  '57000000-0000-4000-8000-000000000061',
  '57000000-0000-4000-8000-000000000021',
  '57000000-0000-4000-8000-000000000051', 'purchase_pricing_option',
  '57000000-0000-4000-8000-000000000031',
  '57000000-0000-4000-8000-000000000041',
  '1431', 'draft', now(), repeat('a', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('57000000-0000-4000-8000-000000000021', '57000000-0000-4000-8000-000000000061', 'location', '1'),
  ('57000000-0000-4000-8000-000000000021', '57000000-0000-4000-8000-000000000061', 'program', '27'),
  ('57000000-0000-4000-8000-000000000021', '57000000-0000-4000-8000-000000000061', 'class_description', '223'),
  ('57000000-0000-4000-8000-000000000021', '57000000-0000-4000-8000-000000000061', 'session_type', '250');
update public.class_offer_provider_mappings set status = 'active'
where id = '57000000-0000-4000-8000-000000000061';

select throws_ok(
  $$update public.class_offer_provider_mappings
    set paid_payment_route = 'mindbody_sandbox_cash', paid_checkout_location_id = 98,
        sandbox_demo_customer_id = '57000000-0000-4000-8000-000000000011',
        sandbox_demo_evidence_digest = repeat('b', 64)
    where id = '57000000-0000-4000-8000-000000000061'$$,
  23514,
  null,
  'sandbox Cash cannot use the production checkout Location'
);

select lives_ok(
  $$update public.class_offer_provider_mappings
    set paid_payment_route = 'mindbody_sandbox_cash', paid_checkout_location_id = 1,
        sandbox_demo_customer_id = '57000000-0000-4000-8000-000000000011',
        sandbox_demo_evidence_digest = repeat('b', 64)
    where id = '57000000-0000-4000-8000-000000000061'$$,
  'operations can configure the exact disabled Site -99 route'
);
select is(
  (select paid_pricing_option_enabled from public.class_offer_provider_mappings
    where id = '57000000-0000-4000-8000-000000000061'),
  false,
  'configuring the Site -99 route does not open writes'
);
select lives_ok(
  $$update public.class_offer_provider_mappings
    set sandbox_demo_write_enabled = true, paid_pricing_option_enabled = true,
        mode_verified_at = now(), mode_evidence_digest = repeat('c', 64)
    where id = '57000000-0000-4000-8000-000000000061'$$,
  'the exact sandbox scope can be enabled with controlled evidence'
);
select lives_ok(
  $$update public.class_revvi_offers set status = 'active'
    where id = '57000000-0000-4000-8000-000000000051'$$,
  'the exact sandbox Offer can become visible after its route is enabled'
);

select * from finish();
rollback;

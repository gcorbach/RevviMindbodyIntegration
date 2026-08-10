begin;

select plan(46);

select has_table(
  'public', 'class_paid_pricing_option_evidence',
  'paid pricing-option activation has a dedicated controlled-evidence ledger'
);

select has_column(
  'public', 'class_offer_provider_mappings', 'paid_pricing_option_enabled',
  'paid writes have a server-owned per-Offer feature flag'
);
select has_column(
  'public', 'class_bookings', 'payment_action_url',
  'a requires-action Booking retains its short-lived redirect'
);
select has_column(
  'public', 'class_bookings', 'payment_action_expires_at',
  'provider redirects have an explicit retention boundary'
);
select has_function(
  'public', 'persist_class_booking_payment_action',
  array['uuid','uuid','uuid','text','text','class_paid_payment_route','text','text','text'],
  'payment redirects are persisted only through the active write lock'
);
select has_table(
  'public', 'class_paid_checkout_actions',
  'provider access tokens have a service-only short-lived sealed ledger'
);
select has_column(
  'public', 'class_paid_checkout_actions', 'completion_token_digest',
  'paid completion has a one-way single-use claim token'
);
select has_column(
  'public', 'class_paid_checkout_actions', 'completion_claimed_at',
  'paid completion records when its provider write was claimed'
);
select has_function(
  'public', 'claim_class_paid_checkout_completion', array['uuid','uuid','text'],
  'return handling has a durable single-writer completion claim'
);
select has_function(
  'public', 'finalize_class_paid_checkout_completion',
  array['uuid','uuid','uuid','text','text','text','text','text','text','text','text','text','text','text','text'],
  'paid completion persists its authoritative outcome atomically'
);
select has_column(
  'public', 'class_offer_provider_mappings', 'paid_checkout_location_id',
  'the route-specific Mindbody checkout location is server-owned'
);
select has_column(
  'public', 'class_offer_provider_mappings', 'paid_payment_route',
  'the exact approved no-raw-card route is server-owned'
);
select has_column(
  'public', 'class_offer_provider_mappings', 'paid_payment_method_id',
  'the provider-approved alternative payment method is server-owned'
);

insert into public.class_businesses (id, slug, display_name, status)
values ('40000000-0000-4000-8000-000000000001', 'issue-40', 'Issue 40', 'active');
insert into public.class_business_integrations (
  id, business_id, environment, provider_site_id, status, activated_at
) values (
  '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001',
  'sandbox', '-40001', 'active', now()
);
insert into public.class_business_locations (
  id, business_id, integration_id, slug, display_name, timezone, provider_location_id, enabled
) values (
  '40000000-0000-4000-8000-000000000021', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000011', 'rosebank', 'Rosebank', 'Africa/Johannesburg', '7', true
);
insert into public.class_revvi_offers (
  id, business_id, location_id, slug, display_name, fulfilment_mode,
  eligible_memberstack_plan_ids, status
) values (
  '40000000-0000-4000-8000-000000000041', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000021', 'paid-yoga', 'Paid Yoga',
  'purchase_pricing_option', array['plan-revvi'], 'draft'
);
insert into public.class_offer_provider_mappings (
  id, business_id, offer_id, fulfilment_mode, integration_id, location_id,
  provider_service_product_id, status, validated_at, validation_evidence_digest
) values (
  '40000000-0000-4000-8000-000000000051', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000041', 'purchase_pricing_option',
  '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000021',
  'product-40', 'draft', now(), repeat('a', 64)
);
insert into public.class_offer_inventory_allowlist (business_id, mapping_id, entity_kind, provider_entity_id)
values
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000051', 'location', '7'),
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000051', 'program', '11'),
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000051', 'class_description', '13'),
  ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000051', 'session_type', '23');
update public.class_offer_provider_mappings set status = 'active'
where id = '40000000-0000-4000-8000-000000000051';

select throws_ok(
  $$update public.class_revvi_offers set status = 'active'
    where id = '40000000-0000-4000-8000-000000000041'$$,
  'a paid Revvi Offer requires its approved route flag and controlled evidence',
  'a paid Offer cannot activate on generic mapping validation alone'
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '40000000-0000-4000-8000-000000000051'$$,
  'the paid pricing-option route flag must be active',
  'generic mode evidence cannot bypass the disabled paid route'
);
select lives_ok(
  $$update public.class_offer_provider_mappings
    set paid_payment_route = 'mindbody_alternative_payment',
        paid_payment_method_id = 801, paid_checkout_location_id = 98
    where id = '40000000-0000-4000-8000-000000000051'$$,
  'operations can configure the exact route without opening paid writes'
);
select throws_ok(
  $$insert into public.class_paid_pricing_option_evidence (
      business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
      payment_route, payment_method_id, checkout_location_id, evidence_digest, verified_at
    ) select business_id, id, mapping_version, 'written_route_approval', 'production',
        paid_payment_route, paid_payment_method_id, paid_checkout_location_id, repeat('1', 64), now()
      from public.class_offer_provider_mappings
      where id = '40000000-0000-4000-8000-000000000051'$$,
  'evidence environment must match the mapping integration',
  'payment evidence cannot mislabel its provider environment'
);
select throws_ok(
  $$update public.class_offer_provider_mappings
    set paid_pricing_option_enabled = true,
        mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '40000000-0000-4000-8000-000000000051'$$,
  'all paid route approval and controlled provider evidence are required',
  'the paid feature flag alone cannot open provider writes'
);

insert into public.class_paid_pricing_option_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
  payment_route, payment_method_id, checkout_location_id, evidence_digest, verified_at
)
select
  mapping.business_id, mapping.id, mapping.mapping_version, evidence.kind, 'sandbox',
  mapping.paid_payment_route, mapping.paid_payment_method_id, mapping.paid_checkout_location_id,
  encode(extensions.digest(mapping.id::text || evidence.kind::text, 'sha256'), 'hex'), now()
from public.class_offer_provider_mappings mapping
cross join unnest(enum_range(null::public.class_paid_pricing_option_evidence_kind)) evidence(kind)
where mapping.id = '40000000-0000-4000-8000-000000000051'
  and evidence.kind <> 'decline_partial_timeout_recovery';
select throws_ok(
  $$update public.class_offer_provider_mappings
    set paid_pricing_option_enabled = true,
        mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '40000000-0000-4000-8000-000000000051'$$,
  'all paid route approval and controlled provider evidence are required',
  'partial paid-route evidence keeps the mode closed'
);
insert into public.class_paid_pricing_option_evidence (
  business_id, mapping_id, mapping_version, evidence_kind, evidence_environment,
  payment_route, payment_method_id, checkout_location_id, evidence_digest, verified_at
)
select business_id, id, mapping_version, 'decline_partial_timeout_recovery', 'sandbox',
  paid_payment_route, paid_payment_method_id, paid_checkout_location_id, repeat('8', 64), now()
from public.class_offer_provider_mappings
where id = '40000000-0000-4000-8000-000000000051';
select lives_ok(
  $$update public.class_offer_provider_mappings
    set paid_pricing_option_enabled = true,
        mode_verified_at = now(), mode_evidence_digest = repeat('b', 64)
    where id = '40000000-0000-4000-8000-000000000051'$$,
  'the exact route flag plus every controlled proof can activate paid fulfilment'
);
select lives_ok(
  $$update public.class_revvi_offers set status = 'active'
    where id = '40000000-0000-4000-8000-000000000041'$$,
  'the paid Revvi Offer can activate only after its mapping gate is complete'
);
select is(
  (select count(*)::integer from public.class_paid_pricing_option_evidence
   where mapping_id = '40000000-0000-4000-8000-000000000051' and status = 'verified'), 8,
  'all paid-route approval and provider behaviors remain distinct evidence records'
);

insert into public.class_revvi_customers (
  id, memberstack_customer_id, email, first_name, last_name,
  subscription_status, memberstack_plan_ids
) values (
  '40000000-0000-4000-8000-000000000031', 'member-40-a', 'a40@example.com',
  'Ava', 'Ndlovu', 'active', array['plan-revvi']
);
select * from public.persist_class_customer_provider_profile(
  '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000031',
  '40000000-0000-4000-8000-000000000011', '-40001', 'rss-40-a', 'unique-40-a'
);
insert into public.class_booking_quotes (
  id, business_id, offer_id, mapping_id, mapping_version, integration_id, location_id,
  customer_id, customer_provider_profile_id, provider_site_id, provider_location_id,
  provider_class_id, provider_class_schedule_id, provider_client_id, provider_client_unique_id,
  provider_service_product_id, fulfilment_mode, subtotal, discount_total, tax_total,
  grand_total, currency, provider_calculation, quote_fingerprint, expires_at
) values (
  '40000000-0000-4000-8000-000000000061', '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000041', '40000000-0000-4000-8000-000000000051',
  (select mapping_version from public.class_offer_provider_mappings
   where id = '40000000-0000-4000-8000-000000000051'),
  '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000021',
  '40000000-0000-4000-8000-000000000031',
  (select id from public.class_customer_provider_profiles where provider_client_id = 'rss-40-a'),
  '-40001', '7', '771', '991', 'rss-40-a', 'unique-40-a', 'product-40',
  'purchase_pricing_option', 120, 20, 15, 115, 'ZAR', 'checkout_test_cart',
  repeat('9', 64), now() + interval '5 minutes'
);
create temporary table issue_40_claim as
select public.claim_class_booking_attempt(
  '40000000-0000-4000-8000-000000000061', '40000000-0000-4000-8000-000000000031',
  '550e8400-e29b-41d4-a716-446655440040', repeat('a', 64),
  'purchase_booking', repeat('b', 64), '991', '13', '11', '23',
  'Paid Yoga', 'Maya', now() + interval '1 day', now() + interval '25 hours'
) as payload;
select lives_ok(
  format(
    $$select public.persist_class_booking_payment_action(
      '40000000-0000-4000-8000-000000000001', %L::uuid, %L::uuid,
      repeat('b', 64), 'https://payments.example.test/challenge?opaque=token',
      'mindbody_alternative_payment', 'sealedciphertext', '0123456789abcdef',
      'payment-action-v1'
    )$$,
    (select payload#>>'{booking,id}' from issue_40_claim),
    (select payload#>>'{attempt,id}' from issue_40_claim)
  ),
  'the active paid write lock can persist one validated provider redirect'
);
select ok(
  (select payment_action_url = 'https://payments.example.test/challenge?opaque=token'
      and payment_action_expires_at > now()
      and payment_action_expires_at <= created_at + interval '48 hours'
      and exists (
        select 1 from public.class_paid_checkout_actions action
        where action.booking_id = class_bookings.id
          and action.access_token_ciphertext = 'sealedciphertext'
          and action.access_token_ciphertext <> 'opaque-provider-token'
          and action.status = 'awaiting_return'
      )
   from public.class_bookings
   where id = ((select payload#>>'{booking,id}' from issue_40_claim))::uuid),
  'the redirect is bounded and expires inside the 48-hour provider-data window'
);
select lives_ok(
  $$select 1 from public.class_paid_checkout_actions
    where booking_id = ((select payload#>>'{booking,id}' from issue_40_claim))::uuid
      and status = 'awaiting_return'$$,
  'redirect persistence and the requires-action transition commit together'
);
select is(
  (select status::text from public.class_bookings
   where id = ((select payload#>>'{booking,id}' from issue_40_claim))::uuid),
  'requires_action',
  'the callback redirect remains a non-terminal requires-action state'
);
select is(
  (select count(*)::integer from public.class_booking_write_locks
   where booking_id = ((select payload#>>'{booking,id}' from issue_40_claim))::uuid
     and status = 'active'),
  1,
  'requires-action retains the duplicate-charge prevention lock'
);
select is(
  has_function_privilege(
    'authenticated', 'public.claim_class_paid_checkout_completion(uuid,uuid,text)', 'EXECUTE'
  ),
  false,
  'browser sessions cannot claim a provider completion write directly'
);

create temporary table issue_40_completion_claim as
select public.claim_class_paid_checkout_completion(
  ((select payload#>>'{booking,id}' from issue_40_claim))::uuid,
  '40000000-0000-4000-8000-000000000031', repeat('c', 64)
) as payload;
select ok(
  (select (payload->>'shouldComplete')::boolean from issue_40_completion_claim),
  'the first authenticated return claims exactly one provider completion write'
);
select is(
  (select payload#>>'{action,accessTokenCiphertext}' from issue_40_completion_claim),
  'sealedciphertext',
  'the completion worker receives only the sealed provider access token'
);
select is(
  (select (public.claim_class_paid_checkout_completion(
    ((select payload#>>'{booking,id}' from issue_40_claim))::uuid,
    '40000000-0000-4000-8000-000000000031', repeat('d', 64)
  )->>'shouldComplete')::boolean),
  false,
  'a repeated provider return cannot perform a duplicate completion write'
);
select throws_ok(
  format(
    $$select public.finalize_class_paid_checkout_completion(
      '40000000-0000-4000-8000-000000000001', %L::uuid, %L::uuid,
      repeat('c', 64), 'confirmed', null, null, null, 'product-40',
      'sale-40', null, 'transaction-40', null, null, null
    )$$,
    (select payload#>>'{booking,id}' from issue_40_claim),
    (select payload#>>'{attempt,id}' from issue_40_claim)
  ),
  'paid confirmation requires exact purchase and Class roster evidence',
  'financial evidence alone can never confirm the paid Class Booking'
);
select lives_ok(
  format(
    $$select public.finalize_class_paid_checkout_completion(
      '40000000-0000-4000-8000-000000000001', %L::uuid, %L::uuid,
      repeat('c', 64), 'confirmed', 'visit-40', 'roster-40', 'client-service-40',
      'product-40', 'sale-40', 'cart-40', 'transaction-40', 'payment-40',
      'request-40', null
    )$$,
    (select payload#>>'{booking,id}' from issue_40_claim),
    (select payload#>>'{attempt,id}' from issue_40_claim)
  ),
  'authoritative purchase and roster evidence can finalize paid fulfilment'
);
select ok(
  (select status = 'confirmed' and payment_status = 'paid'
      and provider_visit_id = 'visit-40'
      and provider_client_service_id = 'client-service-40'
      and provider_service_product_id = 'product-40'
      and provider_sale_id = 'sale-40'
      and provider_cart_id = 'cart-40'
      and provider_transaction_id = 'transaction-40'
      and provider_payment_id = 'payment-40'
   from public.class_bookings
   where id = ((select payload#>>'{booking,id}' from issue_40_claim))::uuid),
  'paid success stores the exact roster, entitlement, pricing option, Sale, and Transaction'
);
select ok(
  (select status = 'completed'
      and access_token_ciphertext is null and access_token_nonce is null
      and completion_token_digest = encode(extensions.digest(repeat('c', 64), 'sha256'), 'hex')
   from public.class_paid_checkout_actions
   where booking_id = ((select payload#>>'{booking,id}' from issue_40_claim))::uuid),
  'terminal completion destroys the short-lived provider access token'
);
select is(
  (select count(*)::integer from public.class_booking_write_locks
   where booking_id = ((select payload#>>'{booking,id}' from issue_40_claim))::uuid
     and status = 'active'),
  0,
  'authoritative paid success releases the duplicate-charge prevention lock'
);

insert into public.class_booking_quotes (
  id, business_id, offer_id, mapping_id, mapping_version, integration_id, location_id,
  customer_id, customer_provider_profile_id, provider_site_id, provider_location_id,
  provider_class_id, provider_class_schedule_id, provider_client_id, provider_client_unique_id,
  provider_service_product_id, fulfilment_mode, subtotal, discount_total, tax_total,
  grand_total, currency, provider_calculation, quote_fingerprint, expires_at
)
select
  '40000000-0000-4000-8000-000000000062', business_id, offer_id, mapping_id, mapping_version,
  integration_id, location_id, customer_id, customer_provider_profile_id, provider_site_id,
  provider_location_id, '772', provider_class_schedule_id, provider_client_id,
  provider_client_unique_id, provider_service_product_id, fulfilment_mode, subtotal,
  discount_total, tax_total, grand_total, currency, provider_calculation, repeat('7', 64),
  now() + interval '5 minutes'
from public.class_booking_quotes
where id = '40000000-0000-4000-8000-000000000061';
create temporary table issue_40_expiry_claim as
select public.claim_class_booking_attempt(
  '40000000-0000-4000-8000-000000000062', '40000000-0000-4000-8000-000000000031',
  '550e8400-e29b-41d4-a716-446655440041', repeat('d', 64),
  'purchase_booking', repeat('e', 64), '991', '13', '11', '23',
  'Paid Yoga', 'Maya', now() + interval '2 days', now() + interval '49 hours'
) as payload;
select public.persist_class_booking_payment_action(
  '40000000-0000-4000-8000-000000000001',
  ((select payload#>>'{booking,id}' from issue_40_expiry_claim))::uuid,
  ((select payload#>>'{attempt,id}' from issue_40_expiry_claim))::uuid,
  repeat('e', 64), 'https://payments.example.test/expiring',
  'mindbody_alternative_payment', 'expiringciphertext', 'fedcba9876543210',
  'payment-action-v1'
);
select public.finalize_class_booking_attempt(
  '40000000-0000-4000-8000-000000000001',
  ((select payload#>>'{booking,id}' from issue_40_expiry_claim))::uuid,
  ((select payload#>>'{attempt,id}' from issue_40_expiry_claim))::uuid,
  repeat('e', 64), 'requires_action', 'requires_action', 'requires_action', null,
  null, null, null, null, 'product-40', null, null, null, null,
  null, null, false
);
update public.class_bookings
set created_at = now() - interval '2 hours',
    payment_action_expires_at = now() - interval '1 hour'
where id = ((select payload#>>'{booking,id}' from issue_40_expiry_claim))::uuid;
update public.class_paid_checkout_actions
set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
where booking_id = ((select payload#>>'{booking,id}' from issue_40_expiry_claim))::uuid;
select is(
  public.purge_expired_class_payment_actions(), 1::bigint,
  'the expiry job converts one abandoned payment action into reconciliation work'
);
select ok(
  (select status = 'unknown' and payment_status = 'unknown'
      and payment_action_url is null and payment_action_expires_at is null
      and error_code = 'PAYMENT_ACTION_EXPIRED'
   from public.class_bookings
   where id = ((select payload#>>'{booking,id}' from issue_40_expiry_claim))::uuid),
  'an expired redirect becomes an explicit unknown Booking instead of remaining requires-action'
);
select ok(
  (select status = 'unknown' and access_token_ciphertext is null
      and access_token_nonce is null and error_code = 'PAYMENT_ACTION_EXPIRED'
   from public.class_paid_checkout_actions
   where booking_id = ((select payload#>>'{booking,id}' from issue_40_expiry_claim))::uuid),
  'expiry destroys the provider token while retaining the auditable action row'
);
select ok(
  exists (
    select 1 from public.class_booking_reconciliation_queue queue
    where queue.attempt_id = ((select payload#>>'{attempt,id}' from issue_40_expiry_claim))::uuid
      and queue.status = 'queued' and queue.reason_code = 'PAYMENT_ACTION_EXPIRED'
  ) and exists (
    select 1 from public.class_booking_write_locks write_lock
    where write_lock.booking_id = ((select payload#>>'{booking,id}' from issue_40_expiry_claim))::uuid
      and write_lock.status = 'active'
  ),
  'expiry queues read-only reconciliation and keeps the duplicate-charge lock active'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.persist_class_booking_payment_action(uuid,uuid,uuid,text,text,class_paid_payment_route,text,text,text)',
    'EXECUTE'
  ),
  false,
  'browser sessions cannot fabricate a provider payment redirect'
);
select throws_ok(
  $$update public.class_paid_pricing_option_evidence set evidence_digest = repeat('9', 64)
    where mapping_id = '40000000-0000-4000-8000-000000000051'
      and evidence_kind = 'endpoint_auth_permissions'$$,
  'controlled paid pricing-option evidence is append-only except for revocation',
  'approval and sandbox proof cannot be rewritten after verification'
);
select lives_ok(
  $$update public.class_paid_pricing_option_evidence
    set status = 'revoked', revoked_at = now(), revocation_reason = 'PAYMENT_APPROVAL_WITHDRAWN'
    where mapping_id = '40000000-0000-4000-8000-000000000051'
      and evidence_kind = 'written_route_approval'$$,
  'an approval can be explicitly revoked without rewriting its evidence'
);
select is(
  (select paid_pricing_option_enabled from public.class_offer_provider_mappings
   where id = '40000000-0000-4000-8000-000000000051'), false,
  'revoking one required proof immediately disables paid writes'
);
select is(
  (select status::text from public.class_revvi_offers
   where id = '40000000-0000-4000-8000-000000000041'), 'inactive',
  'revoking payment approval also deactivates the public Offer'
);
select is(
  has_table_privilege('authenticated', 'public.class_paid_pricing_option_evidence', 'insert'), false,
  'browser sessions cannot fabricate payment approval or sandbox evidence'
);

select * from finish();
rollback;

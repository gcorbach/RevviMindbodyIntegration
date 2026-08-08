insert into public.businesses (
  id,
  slug,
  display_name,
  support_email,
  status,
  booking_enabled,
  completion_mode,
  provider_environment
)
values
  (
    '00000000-0000-0000-0000-000000000011',
    'sandbox-wellness',
    'Revvi Sandbox Wellness',
    'support@example.test',
    'active',
    true,
    'free_unpaid',
    'sandbox'
  ),
  (
    '00000000-0000-0000-0000-000000000012',
    'sandbox-secondary',
    'Revvi Sandbox Secondary',
    'support@example.test',
    'disabled',
    false,
    'disabled',
    'sandbox'
  ),
  (
    '00000000-0000-0000-0000-000000000013',
    'sandbox-checkout-disabled',
    'Revvi Sandbox Checkout Disabled',
    'support@example.test',
    'active',
    true,
    'mindbody_checkout',
    'sandbox'
  ),
  (
    '00000000-0000-0000-0000-000000000014',
    'sandbox-checkout',
    'Revvi Sandbox Checkout',
    'support@example.test',
    'active',
    true,
    'mindbody_checkout',
    'sandbox'
  )
on conflict (id) do update set
  slug = excluded.slug,
  display_name = excluded.display_name,
  support_email = excluded.support_email,
  status = excluded.status,
  booking_enabled = excluded.booking_enabled,
  completion_mode = excluded.completion_mode,
  provider_environment = excluded.provider_environment;

insert into public.business_locations (
  id,
  business_id,
  slug,
  display_name,
  timezone,
  enabled
)
values
  (
    '00000000-0000-0000-0000-000000000021',
    '00000000-0000-0000-0000-000000000011',
    'sandbox-location',
    'Sandbox Location',
    'America/Los_Angeles',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000022',
    '00000000-0000-0000-0000-000000000012',
    'secondary-location',
    'Secondary Location',
    'UTC',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000023',
    '00000000-0000-0000-0000-000000000013',
    'checkout-disabled-location',
    'Sandbox Checkout Disabled Location',
    'America/Los_Angeles',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000024',
    '00000000-0000-0000-0000-000000000014',
    'checkout-location',
    'Sandbox Checkout Location',
    'America/Los_Angeles',
    true
  )
on conflict (id) do update set
  business_id = excluded.business_id,
  slug = excluded.slug,
  display_name = excluded.display_name,
  timezone = excluded.timezone,
  enabled = excluded.enabled;

insert into public.business_services (
  id,
  business_id,
  location_id,
  display_name_override,
  enabled
)
values (
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000021',
  null,
  true
), (
  '00000000-0000-0000-0000-000000000032',
  '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-000000000023',
  null,
  true
), (
  '00000000-0000-0000-0000-000000000033',
  '00000000-0000-0000-0000-000000000014',
  '00000000-0000-0000-0000-000000000024',
  null,
  true
)
on conflict (id) do update set
  business_id = excluded.business_id,
  location_id = excluded.location_id,
  display_name_override = excluded.display_name_override,
  enabled = excluded.enabled;

insert into public.business_provider_config (business_id, mindbody_site_id)
values
  ('00000000-0000-0000-0000-000000000011', '__MINDBODY_SANDBOX_SITE_ID__'),
  ('00000000-0000-0000-0000-000000000012', '__MINDBODY_SANDBOX_SITE_ID__'),
  ('00000000-0000-0000-0000-000000000013', '__MINDBODY_SANDBOX_SITE_ID__'),
  ('00000000-0000-0000-0000-000000000014', '__MINDBODY_SANDBOX_SITE_ID__')
on conflict (business_id) do update set
  mindbody_site_id = excluded.mindbody_site_id;

insert into public.business_location_provider_config (business_id, location_id, mindbody_location_id)
values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000021', '1'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000022', '2'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000023', '1'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000024', '1')
on conflict (business_id, location_id) do update set
  mindbody_location_id = excluded.mindbody_location_id;

insert into public.business_service_provider_config (business_id, service_id, mindbody_session_type_id)
values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000031', '23'),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000032', '23'),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000033', '23')
on conflict (business_id, service_id) do update set
  mindbody_session_type_id = excluded.mindbody_session_type_id;

insert into public.business_checkout_config (business_id, payment_mode, checkout_request, validation_evidence_ref, validated_at, enabled)
values (
  '00000000-0000-0000-0000-000000000014',
  'approved_non_sensitive',
  '{"ClientId":"$REVVI_CLIENT_ID","AppointmentId":"$REVVI_APPOINTMENT_ID","TransactionIds":"$REVVI_TRANSACTION_IDS","PaymentAuthenticationCallbackUrl":"$REVVI_CALLBACK_URL","PaymentInfo":{"PaymentMethodId":801},"Test":true}'::jsonb,
  'sandbox-checkout-validation-2026-08-03',
  '2026-08-03T00:00:00.000Z',
  true
)
on conflict (business_id) do update set
  payment_mode = excluded.payment_mode,
  checkout_request = excluded.checkout_request,
  validation_evidence_ref = excluded.validation_evidence_ref,
  validated_at = excluded.validated_at,
  enabled = excluded.enabled;

insert into public.memberstack_identity_allowlist (memberstack_id, source)
values
  ('local-sandbox-member', 'sandbox_allowlist'),
  ('issue-14-missing-member', 'sandbox_allowlist'),
  ('issue-14-ambiguous-member', 'sandbox_allowlist'),
  ('issue-14-failure-member', 'sandbox_allowlist'),
  ('issue-14-created-conflict', 'sandbox_allowlist'),
  ('issue-14-concurrent-member', 'sandbox_allowlist'),
  ('issue-14-stale-lock-member', 'sandbox_allowlist'),
  ('issue-15-stale-slot', 'sandbox_allowlist'),
  ('issue-15-duplicate', 'sandbox_allowlist'),
  ('issue-15-unknown-retry', 'sandbox_allowlist'),
  ('issue-16-authoritative-success', 'sandbox_allowlist'),
  ('issue-16-authoritative-absence', 'sandbox_allowlist'),
  ('issue-16-payment-needs-attention', 'sandbox_allowlist'),
  ('issue-16-reconciliation-exhausted', 'sandbox_allowlist'),
  ('issue-16-expired', 'sandbox_allowlist'),
  ('issue-16-expired-during-confirmation', 'sandbox_allowlist'),
  ('issue-16-expired-payment-attention', 'sandbox_allowlist'),
  ('issue-16-malformed-reconciliation', 'sandbox_allowlist'),
  ('issue-16-delayed-callback', 'sandbox_allowlist'),
  ('issue-17-checkout-disabled', 'sandbox_allowlist'),
  ('issue-17-checkout-enabled', 'sandbox_allowlist'),
  ('issue-17-checkout-sca', 'sandbox_allowlist'),
  ('issue-17-checkout-callback', 'sandbox_allowlist'),
  ('issue-17-checkout-failed', 'sandbox_allowlist'),
  ('issue-17-checkout-unknown', 'sandbox_allowlist'),
  ('issue-18-expired-unknown-retry', 'sandbox_allowlist')
on conflict (memberstack_id) do update set
  source = excluded.source,
  verified_at = now();

insert into public.business_customer_access (business_id, memberstack_id)
values
  ('00000000-0000-0000-0000-000000000011', 'local-sandbox-member'),
  ('00000000-0000-0000-0000-000000000011', 'issue-14-missing-member'),
  ('00000000-0000-0000-0000-000000000011', 'issue-14-ambiguous-member'),
  ('00000000-0000-0000-0000-000000000011', 'issue-14-failure-member'),
  ('00000000-0000-0000-0000-000000000011', 'issue-14-created-conflict'),
  ('00000000-0000-0000-0000-000000000011', 'issue-14-concurrent-member'),
  ('00000000-0000-0000-0000-000000000011', 'issue-14-stale-lock-member'),
  ('00000000-0000-0000-0000-000000000011', 'issue-15-stale-slot'),
  ('00000000-0000-0000-0000-000000000011', 'issue-15-duplicate'),
  ('00000000-0000-0000-0000-000000000011', 'issue-15-unknown-retry'),
  ('00000000-0000-0000-0000-000000000011', 'issue-16-authoritative-success'),
  ('00000000-0000-0000-0000-000000000011', 'issue-16-authoritative-absence'),
  ('00000000-0000-0000-0000-000000000011', 'issue-16-payment-needs-attention'),
  ('00000000-0000-0000-0000-000000000011', 'issue-16-reconciliation-exhausted'),
  ('00000000-0000-0000-0000-000000000011', 'issue-16-expired'),
  ('00000000-0000-0000-0000-000000000011', 'issue-16-expired-during-confirmation'),
  ('00000000-0000-0000-0000-000000000011', 'issue-16-expired-payment-attention'),
  ('00000000-0000-0000-0000-000000000011', 'issue-16-malformed-reconciliation'),
  ('00000000-0000-0000-0000-000000000011', 'issue-16-delayed-callback'),
  ('00000000-0000-0000-0000-000000000013', 'issue-17-checkout-disabled'),
  ('00000000-0000-0000-0000-000000000014', 'issue-17-checkout-enabled'),
  ('00000000-0000-0000-0000-000000000014', 'issue-17-checkout-sca'),
  ('00000000-0000-0000-0000-000000000014', 'issue-17-checkout-callback'),
  ('00000000-0000-0000-0000-000000000014', 'issue-17-checkout-failed'),
  ('00000000-0000-0000-0000-000000000014', 'issue-17-checkout-unknown'),
  ('00000000-0000-0000-0000-000000000011', 'issue-18-expired-unknown-retry')
on conflict do nothing;

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'local-sandbox-member@example.test',
    crypt('LocalSandbox123!', gen_salt('bf')),
    now(),
    '{"identity_provider":"memberstack","memberstack_id":"local-sandbox-member","memberstack_verified":true}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'sandbox-staff-a@example.test',
    crypt('LocalSandbox123!', gen_salt('bf')),
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'sandbox-staff-b@example.test',
    crypt('LocalSandbox123!', gen_salt('bf')),
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000004',
    'authenticated',
    'authenticated',
    'sandbox-unassigned@example.test',
    crypt('LocalSandbox123!', gen_salt('bf')),
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000005',
    'authenticated',
    'authenticated',
    'sandbox-platform-operations@example.test',
    crypt('LocalSandbox123!', gen_salt('bf')),
    now(),
    '{"platform_operations":true}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = excluded.updated_at;

insert into public.business_staff_access (business_id, user_id)
values
  ('00000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into public.booking_attempts (
  id, business_id, memberstack_id, idempotency_key, location_id, service_id,
  business_name, location_name, location_timezone, service_name,
  mindbody_location_id, mindbody_session_type_id, selected_start_time,
  selected_end_time, duration_minutes, price, state, completion_mode,
  expires_at, correlation_id, mindbody_client_id, mindbody_appointment_id
)
values
  ('19000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000011', 'pilot-readiness-seed-11', 'pilot-readiness-seed-11', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000031', 'Revvi Sandbox Wellness', 'Sandbox Location', 'America/Los_Angeles', 'Nutrition Consultation', '1', '23', '2026-08-07T08:00:00Z', '2026-08-07T08:45:00Z', 45, 120, 'confirmed', 'free_unpaid', '2026-08-07T08:15:00Z', '19000000-0000-4100-8000-000000000011', 'seed-client-11', 'seed-booking-11'),
  ('19000000-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000013', 'pilot-readiness-seed-13', 'pilot-readiness-seed-13', '00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000032', 'Revvi Sandbox Checkout Disabled', 'Sandbox Checkout Disabled Location', 'America/Los_Angeles', 'Nutrition Consultation', '1', '23', '2026-08-07T08:00:00Z', '2026-08-07T08:45:00Z', 45, 120, 'confirmed', 'mindbody_checkout', '2026-08-07T08:15:00Z', '19000000-0000-4100-8000-000000000013', 'seed-client-13', 'seed-booking-13'),
  ('19000000-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000014', 'pilot-readiness-seed-14', 'pilot-readiness-seed-14', '00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000033', 'Revvi Sandbox Checkout', 'Sandbox Checkout Location', 'America/Los_Angeles', 'Nutrition Consultation', '1', '23', '2026-08-07T08:00:00Z', '2026-08-07T08:45:00Z', 45, 120, 'confirmed', 'mindbody_checkout', '2026-08-07T08:15:00Z', '19000000-0000-4100-8000-000000000014', 'seed-client-14', 'seed-booking-14')
on conflict (id) do nothing;

insert into public.booking_attempt_events (
  business_id, booking_attempt_id, correlation_id, event_type, operation
)
select business_id, booking_attempt_id, correlation_id, event_type, operation
from (values
  ('00000000-0000-0000-0000-000000000011'::uuid, '19000000-0000-4000-8000-000000000011'::uuid, '19000000-0000-4100-8000-000000000011'::uuid),
  ('00000000-0000-0000-0000-000000000013'::uuid, '19000000-0000-4000-8000-000000000013'::uuid, '19000000-0000-4100-8000-000000000013'::uuid),
  ('00000000-0000-0000-0000-000000000014'::uuid, '19000000-0000-4000-8000-000000000014'::uuid, '19000000-0000-4100-8000-000000000014'::uuid)
) attempt(business_id, booking_attempt_id, correlation_id)
cross join (values
  ('attempt_created', 'booking_attempt'),
  ('provider_revalidation_succeeded', 'booking_facts_revalidation'),
  ('provider_write_started', 'appointment_create'),
  ('attempt_confirmed', 'appointment_create')
) event(event_type, operation)
where not exists (
  select 1 from public.booking_attempt_events existing
  where existing.booking_attempt_id = attempt.booking_attempt_id
    and existing.event_type = event.event_type
);

update public.business_pilot_readiness readiness
set
  status = 'active',
  checkout_mode = case when business.completion_mode = 'free_unpaid' then 'approved_non_paid' else 'supported_checkout' end,
  transactional_message_behavior = 'Sandbox transactional-message behaviour recorded for the controlled pilot.',
  accepted_limitations = '["Sandbox evidence does not prove production notification branding."]'::jsonb,
  site_activation_fingerprint = encode(extensions.digest(provider.mindbody_site_id, 'sha256'), 'hex'),
  responsible_staff_actor = '10000000-0000-0000-0000-000000000005',
  activated_at = now()
from public.businesses business
join public.business_provider_config provider on provider.business_id = business.id
where readiness.business_id = business.id
  and business.id in (
    '00000000-0000-0000-0000-000000000011',
    '00000000-0000-0000-0000-000000000013',
    '00000000-0000-0000-0000-000000000014'
  );

insert into public.business_pilot_readiness_checks (
  business_id, check_name, passed, verified_at, evidence_ref, details, verified_by
)
select
  business_id,
  check_name,
  true,
  now(),
  'seed/issue-19/' || check_name::text,
  case when check_name = 'controlled_booking'
    then jsonb_build_object('bookingAttemptId', case business_id
      when '00000000-0000-0000-0000-000000000011' then '19000000-0000-4000-8000-000000000011'
      when '00000000-0000-0000-0000-000000000013' then '19000000-0000-4000-8000-000000000013'
      else '19000000-0000-4000-8000-000000000014' end)
    when check_name in ('tenant_isolation', 'booking_lifecycle') then jsonb_build_object(
      'automatedTestRun', jsonb_build_object(
        'suite', check_name::text,
        'runId', 'seed-issue-19-' || check_name::text,
        'result', 'passed',
        'completedAt', now(),
        'artifactDigest', 'sha256:0000000000000000000000000000000000000000000000000000000000000019'
      )
    )
    else jsonb_build_object('verification', 'Seeded sandbox pilot evidence.') end,
  '10000000-0000-0000-0000-000000000005'
from unnest(array[
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000013'::uuid,
  '00000000-0000-0000-0000-000000000014'::uuid
]) business_id
cross join unnest(enum_range(null::public.business_pilot_readiness_check)) check_name
on conflict (business_id, check_name) do update set
  passed = excluded.passed,
  verified_at = excluded.verified_at,
  recorded_at = now(),
  evidence_ref = excluded.evidence_ref,
  details = excluded.details,
  verified_by = excluded.verified_by;

insert into public.business_pilot_readiness_actions (
  business_id, actor_user_id, action, from_status, to_status, reason, snapshot
)
select
  business_id,
  '10000000-0000-0000-0000-000000000005',
  'activated',
  'ready',
  'active',
  'seeded_sandbox_pilot',
  jsonb_build_object('source', 'supabase seed')
from unnest(array[
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000013'::uuid,
  '00000000-0000-0000-0000-000000000014'::uuid
]) business_id;

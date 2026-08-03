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
  ('issue-17-checkout-unknown', 'sandbox_allowlist')
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
  ('00000000-0000-0000-0000-000000000014', 'issue-17-checkout-unknown')
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

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
)
on conflict (id) do update set
  business_id = excluded.business_id,
  location_id = excluded.location_id,
  display_name_override = excluded.display_name_override,
  enabled = excluded.enabled;

insert into public.business_provider_config (business_id, mindbody_site_id)
values
  ('00000000-0000-0000-0000-000000000011', '__MINDBODY_SANDBOX_SITE_ID__'),
  ('00000000-0000-0000-0000-000000000012', '__MINDBODY_SANDBOX_SITE_ID__')
on conflict (business_id) do update set
  mindbody_site_id = excluded.mindbody_site_id;

insert into public.business_location_provider_config (business_id, location_id, mindbody_location_id)
values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000021', '1'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000022', '2')
on conflict (business_id, location_id) do update set
  mindbody_location_id = excluded.mindbody_location_id;

insert into public.business_service_provider_config (business_id, service_id, mindbody_session_type_id)
values ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000031', '23')
on conflict (business_id, service_id) do update set
  mindbody_session_type_id = excluded.mindbody_session_type_id;

insert into public.memberstack_identity_allowlist (memberstack_id, source)
values ('local-sandbox-member', 'sandbox_allowlist')
on conflict (memberstack_id) do update set
  source = excluded.source,
  verified_at = now();

insert into public.business_customer_access (business_id, memberstack_id)
values ('00000000-0000-0000-0000-000000000011', 'local-sandbox-member')
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

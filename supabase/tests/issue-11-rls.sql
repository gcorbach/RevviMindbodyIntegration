select plan(8);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '10000000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'app_metadata', json_build_object('identity_provider', 'memberstack', 'memberstack_id', 'local-sandbox-member', 'memberstack_verified', true)
  )::text,
  false
);
set role authenticated;

select is((select count(*)::int from public.businesses), 1, 'a customer sees only the Business in its trusted context');
select is((select count(*)::int from public.business_locations), 1, 'a customer sees only Locations in its Business');
select is((select count(*)::int from public.business_services), 1, 'a customer sees only services in its Business');
select is((select count(*)::int from public.business_customer_access), 1, 'a customer sees only its own access grant');

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '10000000-0000-0000-0000-000000000004', 'role', 'authenticated')::text,
  false
);

select is((select count(*)::int from public.businesses), 0, 'a customer without a grant cannot cross into another tenant');

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '10000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text,
  false
);

select is((select count(*)::int from public.businesses), 1, 'staff access is scoped to one Business');

set role postgres;

select throws_ok(
  $$update public.business_services
    set business_id = '00000000-0000-0000-0000-000000000012'
    where id = '00000000-0000-0000-0000-000000000031'$$,
  'business ownership is immutable',
  'tenant ownership cannot be reassigned'
);

select throws_ok(
  $$update public.business_customer_access
    set business_id = '00000000-0000-0000-0000-000000000012'
    where business_id = '00000000-0000-0000-0000-000000000011'$$,
  'business ownership is immutable',
  'access-grant ownership cannot be reassigned'
);

select * from finish();

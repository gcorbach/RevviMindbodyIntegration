alter table public.class_business_integrations
  add column allow_client_creation boolean not null default false,
  add column client_creation_evidence_digest text,
  add check (
    (not allow_client_creation and client_creation_evidence_digest is null)
    or (allow_client_creation and coalesce(client_creation_evidence_digest ~ '^[0-9a-f]{64}$', false))
  );

alter table public.class_revvi_offers
  add column cancellation_policy_text text not null default 'Cancellation policy is supplied by the pilot studio.'
    check (length(trim(cancellation_policy_text)) between 1 and 500),
  add column cancellation_policy_certainty text not null default 'studio_reported'
    check (cancellation_policy_certainty in ('studio_reported', 'provider_reported'));

alter table public.class_offer_provider_mappings
  add column mapping_version bigint not null default 1 check (mapping_version > 0),
  add column mode_verified_at timestamptz,
  add column mode_evidence_digest text,
  add check (
    (mode_verified_at is null and mode_evidence_digest is null)
    or (mode_verified_at is not null and mode_evidence_digest ~ '^[0-9a-f]{64}$')
  );

alter table public.class_customer_provider_profiles
  add column resolution_status text not null default 'resolved'
    check (resolution_status in ('resolved', 'ambiguous', 'blocked')),
  add column verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'stale')),
  add column verified_at timestamptz,
  add column ambiguity_reason text check (
    ambiguity_reason is null or ambiguity_reason ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  add check ((resolution_status = 'ambiguous') = (ambiguity_reason is not null));

alter table public.class_customer_provider_profiles
  add check ((verification_status = 'verified') = (verified_at is not null));

alter table public.class_booking_quotes
  add column mapping_version bigint not null default 1 check (mapping_version > 0),
  add check (
    (fulfilment_mode = 'purchase_pricing_option'
      and provider_calculation = 'checkout_test_cart'
      and provider_service_product_id is not null
      and provider_client_service_id is null)
    or (fulfilment_mode = 'existing_entitlement'
      and provider_calculation = 'entitlement_balance'
      and provider_service_product_id is null
      and provider_client_service_id is not null)
    or (fulfilment_mode = 'approved_unpaid'
      and provider_calculation = 'approved_unpaid'
      and provider_service_product_id is null
      and provider_client_service_id is null)
  );

create table public.class_client_resolution_support_work (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  integration_id uuid not null,
  customer_id uuid not null references public.class_revvi_customers(id) on delete restrict,
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  candidate_count integer not null check (candidate_count between 1 and 100),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, integration_id)
    references public.class_business_integrations(business_id, id)
    on delete restrict,
  check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status <> 'open' and resolved_at is not null and resolved_by is not null)
  )
);

create table public.class_quote_provider_diagnostics (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  offer_id uuid not null,
  location_id uuid not null,
  mapping_id uuid not null,
  customer_id uuid not null references public.class_revvi_customers(id) on delete restrict,
  endpoint_name text not null check (endpoint_name ~ '^[A-Za-z][A-Za-z0-9._/-]{0,127}$'),
  request_id text check (request_id is null or length(request_id) between 1 and 128),
  provider_request_id text check (provider_request_id is null or length(provider_request_id) between 1 and 128),
  status_code integer check (status_code is null or status_code between 100 and 599),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  success boolean not null,
  error_code text check (error_code is null or error_code ~ '^[A-Za-z0-9._:-]{1,128}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  foreign key (business_id, offer_id, location_id)
    references public.class_revvi_offers(business_id, id, location_id) on delete restrict,
  foreign key (business_id, mapping_id, offer_id)
    references public.class_offer_provider_mappings(business_id, id, offer_id) on delete restrict,
  check (expires_at > created_at and expires_at <= created_at + interval '48 hours')
);

comment on table public.class_quote_provider_diagnostics is
  'Temporary allowlisted quote-operation facts. Raw Client, Class, cart, credential, and payment payloads are prohibited.';

create index class_client_resolution_support_open_idx
on public.class_client_resolution_support_work (business_id, created_at)
where status = 'open';

create index class_quote_provider_diagnostics_expiry_idx
on public.class_quote_provider_diagnostics (expires_at);

create trigger class_client_resolution_support_set_updated_at
before update on public.class_client_resolution_support_work
for each row execute function public.class_set_updated_at();

create trigger class_client_resolution_support_immutable_owner
before update on public.class_client_resolution_support_work
for each row execute function public.class_prevent_business_reassignment();

create or replace function public.class_bump_mapping_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.integration_id, old.location_id, old.fulfilment_mode, old.provider_service_product_id)
    is distinct from
    (new.integration_id, new.location_id, new.fulfilment_mode, new.provider_service_product_id) then
    new.mode_verified_at := null;
    new.mode_evidence_digest := null;
  end if;
  new.mapping_version := old.mapping_version + 1;
  return new;
end;
$$;

create trigger class_mappings_bump_version
before update on public.class_offer_provider_mappings
for each row execute function public.class_bump_mapping_version();

create or replace function public.class_protect_quote_binding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    old.business_id, old.offer_id, old.mapping_id, old.mapping_version,
    old.integration_id, old.location_id, old.customer_id,
    old.customer_provider_profile_id, old.provider, old.provider_site_id,
    old.provider_location_id, old.provider_class_id, old.provider_class_schedule_id,
    old.provider_client_id, old.provider_client_unique_id,
    old.provider_service_product_id, old.provider_client_service_id,
    old.fulfilment_mode, old.subtotal, old.discount_total, old.tax_total,
    old.grand_total, old.currency, old.provider_calculation,
    old.quote_fingerprint, old.quoted_at, old.expires_at
  ) is distinct from (
    new.business_id, new.offer_id, new.mapping_id, new.mapping_version,
    new.integration_id, new.location_id, new.customer_id,
    new.customer_provider_profile_id, new.provider, new.provider_site_id,
    new.provider_location_id, new.provider_class_id, new.provider_class_schedule_id,
    new.provider_client_id, new.provider_client_unique_id,
    new.provider_service_product_id, new.provider_client_service_id,
    new.fulfilment_mode, new.subtotal, new.discount_total, new.tax_total,
    new.grand_total, new.currency, new.provider_calculation,
    new.quote_fingerprint, new.quoted_at, new.expires_at
  ) then
    raise exception 'Quote ownership and binding facts are immutable';
  end if;
  return new;
end;
$$;

create trigger class_quotes_immutable_binding
before update on public.class_booking_quotes
for each row execute function public.class_protect_quote_binding();

create or replace function public.class_validate_new_quote_open_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'open' then
    raise exception 'a new Booking quote must be open';
  end if;
  return new;
end;
$$;

create trigger class_quotes_validate_new_open_status
before insert on public.class_booking_quotes
for each row execute function public.class_validate_new_quote_open_status();

create or replace function public.resolve_class_booking_quote_context(
  candidate_offer_id uuid,
  candidate_customer_id uuid
)
returns table (
  business_id uuid,
  location_id uuid,
  location_name text,
  location_timezone text,
  provider_location_id text,
  offer_id uuid,
  offer_name text,
  fulfilment_mode public.class_offer_fulfilment_mode,
  cancellation_policy_text text,
  cancellation_policy_certainty text,
  integration_id uuid,
  provider_site_id text,
  provider_environment public.class_provider_environment,
  allow_client_creation boolean,
  mapping_id uuid,
  mapping_version bigint,
  provider_service_product_id text,
  mode_evidence_verified boolean,
  customer_provider_profile_id uuid,
  provider_client_id text,
  provider_client_unique_id text,
  inventory_allowlist jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    business.id,
    location.id,
    location.display_name,
    location.timezone,
    location.provider_location_id,
    offer.id,
    offer.display_name,
    offer.fulfilment_mode,
    offer.cancellation_policy_text,
    offer.cancellation_policy_certainty,
    integration.id,
    integration.provider_site_id,
    integration.environment,
    integration.allow_client_creation,
    mapping.id,
    mapping.mapping_version,
    mapping.provider_service_product_id,
    mapping.mode_verified_at is not null
      and mapping.mode_evidence_digest ~ '^[0-9a-f]{64}$',
    profile.id,
    profile.provider_client_id,
    profile.provider_client_unique_id,
    jsonb_build_object(
      'location', coalesce((select jsonb_agg(item.provider_entity_id order by item.provider_entity_id)
        from public.class_offer_inventory_allowlist item
        where item.mapping_id = mapping.id and item.entity_kind = 'location'), '[]'::jsonb),
      'program', coalesce((select jsonb_agg(item.provider_entity_id order by item.provider_entity_id)
        from public.class_offer_inventory_allowlist item
        where item.mapping_id = mapping.id and item.entity_kind = 'program'), '[]'::jsonb),
      'classDescription', coalesce((select jsonb_agg(item.provider_entity_id order by item.provider_entity_id)
        from public.class_offer_inventory_allowlist item
        where item.mapping_id = mapping.id and item.entity_kind = 'class_description'), '[]'::jsonb),
      'sessionType', coalesce((select jsonb_agg(item.provider_entity_id order by item.provider_entity_id)
        from public.class_offer_inventory_allowlist item
        where item.mapping_id = mapping.id and item.entity_kind = 'session_type'), '[]'::jsonb),
      'classSchedule', coalesce((select jsonb_agg(item.provider_entity_id order by item.provider_entity_id)
        from public.class_offer_inventory_allowlist item
        where item.mapping_id = mapping.id and item.entity_kind = 'class_schedule'), '[]'::jsonb)
    )
  from public.class_revvi_offers offer
  join public.class_businesses business
    on business.id = offer.business_id and business.status = 'active'
  join public.class_business_locations location
    on location.business_id = offer.business_id
   and location.id = offer.location_id
   and location.enabled
  join public.class_offer_provider_mappings mapping
    on mapping.business_id = offer.business_id
   and mapping.offer_id = offer.id
   and mapping.location_id = location.id
   and mapping.fulfilment_mode = offer.fulfilment_mode
   and mapping.status = 'active'
  join public.class_business_integrations integration
    on integration.business_id = mapping.business_id
   and integration.id = mapping.integration_id
   and integration.status = 'active'
  join public.class_revvi_customers customer
    on customer.id = candidate_customer_id
  left join public.class_customer_provider_profiles profile
    on profile.business_id = business.id
   and profile.customer_id = customer.id
   and profile.integration_id = integration.id
   and profile.resolution_status = 'resolved'
  where offer.id = candidate_offer_id
    and offer.status = 'active';
$$;

revoke all on function public.resolve_class_booking_quote_context(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.resolve_class_booking_quote_context(uuid, uuid)
to service_role;

create or replace function public.persist_class_customer_provider_profile(
  candidate_business_id uuid,
  candidate_customer_id uuid,
  candidate_integration_id uuid,
  candidate_provider_site_id text,
  candidate_provider_client_id text,
  candidate_provider_client_unique_id text
)
returns table (
  profile_id uuid,
  provider_client_id text,
  provider_client_unique_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  stored public.class_customer_provider_profiles%rowtype;
begin
  if candidate_provider_site_id is null or length(trim(candidate_provider_site_id)) = 0
    or candidate_provider_client_id is null or length(trim(candidate_provider_client_id)) = 0
    or candidate_provider_client_unique_id is null or length(trim(candidate_provider_client_unique_id)) = 0 then
    raise exception 'complete Site-scoped Client identity is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    candidate_customer_id::text || ':' || candidate_integration_id::text, 0
  ));

  insert into public.class_business_customer_access (business_id, customer_id)
  values (candidate_business_id, candidate_customer_id)
  on conflict (business_id, customer_id) do update
  set revoked_at = null;

  select profile.* into stored
  from public.class_customer_provider_profiles profile
  where profile.customer_id = candidate_customer_id
    and profile.integration_id = candidate_integration_id
  for update;

  if stored.id is not null then
    if stored.business_id is distinct from candidate_business_id
      or stored.provider_site_id is distinct from trim(candidate_provider_site_id)
      or stored.provider_client_id is distinct from trim(candidate_provider_client_id)
      or (stored.provider_client_unique_id is not null
        and stored.provider_client_unique_id is distinct from trim(candidate_provider_client_unique_id)) then
      raise exception 'existing Site-scoped Client identity cannot be overwritten';
    end if;
    if stored.provider_client_unique_id is null then
      update public.class_customer_provider_profiles
      set provider_client_unique_id = trim(candidate_provider_client_unique_id),
          verification_status = 'verified',
          verified_at = now()
      where id = stored.id
      returning * into stored;
    else
      update public.class_customer_provider_profiles
      set verification_status = 'verified', verified_at = now()
      where id = stored.id
      returning * into stored;
    end if;
  else
    insert into public.class_customer_provider_profiles (
      business_id, customer_id, integration_id, provider_site_id,
      provider_client_id, provider_client_unique_id,
      resolution_status, verification_status, verified_at
    ) values (
      candidate_business_id, candidate_customer_id, candidate_integration_id,
      trim(candidate_provider_site_id), trim(candidate_provider_client_id),
      trim(candidate_provider_client_unique_id), 'resolved', 'verified', now()
    )
    returning * into stored;
  end if;

  return query select stored.id, stored.provider_client_id, stored.provider_client_unique_id;
end;
$$;

revoke all on function public.persist_class_customer_provider_profile(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.persist_class_customer_provider_profile(
  uuid, uuid, uuid, text, text, text
) to service_role;

create or replace function public.expire_open_class_booking_quotes()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_count bigint;
begin
  update public.class_booking_quotes
  set status = 'expired'
  where status = 'open' and expires_at <= now();
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

revoke all on function public.expire_open_class_booking_quotes() from public, anon, authenticated;
grant execute on function public.expire_open_class_booking_quotes() to service_role;

select cron.schedule(
  'class-booking-quote-expiry',
  '* * * * *',
  'select public.expire_open_class_booking_quotes();'
);

create or replace function public.purge_expired_class_provider_diagnostics()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_deleted_count bigint := 0;
  deleted_count bigint := 0;
  quote_deleted_count bigint := 0;
begin
  delete from public.class_booking_provider_diagnostics where expires_at <= now();
  get diagnostics booking_deleted_count = row_count;
  delete from public.class_availability_provider_diagnostics where expires_at <= now();
  get diagnostics deleted_count = row_count;
  delete from public.class_quote_provider_diagnostics where expires_at <= now();
  get diagnostics quote_deleted_count = row_count;
  return booking_deleted_count + deleted_count + quote_deleted_count;
end;
$$;

revoke all on function public.purge_expired_class_provider_diagnostics() from public, anon, authenticated;
grant execute on function public.purge_expired_class_provider_diagnostics() to service_role;

alter table public.class_client_resolution_support_work enable row level security;
alter table public.class_quote_provider_diagnostics enable row level security;

create policy class_client_resolution_support_operations_select
on public.class_client_resolution_support_work for select to authenticated
using (public.has_class_operations_access(business_id));

create policy class_quote_provider_diagnostics_operations_select
on public.class_quote_provider_diagnostics for select to authenticated
using (public.has_class_operations_access(business_id));

grant select on public.class_client_resolution_support_work to authenticated, service_role;
grant insert, update on public.class_client_resolution_support_work to service_role;
grant select on public.class_quote_provider_diagnostics to authenticated, service_role;
grant insert on public.class_quote_provider_diagnostics to service_role;

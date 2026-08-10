create table public.class_availability_provider_diagnostics (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  offer_id uuid not null,
  location_id uuid not null,
  mapping_id uuid not null,
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
    references public.class_revvi_offers(business_id, id, location_id)
    on delete restrict,
  foreign key (business_id, mapping_id, offer_id)
    references public.class_offer_provider_mappings(business_id, id, offer_id)
    on delete restrict,
  check (expires_at > created_at and expires_at <= created_at + interval '48 hours')
);

comment on table public.class_availability_provider_diagnostics is
  'Temporary allowlisted facts for Mindbody Class reads. Raw requests, responses, credentials, Client data, and Class payloads are prohibited.';

create index class_availability_diagnostics_expiry_idx
on public.class_availability_provider_diagnostics (expires_at);

create index class_availability_diagnostics_business_created_idx
on public.class_availability_provider_diagnostics (business_id, created_at desc);

create or replace function public.class_validate_mapping_activation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  business_status public.class_business_status;
  integration_status public.class_integration_status;
  location_enabled boolean;
  location_integration_id uuid;
  provider_location_id text;
begin
  if tg_op = 'UPDATE'
    and old.status = 'active'
    and new.status <> 'active'
    and exists (
      select 1 from public.class_revvi_offers offer
      where offer.id = old.offer_id and offer.status = 'active'
    ) then
    raise exception 'an active Revvi Offer must be disabled before its Class mapping';
  end if;

  if new.status <> 'active' then
    return new;
  end if;

  select status into business_status
  from public.class_businesses
  where id = new.business_id;

  select status into integration_status
  from public.class_business_integrations
  where id = new.integration_id and business_id = new.business_id;

  select enabled, integration_id, class_business_locations.provider_location_id
  into location_enabled, location_integration_id, provider_location_id
  from public.class_business_locations
  where id = new.location_id and business_id = new.business_id;

  if business_status is distinct from 'active' then
    raise exception 'active Class mapping requires an active Business';
  end if;

  if integration_status is distinct from 'active'
    or not coalesce(location_enabled, false)
    or location_integration_id is distinct from new.integration_id then
    raise exception 'active Class mapping requires an active integration and enabled Location';
  end if;

  if not exists (
    select 1
    from public.class_offer_inventory_allowlist inventory
    where inventory.mapping_id = new.id
      and inventory.business_id = new.business_id
      and inventory.entity_kind = 'location'
      and inventory.provider_entity_id = provider_location_id
  ) or not exists (
    select 1
    from public.class_offer_inventory_allowlist inventory
    where inventory.mapping_id = new.id
      and inventory.business_id = new.business_id
      and inventory.entity_kind = 'program'
  ) or not exists (
    select 1
    from public.class_offer_inventory_allowlist inventory
    where inventory.mapping_id = new.id
      and inventory.business_id = new.business_id
      and inventory.entity_kind = 'class_description'
  ) or not exists (
    select 1
    from public.class_offer_inventory_allowlist inventory
    where inventory.mapping_id = new.id
      and inventory.business_id = new.business_id
      and inventory.entity_kind = 'session_type'
  ) then
    raise exception 'active Class mapping requires Location, Program, Class Description, and Session Type inventory';
  end if;

  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
    from public.class_offer_provider_mappings mapping
    join public.class_business_locations location
      on location.business_id = mapping.business_id and location.id = mapping.location_id
    where mapping.status = 'active'
      and (
        not exists (
          select 1 from public.class_offer_inventory_allowlist inventory
          where inventory.business_id = mapping.business_id
            and inventory.mapping_id = mapping.id
            and inventory.entity_kind = 'location'
            and inventory.provider_entity_id = location.provider_location_id
        )
        or not exists (
          select 1 from public.class_offer_inventory_allowlist inventory
          where inventory.business_id = mapping.business_id
            and inventory.mapping_id = mapping.id
            and inventory.entity_kind = 'program'
        )
        or not exists (
          select 1 from public.class_offer_inventory_allowlist inventory
          where inventory.business_id = mapping.business_id
            and inventory.mapping_id = mapping.id
            and inventory.entity_kind = 'class_description'
        )
        or not exists (
          select 1 from public.class_offer_inventory_allowlist inventory
          where inventory.business_id = mapping.business_id
            and inventory.mapping_id = mapping.id
            and inventory.entity_kind = 'session_type'
        )
      )
  ) then
    raise exception 'existing active Class mapping has incomplete approved inventory';
  end if;
end;
$$;

create or replace function public.resolve_class_availability_context(
  candidate_business_slug text,
  candidate_location_id uuid,
  candidate_offer_id uuid,
  candidate_customer_id uuid
)
returns table (
  business_id uuid,
  business_slug text,
  business_name text,
  location_id uuid,
  location_name text,
  location_timezone text,
  provider_location_id text,
  offer_id uuid,
  offer_name text,
  fulfilment_mode public.class_offer_fulfilment_mode,
  integration_id uuid,
  provider_site_id text,
  mapping_id uuid,
  provider_service_product_id text,
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
    business.slug,
    business.display_name,
    location.id,
    location.display_name,
    location.timezone,
    location.provider_location_id,
    offer.id,
    offer.display_name,
    offer.fulfilment_mode,
    integration.id,
    integration.provider_site_id,
    mapping.id,
    mapping.provider_service_product_id,
    profile.id,
    profile.provider_client_id,
    profile.provider_client_unique_id,
    jsonb_build_object(
      'location', coalesce((
        select jsonb_agg(inventory.provider_entity_id order by inventory.provider_entity_id)
        from public.class_offer_inventory_allowlist inventory
        where inventory.business_id = business.id
          and inventory.mapping_id = mapping.id
          and inventory.entity_kind = 'location'
      ), '[]'::jsonb),
      'program', coalesce((
        select jsonb_agg(inventory.provider_entity_id order by inventory.provider_entity_id)
        from public.class_offer_inventory_allowlist inventory
        where inventory.business_id = business.id
          and inventory.mapping_id = mapping.id
          and inventory.entity_kind = 'program'
      ), '[]'::jsonb),
      'classDescription', coalesce((
        select jsonb_agg(inventory.provider_entity_id order by inventory.provider_entity_id)
        from public.class_offer_inventory_allowlist inventory
        where inventory.business_id = business.id
          and inventory.mapping_id = mapping.id
          and inventory.entity_kind = 'class_description'
      ), '[]'::jsonb),
      'sessionType', coalesce((
        select jsonb_agg(inventory.provider_entity_id order by inventory.provider_entity_id)
        from public.class_offer_inventory_allowlist inventory
        where inventory.business_id = business.id
          and inventory.mapping_id = mapping.id
          and inventory.entity_kind = 'session_type'
      ), '[]'::jsonb),
      'classSchedule', coalesce((
        select jsonb_agg(inventory.provider_entity_id order by inventory.provider_entity_id)
        from public.class_offer_inventory_allowlist inventory
        where inventory.business_id = business.id
          and inventory.mapping_id = mapping.id
          and inventory.entity_kind = 'class_schedule'
      ), '[]'::jsonb)
    )
  from public.class_businesses business
  join public.class_business_locations location
    on location.business_id = business.id
    and location.id = candidate_location_id
    and location.enabled
  join public.class_revvi_offers offer
    on offer.business_id = business.id
    and offer.location_id = location.id
    and offer.id = candidate_offer_id
    and offer.status = 'active'
  join public.class_offer_provider_mappings mapping
    on mapping.business_id = business.id
    and mapping.offer_id = offer.id
    and mapping.location_id = location.id
    and mapping.fulfilment_mode = offer.fulfilment_mode
    and mapping.status = 'active'
  join public.class_business_integrations integration
    on integration.business_id = business.id
    and integration.id = location.integration_id
    and integration.id = mapping.integration_id
    and integration.provider = 'mindbody'
    and integration.status = 'active'
  left join public.class_customer_provider_profiles profile
    on profile.business_id = business.id
    and profile.customer_id = candidate_customer_id
    and profile.integration_id = integration.id
    and profile.provider = integration.provider
    and profile.provider_site_id = integration.provider_site_id
  where business.slug = candidate_business_slug
    and business.status = 'active';
$$;

comment on function public.resolve_class_availability_context(text, uuid, uuid, uuid) is
  'Returns one server-owned, tenant-scoped active Offer-to-Mindbody Class read context. It never returns occurrence inventory.';

revoke all on function public.resolve_class_availability_context(text, uuid, uuid, uuid) from public;
revoke all on function public.resolve_class_availability_context(text, uuid, uuid, uuid) from anon;
revoke all on function public.resolve_class_availability_context(text, uuid, uuid, uuid) from authenticated;
grant execute on function public.resolve_class_availability_context(text, uuid, uuid, uuid) to service_role;

create or replace function public.purge_expired_class_provider_diagnostics()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_booking_count bigint;
  deleted_availability_count bigint;
begin
  delete from public.class_booking_provider_diagnostics
  where expires_at <= now();
  get diagnostics deleted_booking_count = row_count;

  delete from public.class_availability_provider_diagnostics
  where expires_at <= now();
  get diagnostics deleted_availability_count = row_count;

  return deleted_booking_count + deleted_availability_count;
end;
$$;

alter table public.class_availability_provider_diagnostics enable row level security;

create policy class_availability_diagnostics_operations_select
on public.class_availability_provider_diagnostics
for select to authenticated
using (public.has_class_operations_access(business_id));

grant select, insert, update, delete on public.class_availability_provider_diagnostics to service_role;
grant select on public.class_availability_provider_diagnostics to authenticated;
revoke insert, update, delete on public.class_availability_provider_diagnostics from anon, authenticated;

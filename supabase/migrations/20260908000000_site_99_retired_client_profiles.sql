-- Preserve historical Client bindings when an operator verifies a Site -99 reset.
alter table public.class_customer_provider_profiles
  add column retired_at timestamptz,
  add column retirement_evidence_digest text,
  add constraint class_profile_retirement_evidence check (
    (retired_at is null and retirement_evidence_digest is null)
    or (retired_at is not null and retirement_evidence_digest ~ '^[a-f0-9]{64}$')
  );
alter table public.class_customer_provider_profiles
  drop constraint class_customer_provider_profiles_customer_id_integration_id_key;
alter table public.class_customer_provider_profiles
  drop constraint class_customer_provider_profi_integration_id_provider_clien_key;
create unique index class_current_customer_integration_profile
  on public.class_customer_provider_profiles(customer_id, integration_id) where retired_at is null;
create unique index class_current_integration_client_profile
  on public.class_customer_provider_profiles(integration_id, provider_client_id) where retired_at is null;

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
    on profile.retired_at is null
   and profile.business_id = business.id
    and profile.customer_id = candidate_customer_id
    and profile.integration_id = integration.id
    and profile.provider = integration.provider
    and profile.provider_site_id = integration.provider_site_id
  where business.slug = candidate_business_slug
    and business.status = 'active';
$$;

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
    on profile.retired_at is null
   and profile.business_id = business.id
   and profile.customer_id = customer.id
   and profile.integration_id = integration.id
   and profile.resolution_status = 'resolved'
  where offer.id = candidate_offer_id
    and offer.status = 'active';
$$;

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
    and profile.retired_at is null
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

create or replace function public.retire_missing_site_99_client_profile(
  candidate_profile_id uuid,
  candidate_provider_client_id text,
  candidate_provider_client_unique_id text,
  candidate_evidence_digest text
) returns void
language plpgsql security definer set search_path = public
as $$
declare stored public.class_customer_provider_profiles%rowtype;
begin
  if candidate_evidence_digest is null or candidate_evidence_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'verified missing-client evidence digest required';
  end if;
  select * into strict stored from public.class_customer_provider_profiles
    where id = candidate_profile_id;
  perform pg_advisory_xact_lock(hashtextextended(
    stored.customer_id::text || ':' || stored.integration_id::text, 0));
  select * into strict stored from public.class_customer_provider_profiles
    where id = candidate_profile_id for update;
  if stored.retired_at is not null
    or stored.provider_client_id is distinct from candidate_provider_client_id
    or stored.provider_client_unique_id is distinct from candidate_provider_client_unique_id
    or not exists (
      select 1 from public.class_business_integrations integration
      join public.class_offer_provider_mappings mapping on mapping.integration_id = integration.id
      join public.class_business_locations location on location.id = mapping.location_id
      where integration.id = stored.integration_id and integration.business_id = stored.business_id
        and integration.environment = 'sandbox' and integration.provider_site_id = '-99'
        and integration.status = 'active' and location.provider_location_id = '1'
        and mapping.status = 'active' and mapping.paid_payment_route = 'mindbody_sandbox_cash'
        and mapping.sandbox_demo_write_enabled
        and mapping.sandbox_demo_customer_id = stored.customer_id
    ) then
    raise exception 'only the exact enabled Site -99 demo profile may be retired';
  end if;
  update public.class_customer_provider_profiles
    set retired_at = now(), retirement_evidence_digest = candidate_evidence_digest,
        verification_status = 'stale', verified_at = null
    where id = stored.id;
  update public.class_booking_quotes set status = 'expired'
    where customer_provider_profile_id = stored.id and status = 'open';
end;
$$;
revoke all on function public.retire_missing_site_99_client_profile(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.retire_missing_site_99_client_profile(uuid, text, text, text)
  to service_role;
comment on function public.retire_missing_site_99_client_profile(uuid, text, text, text) is
  'Operator-only Site -99 recovery after authoritative absence verification. Retains immutable historical identities and Booking states; never infers cancellation or retries a provider write.';

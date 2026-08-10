-- Issue #41: controlled, Classes-only pilot readiness and write activation.

create type public.class_pilot_evidence_kind as enum (
  'site_activation',
  'api_product_use_case',
  'commercial_terms',
  'chargeable_locations',
  'endpoint_permissions',
  'retention_classification',
  'signed_offer_terms',
  'memberstack_plan_eligibility',
  'class_inventory_allowlist',
  'timezone_currency_tax',
  'pricing_restrictions',
  'required_client_fields',
  'notification_behavior',
  'eligible_availability',
  'ineligible_revvi_customer_denial',
  'out_of_allowlist_denial',
  'client_resolution',
  'quote_and_requote',
  'authoritative_booking',
  'cancellation_convergence',
  'unknown_convergence',
  'webhook_convergence',
  'diagnostic_expiry',
  'support_process',
  'rollback_drill'
);

create type public.class_pilot_readiness_status as enum (
  'draft', 'active', 'disabled'
);

create type public.class_mindbody_api_product as enum (
  'public_api_consumer_booking'
);

alter table public.class_business_integrations
  add column mindbody_api_product public.class_mindbody_api_product,
  add column chargeable_location_count integer check (chargeable_location_count > 0);

alter table public.class_offer_provider_mappings
  add column pilot_write_enabled boolean not null default false;

comment on column public.class_offer_provider_mappings.pilot_write_enabled is
  'Fail-closed gate for new provider writes. Only activate_class_pilot may enable it after exact mapping-version evidence is complete.';

create table public.class_pilot_evidence (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  integration_id uuid not null references public.class_business_integrations(id) on delete restrict,
  location_id uuid not null references public.class_business_locations(id) on delete restrict,
  offer_id uuid not null references public.class_revvi_offers(id) on delete restrict,
  mapping_id uuid not null references public.class_offer_provider_mappings(id) on delete restrict,
  mapping_version bigint not null check (mapping_version > 0),
  environment public.class_provider_environment not null,
  fulfilment_mode public.class_offer_fulfilment_mode not null,
  configuration_digest text not null check (configuration_digest ~ '^[0-9a-f]{64}$'),
  evidence_kind public.class_pilot_evidence_kind not null,
  artifact_digest text not null check (artifact_digest ~ '^[0-9a-f]{64}$'),
  artifact_reference text not null check (
    length(artifact_reference) between 3 and 512
    and artifact_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]+$'
  ),
  verified_by text not null check (length(trim(verified_by)) between 2 and 200),
  observed_at timestamptz not null,
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text check (
    revocation_reason is null
    or (length(trim(revocation_reason)) between 3 and 500
      and public.class_text_is_redacted(revocation_reason))
  ),
  created_at timestamptz not null default now(),
  check (observed_at <= verified_at),
  check ((revoked_at is null) = (revocation_reason is null)),
  check (revoked_at is null or revoked_at >= verified_at)
);

create unique index class_pilot_evidence_current_kind_idx
on public.class_pilot_evidence (mapping_id, mapping_version, environment, evidence_kind)
where revoked_at is null;

comment on table public.class_pilot_evidence is
  'Typed, digest-only references to controlled Class pilot proof. Raw provider, Revvi Customer, payment, and notification payloads are deliberately excluded.';

create table public.class_pilot_readiness (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  integration_id uuid not null references public.class_business_integrations(id) on delete restrict,
  location_id uuid not null references public.class_business_locations(id) on delete restrict,
  offer_id uuid not null references public.class_revvi_offers(id) on delete restrict,
  mapping_id uuid not null unique references public.class_offer_provider_mappings(id) on delete restrict,
  mapping_version bigint not null check (mapping_version > 0),
  environment public.class_provider_environment not null,
  fulfilment_mode public.class_offer_fulfilment_mode not null,
  configuration_digest text not null check (configuration_digest ~ '^[0-9a-f]{64}$'),
  status public.class_pilot_readiness_status not null default 'draft',
  evidence_set_digest text check (evidence_set_digest is null or evidence_set_digest ~ '^[0-9a-f]{64}$'),
  evaluated_at timestamptz,
  activated_at timestamptz,
  activated_by text,
  disabled_at timestamptz,
  disabled_by text,
  disabled_reason text check (
    disabled_reason is null
    or (length(trim(disabled_reason)) between 3 and 500
      and public.class_text_is_redacted(disabled_reason))
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status <> 'active'
    or (evidence_set_digest is not null and evaluated_at is not null
      and activated_at is not null and activated_by is not null and disabled_at is null)
  ),
  check (
    status <> 'disabled'
    or (disabled_at is not null and disabled_by is not null and disabled_reason is not null)
  )
);

comment on table public.class_pilot_readiness is
  'Classes-only activation ledger for one exact Business/Location/Offer/mapping version and environment. Appointment prototype readiness never satisfies this gate.';

create or replace function public.class_pilot_operator_authorized(candidate_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select session_user = 'postgres'
    or coalesce(auth.role(), '') = 'service_role'
    or public.has_class_operations_access(candidate_business_id);
$$;

create or replace function public.class_pilot_configuration_digest(candidate_mapping_id uuid)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select encode(extensions.digest(jsonb_build_object(
    'businessId', mapping.business_id,
    'integrationId', mapping.integration_id,
    'environment', integration.environment,
    'providerSiteId', integration.provider_site_id,
    'apiProduct', integration.mindbody_api_product,
    'chargeableLocationCount', integration.chargeable_location_count,
    'locationId', mapping.location_id,
    'providerLocationId', location.provider_location_id,
    'timezone', location.timezone,
    'offerId', mapping.offer_id,
    'memberstackPlanIds', (
      select coalesce(jsonb_agg(plan_id order by plan_id), '[]'::jsonb)
      from unnest(offer.eligible_memberstack_plan_ids) plan_id
    ),
    'mappingId', mapping.id,
    'mappingVersion', mapping.mapping_version,
    'fulfilmentMode', mapping.fulfilment_mode,
    'paidPaymentRoute', mapping.paid_payment_route,
    'paidPaymentMethodId', mapping.paid_payment_method_id,
    'paidCheckoutLocationId', mapping.paid_checkout_location_id
  )::text, 'sha256'), 'hex')
  from public.class_offer_provider_mappings mapping
  join public.class_business_integrations integration
    on integration.business_id = mapping.business_id and integration.id = mapping.integration_id
  join public.class_business_locations location
    on location.business_id = mapping.business_id and location.id = mapping.location_id
  join public.class_revvi_offers offer
    on offer.business_id = mapping.business_id and offer.id = mapping.offer_id
  where mapping.id = candidate_mapping_id;
$$;

create or replace function public.class_pilot_mode_ready(candidate_mapping_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(case mapping.fulfilment_mode
    when 'existing_entitlement' then true
    when 'approved_unpaid' then mapping.approved_unpaid_enabled
    when 'purchase_pricing_option' then
      mapping.paid_pricing_option_enabled
      and mapping.paid_payment_route is not null
      and mapping.paid_payment_method_id is not null
      and mapping.paid_checkout_location_id is not null
    else false
  end, false)
  from public.class_offer_provider_mappings mapping
  where mapping.id = candidate_mapping_id;
$$;

create or replace function public.record_class_pilot_evidence(
  candidate_mapping_id uuid,
  candidate_evidence_kind public.class_pilot_evidence_kind,
  candidate_artifact_digest text,
  candidate_artifact_reference text,
  candidate_verified_by text,
  candidate_observed_at timestamptz
)
returns public.class_pilot_evidence
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  mapping_row record;
  evidence_row public.class_pilot_evidence%rowtype;
begin
  select mapping.id, mapping.business_id, mapping.integration_id, mapping.location_id,
    mapping.offer_id, mapping.mapping_version, mapping.fulfilment_mode,
    integration.environment, public.class_pilot_configuration_digest(mapping.id) as configuration_digest
  into mapping_row
  from public.class_offer_provider_mappings mapping
  join public.class_business_integrations integration
    on integration.business_id = mapping.business_id and integration.id = mapping.integration_id
  where mapping.id = candidate_mapping_id;

  if mapping_row.id is null then
    raise exception 'Class pilot Offer mapping was not found';
  end if;
  if not public.class_pilot_operator_authorized(mapping_row.business_id) then
    raise exception 'Class pilot evidence requires operations access';
  end if;
  if candidate_artifact_digest is null or candidate_artifact_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Class pilot evidence requires a SHA-256 artifact digest';
  end if;
  if candidate_artifact_reference is null
    or candidate_artifact_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]+$'
    or length(candidate_artifact_reference) not between 3 and 512 then
    raise exception 'Class pilot evidence requires an opaque artifact reference';
  end if;
  if candidate_verified_by is null or length(trim(candidate_verified_by)) not between 2 and 200 then
    raise exception 'Class pilot evidence requires an identifiable verifier';
  end if;
  if candidate_observed_at is null or candidate_observed_at > now() then
    raise exception 'Class pilot evidence requires a non-future observation time';
  end if;
  if exists (
    select 1 from public.class_pilot_evidence evidence
    where evidence.mapping_id = mapping_row.id
      and evidence.mapping_version = mapping_row.mapping_version
      and evidence.environment = mapping_row.environment
      and evidence.evidence_kind = candidate_evidence_kind
      and evidence.revoked_at is null
  ) then
    raise exception 'current Class pilot evidence already exists for this check';
  end if;

  insert into public.class_pilot_evidence (
    business_id, integration_id, location_id, offer_id, mapping_id,
    mapping_version, environment, fulfilment_mode, configuration_digest, evidence_kind,
    artifact_digest, artifact_reference, verified_by, observed_at
  ) values (
    mapping_row.business_id, mapping_row.integration_id, mapping_row.location_id,
    mapping_row.offer_id, mapping_row.id, mapping_row.mapping_version,
    mapping_row.environment, mapping_row.fulfilment_mode, mapping_row.configuration_digest,
    candidate_evidence_kind,
    candidate_artifact_digest, candidate_artifact_reference,
    trim(candidate_verified_by), candidate_observed_at
  ) returning * into evidence_row;
  return evidence_row;
end;
$$;

create or replace function public.class_pilot_evidence_summary(
  candidate_mapping_id uuid,
  candidate_mapping_version bigint,
  candidate_environment public.class_provider_environment,
  candidate_fulfilment_mode public.class_offer_fulfilment_mode,
  candidate_configuration_digest text
)
returns table(evidence_count integer, evidence_set_digest text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select count(distinct evidence.evidence_kind)::integer,
    encode(extensions.digest(string_agg(
      evidence.evidence_kind::text || ':' || evidence.artifact_digest,
      '|' order by evidence.evidence_kind::text
    ), 'sha256'), 'hex')
  from public.class_pilot_evidence evidence
  where evidence.mapping_id = candidate_mapping_id
    and evidence.mapping_version = candidate_mapping_version
    and evidence.environment = candidate_environment
    and evidence.fulfilment_mode = candidate_fulfilment_mode
    and evidence.configuration_digest = candidate_configuration_digest
    and evidence.revoked_at is null;
$$;

create or replace function public.assert_class_pilot_write_ready(candidate_mapping_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  required_count integer := cardinality(enum_range(null::public.class_pilot_evidence_kind));
begin
  if not exists (
    select 1
    from public.class_offer_provider_mappings mapping
    join public.class_business_integrations integration
      on integration.business_id = mapping.business_id
     and integration.id = mapping.integration_id
     and integration.status = 'active'
    join public.class_pilot_readiness readiness
      on readiness.mapping_id = mapping.id
     and readiness.mapping_version = mapping.mapping_version
     and readiness.environment = integration.environment
     and readiness.fulfilment_mode = mapping.fulfilment_mode
     and readiness.status = 'active'
    join public.class_business_locations location
      on location.business_id = mapping.business_id
     and location.id = mapping.location_id
     and location.integration_id = mapping.integration_id
     and location.enabled
    join public.class_revvi_offers offer
      on offer.business_id = mapping.business_id
     and offer.id = mapping.offer_id
     and offer.location_id = mapping.location_id
     and offer.fulfilment_mode = mapping.fulfilment_mode
     and offer.status = 'active'
    join public.class_businesses business
      on business.id = mapping.business_id and business.status = 'active'
    cross join lateral public.class_pilot_evidence_summary(
      mapping.id, mapping.mapping_version, integration.environment, mapping.fulfilment_mode,
      public.class_pilot_configuration_digest(mapping.id)
    ) evidence_summary
    where mapping.id = candidate_mapping_id
      and mapping.status = 'active'
      and mapping.pilot_write_enabled
      and mapping.mode_verified_at is not null
      and mapping.mode_evidence_digest ~ '^[0-9a-f]{64}$'
      and public.class_pilot_mode_ready(mapping.id)
      and evidence_summary.evidence_count = required_count
      and readiness.evidence_set_digest = evidence_summary.evidence_set_digest
      and readiness.configuration_digest = public.class_pilot_configuration_digest(mapping.id)
  ) then
    raise exception 'Class pilot is not active for this Offer mapping';
  end if;
end;
$$;

create or replace function public.class_pilot_evidence_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.id, new.business_id, new.integration_id, new.location_id, new.offer_id,
      new.mapping_id, new.mapping_version, new.environment, new.fulfilment_mode,
      new.configuration_digest,
      new.evidence_kind, new.artifact_digest, new.artifact_reference,
      new.verified_by, new.observed_at, new.verified_at, new.created_at)
    is distinct from
     (old.id, old.business_id, old.integration_id, old.location_id, old.offer_id,
      old.mapping_id, old.mapping_version, old.environment, old.fulfilment_mode,
      old.configuration_digest,
      old.evidence_kind, old.artifact_digest, old.artifact_reference,
      old.verified_by, old.observed_at, old.verified_at, old.created_at) then
    raise exception 'Class pilot evidence facts are immutable; revoke and record a new result';
  end if;
  if old.revoked_at is not null and (new.revoked_at, new.revocation_reason)
    is distinct from (old.revoked_at, old.revocation_reason) then
    raise exception 'revoked Class pilot evidence is immutable';
  end if;
  return new;
end;
$$;

create trigger class_pilot_evidence_immutable
before update on public.class_pilot_evidence
for each row execute function public.class_pilot_evidence_immutable();

create or replace function public.activate_class_pilot(candidate_mapping_id uuid)
returns public.class_pilot_readiness
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  mapping_row record;
  readiness_row public.class_pilot_readiness%rowtype;
  required_count integer := cardinality(enum_range(null::public.class_pilot_evidence_kind));
  actual_count integer;
  evidence_digest text;
  configuration_digest text;
  actor text := coalesce(auth.uid()::text, session_user);
begin
  select mapping.*, integration.environment, integration.status as integration_status,
    location.enabled as location_enabled, offer.status as offer_status,
    offer.eligible_memberstack_plan_ids, business.status as business_status,
    integration.mindbody_api_product, integration.chargeable_location_count
  into mapping_row
  from public.class_offer_provider_mappings mapping
  join public.class_business_integrations integration
    on integration.business_id = mapping.business_id and integration.id = mapping.integration_id
  join public.class_business_locations location
    on location.business_id = mapping.business_id and location.id = mapping.location_id
  join public.class_revvi_offers offer
    on offer.business_id = mapping.business_id and offer.id = mapping.offer_id
  join public.class_businesses business on business.id = mapping.business_id
  where mapping.id = candidate_mapping_id
  for update of mapping, integration, location, offer, business;

  if mapping_row.id is null then raise exception 'Class pilot Offer mapping was not found'; end if;
  if not public.class_pilot_operator_authorized(mapping_row.business_id) then
    raise exception 'Class pilot activation requires operations access';
  end if;
  if mapping_row.business_status <> 'active' or mapping_row.integration_status <> 'active'
    or not mapping_row.location_enabled or mapping_row.offer_status <> 'active'
    or mapping_row.status <> 'active' then
    raise exception 'Class pilot configuration is not active';
  end if;
  if mapping_row.mode_verified_at is null or mapping_row.mode_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Class pilot fulfilment mode is not verified';
  end if;
  if cardinality(mapping_row.eligible_memberstack_plan_ids) < 1 then
    raise exception 'Class pilot requires exact Memberstack plan eligibility';
  end if;
  if mapping_row.mindbody_api_product is null then
    raise exception 'Class pilot requires the confirmed Mindbody API product and use case';
  end if;
  if mapping_row.chargeable_location_count is null or mapping_row.chargeable_location_count < 1 then
    raise exception 'Class pilot requires the effective chargeable Location count';
  end if;
  if not public.class_pilot_mode_ready(mapping_row.id) then
    raise exception 'Class pilot selected fulfilment mode is disabled or lacks approved evidence';
  end if;
  if exists (
    select required.kind
    from unnest(array['location','program','class_description','session_type']::public.class_inventory_entity_kind[]) required(kind)
    where not exists (
      select 1 from public.class_offer_inventory_allowlist allowed
      where allowed.mapping_id = mapping_row.id and allowed.entity_kind = required.kind
    )
  ) then
    raise exception 'Class pilot inventory allowlist is incomplete';
  end if;

  configuration_digest := public.class_pilot_configuration_digest(mapping_row.id);
  select summary.evidence_count, summary.evidence_set_digest
  into actual_count, evidence_digest
  from public.class_pilot_evidence_summary(
    mapping_row.id, mapping_row.mapping_version,
    mapping_row.environment, mapping_row.fulfilment_mode, configuration_digest
  ) summary;

  if actual_count <> required_count then
    raise exception 'Class pilot evidence is incomplete';
  end if;
  if exists (
    select 1 from public.class_bookings booking
    join public.class_booking_quotes quote on quote.id = booking.quote_id
    where quote.mapping_id = mapping_row.id
      and booking.status in ('pending', 'requires_action', 'cancel_pending', 'unknown')
  ) or exists (
    select 1 from public.class_booking_reconciliation_queue queue
    join public.class_bookings booking on booking.id = queue.booking_id
    join public.class_booking_quotes quote on quote.id = booking.quote_id
    where quote.mapping_id = mapping_row.id
      and queue.status in ('queued', 'processing', 'requires_support')
  ) or exists (
    select 1 from public.class_lifecycle_reconciliation_queue queue
    join public.class_bookings booking on booking.id = queue.booking_id
    join public.class_booking_quotes quote on quote.id = booking.quote_id
    where quote.mapping_id = mapping_row.id
      and queue.status in ('queued', 'processing', 'requires_support')
  ) then
    raise exception 'Class pilot has unresolved Booking outcomes';
  end if;

  insert into public.class_pilot_readiness (
    business_id, integration_id, location_id, offer_id, mapping_id,
    mapping_version, environment, fulfilment_mode, configuration_digest, status,
    evidence_set_digest, evaluated_at, activated_at, activated_by,
    disabled_at, disabled_by, disabled_reason
  ) values (
    mapping_row.business_id, mapping_row.integration_id, mapping_row.location_id,
    mapping_row.offer_id, mapping_row.id, mapping_row.mapping_version,
    mapping_row.environment, mapping_row.fulfilment_mode, configuration_digest, 'active',
    evidence_digest, now(), now(), actor, null, null, null
  ) on conflict (mapping_id) do update set
    business_id = excluded.business_id,
    integration_id = excluded.integration_id,
    location_id = excluded.location_id,
    offer_id = excluded.offer_id,
    mapping_version = excluded.mapping_version,
    environment = excluded.environment,
    fulfilment_mode = excluded.fulfilment_mode,
    configuration_digest = excluded.configuration_digest,
    status = 'active',
    evidence_set_digest = excluded.evidence_set_digest,
    evaluated_at = excluded.evaluated_at,
    activated_at = excluded.activated_at,
    activated_by = excluded.activated_by,
    disabled_at = null,
    disabled_by = null,
    disabled_reason = null,
    updated_at = now()
  returning * into readiness_row;

  update public.class_offer_provider_mappings
  set pilot_write_enabled = true
  where id = mapping_row.id;
  return readiness_row;
end;
$$;

create or replace function public.class_disable_pilot_state(
  candidate_mapping_id uuid,
  candidate_actor text,
  candidate_reason text,
  update_mapping_gate boolean default true
)
returns public.class_pilot_readiness
language plpgsql
security definer
set search_path = public
as $$
declare
  readiness_row public.class_pilot_readiness%rowtype;
begin
  if candidate_actor is null or length(trim(candidate_actor)) not between 2 and 200 then
    raise exception 'Class pilot disablement requires an identifiable actor';
  end if;
  if candidate_reason is null or length(trim(candidate_reason)) not between 3 and 500
    or not public.class_text_is_redacted(candidate_reason) then
    raise exception 'Class pilot disablement requires a safe reason';
  end if;
  if update_mapping_gate then
    update public.class_offer_provider_mappings set pilot_write_enabled = false
    where id = candidate_mapping_id;
  end if;
  update public.class_pilot_readiness set
    status = 'disabled', disabled_at = now(), disabled_by = trim(candidate_actor),
    disabled_reason = trim(candidate_reason), updated_at = now()
  where mapping_id = candidate_mapping_id
  returning * into readiness_row;
  return readiness_row;
end;
$$;

create or replace function public.class_disable_pilots_for_configuration_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_mapping_id uuid;
  affected_mapping_ids uuid[];
  configuration_changed boolean;
  change_reason text;
begin
  case tg_table_name
    when 'class_business_integrations' then
      configuration_changed := (new.environment, new.provider_site_id, new.status,
        new.mindbody_api_product, new.chargeable_location_count)
        is distinct from
        (old.environment, old.provider_site_id, old.status,
         old.mindbody_api_product, old.chargeable_location_count);
      change_reason := 'Mindbody integration configuration changed';
      select coalesce(array_agg(mapping.id), array[]::uuid[]) into affected_mapping_ids
      from public.class_offer_provider_mappings mapping
      where mapping.integration_id = new.id and mapping.pilot_write_enabled;
    when 'class_business_locations' then
      configuration_changed := (new.integration_id, new.provider_location_id, new.timezone, new.enabled)
        is distinct from
        (old.integration_id, old.provider_location_id, old.timezone, old.enabled);
      change_reason := 'Business Location configuration changed';
      select coalesce(array_agg(mapping.id), array[]::uuid[]) into affected_mapping_ids
      from public.class_offer_provider_mappings mapping
      where mapping.location_id = new.id and mapping.pilot_write_enabled;
    when 'class_revvi_offers' then
      configuration_changed := (new.location_id, new.fulfilment_mode,
        new.eligible_memberstack_plan_ids, new.status)
        is distinct from
        (old.location_id, old.fulfilment_mode, old.eligible_memberstack_plan_ids, old.status);
      change_reason := 'Revvi Offer configuration changed';
      select coalesce(array_agg(mapping.id), array[]::uuid[]) into affected_mapping_ids
      from public.class_offer_provider_mappings mapping
      where mapping.offer_id = new.id and mapping.pilot_write_enabled;
    else
      raise exception 'unsupported Class pilot configuration trigger source';
  end case;

  if not configuration_changed then
    return new;
  end if;
  foreach affected_mapping_id in array affected_mapping_ids loop
    perform public.class_disable_pilot_state(
      affected_mapping_id, 'system', change_reason, true
    );
  end loop;
  return new;
end;
$$;

create trigger class_disable_pilots_for_integration_change
after update on public.class_business_integrations
for each row execute function public.class_disable_pilots_for_configuration_change();

create trigger class_disable_pilots_for_location_change
after update on public.class_business_locations
for each row execute function public.class_disable_pilots_for_configuration_change();

create trigger class_disable_pilots_for_offer_change
after update on public.class_revvi_offers
for each row execute function public.class_disable_pilots_for_configuration_change();

create or replace function public.deactivate_class_pilot(candidate_mapping_id uuid, candidate_reason text)
returns public.class_pilot_readiness
language plpgsql
security definer
set search_path = public
as $$
declare
  readiness_row public.class_pilot_readiness%rowtype;
  candidate_business_id uuid;
  actor text := coalesce(auth.uid()::text, session_user);
begin
  select business_id into candidate_business_id
  from public.class_offer_provider_mappings where id = candidate_mapping_id;
  if candidate_business_id is null then raise exception 'Class pilot Offer mapping was not found'; end if;
  if not public.class_pilot_operator_authorized(candidate_business_id) then
    raise exception 'Class pilot deactivation requires operations access';
  end if;
  select * into readiness_row from public.class_disable_pilot_state(
    candidate_mapping_id, actor, candidate_reason, true
  );
  if readiness_row.id is null then raise exception 'Class pilot readiness was not found'; end if;
  return readiness_row;
end;
$$;

create or replace function public.revoke_class_pilot_evidence(candidate_evidence_id uuid, candidate_reason text)
returns public.class_pilot_evidence
language plpgsql
security definer
set search_path = public
as $$
declare
  evidence_row public.class_pilot_evidence%rowtype;
begin
  select * into evidence_row from public.class_pilot_evidence
  where id = candidate_evidence_id for update;
  if evidence_row.id is null then raise exception 'Class pilot evidence was not found'; end if;
  if not public.class_pilot_operator_authorized(evidence_row.business_id) then
    raise exception 'Class pilot evidence revocation requires operations access';
  end if;
  if evidence_row.revoked_at is not null then return evidence_row; end if;
  if candidate_reason is null or length(trim(candidate_reason)) not between 3 and 500
    or not public.class_text_is_redacted(candidate_reason) then
    raise exception 'Class pilot evidence revocation requires a safe reason';
  end if;

  update public.class_pilot_evidence set
    revoked_at = now(), revocation_reason = trim(candidate_reason)
  where id = candidate_evidence_id returning * into evidence_row;
  perform public.class_disable_pilot_state(
    evidence_row.mapping_id, coalesce(auth.uid()::text, session_user),
    'Required pilot evidence was revoked', true
  );
  return evidence_row;
end;
$$;

create or replace function public.class_validate_pilot_write_enablement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.pilot_write_enabled and not old.pilot_write_enabled
    and not exists (
      select 1 from public.class_pilot_readiness readiness
      where readiness.mapping_id = new.id
        and readiness.mapping_version = new.mapping_version
        and readiness.status = 'active'
    ) then
    raise exception 'Class pilot readiness must be active before provider writes are enabled';
  end if;
  if new.pilot_write_enabled and (
    new.mapping_version is distinct from old.mapping_version
    or new.status <> 'active'
    or new.mode_verified_at is null
    or new.mode_evidence_digest is null
  ) then
    new.pilot_write_enabled := false;
    perform public.class_disable_pilot_state(
      new.id, 'system', 'Offer mapping configuration changed', false
    );
  end if;
  return new;
end;
$$;

create trigger zz_class_validate_pilot_write_enablement
before update on public.class_offer_provider_mappings
for each row execute function public.class_validate_pilot_write_enablement();

create or replace function public.class_guard_pilot_provider_attempt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  candidate_mapping_id uuid;
begin
  if new.attempt_type not in ('purchase_booking', 'existing_entitlement_booking', 'approved_unpaid_booking') then
    return new;
  end if;
  -- Database owners can construct transactional fixtures; application traffic cannot bypass the gate.
  if session_user = 'postgres' then return new; end if;
  select quote.mapping_id into candidate_mapping_id
  from public.class_bookings booking
  join public.class_booking_quotes quote on quote.id = booking.quote_id
  where booking.id = new.booking_id;
  perform public.assert_class_pilot_write_ready(candidate_mapping_id);
  return new;
end;
$$;

create trigger class_guard_pilot_provider_attempt
before insert on public.class_booking_provider_attempts
for each row execute function public.class_guard_pilot_provider_attempt();

alter table public.class_pilot_evidence enable row level security;
alter table public.class_pilot_readiness enable row level security;

create policy class_pilot_evidence_operations_select
on public.class_pilot_evidence for select to authenticated
using (public.has_class_operations_access(business_id));
create policy class_pilot_readiness_operations_select
on public.class_pilot_readiness for select to authenticated
using (public.has_class_operations_access(business_id));

grant select on public.class_pilot_evidence, public.class_pilot_readiness to authenticated;
revoke insert, update, delete on public.class_pilot_evidence, public.class_pilot_readiness from service_role;
grant select on public.class_pilot_evidence, public.class_pilot_readiness to service_role;
revoke all on function public.class_pilot_operator_authorized(uuid) from public, anon, authenticated;
grant execute on function public.class_pilot_operator_authorized(uuid) to service_role;
revoke all on function public.class_pilot_configuration_digest(uuid) from public, anon, authenticated;
grant execute on function public.class_pilot_configuration_digest(uuid) to service_role;
revoke all on function public.class_pilot_mode_ready(uuid) from public, anon, authenticated;
grant execute on function public.class_pilot_mode_ready(uuid) to service_role;
revoke all on function public.class_pilot_evidence_summary(uuid, bigint, public.class_provider_environment, public.class_offer_fulfilment_mode, text) from public, anon, authenticated;
grant execute on function public.class_pilot_evidence_summary(uuid, bigint, public.class_provider_environment, public.class_offer_fulfilment_mode, text) to service_role;
revoke all on function public.class_disable_pilot_state(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.class_disable_pilot_state(uuid, text, text, boolean) to service_role;
revoke all on function public.record_class_pilot_evidence(uuid, public.class_pilot_evidence_kind, text, text, text, timestamptz) from public, anon;
grant execute on function public.record_class_pilot_evidence(uuid, public.class_pilot_evidence_kind, text, text, text, timestamptz) to authenticated, service_role;
revoke all on function public.activate_class_pilot(uuid) from public, anon;
grant execute on function public.activate_class_pilot(uuid) to authenticated, service_role;
revoke all on function public.deactivate_class_pilot(uuid, text) from public, anon;
grant execute on function public.deactivate_class_pilot(uuid, text) to authenticated, service_role;
revoke all on function public.revoke_class_pilot_evidence(uuid, text) from public, anon;
grant execute on function public.revoke_class_pilot_evidence(uuid, text) to authenticated, service_role;
revoke all on function public.assert_class_pilot_write_ready(uuid) from public, anon, authenticated;
grant execute on function public.assert_class_pilot_write_ready(uuid) to service_role;

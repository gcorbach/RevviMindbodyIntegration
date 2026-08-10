-- Issue #40: paid pricing-option fulfilment remains fail-closed until one
-- no-raw-card Mindbody route and every recovery behavior are proven.

create type public.class_paid_payment_route as enum (
  'mindbody_alternative_payment'
);

create type public.class_paid_pricing_option_evidence_kind as enum (
  'written_route_approval',
  'processor_country_eligibility',
  'endpoint_auth_permissions',
  'no_raw_card_pci_boundary',
  'test_cart_recalculation',
  'redirect_completion',
  'atomic_purchase_roster',
  'decline_partial_timeout_recovery'
);

create type public.class_paid_checkout_action_status as enum (
  'awaiting_return',
  'completing',
  'completed',
  'unknown'
);

alter table public.class_offer_provider_mappings
  add column paid_pricing_option_enabled boolean not null default false,
  add column paid_payment_route public.class_paid_payment_route,
  add column paid_payment_method_id integer,
  add column paid_checkout_location_id integer,
  add check (
    (fulfilment_mode = 'purchase_pricing_option'
      and (
        (paid_payment_route is null
          and paid_payment_method_id is null
          and paid_checkout_location_id is null)
        or (paid_payment_route is not null
          and paid_payment_method_id between 1 and 2147483647
          and paid_checkout_location_id = 98)
      ))
    or (fulfilment_mode <> 'purchase_pricing_option'
      and not paid_pricing_option_enabled
      and paid_payment_route is null
      and paid_payment_method_id is null
      and paid_checkout_location_id is null)
  ),
  add check (
    not paid_pricing_option_enabled
    or (paid_payment_route is not null
      and paid_payment_method_id is not null
      and paid_checkout_location_id is not null)
  );

comment on column public.class_offer_provider_mappings.paid_pricing_option_enabled is
  'Server-owned per-Offer flag. Paid writes remain closed unless every current route-specific evidence gate also passes.';

alter table public.class_bookings
  add column payment_action_url text,
  add column payment_action_expires_at timestamptz,
  add check (
    (payment_action_url is null and payment_action_expires_at is null)
    or (payment_action_url ~ '^https://[^[:space:]]+$'
      and length(payment_action_url) between 9 and 2048
      and payment_action_expires_at is not null
      and payment_action_expires_at > created_at
      and payment_action_expires_at <= created_at + interval '48 hours')
  );

comment on column public.class_bookings.payment_action_url is
  'Short-lived provider redirect only. It is cleared within the Mindbody 48-hour data boundary and never proves payment success.';

create table public.class_paid_pricing_option_evidence (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  mapping_id uuid not null,
  mapping_version bigint not null check (mapping_version > 0),
  evidence_kind public.class_paid_pricing_option_evidence_kind not null,
  evidence_environment public.class_provider_environment not null,
  payment_route public.class_paid_payment_route not null,
  payment_method_id integer not null check (payment_method_id between 1 and 2147483647),
  checkout_location_id integer not null check (checkout_location_id = 98),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  status public.class_mode_evidence_status not null default 'verified',
  verified_at timestamptz not null,
  verified_by uuid references auth.users(id) on delete restrict,
  source_evidence_id uuid references public.class_paid_pricing_option_evidence(id) on delete restrict,
  production_equivalence_digest text check (
    production_equivalence_digest is null or production_equivalence_digest ~ '^[0-9a-f]{64}$'
  ),
  revoked_at timestamptz,
  revocation_reason text check (
    revocation_reason is null or revocation_reason ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  created_at timestamptz not null default now(),
  foreign key (business_id, mapping_id)
    references public.class_offer_provider_mappings(business_id, id) on delete restrict,
  check (
    (status = 'verified' and revoked_at is null and revocation_reason is null)
    or (status = 'revoked' and revoked_at is not null and revocation_reason is not null)
  ),
  check (
    (source_evidence_id is null and production_equivalence_digest is null)
    or (source_evidence_id is not null and production_equivalence_digest is not null)
  ),
  check (source_evidence_id is null or source_evidence_id <> id)
);

comment on table public.class_paid_pricing_option_evidence is
  'Digest-only approval and sandbox proof for one no-raw-card route. Raw payment details, provider payloads, and credentials are prohibited.';

create unique index class_paid_pricing_option_one_active_evidence_kind
on public.class_paid_pricing_option_evidence (mapping_id, mapping_version, evidence_kind)
where status = 'verified';

create index class_paid_pricing_option_evidence_scope_idx
on public.class_paid_pricing_option_evidence (business_id, mapping_id, mapping_version, status);

create table public.class_paid_checkout_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  booking_id uuid not null,
  attempt_id uuid not null,
  payment_route public.class_paid_payment_route not null,
  access_token_ciphertext text not null check (
    length(access_token_ciphertext) between 1 and 8192
    and access_token_ciphertext ~ '^[A-Za-z0-9_-]+$'
  ),
  access_token_nonce text not null check (
    length(access_token_nonce) = 16
    and access_token_nonce ~ '^[A-Za-z0-9_-]+$'
  ),
  encryption_key_version text not null check (
    length(encryption_key_version) between 1 and 64
    and encryption_key_version ~ '^[A-Za-z0-9._-]+$'
  ),
  status public.class_paid_checkout_action_status not null default 'awaiting_return',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id),
  unique (attempt_id),
  foreign key (business_id, booking_id)
    references public.class_bookings(business_id, id) on delete restrict,
  foreign key (business_id, attempt_id)
    references public.class_booking_provider_attempts(business_id, id) on delete restrict,
  check (expires_at > created_at and expires_at <= created_at + interval '48 hours')
);

comment on table public.class_paid_checkout_actions is
  'Service-only, AES-GCM-sealed provider access tokens for redirect completion. Raw tokens and card data are prohibited.';

create trigger class_paid_checkout_actions_set_updated_at
before update on public.class_paid_checkout_actions
for each row execute function public.class_set_updated_at();

alter table public.class_paid_checkout_actions
  alter column access_token_ciphertext drop not null,
  alter column access_token_nonce drop not null,
  add column completion_token_digest text check (
    completion_token_digest is null or completion_token_digest ~ '^[0-9a-f]{64}$'
  ),
  add column completion_claimed_at timestamptz,
  add column completed_at timestamptz,
  add column error_code text check (
    error_code is null or error_code ~ '^[A-Z][A-Z0-9_:-]{0,127}$'
  ),
  add check (
    (status = 'awaiting_return'
      and access_token_ciphertext is not null and access_token_nonce is not null
      and completion_token_digest is null and completion_claimed_at is null and completed_at is null)
    or (status = 'completing'
      and access_token_ciphertext is not null and access_token_nonce is not null
      and completion_token_digest is not null and completion_claimed_at is not null and completed_at is null)
    or (status = 'completed'
      and access_token_ciphertext is null and access_token_nonce is null
      and completion_token_digest is not null and completion_claimed_at is not null
      and completed_at is not null)
    or (status = 'unknown'
      and access_token_ciphertext is null and access_token_nonce is null
      and completed_at is null
      and ((completion_token_digest is null and completion_claimed_at is null)
        or (completion_token_digest is not null and completion_claimed_at is not null)))
  );

create or replace function public.class_enforce_paid_booking_confirmation_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.fulfilment_mode = 'purchase_pricing_option' and new.status = 'confirmed' and (
    (new.provider_visit_id is null and new.provider_roster_booking_id is null)
    or new.provider_client_service_id is null
    or new.provider_service_product_id is null
    or new.provider_sale_id is null
    or new.provider_cart_id is null
    or new.provider_transaction_id is null
    or new.provider_payment_id is null
  ) then
    raise exception 'paid confirmation requires exact purchase and Class roster evidence';
  end if;
  if new.fulfilment_mode = 'purchase_pricing_option' and new.status = 'confirmed' then
    new.payment_status := 'paid';
  end if;
  return new;
end;
$$;

create trigger class_bookings_enforce_paid_confirmation_evidence
before insert or update on public.class_bookings
for each row execute function public.class_enforce_paid_booking_confirmation_evidence();

-- Payment route and method are part of the binding mapping. Changing either
-- invalidates every quote and every proof recorded against the prior version.
create or replace function public.class_bump_mapping_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.offer_id, old.integration_id, old.location_id, old.fulfilment_mode,
      old.provider_service_product_id, old.inventory_revision,
      old.validation_evidence_digest, old.paid_payment_route,
      old.paid_payment_method_id, old.paid_checkout_location_id)
    is distinct from
    (new.offer_id, new.integration_id, new.location_id, new.fulfilment_mode,
     new.provider_service_product_id, new.inventory_revision,
     new.validation_evidence_digest, new.paid_payment_route,
     new.paid_payment_method_id, new.paid_checkout_location_id)
    or (old.status = 'active' and new.status <> 'active') then
    new.mode_verified_at := null;
    new.mode_evidence_digest := null;
    new.mapping_version := old.mapping_version + 1;
  else
    new.mapping_version := old.mapping_version;
  end if;
  return new;
end;
$$;

create or replace function public.class_validate_paid_pricing_option_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mapping_row public.class_offer_provider_mappings%rowtype;
  integration_environment public.class_provider_environment;
  source_row public.class_paid_pricing_option_evidence%rowtype;
  source_integration_environment public.class_provider_environment;
  source_mapping_current boolean;
begin
  select mapping.* into mapping_row
  from public.class_offer_provider_mappings mapping
  where mapping.business_id = new.business_id
    and mapping.id = new.mapping_id
  for key share;

  select integration.environment into integration_environment
  from public.class_business_integrations integration
  where integration.business_id = mapping_row.business_id
    and integration.id = mapping_row.integration_id;

  if mapping_row.id is null
    or mapping_row.fulfilment_mode <> 'purchase_pricing_option'
    or mapping_row.mapping_version <> new.mapping_version
    or mapping_row.status <> 'active'
    or mapping_row.validated_at is null
    or mapping_row.validation_evidence_digest !~ '^[0-9a-f]{64}$'
    or mapping_row.paid_payment_route is null
    or mapping_row.paid_payment_method_id is null
    or mapping_row.paid_checkout_location_id is null then
    raise exception 'paid pricing-option evidence requires the current configured active mapping';
  end if;
  if new.payment_route is distinct from mapping_row.paid_payment_route
    or new.payment_method_id is distinct from mapping_row.paid_payment_method_id
    or new.checkout_location_id is distinct from mapping_row.paid_checkout_location_id then
    raise exception 'payment evidence must match the configured route and method';
  end if;
  if new.evidence_environment is distinct from integration_environment then
    raise exception 'evidence environment must match the mapping integration';
  end if;
  if new.verified_at > now() then
    raise exception 'paid pricing-option evidence cannot be verified in the future';
  end if;

  if integration_environment = 'sandbox' then
    if new.source_evidence_id is not null or new.production_equivalence_digest is not null then
      raise exception 'sandbox evidence cannot claim a production promotion';
    end if;
  elsif integration_environment = 'production' then
    if new.source_evidence_id is null or new.production_equivalence_digest is null then
      raise exception 'production paid pricing-option evidence requires reviewed sandbox promotion';
    end if;
    select evidence.* into source_row
    from public.class_paid_pricing_option_evidence evidence
    where evidence.id = new.source_evidence_id
    for share;
    if source_row.id is not null then
      select integration.environment,
        source_mapping.mapping_version = source_row.mapping_version
          and source_mapping.fulfilment_mode = 'purchase_pricing_option'
          and source_mapping.status = 'active'
          and source_mapping.validated_at is not null
          and source_mapping.validation_evidence_digest ~ '^[0-9a-f]{64}$'
          and source_mapping.paid_payment_route = source_row.payment_route
          and source_mapping.paid_payment_method_id = source_row.payment_method_id
          and source_mapping.paid_checkout_location_id = source_row.checkout_location_id
      into source_integration_environment, source_mapping_current
      from public.class_offer_provider_mappings source_mapping
      join public.class_business_integrations integration
        on integration.business_id = source_mapping.business_id
       and integration.id = source_mapping.integration_id
      where source_mapping.business_id = source_row.business_id
        and source_mapping.id = source_row.mapping_id;
    end if;
    if source_row.id is null
      or source_row.business_id <> new.business_id
      or source_row.evidence_kind <> new.evidence_kind
      or source_row.status <> 'verified'
      or source_row.evidence_environment <> 'sandbox'
      or source_row.payment_route <> new.payment_route
      or source_row.payment_method_id <> new.payment_method_id
      or source_row.checkout_location_id <> new.checkout_location_id
      or source_integration_environment <> 'sandbox'
      or source_mapping_current is not true
      or new.verified_at < source_row.verified_at then
      raise exception 'production paid pricing-option promotion requires matching current sandbox proof';
    end if;
  else
    raise exception 'paid pricing-option evidence requires a known provider environment';
  end if;
  return new;
end;
$$;

create trigger class_paid_pricing_option_evidence_validate
before insert on public.class_paid_pricing_option_evidence
for each row execute function public.class_validate_paid_pricing_option_evidence();

create or replace function public.class_protect_paid_pricing_option_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'verified'
    and new.status = 'revoked'
    and new.revoked_at is not null
    and new.revocation_reason is not null
    and (old.id, old.business_id, old.mapping_id, old.mapping_version,
         old.evidence_kind, old.evidence_environment, old.payment_route,
         old.payment_method_id, old.checkout_location_id, old.evidence_digest, old.verified_at,
         old.verified_by, old.source_evidence_id,
         old.production_equivalence_digest, old.created_at)
      is not distinct from
        (new.id, new.business_id, new.mapping_id, new.mapping_version,
         new.evidence_kind, new.evidence_environment, new.payment_route,
         new.payment_method_id, new.checkout_location_id, new.evidence_digest, new.verified_at,
         new.verified_by, new.source_evidence_id,
         new.production_equivalence_digest, new.created_at) then
    return new;
  end if;
  raise exception 'controlled paid pricing-option evidence is append-only except for revocation';
end;
$$;

create trigger class_paid_pricing_option_evidence_protect
before update or delete on public.class_paid_pricing_option_evidence
for each row execute function public.class_protect_paid_pricing_option_evidence();

create or replace function public.class_require_paid_pricing_option_activation_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  evidence_missing boolean;
  integration_environment public.class_provider_environment;
begin
  if new.fulfilment_mode <> 'purchase_pricing_option' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.paid_pricing_option_enabled
    and not new.paid_pricing_option_enabled then
    new.mode_verified_at := null;
    new.mode_evidence_digest := null;
  end if;
  if new.mode_verified_at is null or new.mode_evidence_digest is null then
    return new;
  end if;
  if not new.paid_pricing_option_enabled then
    raise exception 'the paid pricing-option route flag must be active';
  end if;
  if new.paid_payment_route is null
    or new.paid_payment_method_id is null
    or new.paid_checkout_location_id is null then
    raise exception 'an exact no-raw-card payment route and method are required';
  end if;

  select integration.environment into integration_environment
  from public.class_business_integrations integration
  where integration.business_id = new.business_id
    and integration.id = new.integration_id;

  select exists (
    select required.kind
    from unnest(enum_range(null::public.class_paid_pricing_option_evidence_kind)) required(kind)
    except
    select target.evidence_kind
    from public.class_paid_pricing_option_evidence target
    left join public.class_paid_pricing_option_evidence source
      on source.id = target.source_evidence_id
    left join public.class_offer_provider_mappings source_mapping
      on source_mapping.business_id = source.business_id
     and source_mapping.id = source.mapping_id
    left join public.class_business_integrations source_integration
      on source_integration.business_id = source_mapping.business_id
     and source_integration.id = source_mapping.integration_id
    where target.business_id = new.business_id
      and target.mapping_id = new.id
      and target.mapping_version = new.mapping_version
      and target.status = 'verified'
      and target.payment_route = new.paid_payment_route
      and target.payment_method_id = new.paid_payment_method_id
      and target.checkout_location_id = new.paid_checkout_location_id
      and (
        (integration_environment = 'sandbox'
          and target.evidence_environment = 'sandbox'
          and target.source_evidence_id is null)
        or
        (integration_environment = 'production'
          and target.evidence_environment = 'production'
          and source.status = 'verified'
          and source.evidence_environment = 'sandbox'
          and source.business_id = target.business_id
          and source.evidence_kind = target.evidence_kind
          and source.payment_route = target.payment_route
          and source.payment_method_id = target.payment_method_id
          and source.checkout_location_id = target.checkout_location_id
          and source_mapping.mapping_version = source.mapping_version
          and source_mapping.fulfilment_mode = 'purchase_pricing_option'
          and source_mapping.status = 'active'
          and source_mapping.validated_at is not null
          and source_mapping.validation_evidence_digest ~ '^[0-9a-f]{64}$'
          and source_mapping.paid_payment_route = source.payment_route
          and source_mapping.paid_payment_method_id = source.payment_method_id
          and source_mapping.paid_checkout_location_id = source.checkout_location_id
          and source_integration.environment = 'sandbox')
      )
  ) into evidence_missing;

  if evidence_missing then
    raise exception 'all paid route approval and controlled provider evidence are required';
  end if;
  return new;
end;
$$;

create trigger class_mappings_require_paid_pricing_option_evidence
before insert or update on public.class_offer_provider_mappings
for each row execute function public.class_require_paid_pricing_option_activation_evidence();

create or replace function public.class_require_paid_pricing_option_offer_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfilment_mode = 'purchase_pricing_option'
    and new.status = 'active'
    and not exists (
      select 1
      from public.class_offer_provider_mappings mapping
      where mapping.business_id = new.business_id
        and mapping.offer_id = new.id
        and mapping.fulfilment_mode = 'purchase_pricing_option'
        and mapping.status = 'active'
        and mapping.paid_pricing_option_enabled
        and mapping.paid_payment_route is not null
        and mapping.paid_payment_method_id is not null
        and mapping.paid_checkout_location_id is not null
        and mapping.mode_verified_at is not null
        and mapping.mode_evidence_digest ~ '^[0-9a-f]{64}$'
    ) then
    raise exception 'a paid Revvi Offer requires its approved route flag and controlled evidence';
  end if;
  return new;
end;
$$;

create trigger class_offers_require_paid_pricing_option_evidence
before insert or update on public.class_revvi_offers
for each row execute function public.class_require_paid_pricing_option_offer_activation();

create or replace function public.class_disable_paid_pricing_option_offer_when_gate_closes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfilment_mode = 'purchase_pricing_option'
    and (
      not new.paid_pricing_option_enabled
      or new.mode_verified_at is null
      or new.mode_evidence_digest is null
    ) then
    update public.class_revvi_offers
    set status = 'inactive'
    where business_id = new.business_id
      and id = new.offer_id
      and status = 'active';
  end if;
  return null;
end;
$$;

create trigger class_mappings_disable_paid_pricing_option_offer
after update on public.class_offer_provider_mappings
for each row execute function public.class_disable_paid_pricing_option_offer_when_gate_closes();

create or replace function public.class_disable_revoked_paid_pricing_option_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'verified' and new.status = 'revoked' then
    update public.class_paid_pricing_option_evidence
    set status = 'revoked', revoked_at = now(), revocation_reason = 'SOURCE_EVIDENCE_REVOKED'
    where source_evidence_id = new.id and status = 'verified';
    update public.class_offer_provider_mappings
    set paid_pricing_option_enabled = false,
        mode_verified_at = null,
        mode_evidence_digest = null
    where business_id = new.business_id
      and id = new.mapping_id
      and mapping_version = new.mapping_version;
  end if;
  return null;
end;
$$;

create trigger class_paid_pricing_option_evidence_disable_on_revoke
after update on public.class_paid_pricing_option_evidence
for each row execute function public.class_disable_revoked_paid_pricing_option_mode();

create or replace function public.class_revoke_paid_pricing_option_evidence_on_mapping_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mapping_version is distinct from old.mapping_version then
    update public.class_paid_pricing_option_evidence
    set status = 'revoked', revoked_at = now(), revocation_reason = 'MAPPING_VERSION_CHANGED'
    where business_id = old.business_id
      and mapping_id = old.id
      and mapping_version = old.mapping_version
      and status = 'verified';
    if new.fulfilment_mode = 'purchase_pricing_option'
      and new.paid_pricing_option_enabled then
      update public.class_offer_provider_mappings
      set paid_pricing_option_enabled = false,
          mode_verified_at = null,
          mode_evidence_digest = null
      where business_id = new.business_id and id = new.id;
    end if;
  end if;
  return null;
end;
$$;

create trigger class_mappings_revoke_stale_paid_pricing_option_evidence
after update on public.class_offer_provider_mappings
for each row execute function public.class_revoke_paid_pricing_option_evidence_on_mapping_change();

create or replace function public.persist_class_booking_payment_action(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_attempt_id uuid,
  candidate_write_token text,
  candidate_redirect_url text,
  candidate_payment_route public.class_paid_payment_route,
  candidate_access_token_ciphertext text,
  candidate_access_token_nonce text,
  candidate_encryption_key_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.class_bookings%rowtype;
  attempt_row public.class_booking_provider_attempts%rowtype;
  lock_row public.class_booking_write_locks%rowtype;
  approved_route public.class_paid_payment_route;
  action_expires_at timestamptz;
begin
  if candidate_write_token !~ '^[0-9a-f]{64}$' then
    raise exception 'a valid Class Booking write token is required';
  end if;
  if candidate_redirect_url is null
    or candidate_redirect_url !~ '^https://[^[:space:]]+$'
    or length(candidate_redirect_url) not between 9 and 2048 then
    raise exception 'a bounded HTTPS payment redirect is required';
  end if;
  if candidate_access_token_ciphertext is null
    or length(candidate_access_token_ciphertext) not between 1 and 8192
    or candidate_access_token_ciphertext !~ '^[A-Za-z0-9_-]+$'
    or candidate_access_token_nonce is null
    or length(candidate_access_token_nonce) <> 16
    or candidate_access_token_nonce !~ '^[A-Za-z0-9_-]+$'
    or candidate_encryption_key_version is null
    or length(candidate_encryption_key_version) not between 1 and 64
    or candidate_encryption_key_version !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'a sealed provider payment action is required';
  end if;

  select booking.* into booking_row
  from public.class_bookings booking
  where booking.business_id = candidate_business_id
    and booking.id = candidate_booking_id
  for update;
  select attempt.* into attempt_row
  from public.class_booking_provider_attempts attempt
  where attempt.business_id = candidate_business_id
    and attempt.id = candidate_attempt_id
    and attempt.booking_id = candidate_booking_id
  for update;
  select write_lock.* into lock_row
  from public.class_booking_write_locks write_lock
  where write_lock.business_id = candidate_business_id
    and write_lock.booking_id = candidate_booking_id
    and write_lock.attempt_id = candidate_attempt_id
    and write_lock.status = 'active'
  for update;

  if booking_row.id is null or attempt_row.id is null or lock_row.id is null
    or lock_row.token_digest is distinct from encode(extensions.digest(candidate_write_token, 'sha256'), 'hex') then
    raise exception 'Class Booking payment-action lock could not be verified';
  end if;
  if booking_row.fulfilment_mode <> 'purchase_pricing_option'
    or booking_row.status <> 'pending'
    or attempt_row.attempt_type <> 'purchase_booking'
    or attempt_row.status <> 'pending' then
    raise exception 'only a pending paid Booking attempt can persist a payment action';
  end if;
  if booking_row.created_at + interval '48 hours' <= now() then
    raise exception 'the paid Booking attempt is outside the provider-data retention window';
  end if;

  select mapping.paid_payment_route into approved_route
  from public.class_booking_quotes quote
  join public.class_offer_provider_mappings mapping
    on mapping.business_id = quote.business_id
   and mapping.id = quote.mapping_id
   and mapping.mapping_version = quote.mapping_version
  where quote.business_id = booking_row.business_id
    and quote.id = booking_row.quote_id
    and mapping.status = 'active'
    and mapping.paid_pricing_option_enabled
    and mapping.mode_verified_at is not null
    and mapping.mode_evidence_digest ~ '^[0-9a-f]{64}$';
  if approved_route is null or candidate_payment_route is distinct from approved_route then
    raise exception 'the provider payment action does not match the approved mapping route';
  end if;

  if booking_row.payment_action_url is not null
    and booking_row.payment_action_url is distinct from candidate_redirect_url then
    raise exception 'a paid Booking attempt cannot replace its payment redirect';
  end if;

  action_expires_at := least(
    now() + interval '47 hours',
    booking_row.created_at + interval '48 hours'
  );
  insert into public.class_paid_checkout_actions (
    business_id, booking_id, attempt_id, payment_route,
    access_token_ciphertext, access_token_nonce, encryption_key_version,
    expires_at
  ) values (
    booking_row.business_id, booking_row.id, attempt_row.id, candidate_payment_route,
    candidate_access_token_ciphertext, candidate_access_token_nonce,
    candidate_encryption_key_version, action_expires_at
  );

  update public.class_bookings set
    status = 'requires_action',
    payment_status = 'requires_action',
    payment_action_url = candidate_redirect_url,
    payment_action_expires_at = action_expires_at,
    error_code = null,
    error_message = null
  where id = booking_row.id
  returning * into booking_row;

  update public.class_booking_provider_attempts set
    status = 'requires_action',
    provider_error_code = null,
    error_message = null,
    completed_at = null
  where id = attempt_row.id
  returning * into attempt_row;

  return jsonb_build_object(
    'booking', jsonb_build_object(
      'id', booking_row.id, 'status', booking_row.status,
      'priceAmount', booking_row.price_amount, 'currency', booking_row.currency,
      'className', booking_row.class_name, 'startAt', booking_row.start_datetime,
      'locationName', booking_row.location_name,
      'providerClassId', booking_row.provider_class_id,
      'providerVisitId', booking_row.provider_visit_id,
      'providerRosterBookingId', booking_row.provider_roster_booking_id,
      'providerWaitlistEntryId', booking_row.provider_waitlist_entry_id,
      'providerClientServiceId', booking_row.provider_client_service_id,
      'providerServiceProductId', booking_row.provider_service_product_id,
      'providerSaleId', booking_row.provider_sale_id,
      'providerCartId', booking_row.provider_cart_id,
      'providerTransactionId', booking_row.provider_transaction_id,
      'providerPaymentId', booking_row.provider_payment_id,
      'redirectUrl', booking_row.payment_action_url
    ),
    'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
  );
end;
$$;

create or replace function public.purge_expired_class_payment_actions()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  affected bigint := 0;
  expired record;
begin
  for expired in
    select action.id as action_id, action.business_id, action.booking_id, action.attempt_id
    from public.class_paid_checkout_actions action
    join public.class_bookings booking
      on booking.business_id = action.business_id and booking.id = action.booking_id
    where action.expires_at <= now()
      and action.status in ('awaiting_return', 'completing')
      and booking.status = 'requires_action'
    for update of action, booking
  loop
    update public.class_paid_checkout_actions set
      status = 'unknown', access_token_ciphertext = null, access_token_nonce = null,
      completed_at = null, error_code = 'PAYMENT_ACTION_EXPIRED'
    where id = expired.action_id;

    update public.class_bookings set
      status = 'unknown', payment_status = 'unknown',
      payment_action_url = null, payment_action_expires_at = null,
      error_code = 'PAYMENT_ACTION_EXPIRED'
    where business_id = expired.business_id and id = expired.booking_id;

    update public.class_booking_provider_attempts set
      status = 'unknown', provider_error_code = 'PAYMENT_ACTION_EXPIRED', completed_at = null
    where business_id = expired.business_id and id = expired.attempt_id;

    insert into public.class_booking_reconciliation_queue (
      business_id, booking_id, attempt_id, reason_code
    ) values (
      expired.business_id, expired.booking_id, expired.attempt_id, 'PAYMENT_ACTION_EXPIRED'
    ) on conflict (attempt_id) do update set
      status = 'queued', reason_code = excluded.reason_code,
      available_at = least(public.class_booking_reconciliation_queue.available_at, excluded.available_at),
      completed_at = null;
    affected := affected + 1;
  end loop;
  return affected;
end;
$$;

create or replace function public.claim_class_paid_checkout_completion(
  candidate_booking_id uuid,
  candidate_customer_id uuid,
  candidate_completion_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  action_row public.class_paid_checkout_actions%rowtype;
  booking_row public.class_bookings%rowtype;
  attempt_row public.class_booking_provider_attempts%rowtype;
  quote_row public.class_booking_quotes%rowtype;
  lock_row public.class_booking_write_locks%rowtype;
begin
  if candidate_completion_token is null or candidate_completion_token !~ '^[0-9a-f]{64}$' then
    raise exception 'a valid paid completion token is required';
  end if;

  select action.* into action_row
  from public.class_paid_checkout_actions action
  where action.booking_id = candidate_booking_id
  for update;
  select booking.* into booking_row
  from public.class_bookings booking
  where booking.id = candidate_booking_id and booking.customer_id = candidate_customer_id
  for update;

  if action_row.id is null or booking_row.id is null then
    raise exception 'paid Class Booking action not found for this Customer';
  end if;

  select attempt.* into attempt_row
  from public.class_booking_provider_attempts attempt
  where attempt.id = action_row.attempt_id
    and attempt.business_id = booking_row.business_id
    and attempt.booking_id = booking_row.id
  for update;
  select quote.* into quote_row
  from public.class_booking_quotes quote
  where quote.id = booking_row.quote_id and quote.business_id = booking_row.business_id;
  select write_lock.* into lock_row
  from public.class_booking_write_locks write_lock
  where write_lock.business_id = booking_row.business_id
    and write_lock.booking_id = booking_row.id
    and write_lock.attempt_id = attempt_row.id
    and write_lock.status = 'active'
  for update;

  if action_row.status <> 'awaiting_return' then
    return jsonb_build_object(
      'shouldComplete', false,
      'booking', jsonb_build_object(
        'id', booking_row.id, 'status', booking_row.status,
        'paymentStatus', booking_row.payment_status
      ),
      'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status),
      'actionStatus', action_row.status
    );
  end if;
  if action_row.expires_at <= now() then
    raise exception 'paid Class Booking action has expired';
  end if;
  if booking_row.fulfilment_mode <> 'purchase_pricing_option'
    or booking_row.status <> 'requires_action'
    or booking_row.payment_status <> 'requires_action'
    or attempt_row.id is null or attempt_row.status <> 'requires_action'
    or quote_row.id is null
    or lock_row.id is null then
    raise exception 'paid Class Booking completion state is invalid';
  end if;

  update public.class_paid_checkout_actions set
    status = 'completing',
    completion_token_digest = encode(extensions.digest(candidate_completion_token, 'sha256'), 'hex'),
    completion_claimed_at = now(),
    error_code = null
  where id = action_row.id
  returning * into action_row;

  return jsonb_build_object(
    'shouldComplete', true,
    'completionToken', candidate_completion_token,
    'booking', jsonb_build_object(
      'id', booking_row.id, 'businessId', booking_row.business_id,
      'status', booking_row.status, 'paymentStatus', booking_row.payment_status,
      'fulfilmentMode', booking_row.fulfilment_mode,
      'providerSiteId', booking_row.provider_site_id,
      'providerClassId', booking_row.provider_class_id,
      'providerClientId', booking_row.provider_client_id,
      'providerClientUniqueId', booking_row.provider_client_unique_id,
      'providerServiceProductId', booking_row.provider_service_product_id,
      'priceAmount', booking_row.price_amount, 'currency', booking_row.currency,
      'integrationId', quote_row.integration_id
    ),
    'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status),
    'action', jsonb_build_object(
      'id', action_row.id, 'paymentRoute', action_row.payment_route,
      'accessTokenCiphertext', action_row.access_token_ciphertext,
      'accessTokenNonce', action_row.access_token_nonce,
      'encryptionKeyVersion', action_row.encryption_key_version,
      'expiresAt', action_row.expires_at
    )
  );
end;
$$;

create or replace function public.finalize_class_paid_checkout_completion(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_attempt_id uuid,
  candidate_completion_token text,
  candidate_outcome text,
  candidate_provider_visit_id text,
  candidate_provider_roster_booking_id text,
  candidate_provider_client_service_id text,
  candidate_provider_service_product_id text,
  candidate_provider_sale_id text,
  candidate_provider_cart_id text,
  candidate_provider_transaction_id text,
  candidate_provider_payment_id text,
  candidate_provider_request_id text,
  candidate_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  action_row public.class_paid_checkout_actions%rowtype;
  booking_row public.class_bookings%rowtype;
  attempt_row public.class_booking_provider_attempts%rowtype;
  lock_row public.class_booking_write_locks%rowtype;
  terminal boolean;
begin
  if candidate_completion_token is null or candidate_completion_token !~ '^[0-9a-f]{64}$'
    or candidate_outcome not in ('confirmed', 'failed', 'unknown') then
    raise exception 'invalid paid Class Booking completion result';
  end if;

  select action.* into action_row from public.class_paid_checkout_actions action
  where action.booking_id = candidate_booking_id for update;
  select booking.* into booking_row from public.class_bookings booking
  where booking.business_id = candidate_business_id and booking.id = candidate_booking_id for update;
  select attempt.* into attempt_row from public.class_booking_provider_attempts attempt
  where attempt.business_id = candidate_business_id and attempt.id = candidate_attempt_id
    and attempt.booking_id = candidate_booking_id for update;
  select write_lock.* into lock_row from public.class_booking_write_locks write_lock
  where write_lock.business_id = candidate_business_id
    and write_lock.booking_id = candidate_booking_id
    and write_lock.attempt_id = candidate_attempt_id
    and write_lock.status = 'active' for update;

  if action_row.id is null or booking_row.id is null or attempt_row.id is null or lock_row.id is null
    or action_row.status <> 'completing'
    or action_row.completion_token_digest is distinct from encode(extensions.digest(candidate_completion_token, 'sha256'), 'hex')
    or booking_row.fulfilment_mode <> 'purchase_pricing_option'
    or booking_row.status <> 'requires_action'
    or attempt_row.status <> 'requires_action' then
    raise exception 'paid Class Booking completion lock could not be verified';
  end if;

  if candidate_outcome = 'confirmed' and (
    (candidate_provider_visit_id is null and candidate_provider_roster_booking_id is null)
    or candidate_provider_client_service_id is null
    or candidate_provider_service_product_id is distinct from booking_row.provider_service_product_id
    or candidate_provider_sale_id is null
    or candidate_provider_cart_id is null
    or candidate_provider_transaction_id is null
    or candidate_provider_payment_id is null
  ) then
    raise exception 'paid confirmation requires exact purchase and Class roster evidence';
  end if;
  if candidate_outcome = 'unknown' and candidate_error_code is null then
    raise exception 'an unknown paid completion requires a reason code';
  end if;

  terminal := candidate_outcome in ('confirmed', 'failed');
  update public.class_bookings set
    status = candidate_outcome::public.class_booking_status,
    payment_status = case candidate_outcome
      when 'confirmed' then 'paid'::public.class_payment_status
      when 'failed' then 'failed'::public.class_payment_status
      else 'unknown'::public.class_payment_status end,
    provider_visit_id = coalesce(candidate_provider_visit_id, provider_visit_id),
    provider_roster_booking_id = coalesce(candidate_provider_roster_booking_id, provider_roster_booking_id),
    provider_client_service_id = coalesce(candidate_provider_client_service_id, provider_client_service_id),
    provider_service_product_id = coalesce(provider_service_product_id, candidate_provider_service_product_id),
    provider_sale_id = coalesce(candidate_provider_sale_id, provider_sale_id),
    provider_cart_id = coalesce(candidate_provider_cart_id, provider_cart_id),
    provider_transaction_id = coalesce(candidate_provider_transaction_id, provider_transaction_id),
    provider_payment_id = coalesce(candidate_provider_payment_id, provider_payment_id),
    payment_action_url = null,
    payment_action_expires_at = null,
    error_code = candidate_error_code,
    confirmed_at = case when candidate_outcome = 'confirmed' then now() else confirmed_at end
  where id = booking_row.id returning * into booking_row;

  update public.class_booking_provider_attempts set
    status = case candidate_outcome
      when 'confirmed' then 'confirmed'::public.class_provider_attempt_status
      when 'failed' then 'failed'::public.class_provider_attempt_status
      else 'unknown'::public.class_provider_attempt_status end,
    provider_request_id = coalesce(candidate_provider_request_id, provider_request_id),
    provider_error_code = candidate_error_code,
    completed_at = case when terminal then now() else completed_at end
  where id = attempt_row.id returning * into attempt_row;

  update public.class_paid_checkout_actions set
    status = case when terminal then 'completed'::public.class_paid_checkout_action_status
      else 'unknown'::public.class_paid_checkout_action_status end,
    access_token_ciphertext = null,
    access_token_nonce = null,
    completed_at = case when terminal then now() else null end,
    error_code = candidate_error_code
  where id = action_row.id;

  if terminal then
    update public.class_booking_write_locks set status = 'released', released_at = now()
    where id = lock_row.id;
    update public.class_booking_reconciliation_queue set status = 'completed', completed_at = now()
    where attempt_id = attempt_row.id and status <> 'completed';
  else
    insert into public.class_booking_reconciliation_queue (
      business_id, booking_id, attempt_id, reason_code
    ) values (
      candidate_business_id, candidate_booking_id, candidate_attempt_id, candidate_error_code
    ) on conflict (attempt_id) do update
      set status = 'queued', reason_code = excluded.reason_code,
          available_at = least(public.class_booking_reconciliation_queue.available_at, excluded.available_at);
  end if;

  return jsonb_build_object(
    'booking', jsonb_build_object(
      'id', booking_row.id, 'status', booking_row.status,
      'paymentStatus', booking_row.payment_status,
      'className', booking_row.class_name,
      'startAt', booking_row.start_datetime,
      'locationName', booking_row.location_name,
      'priceAmount', booking_row.price_amount,
      'currency', booking_row.currency,
      'providerVisitId', booking_row.provider_visit_id,
      'providerRosterBookingId', booking_row.provider_roster_booking_id,
      'providerClientServiceId', booking_row.provider_client_service_id,
      'providerServiceProductId', booking_row.provider_service_product_id,
      'providerSaleId', booking_row.provider_sale_id,
      'providerCartId', booking_row.provider_cart_id,
      'providerTransactionId', booking_row.provider_transaction_id,
      'providerPaymentId', booking_row.provider_payment_id
    ),
    'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
  );
end;
$$;

revoke all on function public.persist_class_booking_payment_action(
  uuid, uuid, uuid, text, text, public.class_paid_payment_route, text, text, text
) from public;
grant execute on function public.persist_class_booking_payment_action(
  uuid, uuid, uuid, text, text, public.class_paid_payment_route, text, text, text
) to service_role;
revoke all on function public.purge_expired_class_payment_actions() from public;
grant execute on function public.purge_expired_class_payment_actions() to service_role;
revoke all on function public.claim_class_paid_checkout_completion(uuid, uuid, text) from public;
grant execute on function public.claim_class_paid_checkout_completion(uuid, uuid, text) to service_role;
revoke all on function public.finalize_class_paid_checkout_completion(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.finalize_class_paid_checkout_completion(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text
) to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'purge-expired-class-payment-actions') then
    perform cron.schedule(
      'purge-expired-class-payment-actions',
      '17 * * * *',
      'select public.purge_expired_class_payment_actions();'
    );
  end if;
end;
$$;

-- Generic evidence recorded before this migration did not prove a no-card
-- route, processor eligibility, recovery, or the PCI boundary.
update public.class_offer_provider_mappings
set paid_pricing_option_enabled = false,
    mode_verified_at = null,
    mode_evidence_digest = null
where fulfilment_mode = 'purchase_pricing_option';

alter table public.class_paid_pricing_option_evidence enable row level security;
alter table public.class_paid_checkout_actions enable row level security;

grant select, insert, update, delete on public.class_paid_pricing_option_evidence to service_role;
grant select, insert, update, delete on public.class_paid_checkout_actions to service_role;

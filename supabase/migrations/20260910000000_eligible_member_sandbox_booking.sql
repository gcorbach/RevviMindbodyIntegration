-- Eligibility belongs to the current Memberstack plan and tenant-scoped Offer.
-- Keep legacy Customer metadata for rolling deployment compatibility only.
alter table public.class_offer_provider_mappings
  drop constraint class_offer_provider_mappings_check3,
  drop constraint class_offer_provider_mappings_check4,
  add constraint class_offer_provider_mappings_check3 check (
    (fulfilment_mode = 'purchase_pricing_option'
      and (
        (paid_payment_route is null
          and paid_payment_method_id is null
          and paid_checkout_location_id is null
          and not sandbox_demo_write_enabled
          and sandbox_demo_customer_id is null
          and sandbox_demo_evidence_digest is null)
        or (paid_payment_route = 'mindbody_alternative_payment'
          and paid_payment_method_id between 1 and 2147483647
          and paid_checkout_location_id = 98
          and not sandbox_demo_write_enabled
          and sandbox_demo_customer_id is null
          and sandbox_demo_evidence_digest is null)
        or (paid_payment_route = 'mindbody_sandbox_cash'
          and paid_payment_method_id is null
          and paid_checkout_location_id = 1
          and sandbox_demo_evidence_digest ~ '^[0-9a-f]{64}$')
      ))
    or (fulfilment_mode <> 'purchase_pricing_option'
      and not paid_pricing_option_enabled
      and paid_payment_route is null
      and paid_payment_method_id is null
      and paid_checkout_location_id is null
      and not sandbox_demo_write_enabled
      and sandbox_demo_customer_id is null
      and sandbox_demo_evidence_digest is null)
  ),
  add constraint class_offer_provider_mappings_check4 check (
    not paid_pricing_option_enabled
    or (paid_payment_route = 'mindbody_alternative_payment'
      and paid_payment_method_id is not null
      and paid_checkout_location_id = 98)
    or (paid_payment_route = 'mindbody_sandbox_cash'
      and paid_payment_method_id is null
      and paid_checkout_location_id = 1
      and sandbox_demo_write_enabled
      and sandbox_demo_evidence_digest ~ '^[0-9a-f]{64}$')
  );


create or replace function public.class_require_paid_pricing_option_activation_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  evidence_missing boolean;
  integration_environment public.class_provider_environment;
  integration_site_id text;
  location_provider_id text;
begin
  if new.fulfilment_mode <> 'purchase_pricing_option' then return new; end if;
  if tg_op = 'UPDATE' and old.paid_pricing_option_enabled and not new.paid_pricing_option_enabled then
    new.mode_verified_at := null;
    new.mode_evidence_digest := null;
  end if;
  if new.mode_verified_at is null or new.mode_evidence_digest is null then return new; end if;
  if not new.paid_pricing_option_enabled then
    raise exception 'the paid pricing-option route flag must be active';
  end if;

  select integration.environment, integration.provider_site_id, location.provider_location_id
  into integration_environment, integration_site_id, location_provider_id
  from public.class_business_integrations integration
  join public.class_business_locations location
    on location.business_id = integration.business_id
   and location.integration_id = integration.id
   and location.id = new.location_id
  where integration.business_id = new.business_id and integration.id = new.integration_id;

  if new.paid_payment_route = 'mindbody_sandbox_cash' then
    if integration_environment <> 'sandbox'
      or integration_site_id <> '-99'
      or location_provider_id <> '1'
      or new.paid_checkout_location_id <> 1
      or new.paid_payment_method_id is not null
      or not new.sandbox_demo_write_enabled
      or new.sandbox_demo_evidence_digest !~ '^[0-9a-f]{64}$' then
      raise exception 'the fictitious Cash route is restricted to the exact Site -99 demo scope';
    end if;
    return new;
  end if;

  if new.paid_payment_route <> 'mindbody_alternative_payment'
    or new.paid_payment_method_id is null or new.paid_checkout_location_id <> 98 then
    raise exception 'an exact no-raw-card payment route and method are required';
  end if;

  select exists (
    select required.kind
    from unnest(enum_range(null::public.class_paid_pricing_option_evidence_kind)) required(kind)
    except
    select target.evidence_kind
    from public.class_paid_pricing_option_evidence target
    left join public.class_paid_pricing_option_evidence source on source.id = target.source_evidence_id
    left join public.class_offer_provider_mappings source_mapping
      on source_mapping.business_id = source.business_id and source_mapping.id = source.mapping_id
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
          and target.evidence_environment = 'sandbox' and target.source_evidence_id is null)
        or (integration_environment = 'production'
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

create or replace function public.class_guard_pilot_provider_attempt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  candidate_mapping_id uuid;
  sandbox_demo_allowed boolean;
begin
  if new.attempt_type not in ('purchase_booking', 'existing_entitlement_booking', 'approved_unpaid_booking') then
    return new;
  end if;
  if session_user = 'postgres' then return new; end if;
  select quote.mapping_id,
    mapping.sandbox_demo_write_enabled
      and mapping.paid_payment_route = 'mindbody_sandbox_cash'
      and mapping.paid_pricing_option_enabled
      and mapping.mode_verified_at is not null
      and mapping.mode_evidence_digest ~ '^[0-9a-f]{64}$'
      and mapping.sandbox_demo_evidence_digest ~ '^[0-9a-f]{64}$'
      and integration.environment = 'sandbox'
      and integration.provider_site_id = '-99'
      and location.provider_location_id = '1'
  into candidate_mapping_id, sandbox_demo_allowed
  from public.class_bookings booking
  join public.class_booking_quotes quote on quote.id = booking.quote_id
  join public.class_offer_provider_mappings mapping on mapping.id = quote.mapping_id
  join public.class_business_integrations integration on integration.id = mapping.integration_id
  join public.class_business_locations location on location.id = mapping.location_id
  where booking.id = new.booking_id;
  if coalesce(sandbox_demo_allowed, false) then return new; end if;
  perform public.assert_class_pilot_write_ready(candidate_mapping_id);
  return new;
end;
$$;

create or replace function public.persist_class_sandbox_demo_restoration_baseline(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_attempt_id uuid,
  candidate_write_token text,
  candidate_current boolean,
  candidate_returned boolean,
  candidate_unlimited boolean,
  candidate_remaining numeric,
  candidate_observed_at timestamptz
)
returns public.class_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.class_bookings%rowtype;
  attempt_row public.class_booking_provider_attempts%rowtype;
  lock_row public.class_cancellation_write_locks%rowtype;
  exact_scope boolean;
begin
  select booking.* into booking_row from public.class_bookings booking
  where booking.business_id = candidate_business_id and booking.id = candidate_booking_id
  for update;
  select attempt.* into attempt_row from public.class_booking_provider_attempts attempt
  where attempt.business_id = candidate_business_id and attempt.id = candidate_attempt_id
    and attempt.booking_id = candidate_booking_id
    and attempt.attempt_type in ('cancellation', 'waitlist_removal')
  for update;
  select cancellation_lock.* into lock_row from public.class_cancellation_write_locks cancellation_lock
  where cancellation_lock.business_id = candidate_business_id
    and cancellation_lock.booking_id = candidate_booking_id
    and cancellation_lock.attempt_id = candidate_attempt_id
    and cancellation_lock.status = 'active'
  for update;
  select exists (
    select 1
    from public.class_booking_quotes quote
    join public.class_offer_provider_mappings mapping
      on mapping.business_id = quote.business_id and mapping.id = quote.mapping_id
    join public.class_business_integrations integration
      on integration.business_id = mapping.business_id and integration.id = mapping.integration_id
    join public.class_business_locations location
      on location.business_id = mapping.business_id and location.id = mapping.location_id
    where quote.business_id = booking_row.business_id and quote.id = booking_row.quote_id
      and mapping.paid_payment_route = 'mindbody_sandbox_cash'
      and integration.environment = 'sandbox' and integration.provider_site_id = '-99'
      and location.provider_location_id = '1'
  ) into exact_scope;
  if booking_row.id is null or attempt_row.id is null or lock_row.id is null
    or booking_row.status <> 'cancel_pending'
    or booking_row.fulfilment_mode <> 'purchase_pricing_option'
    or booking_row.provider_client_service_id is null
    or not coalesce(exact_scope, false)
    or lock_row.token_digest is distinct from encode(extensions.digest(candidate_write_token, 'sha256'), 'hex') then
    raise exception 'an exact locked Site -99 Cash cancellation is required';
  end if;
  if candidate_current is null or candidate_returned is null or candidate_unlimited is null
    or candidate_observed_at is null or candidate_observed_at > now() then
    raise exception 'a complete non-future sandbox ClientService baseline is required';
  end if;
  if booking_row.restoration_baseline_observed_at is not null then
    if booking_row.restoration_baseline_current is distinct from candidate_current
      or booking_row.restoration_baseline_returned is distinct from candidate_returned
      or booking_row.restoration_baseline_unlimited is distinct from candidate_unlimited
      or booking_row.restoration_baseline_remaining is distinct from candidate_remaining
      or booking_row.restoration_baseline_observed_at is distinct from candidate_observed_at then
      raise exception 'the sandbox ClientService baseline is immutable after persistence';
    end if;
    return booking_row;
  end if;
  update public.class_bookings set
    restoration_baseline_current = candidate_current,
    restoration_baseline_returned = candidate_returned,
    restoration_baseline_unlimited = candidate_unlimited,
    restoration_baseline_remaining = candidate_remaining,
    restoration_baseline_observed_at = candidate_observed_at
  where id = booking_row.id returning * into booking_row;
  return booking_row;
end;
$$;

create or replace function public.record_class_sandbox_demo_restoration(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_restoration_status public.class_provider_attempt_status,
  candidate_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.class_bookings%rowtype;
  exact_scope boolean;
begin
  if candidate_restoration_status not in ('confirmed', 'failed', 'unknown') then
    raise exception 'sandbox ClientService restoration must be confirmed, failed, or unknown';
  end if;
  select booking.* into booking_row from public.class_bookings booking
  where booking.business_id = candidate_business_id and booking.id = candidate_booking_id
  for update;
  select exists (
    select 1
    from public.class_booking_quotes quote
    join public.class_offer_provider_mappings mapping
      on mapping.business_id = quote.business_id and mapping.id = quote.mapping_id
    join public.class_business_integrations integration
      on integration.business_id = mapping.business_id and integration.id = mapping.integration_id
    join public.class_business_locations location
      on location.business_id = mapping.business_id and location.id = mapping.location_id
    where quote.business_id = booking_row.business_id and quote.id = booking_row.quote_id
      and mapping.paid_payment_route = 'mindbody_sandbox_cash'
      and integration.environment = 'sandbox' and integration.provider_site_id = '-99'
      and location.provider_location_id = '1'
  ) into exact_scope;
  if booking_row.id is null or booking_row.status <> 'cancelled'
    or booking_row.fulfilment_mode <> 'purchase_pricing_option'
    or booking_row.provider_client_service_id is null
    or booking_row.restoration_baseline_observed_at is null
    or not coalesce(exact_scope, false) then
    raise exception 'a cancelled Site -99 Cash Booking with its exact baseline is required';
  end if;
  update public.class_bookings set
    restoration_status = candidate_restoration_status,
    restoration_observed_at = case
      when candidate_restoration_status in ('confirmed', 'failed') then now()
      else restoration_observed_at
    end,
    restoration_error_code = candidate_error_code,
    last_lifecycle_reconciled_at = now()
  where id = booking_row.id returning * into booking_row;
  if candidate_restoration_status = 'unknown' then
    insert into public.class_lifecycle_reconciliation_queue (
      business_id, booking_id, purpose, source, reason_code
    ) values (
      booking_row.business_id, booking_row.id, 'cancellation', 'manual',
      coalesce(candidate_error_code, 'SANDBOX_CLIENT_SERVICE_RESTORATION_UNKNOWN')
    ) on conflict (booking_id, purpose) where status in ('queued', 'processing', 'requires_support')
      do update set status = 'queued',
        available_at = least(public.class_lifecycle_reconciliation_queue.available_at, now()),
        reason_code = excluded.reason_code;
  end if;
  return jsonb_build_object('booking', jsonb_build_object(
    'id', booking_row.id,
    'status', 'cancelled',
    'cancelledAt', booking_row.cancelled_at,
    'passRestoration', case candidate_restoration_status
      when 'confirmed' then 'restored'
      when 'failed' then 'not_restored'
      else 'unknown'
    end,
    'refund', 'not_requested'
  ));
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

create or replace function public.register_site_99_quote_pricing_option(
  candidate_business_id uuid, candidate_mapping_id uuid, candidate_customer_id uuid,
  candidate_product_id text, candidate_evidence_digest text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if candidate_product_id is null or length(trim(candidate_product_id)) = 0
    or candidate_evidence_digest is null or candidate_evidence_digest !~ '^[a-f0-9]{64}$'
    or not exists (
      select 1 from public.class_offer_provider_mappings mapping
      join public.class_business_integrations integration on integration.id = mapping.integration_id
      join public.class_business_locations location on location.id = mapping.location_id
      where mapping.id = candidate_mapping_id and mapping.business_id = candidate_business_id
        and integration.environment = 'sandbox' and integration.provider_site_id = '-99'
        and integration.status = 'active' and location.provider_location_id = '1'
        and mapping.status = 'active' and mapping.fulfilment_mode = 'purchase_pricing_option'
        and mapping.paid_payment_route = 'mindbody_sandbox_cash'
        and mapping.sandbox_demo_write_enabled and mapping.paid_pricing_option_enabled
        and exists (
          select 1 from public.class_business_customer_access access
          where access.business_id = candidate_business_id
            and access.customer_id = candidate_customer_id
            and access.revoked_at is null
        )
    ) then
    raise exception 'only the enabled Site -99 quote lane may register discovered pricing options';
  end if;
  insert into public.class_offer_pricing_options (
    business_id, mapping_id, provider_service_product_id, status, validated_at, validation_evidence_digest
  ) values (
    candidate_business_id, candidate_mapping_id, trim(candidate_product_id), 'active', now(), candidate_evidence_digest
  ) on conflict (business_id, mapping_id, provider_service_product_id) do update
    set status = 'active', validated_at = excluded.validated_at,
        validation_evidence_digest = excluded.validation_evidence_digest;
end;
$$;

comment on column public.class_offer_provider_mappings.sandbox_demo_customer_id is
  'Deprecated demo metadata; never grants or restricts member booking authorization.';
comment on column public.class_offer_provider_mappings.sandbox_demo_write_enabled is
  'Operator gate for fictitious Cash at sandbox Site -99 Location 1. All Customers eligible for the tenant Offer may use it.';

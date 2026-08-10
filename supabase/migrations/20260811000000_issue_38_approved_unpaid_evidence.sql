-- Issue #38: approved-unpaid writes require an explicit flag and controlled evidence.

create type public.class_approved_unpaid_evidence_kind as enum (
  'written_business_approval',
  'provider_permissions',
  'unpaid_roster_booking',
  'notification_behavior',
  'cancellation_behavior',
  'booking_reconciliation'
);

alter table public.class_offer_provider_mappings
add column approved_unpaid_enabled boolean not null default false;

comment on column public.class_offer_provider_mappings.approved_unpaid_enabled is
  'Server-owned per-Offer feature flag. It opens approved-unpaid writes only while current controlled evidence is also verified.';

alter table public.class_bookings
add column fulfilment_mode public.class_offer_fulfilment_mode;

update public.class_bookings booking
set fulfilment_mode = quote.fulfilment_mode
from public.class_booking_quotes quote
where quote.business_id = booking.business_id
  and quote.id = booking.quote_id;

alter table public.class_bookings
alter column fulfilment_mode set not null;

alter table public.class_bookings
add constraint class_approved_unpaid_confirmation_is_nonfinancial check (
  fulfilment_mode <> 'approved_unpaid'
  or (
    payment_status = 'not_required'
    and (
      status not in ('confirmed', 'waitlisted')
      or (
        status = 'confirmed'
        and price_amount = 0
        and provider_waitlist_entry_id is null
        and provider_client_service_id is null
        and provider_service_product_id is null
        and provider_sale_id is null
        and provider_cart_id is null
        and provider_transaction_id is null
        and provider_payment_id is null
      )
    )
  )
);

create or replace function public.class_bind_booking_fulfilment_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_mode public.class_offer_fulfilment_mode;
begin
  if tg_op = 'UPDATE' then
    if new.fulfilment_mode is distinct from old.fulfilment_mode then
      raise exception 'a Class Booking fulfilment mode is immutable';
    end if;
    return new;
  end if;

  select quote.fulfilment_mode into quote_mode
  from public.class_booking_quotes quote
  where quote.business_id = new.business_id
    and quote.id = new.quote_id;

  if quote_mode is null then
    raise exception 'a Class Booking requires its binding quote mode';
  end if;
  if new.fulfilment_mode is not null and new.fulfilment_mode is distinct from quote_mode then
    raise exception 'a Class Booking fulfilment mode must match its binding quote';
  end if;
  new.fulfilment_mode := quote_mode;
  return new;
end;
$$;

create trigger class_bookings_bind_fulfilment_mode
before insert or update on public.class_bookings
for each row execute function public.class_bind_booking_fulfilment_mode();

create or replace function public.record_class_booking_reconciliation_observation(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_attempt_id uuid,
  candidate_write_token text,
  candidate_provider_visit_id text,
  candidate_provider_roster_booking_id text,
  candidate_provider_waitlist_entry_id text,
  candidate_provider_client_service_id text,
  candidate_provider_service_product_id text,
  candidate_provider_sale_id text,
  candidate_provider_cart_id text,
  candidate_provider_transaction_id text,
  candidate_provider_payment_id text,
  candidate_error_code text
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
begin
  if candidate_write_token !~ '^[0-9a-f]{64}$' then
    raise exception 'a valid Class Booking write token is required';
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
    raise exception 'Class Booking reconciliation lock could not be verified';
  end if;
  if booking_row.status not in ('pending', 'unknown')
    or attempt_row.status not in ('pending', 'unknown') then
    raise exception 'only an unresolved Booking attempt can record reconciliation evidence';
  end if;

  update public.class_bookings set
    status = 'unknown',
    provider_visit_id = coalesce(provider_visit_id, candidate_provider_visit_id),
    provider_roster_booking_id = coalesce(provider_roster_booking_id, candidate_provider_roster_booking_id),
    provider_waitlist_entry_id = coalesce(provider_waitlist_entry_id, candidate_provider_waitlist_entry_id),
    provider_client_service_id = coalesce(provider_client_service_id, candidate_provider_client_service_id),
    provider_service_product_id = coalesce(provider_service_product_id, candidate_provider_service_product_id),
    provider_sale_id = coalesce(provider_sale_id, candidate_provider_sale_id),
    provider_cart_id = coalesce(provider_cart_id, candidate_provider_cart_id),
    provider_transaction_id = coalesce(provider_transaction_id, candidate_provider_transaction_id),
    provider_payment_id = coalesce(provider_payment_id, candidate_provider_payment_id),
    error_code = candidate_error_code
  where id = booking_row.id
  returning * into booking_row;

  update public.class_booking_provider_attempts set
    status = 'unknown',
    provider_error_code = candidate_error_code
  where id = attempt_row.id
  returning * into attempt_row;

  insert into public.class_booking_reconciliation_queue (
    business_id, booking_id, attempt_id, reason_code
  ) values (
    candidate_business_id, candidate_booking_id, candidate_attempt_id,
    coalesce(candidate_error_code, 'PROVIDER_OUTCOME_UNKNOWN')
  ) on conflict (attempt_id) do update
    set status = 'queued', reason_code = excluded.reason_code,
        available_at = least(public.class_booking_reconciliation_queue.available_at, excluded.available_at);

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
      'providerPaymentId', booking_row.provider_payment_id
    ),
    'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
  );
end;
$$;

create table public.class_approved_unpaid_evidence (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  mapping_id uuid not null,
  mapping_version bigint not null check (mapping_version > 0),
  evidence_kind public.class_approved_unpaid_evidence_kind not null,
  evidence_environment public.class_provider_environment not null default 'sandbox',
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  status public.class_mode_evidence_status not null default 'verified',
  verified_at timestamptz not null,
  verified_by uuid references auth.users(id) on delete restrict,
  source_evidence_id uuid references public.class_approved_unpaid_evidence(id) on delete restrict,
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

comment on table public.class_approved_unpaid_evidence is
  'Digest-only proof of written approval and controlled unpaid roster behavior. Raw agreements, notifications, and provider payloads are prohibited.';

create unique index class_approved_unpaid_one_active_evidence_kind
on public.class_approved_unpaid_evidence (mapping_id, mapping_version, evidence_kind)
where status = 'verified';

create index class_approved_unpaid_evidence_scope_idx
on public.class_approved_unpaid_evidence (business_id, mapping_id, mapping_version, status);

create or replace function public.class_validate_approved_unpaid_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mapping_row public.class_offer_provider_mappings%rowtype;
  integration_environment public.class_provider_environment;
  source_row public.class_approved_unpaid_evidence%rowtype;
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
    or mapping_row.fulfilment_mode <> 'approved_unpaid'
    or mapping_row.mapping_version <> new.mapping_version
    or mapping_row.status <> 'active'
    or mapping_row.validated_at is null
    or mapping_row.validation_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'approved-unpaid evidence requires the current active validated mapping';
  end if;
  if new.evidence_environment is distinct from integration_environment then
    raise exception 'evidence environment must match the mapping integration';
  end if;

  if integration_environment = 'sandbox' then
    if new.source_evidence_id is not null or new.production_equivalence_digest is not null then
      raise exception 'sandbox evidence cannot claim a production promotion';
    end if;
  elsif integration_environment = 'production' then
    if new.source_evidence_id is null or new.production_equivalence_digest is null then
      raise exception 'production approved-unpaid evidence requires reviewed sandbox promotion';
    end if;
    select evidence.* into source_row
    from public.class_approved_unpaid_evidence evidence
    where evidence.id = new.source_evidence_id
    for share;
    if source_row.id is not null then
      select integration.environment,
        source_mapping.mapping_version = source_row.mapping_version
          and source_mapping.fulfilment_mode = 'approved_unpaid'
          and source_mapping.status = 'active'
          and source_mapping.validated_at is not null
          and source_mapping.validation_evidence_digest ~ '^[0-9a-f]{64}$'
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
      or source_integration_environment <> 'sandbox'
      or source_mapping_current is not true
      or new.verified_at < source_row.verified_at then
      raise exception 'production approved-unpaid promotion requires matching current sandbox proof';
    end if;
  else
    raise exception 'approved-unpaid evidence requires a known provider environment';
  end if;

  if new.verified_at > now() then
    raise exception 'approved-unpaid evidence cannot be verified in the future';
  end if;
  return new;
end;
$$;

create trigger class_approved_unpaid_evidence_validate
before insert on public.class_approved_unpaid_evidence
for each row execute function public.class_validate_approved_unpaid_evidence();

create or replace function public.class_protect_approved_unpaid_evidence()
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
         old.evidence_kind, old.evidence_environment, old.evidence_digest,
         old.verified_at, old.verified_by, old.source_evidence_id,
         old.production_equivalence_digest, old.created_at)
      is not distinct from
        (new.id, new.business_id, new.mapping_id, new.mapping_version,
         new.evidence_kind, new.evidence_environment, new.evidence_digest,
         new.verified_at, new.verified_by, new.source_evidence_id,
         new.production_equivalence_digest, new.created_at) then
    return new;
  end if;
  raise exception 'controlled approved-unpaid evidence is append-only except for revocation';
end;
$$;

create trigger class_approved_unpaid_evidence_protect
before update or delete on public.class_approved_unpaid_evidence
for each row execute function public.class_protect_approved_unpaid_evidence();

create or replace function public.class_require_approved_unpaid_activation_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  evidence_missing boolean;
  integration_environment public.class_provider_environment;
begin
  if new.fulfilment_mode <> 'approved_unpaid' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.approved_unpaid_enabled
    and not new.approved_unpaid_enabled then
    new.mode_verified_at := null;
    new.mode_evidence_digest := null;
  end if;

  if new.mode_verified_at is null or new.mode_evidence_digest is null then
    return new;
  end if;
  if not new.approved_unpaid_enabled then
    raise exception 'the approved-unpaid feature flag must be active';
  end if;
  if tg_op = 'INSERT' then
    raise exception 'approved-unpaid mappings must be created inactive before evidence is recorded';
  end if;

  select integration.environment into integration_environment
  from public.class_business_integrations integration
  where integration.business_id = new.business_id
    and integration.id = new.integration_id;

  if integration_environment = 'production' then
    perform source.id
    from public.class_approved_unpaid_evidence target
    join public.class_approved_unpaid_evidence source
      on source.id = target.source_evidence_id
    join public.class_offer_provider_mappings source_mapping
      on source_mapping.business_id = source.business_id
     and source_mapping.id = source.mapping_id
    join public.class_business_integrations source_integration
      on source_integration.business_id = source_mapping.business_id
     and source_integration.id = source_mapping.integration_id
    where target.business_id = new.business_id
      and target.mapping_id = new.id
      and target.mapping_version = new.mapping_version
      and target.status = 'verified'
      and source.status = 'verified'
      and source.evidence_environment = 'sandbox'
      and source.business_id = target.business_id
      and source.evidence_kind = target.evidence_kind
      and source_mapping.mapping_version = source.mapping_version
      and source_mapping.fulfilment_mode = 'approved_unpaid'
      and source_mapping.status = 'active'
      and source_mapping.validated_at is not null
      and source_mapping.validation_evidence_digest ~ '^[0-9a-f]{64}$'
      and source_integration.environment = 'sandbox'
    for share of source;
  end if;

  select exists (
    select required.kind
    from unnest(enum_range(null::public.class_approved_unpaid_evidence_kind)) required(kind)
    except
    select target.evidence_kind
    from public.class_approved_unpaid_evidence target
    left join public.class_approved_unpaid_evidence source
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
          and source_mapping.mapping_version = source.mapping_version
          and source_mapping.fulfilment_mode = 'approved_unpaid'
          and source_mapping.status = 'active'
          and source_mapping.validated_at is not null
          and source_mapping.validation_evidence_digest ~ '^[0-9a-f]{64}$'
          and source_integration.environment = 'sandbox')
      )
  ) into evidence_missing;

  if evidence_missing then
    raise exception 'written approval, permissions, roster, notification, cancellation, and reconciliation evidence are required';
  end if;
  return new;
end;
$$;

create trigger class_mappings_require_approved_unpaid_evidence
before insert or update on public.class_offer_provider_mappings
for each row execute function public.class_require_approved_unpaid_activation_evidence();

create or replace function public.class_require_approved_unpaid_offer_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfilment_mode = 'approved_unpaid'
    and new.status = 'active'
    and not exists (
      select 1
      from public.class_offer_provider_mappings mapping
      where mapping.business_id = new.business_id
        and mapping.offer_id = new.id
        and mapping.fulfilment_mode = 'approved_unpaid'
        and mapping.status = 'active'
        and mapping.approved_unpaid_enabled
        and mapping.mode_verified_at is not null
        and mapping.mode_evidence_digest ~ '^[0-9a-f]{64}$'
    ) then
    raise exception 'an approved-unpaid Revvi Offer requires its active feature flag and controlled evidence';
  end if;
  return new;
end;
$$;

create trigger class_offers_require_approved_unpaid_evidence
before insert or update on public.class_revvi_offers
for each row execute function public.class_require_approved_unpaid_offer_activation();

create or replace function public.class_disable_approved_unpaid_offer_when_gate_closes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.fulfilment_mode = 'approved_unpaid'
    and (
      not new.approved_unpaid_enabled
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

create trigger class_mappings_disable_approved_unpaid_offer
after update on public.class_offer_provider_mappings
for each row execute function public.class_disable_approved_unpaid_offer_when_gate_closes();

create or replace function public.class_disable_revoked_approved_unpaid_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'verified' and new.status = 'revoked' then
    update public.class_approved_unpaid_evidence
    set status = 'revoked', revoked_at = now(), revocation_reason = 'SOURCE_EVIDENCE_REVOKED'
    where source_evidence_id = new.id and status = 'verified';
    update public.class_offer_provider_mappings
    set approved_unpaid_enabled = false,
        mode_verified_at = null,
        mode_evidence_digest = null
    where business_id = new.business_id
      and id = new.mapping_id
      and mapping_version = new.mapping_version;
  end if;
  return null;
end;
$$;

create trigger class_approved_unpaid_evidence_disable_on_revoke
after update on public.class_approved_unpaid_evidence
for each row execute function public.class_disable_revoked_approved_unpaid_mode();

create or replace function public.class_revoke_approved_unpaid_evidence_on_mapping_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mapping_version is distinct from old.mapping_version then
    update public.class_approved_unpaid_evidence
    set status = 'revoked', revoked_at = now(), revocation_reason = 'MAPPING_VERSION_CHANGED'
    where business_id = old.business_id
      and mapping_id = old.id
      and mapping_version = old.mapping_version
      and status = 'verified';
  end if;
  return null;
end;
$$;

create trigger class_mappings_revoke_stale_approved_unpaid_evidence
after update on public.class_offer_provider_mappings
for each row execute function public.class_revoke_approved_unpaid_evidence_on_mapping_change();

-- Generic evidence recorded before this migration did not prove this mode's
-- written approval or controlled provider behavior.
update public.class_offer_provider_mappings
set approved_unpaid_enabled = false,
    mode_verified_at = null,
    mode_evidence_digest = null
where fulfilment_mode = 'approved_unpaid';

alter table public.class_approved_unpaid_evidence enable row level security;

create policy class_approved_unpaid_evidence_operations_select
on public.class_approved_unpaid_evidence for select to authenticated
using (public.has_class_operations_access(business_id));

grant select on public.class_approved_unpaid_evidence to authenticated, service_role;
grant insert, update on public.class_approved_unpaid_evidence to service_role;

revoke all on function public.record_class_booking_reconciliation_observation(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_class_booking_reconciliation_observation(
  uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text
) to service_role;

revoke all on function public.class_bind_booking_fulfilment_mode() from public;
revoke all on function public.class_validate_approved_unpaid_evidence() from public;
revoke all on function public.class_protect_approved_unpaid_evidence() from public;
revoke all on function public.class_require_approved_unpaid_activation_evidence() from public;
revoke all on function public.class_require_approved_unpaid_offer_activation() from public;
revoke all on function public.class_disable_approved_unpaid_offer_when_gate_closes() from public;
revoke all on function public.class_disable_revoked_approved_unpaid_mode() from public;
revoke all on function public.class_revoke_approved_unpaid_evidence_on_mapping_change() from public;

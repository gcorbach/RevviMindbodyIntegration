-- Issue #39: Customer-owned Booking history, controlled cancellation,
-- Mindbody webhook intake, lifecycle reconciliation, and Class support actions.

create extension if not exists pg_net with schema extensions;

create type public.class_cancellation_evidence_kind as enum (
  'roster_removal',
  'waitlist_removal',
  'authoritative_reconciliation',
  'entitlement_restoration_read'
);

create type public.class_lifecycle_reconciliation_purpose as enum ('booking', 'cancellation');
create type public.class_lifecycle_reconciliation_source as enum ('webhook', 'sweep', 'manual');
create type public.class_mindbody_webhook_status as enum (
  'queued', 'processing', 'processed', 'ignored', 'failed'
);
create type public.class_support_resolution as enum (
  'booking_confirmed', 'booking_failed', 'cancellation_confirmed', 'cancellation_failed'
);

alter table public.class_offer_provider_mappings
  add column cancellation_enabled boolean not null default false;

alter table public.class_bookings
  add column last_lifecycle_reconciled_at timestamptz,
  add column last_webhook_event_at timestamptz,
  add column restoration_observed_at timestamptz,
  add column restoration_baseline_current boolean,
  add column restoration_baseline_returned boolean,
  add column restoration_baseline_unlimited boolean,
  add column restoration_baseline_remaining numeric,
  add column restoration_baseline_observed_at timestamptz,
  add column restoration_error_code text check (
    restoration_error_code is null or restoration_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'
  );

comment on column public.class_offer_provider_mappings.cancellation_enabled is
  'Server-owned gate. Cancellation writes remain closed unless current controlled evidence also covers the exact operation.';

create table public.class_cancellation_evidence (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  mapping_id uuid not null,
  mapping_version bigint not null check (mapping_version > 0),
  evidence_kind public.class_cancellation_evidence_kind not null,
  evidence_environment public.class_provider_environment not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  status public.class_mode_evidence_status not null default 'verified',
  verified_at timestamptz not null,
  verified_by uuid references auth.users(id) on delete restrict,
  source_evidence_id uuid references public.class_cancellation_evidence(id) on delete restrict,
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

create unique index class_cancellation_one_active_evidence_kind
on public.class_cancellation_evidence (mapping_id, mapping_version, evidence_kind)
where status = 'verified';

create or replace function public.class_validate_cancellation_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mapping_row public.class_offer_provider_mappings%rowtype;
  integration_environment public.class_provider_environment;
  source_row public.class_cancellation_evidence%rowtype;
  source_mapping_version bigint;
  source_mapping_status public.class_offer_mapping_status;
  source_integration_environment public.class_provider_environment;
begin
  select mapping.* into mapping_row
  from public.class_offer_provider_mappings mapping
  where mapping.business_id = new.business_id and mapping.id = new.mapping_id
  for key share;

  select integration.environment into integration_environment
  from public.class_business_integrations integration
  where integration.business_id = mapping_row.business_id
    and integration.id = mapping_row.integration_id;

  if mapping_row.id is null
    or mapping_row.status <> 'active'
    or mapping_row.mapping_version <> new.mapping_version
    or mapping_row.mode_verified_at is null
    or mapping_row.mode_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'cancellation evidence requires the current active verified mapping';
  end if;
  if new.evidence_environment is distinct from integration_environment then
    raise exception 'cancellation evidence environment must match the mapping integration';
  end if;
  if new.verified_at > now() then
    raise exception 'cancellation evidence cannot be verified in the future';
  end if;

  if integration_environment = 'sandbox' then
    if new.source_evidence_id is not null or new.production_equivalence_digest is not null then
      raise exception 'sandbox cancellation evidence cannot claim production promotion';
    end if;
  elsif integration_environment = 'production' then
    if new.source_evidence_id is null or new.production_equivalence_digest is null then
      raise exception 'production cancellation evidence requires reviewed sandbox promotion';
    end if;
    select evidence.* into source_row
    from public.class_cancellation_evidence evidence
    where evidence.id = new.source_evidence_id
    for share;
    if source_row.id is not null then
      select source_mapping.mapping_version, source_mapping.status, integration.environment
      into source_mapping_version, source_mapping_status, source_integration_environment
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
      or source_mapping_version <> source_row.mapping_version
      or source_mapping_status <> 'active'
      or new.verified_at < source_row.verified_at then
      raise exception 'production cancellation evidence requires matching current sandbox proof';
    end if;
  end if;
  return new;
end;
$$;

create trigger class_cancellation_evidence_validate
before insert on public.class_cancellation_evidence
for each row execute function public.class_validate_cancellation_evidence();

create or replace function public.class_protect_cancellation_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'revoked' then
    raise exception 'revoked cancellation evidence is immutable';
  end if;
  if row(old.business_id, old.mapping_id, old.mapping_version, old.evidence_kind,
         old.evidence_environment, old.evidence_digest, old.verified_at, old.verified_by,
         old.source_evidence_id, old.production_equivalence_digest, old.created_at)
    is distinct from
    row(new.business_id, new.mapping_id, new.mapping_version, new.evidence_kind,
        new.evidence_environment, new.evidence_digest, new.verified_at, new.verified_by,
        new.source_evidence_id, new.production_equivalence_digest, new.created_at) then
    raise exception 'controlled cancellation evidence is append-only except for revocation';
  end if;
  if new.status <> 'revoked' or new.revoked_at is null or new.revocation_reason is null then
    raise exception 'cancellation evidence may only transition to a complete revocation';
  end if;
  return new;
end;
$$;

create trigger class_cancellation_evidence_protect
before update on public.class_cancellation_evidence
for each row execute function public.class_protect_cancellation_evidence();

create or replace function public.class_cancellation_operation_verified(
  candidate_mapping_id uuid,
  candidate_attempt_type public.class_provider_attempt_type
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(mapping.cancellation_enabled, false)
    and mapping.status = 'active'
    and mapping.mode_verified_at is not null
    and mapping.mode_evidence_digest ~ '^[0-9a-f]{64}$'
    and exists (
      select 1 from public.class_cancellation_evidence evidence
      where evidence.mapping_id = mapping.id
        and evidence.mapping_version = mapping.mapping_version
        and evidence.status = 'verified'
        and evidence.evidence_kind = case candidate_attempt_type
          when 'waitlist_removal' then 'waitlist_removal'::public.class_cancellation_evidence_kind
          else 'roster_removal'::public.class_cancellation_evidence_kind
        end
    )
    and exists (
      select 1 from public.class_cancellation_evidence evidence
      where evidence.mapping_id = mapping.id
        and evidence.mapping_version = mapping.mapping_version
        and evidence.status = 'verified'
        and evidence.evidence_kind = 'authoritative_reconciliation'
    )
    and (
      mapping.fulfilment_mode <> 'existing_entitlement'
      or exists (
        select 1 from public.class_cancellation_evidence evidence
        where evidence.mapping_id = mapping.id
          and evidence.mapping_version = mapping.mapping_version
          and evidence.status = 'verified'
          and evidence.evidence_kind = 'entitlement_restoration_read'
      )
    )
  from public.class_offer_provider_mappings mapping
  where mapping.id = candidate_mapping_id;
$$;

create or replace function public.class_revoke_cancellation_evidence_on_mapping_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mapping_version is distinct from old.mapping_version then
    update public.class_cancellation_evidence
    set status = 'revoked', revoked_at = now(), revocation_reason = 'MAPPING_VERSION_CHANGED'
    where business_id = old.business_id and mapping_id = old.id
      and mapping_version = old.mapping_version and status = 'verified';
  end if;
  return null;
end;
$$;

create trigger class_mappings_revoke_stale_cancellation_evidence
after update on public.class_offer_provider_mappings
for each row execute function public.class_revoke_cancellation_evidence_on_mapping_change();

create or replace function public.class_close_cancellation_gate_on_mapping_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.mapping_version is distinct from old.mapping_version then
    new.cancellation_enabled := false;
  end if;
  return new;
end;
$$;

create trigger class_mappings_close_cancellation_gate
before update on public.class_offer_provider_mappings
for each row execute function public.class_close_cancellation_gate_on_mapping_change();

create or replace function public.class_disable_cancellation_on_evidence_revoke()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'verified' and new.status = 'revoked' then
    update public.class_cancellation_evidence
    set status = 'revoked', revoked_at = now(), revocation_reason = 'SOURCE_EVIDENCE_REVOKED'
    where source_evidence_id = new.id and status = 'verified';
    update public.class_offer_provider_mappings
    set cancellation_enabled = false
    where business_id = new.business_id and id = new.mapping_id
      and mapping_version = new.mapping_version;
  end if;
  return null;
end;
$$;

create trigger class_cancellation_evidence_disable_on_revoke
after update on public.class_cancellation_evidence
for each row execute function public.class_disable_cancellation_on_evidence_revoke();

create table public.class_cancellation_write_locks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  booking_id uuid not null,
  attempt_id uuid not null,
  prior_booking_status public.class_booking_status not null,
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  status public.class_support_lock_status not null default 'active',
  acquired_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, booking_id)
    references public.class_bookings(business_id, id) on delete restrict,
  foreign key (business_id, attempt_id)
    references public.class_booking_provider_attempts(business_id, id) on delete restrict,
  check ((status = 'released') = (released_at is not null))
);

create unique index class_cancellation_locks_one_active_idx
on public.class_cancellation_write_locks (booking_id)
where status = 'active';

create table public.class_lifecycle_reconciliation_queue (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  booking_id uuid not null,
  purpose public.class_lifecycle_reconciliation_purpose not null,
  source public.class_lifecycle_reconciliation_source not null,
  status public.class_reconciliation_queue_status not null default 'queued',
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_:-]{0,127}$'),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_:-]{0,127}$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, booking_id)
    references public.class_bookings(business_id, id) on delete restrict,
  check ((status = 'completed') = (completed_at is not null))
);

create unique index class_lifecycle_queue_one_active_idx
on public.class_lifecycle_reconciliation_queue (booking_id, purpose)
where status in ('queued', 'processing', 'requires_support');

create index class_lifecycle_queue_ready_idx
on public.class_lifecycle_reconciliation_queue (available_at, created_at)
where status = 'queued';

create table public.class_mindbody_webhook_events (
  id uuid primary key default gen_random_uuid(),
  message_id text not null check (length(message_id) between 1 and 256),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  event_id text not null check (event_id ~ '^[A-Za-z][A-Za-z0-9.]{0,127}$'),
  event_schema_version integer not null check (event_schema_version = 1),
  event_occurred_at timestamptz not null,
  transaction_key text check (transaction_key is null or length(transaction_key) between 1 and 50),
  provider_site_id text not null check (length(trim(provider_site_id)) > 0),
  provider_location_id text,
  provider_class_id text,
  provider_client_id text,
  provider_client_unique_id text,
  provider_roster_booking_id text,
  provider_waitlist_entry_id text,
  provider_sale_id text,
  status public.class_mindbody_webhook_status not null default 'queued',
  processing_attempts integer not null default 0 check (processing_attempts between 0 and 100),
  processed_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_:-]{0,127}$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id),
  unique (payload_fingerprint),
  check ((status in ('processed', 'ignored')) = (processed_at is not null))
);

comment on table public.class_mindbody_webhook_events is
  'Signature-verified typed event facts only. Exact raw request bodies are never persisted.';

create table public.class_mindbody_webhook_diagnostics (
  id uuid primary key default gen_random_uuid(),
  webhook_event_id uuid not null references public.class_mindbody_webhook_events(id) on delete cascade,
  diagnostic_code text not null check (diagnostic_code ~ '^[A-Z][A-Z0-9_:-]{0,127}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  check (expires_at > created_at and expires_at <= created_at + interval '48 hours')
);

create table public.class_booking_support_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  booking_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  resolution public.class_support_resolution not null,
  evidence_summary text not null check (length(trim(evidence_summary)) between 10 and 1000),
  created_at timestamptz not null default now(),
  foreign key (business_id, booking_id)
    references public.class_bookings(business_id, id) on delete restrict
);

create or replace function public.class_support_actions_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Class Booking support actions are append-only';
end;
$$;

create trigger class_booking_support_actions_append_only
before update or delete on public.class_booking_support_actions
for each row execute function public.class_support_actions_append_only();

create trigger class_cancellation_locks_set_updated_at
before update on public.class_cancellation_write_locks
for each row execute function public.class_set_updated_at();
create trigger class_lifecycle_queue_set_updated_at
before update on public.class_lifecycle_reconciliation_queue
for each row execute function public.class_set_updated_at();
create trigger class_mindbody_webhook_events_set_updated_at
before update on public.class_mindbody_webhook_events
for each row execute function public.class_set_updated_at();

create or replace function public.claim_class_booking_cancellation(
  candidate_booking_id uuid,
  candidate_customer_id uuid,
  candidate_reason text,
  candidate_write_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.class_bookings%rowtype;
  quote_mapping_id uuid;
  quote_integration_id uuid;
  attempt_row public.class_booking_provider_attempts%rowtype;
  attempt_kind public.class_provider_attempt_type;
  cancellation_key text;
begin
  if candidate_reason is null or length(trim(candidate_reason)) not between 10 and 500 then
    raise exception 'a cancellation reason between 10 and 500 characters is required';
  end if;
  if candidate_write_token is null or candidate_write_token !~ '^[0-9a-f]{64}$' then
    raise exception 'a valid Class cancellation write token is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(candidate_booking_id::text, 0));
  select booking.* into booking_row
  from public.class_bookings booking
  where booking.id = candidate_booking_id and booking.customer_id = candidate_customer_id
  for update;
  if booking_row.id is null then
    raise no_data_found using message = 'Class Booking was not found for this Customer';
  end if;

  cancellation_key := 'cancel:' || booking_row.id::text;
  select attempt.* into attempt_row
  from public.class_booking_provider_attempts attempt
  where attempt.provider = booking_row.provider
    and attempt.idempotency_key = cancellation_key;
  if attempt_row.id is not null then
    return jsonb_build_object(
      'shouldWrite', false,
      'booking', jsonb_build_object(
        'id', booking_row.id,
        'status', case
          when booking_row.cancellation_status = 'confirmed' then 'cancelled'
          when booking_row.cancellation_status = 'failed' then 'failed'
          when booking_row.cancellation_status in ('pending', 'unknown') then 'unknown'
          else booking_row.status::text
        end,
        'cancellationStatus', booking_row.cancellation_status,
        'restorationStatus', booking_row.restoration_status,
        'refundStatus', booking_row.refund_status,
        'cancelledAt', booking_row.cancelled_at,
        'passRestoration', case
          when booking_row.fulfilment_mode <> 'existing_entitlement' then 'not_applicable'
          when booking_row.restoration_status = 'confirmed' then 'restored'
          when booking_row.restoration_status = 'failed' then 'not_restored'
          else 'unknown'
        end,
        'refund', 'not_requested'
      ),
      'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
    );
  end if;

  if booking_row.status not in ('confirmed', 'waitlisted') or booking_row.start_datetime <= now() then
    raise exception 'this Class Booking is not currently requestable for cancellation';
  end if;
  attempt_kind := case
    when booking_row.status = 'waitlisted' or booking_row.provider_waitlist_entry_id is not null
      then 'waitlist_removal'::public.class_provider_attempt_type
    else 'cancellation'::public.class_provider_attempt_type
  end;
  if (attempt_kind = 'cancellation' and booking_row.provider_visit_id is null)
    or (attempt_kind = 'waitlist_removal' and booking_row.provider_waitlist_entry_id is null) then
    raise exception 'this Class Booking lacks the exact provider identifier required for cancellation';
  end if;
  select quote.mapping_id, quote.integration_id into quote_mapping_id, quote_integration_id
  from public.class_booking_quotes quote
  where quote.business_id = booking_row.business_id and quote.id = booking_row.quote_id;
  if not public.class_cancellation_operation_verified(quote_mapping_id, attempt_kind) then
    raise exception 'this Class Booking cancellation operation is not enabled by current controlled evidence';
  end if;

  insert into public.class_booking_provider_attempts (
    business_id, booking_id, provider, attempt_type, status,
    idempotency_key, request_fingerprint
  ) values (
    booking_row.business_id, booking_row.id, booking_row.provider, attempt_kind, 'pending',
    cancellation_key,
    encode(extensions.digest(booking_row.id::text || ':' || trim(candidate_reason), 'sha256'), 'hex')
  ) returning * into attempt_row;

  insert into public.class_cancellation_write_locks (
    business_id, booking_id, attempt_id, prior_booking_status, token_digest
  ) values (
    booking_row.business_id, booking_row.id, attempt_row.id, booking_row.status,
    encode(extensions.digest(candidate_write_token, 'sha256'), 'hex')
  );

  update public.class_bookings set
    status = 'cancel_pending', cancellation_status = 'pending',
    cancellation_reason = trim(candidate_reason), error_code = null, error_message = null
  where id = booking_row.id returning * into booking_row;

  return jsonb_build_object(
    'shouldWrite', true, 'writeToken', candidate_write_token,
    'booking', jsonb_build_object(
      'id', booking_row.id, 'businessId', booking_row.business_id,
      'integrationId', quote_integration_id,
      'status', booking_row.status, 'fulfilmentMode', booking_row.fulfilment_mode,
      'providerSiteId', booking_row.provider_site_id,
      'providerClassId', booking_row.provider_class_id,
      'providerClientId', booking_row.provider_client_id,
      'providerClientUniqueId', booking_row.provider_client_unique_id,
      'providerVisitId', booking_row.provider_visit_id,
      'providerRosterBookingId', booking_row.provider_roster_booking_id,
      'providerWaitlistEntryId', booking_row.provider_waitlist_entry_id,
      'providerClientServiceId', booking_row.provider_client_service_id
    ),
    'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status, 'type', attempt_kind)
  );
end;
$$;

create or replace function public.persist_class_entitlement_restoration_baseline(
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
  if booking_row.id is null or attempt_row.id is null or lock_row.id is null
    or booking_row.status <> 'cancel_pending'
    or booking_row.fulfilment_mode <> 'existing_entitlement'
    or booking_row.provider_client_service_id is null
    or lock_row.token_digest is distinct from encode(extensions.digest(candidate_write_token, 'sha256'), 'hex') then
    raise exception 'an exact locked existing-entitlement cancellation is required';
  end if;
  if candidate_current is null or candidate_returned is null or candidate_unlimited is null
    or candidate_observed_at is null or candidate_observed_at > now() then
    raise exception 'a complete non-future entitlement baseline is required';
  end if;
  if booking_row.restoration_baseline_observed_at is not null then
    if booking_row.restoration_baseline_current is distinct from candidate_current
      or booking_row.restoration_baseline_returned is distinct from candidate_returned
      or booking_row.restoration_baseline_unlimited is distinct from candidate_unlimited
      or booking_row.restoration_baseline_remaining is distinct from candidate_remaining
      or booking_row.restoration_baseline_observed_at is distinct from candidate_observed_at then
      raise exception 'the entitlement baseline is immutable after persistence';
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

create or replace function public.finalize_class_booking_cancellation(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_attempt_id uuid,
  candidate_write_token text,
  candidate_outcome public.class_provider_attempt_status,
  candidate_authoritative_cancelled boolean,
  candidate_restoration_status public.class_provider_attempt_status,
  candidate_restoration_error_code text,
  candidate_provider_request_id text,
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
  lock_row public.class_cancellation_write_locks%rowtype;
begin
  select booking.* into booking_row from public.class_bookings booking
  where booking.business_id = candidate_business_id and booking.id = candidate_booking_id
  for update;
  select attempt.* into attempt_row from public.class_booking_provider_attempts attempt
  where attempt.business_id = candidate_business_id and attempt.id = candidate_attempt_id
    and attempt.booking_id = candidate_booking_id
    and attempt.attempt_type in ('cancellation', 'waitlist_removal')
  for update;
  select cancellation_lock.* into lock_row
  from public.class_cancellation_write_locks cancellation_lock
  where cancellation_lock.business_id = candidate_business_id
    and cancellation_lock.booking_id = candidate_booking_id
    and cancellation_lock.attempt_id = candidate_attempt_id
    and cancellation_lock.status = 'active'
  for update;

  if booking_row.id is null or attempt_row.id is null or lock_row.id is null
    or lock_row.token_digest is distinct from encode(extensions.digest(candidate_write_token, 'sha256'), 'hex') then
    raise exception 'Class cancellation write lock could not be verified';
  end if;
  if candidate_outcome not in ('confirmed', 'failed', 'unknown') then
    raise exception 'Class cancellation outcome must be confirmed, failed, or unknown';
  end if;
  if candidate_outcome = 'confirmed' and candidate_authoritative_cancelled is not true then
    raise exception 'authoritative provider evidence is required to confirm cancellation';
  end if;

  update public.class_booking_provider_attempts set
    status = candidate_outcome,
    provider_request_id = candidate_provider_request_id,
    provider_error_code = candidate_error_code,
    completed_at = case when candidate_outcome in ('confirmed', 'failed') then now() else null end
  where id = attempt_row.id returning * into attempt_row;

  update public.class_bookings set
    status = case candidate_outcome
      when 'confirmed' then 'cancelled'::public.class_booking_status
      when 'failed' then lock_row.prior_booking_status
      else 'unknown'::public.class_booking_status
    end,
    cancellation_status = candidate_outcome,
    restoration_status = case
      when fulfilment_mode = 'existing_entitlement'
        then coalesce(candidate_restoration_status, 'unknown'::public.class_provider_attempt_status)
      else null
    end,
    restoration_observed_at = case
      when fulfilment_mode = 'existing_entitlement' and candidate_restoration_status in ('confirmed', 'failed')
        then now()
      else restoration_observed_at
    end,
    restoration_error_code = case
      when fulfilment_mode = 'existing_entitlement' then candidate_restoration_error_code
      else null
    end,
    refund_status = null,
    cancelled_at = case when candidate_outcome = 'confirmed' then now() else cancelled_at end,
    error_code = candidate_error_code,
    last_lifecycle_reconciled_at = case when candidate_authoritative_cancelled then now() else last_lifecycle_reconciled_at end
  where id = booking_row.id returning * into booking_row;

  if candidate_outcome in ('confirmed', 'failed') then
    update public.class_cancellation_write_locks
    set status = 'released', released_at = now() where id = lock_row.id;
  end if;

  if candidate_outcome = 'unknown'
    or (candidate_outcome = 'confirmed'
      and booking_row.fulfilment_mode = 'existing_entitlement'
      and booking_row.restoration_status = 'unknown') then
    insert into public.class_lifecycle_reconciliation_queue (
      business_id, booking_id, purpose, source, reason_code
    ) values (
      booking_row.business_id, booking_row.id, 'cancellation', 'manual',
      case
        when candidate_outcome = 'confirmed' then coalesce(
          candidate_restoration_error_code,
          'ENTITLEMENT_RESTORATION_UNKNOWN'
        )
        else coalesce(candidate_error_code, 'CANCELLATION_STATUS_UNKNOWN')
      end
    ) on conflict (booking_id, purpose) where status in ('queued', 'processing', 'requires_support')
      do update set status = 'queued', available_at = least(public.class_lifecycle_reconciliation_queue.available_at, now()),
        reason_code = excluded.reason_code;
  end if;

  return jsonb_build_object(
    'booking', jsonb_build_object(
      'id', booking_row.id,
      'status', case candidate_outcome when 'confirmed' then 'cancelled' when 'failed' then 'failed' else 'unknown' end,
      'cancelledAt', booking_row.cancelled_at,
      'passRestoration', case
        when booking_row.fulfilment_mode <> 'existing_entitlement' then 'not_applicable'
        when booking_row.restoration_status = 'confirmed' then 'restored'
        when booking_row.restoration_status = 'failed' then 'not_restored'
        else 'unknown'
      end,
      'refund', 'not_requested'
    ),
    'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
  );
end;
$$;

create or replace function public.enqueue_class_mindbody_webhook(
  candidate_message_id text,
  candidate_payload_fingerprint text,
  candidate_event_id text,
  candidate_event_schema_version integer,
  candidate_event_occurred_at timestamptz,
  candidate_transaction_key text,
  candidate_provider_site_id text,
  candidate_provider_location_id text,
  candidate_provider_class_id text,
  candidate_provider_client_id text,
  candidate_provider_client_unique_id text,
  candidate_provider_roster_booking_id text,
  candidate_provider_waitlist_entry_id text,
  candidate_provider_sale_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stored public.class_mindbody_webhook_events%rowtype;
  was_duplicate boolean := false;
begin
  insert into public.class_mindbody_webhook_events (
    message_id, payload_fingerprint, event_id, event_schema_version,
    event_occurred_at, transaction_key, provider_site_id, provider_location_id,
    provider_class_id, provider_client_id, provider_client_unique_id,
    provider_roster_booking_id, provider_waitlist_entry_id, provider_sale_id
  ) values (
    candidate_message_id, candidate_payload_fingerprint, candidate_event_id,
    candidate_event_schema_version, candidate_event_occurred_at,
    nullif(trim(candidate_transaction_key), ''), trim(candidate_provider_site_id),
    nullif(trim(candidate_provider_location_id), ''), nullif(trim(candidate_provider_class_id), ''),
    nullif(trim(candidate_provider_client_id), ''), nullif(trim(candidate_provider_client_unique_id), ''),
    nullif(trim(candidate_provider_roster_booking_id), ''), nullif(trim(candidate_provider_waitlist_entry_id), ''),
    nullif(trim(candidate_provider_sale_id), '')
  ) on conflict do nothing returning * into stored;
  if stored.id is null then
    was_duplicate := true;
    select event.* into stored from public.class_mindbody_webhook_events event
    where event.message_id = candidate_message_id
       or event.payload_fingerprint = candidate_payload_fingerprint
    order by event.created_at limit 1;
    if stored.payload_fingerprint is distinct from candidate_payload_fingerprint
      or stored.message_id is distinct from candidate_message_id then
      raise exception 'Mindbody webhook identity was reused with different verified facts';
    end if;
  end if;
  return jsonb_build_object('id', stored.id, 'duplicate', was_duplicate);
end;
$$;

create or replace function public.reconcile_class_booking_cancellation_from_read(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_attempt_id uuid,
  candidate_authoritative_cancelled boolean,
  candidate_error_code text
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
  if booking_row.id is null or attempt_row.id is null or lock_row.id is null
    or booking_row.status not in ('cancel_pending', 'unknown')
    or booking_row.cancellation_status not in ('pending', 'unknown') then
    raise exception 'an unresolved Class cancellation with its write lock is required';
  end if;
  if candidate_authoritative_cancelled is not true then
    update public.class_bookings set status = 'unknown', cancellation_status = 'unknown',
      error_code = coalesce(candidate_error_code, 'CANCELLATION_STATUS_UNKNOWN')
    where id = booking_row.id returning * into booking_row;
    return booking_row;
  end if;

  update public.class_bookings set
    status = 'cancelled', cancellation_status = 'reconciled', cancelled_at = coalesce(cancelled_at, now()),
    restoration_status = case when fulfilment_mode = 'existing_entitlement'
      then 'unknown'::public.class_provider_attempt_status else null end,
    refund_status = null, error_code = null, error_message = null,
    last_lifecycle_reconciled_at = now()
  where id = booking_row.id returning * into booking_row;
  update public.class_booking_provider_attempts set
    status = 'reconciled', reconciled_at = now(), completed_at = now(), provider_error_code = null
  where id = attempt_row.id;
  update public.class_cancellation_write_locks set status = 'released', released_at = now()
  where id = lock_row.id;
  return booking_row;
end;
$$;

create or replace function public.record_class_entitlement_restoration_read(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_restoration_status public.class_provider_attempt_status,
  candidate_error_code text
)
returns public.class_bookings
language plpgsql
security definer
set search_path = public
as $$
declare booking_row public.class_bookings%rowtype;
begin
  if candidate_restoration_status not in ('confirmed', 'failed', 'unknown') then
    raise exception 'entitlement restoration must be confirmed, failed, or unknown';
  end if;
  select booking.* into booking_row from public.class_bookings booking
  where booking.business_id = candidate_business_id and booking.id = candidate_booking_id
  for update;
  if booking_row.id is null
    or booking_row.status <> 'cancelled'
    or booking_row.fulfilment_mode <> 'existing_entitlement'
    or booking_row.provider_client_service_id is null then
    raise exception 'a cancelled existing-entitlement Booking is required';
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
  return booking_row;
end;
$$;

create or replace function public.claim_class_mindbody_webhook_batch(candidate_limit integer default 25)
returns setof public.class_mindbody_webhook_events
language plpgsql
security definer
set search_path = public
as $$
begin
  if candidate_limit not between 1 and 100 then raise exception 'webhook batch limit must be between 1 and 100'; end if;
  return query
  with claimed as (
    select event.id from public.class_mindbody_webhook_events event
    where event.status in ('queued', 'failed') and event.processing_attempts < 100
    order by event.event_occurred_at, event.created_at
    for update skip locked limit candidate_limit
  )
  update public.class_mindbody_webhook_events event set
    status = 'processing', processing_attempts = processing_attempts + 1,
    last_error_code = null
  from claimed where event.id = claimed.id returning event.*;
end;
$$;

create or replace function public.process_class_mindbody_webhook(candidate_event_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.class_mindbody_webhook_events%rowtype;
  queued_count bigint := 0;
begin
  select event.* into event_row from public.class_mindbody_webhook_events event
  where event.id = candidate_event_id for update;
  if event_row.id is null then raise no_data_found using message = 'Mindbody webhook event was not found'; end if;
  if event_row.status in ('processed', 'ignored') then return 0; end if;
  if event_row.status <> 'processing' then raise exception 'Mindbody webhook event must be claimed before processing'; end if;

  if event_row.event_id not in (
    'classRosterBooking.created', 'classRosterBookingStatus.updated',
    'classRosterBooking.cancelled', 'classWaitlistRequest.created',
    'classWaitlistRequest.cancelled', 'class.created', 'class.updated',
    'class.cancelled', 'classSchedule.updated', 'classSchedule.cancelled',
    'clientSale.created'
  ) then
    update public.class_mindbody_webhook_events set status = 'ignored', processed_at = now()
    where id = event_row.id;
    return 0;
  end if;

  insert into public.class_lifecycle_reconciliation_queue (
    business_id, booking_id, purpose, source, reason_code
  )
  select booking.business_id, booking.id,
    case when booking.status in ('cancel_pending', 'unknown')
          and booking.cancellation_status in ('pending', 'unknown')
      then 'cancellation'::public.class_lifecycle_reconciliation_purpose
      else 'booking'::public.class_lifecycle_reconciliation_purpose end,
    'webhook', 'MINDBODY_WEBHOOK_' || upper(replace(event_row.event_id, '.', '_'))
  from public.class_bookings booking
  where booking.provider = 'mindbody'
    and booking.provider_site_id = event_row.provider_site_id
    and (event_row.provider_class_id is null or booking.provider_class_id = event_row.provider_class_id)
    and (event_row.provider_client_id is null or booking.provider_client_id = event_row.provider_client_id)
    and (event_row.provider_client_unique_id is null
      or booking.provider_client_unique_id = event_row.provider_client_unique_id)
    and (event_row.provider_roster_booking_id is null
      or booking.provider_roster_booking_id is null
      or booking.provider_roster_booking_id = event_row.provider_roster_booking_id)
    and booking.start_datetime >= now() - interval '7 days'
  on conflict (booking_id, purpose) where status in ('queued', 'processing', 'requires_support')
    do update set source = 'webhook', available_at = least(public.class_lifecycle_reconciliation_queue.available_at, now()),
      reason_code = excluded.reason_code;
  get diagnostics queued_count = row_count;

  update public.class_bookings booking set last_webhook_event_at = greatest(
    coalesce(booking.last_webhook_event_at, '-infinity'::timestamptz), event_row.event_occurred_at
  )
  where booking.provider_site_id = event_row.provider_site_id
    and (event_row.provider_class_id is null or booking.provider_class_id = event_row.provider_class_id)
    and (event_row.provider_client_id is null or booking.provider_client_id = event_row.provider_client_id);
  update public.class_mindbody_webhook_events set status = 'processed', processed_at = now()
  where id = event_row.id;
  return queued_count;
exception when others then
  if event_row.id is not null then
    update public.class_mindbody_webhook_events
    set status = 'failed', last_error_code = 'WEBHOOK_PROCESSING_FAILED'
    where id = event_row.id;
    insert into public.class_mindbody_webhook_diagnostics (webhook_event_id, diagnostic_code)
    values (event_row.id, 'WEBHOOK_PROCESSING_FAILED');
  end if;
  return 0;
end;
$$;

create or replace function public.enqueue_class_lifecycle_24_hour_sweep()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare queued_count bigint;
begin
  insert into public.class_lifecycle_reconciliation_queue (
    business_id, booking_id, purpose, source, reason_code
  )
  select booking.business_id, booking.id,
    case when booking.cancellation_status in ('pending', 'unknown')
      then 'cancellation'::public.class_lifecycle_reconciliation_purpose
      else 'booking'::public.class_lifecycle_reconciliation_purpose end,
    'sweep', 'PERIODIC_24_HOUR_RECONCILIATION'
  from public.class_bookings booking
  where booking.status in ('confirmed', 'waitlisted', 'cancel_pending', 'unknown')
    and booking.start_datetime >= now() - interval '7 days'
    and (booking.last_lifecycle_reconciled_at is null
      or booking.last_lifecycle_reconciled_at <= now() - interval '24 hours')
    and not exists (
      select 1 from public.class_lifecycle_reconciliation_queue queue
      where queue.booking_id = booking.id
        and queue.purpose = case when booking.cancellation_status in ('pending', 'unknown')
          then 'cancellation'::public.class_lifecycle_reconciliation_purpose
          else 'booking'::public.class_lifecycle_reconciliation_purpose end
        and queue.status in ('queued', 'processing', 'requires_support')
    );
  get diagnostics queued_count = row_count;
  return queued_count;
end;
$$;

create or replace function public.claim_class_lifecycle_reconciliation_batch(candidate_limit integer default 25)
returns setof public.class_lifecycle_reconciliation_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  if candidate_limit not between 1 and 100 then
    raise exception 'lifecycle reconciliation batch limit must be between 1 and 100';
  end if;
  return query
  with claimed as (
    select queue.id from public.class_lifecycle_reconciliation_queue queue
    where queue.status = 'queued' and queue.available_at <= now() and queue.attempt_count < 100
    order by queue.available_at, queue.created_at
    for update skip locked limit candidate_limit
  )
  update public.class_lifecycle_reconciliation_queue queue set
    status = 'processing', claimed_at = now(), attempt_count = attempt_count + 1,
    last_error_code = null
  from claimed where queue.id = claimed.id returning queue.*;
end;
$$;

create or replace function public.finish_class_lifecycle_reconciliation(
  candidate_queue_id uuid,
  candidate_status public.class_reconciliation_queue_status,
  candidate_error_code text
)
returns public.class_lifecycle_reconciliation_queue
language plpgsql
security definer
set search_path = public
as $$
declare queue_row public.class_lifecycle_reconciliation_queue%rowtype;
begin
  if candidate_status not in ('queued', 'requires_support', 'completed') then
    raise exception 'lifecycle reconciliation must finish queued, requires_support, or completed';
  end if;
  select queue.* into queue_row from public.class_lifecycle_reconciliation_queue queue
  where queue.id = candidate_queue_id for update;
  if queue_row.id is null or queue_row.status <> 'processing' then
    raise exception 'lifecycle reconciliation work was not claimed';
  end if;
  update public.class_lifecycle_reconciliation_queue set
    status = candidate_status,
    available_at = case when candidate_status = 'queued' then now() + interval '15 minutes' else available_at end,
    claimed_at = case when candidate_status = 'queued' then null else claimed_at end,
    completed_at = case when candidate_status = 'completed' then now() else null end,
    last_error_code = candidate_error_code
  where id = queue_row.id returning * into queue_row;
  if candidate_status = 'completed' then
    update public.class_bookings set last_lifecycle_reconciled_at = now()
    where business_id = queue_row.business_id and id = queue_row.booking_id;
  end if;
  return queue_row;
end;
$$;

create or replace function public.list_upcoming_class_bookings(
  candidate_customer_id uuid,
  candidate_limit integer default 20
)
returns table (
  id uuid,
  status public.class_booking_status,
  business_name text,
  class_name text,
  start_at timestamptz,
  location_name text,
  timezone text,
  cancellation_state text,
  cancellation_status public.class_provider_attempt_status,
  restoration_status public.class_provider_attempt_status,
  refund_status public.class_provider_attempt_status,
  fulfilment_mode public.class_offer_fulfilment_mode
)
language sql
stable
security definer
set search_path = public
as $$
  select booking.id, booking.status, business.display_name, booking.class_name,
    booking.start_datetime, booking.location_name, location.timezone,
    case
      when booking.status in ('cancel_pending', 'unknown')
        and booking.cancellation_status in ('pending', 'unknown') then 'pending'
      when booking.status not in ('confirmed', 'waitlisted') then 'unavailable'
      when booking.start_datetime <= now() then 'unavailable'
      when (booking.status = 'waitlisted' or booking.provider_waitlist_entry_id is not null)
        and booking.provider_waitlist_entry_id is null then 'unsupported'
      when booking.status = 'confirmed' and booking.provider_visit_id is null then 'unsupported'
      when public.class_cancellation_operation_verified(
        quote.mapping_id,
        case when booking.status = 'waitlisted' or booking.provider_waitlist_entry_id is not null
          then 'waitlist_removal'::public.class_provider_attempt_type
          else 'cancellation'::public.class_provider_attempt_type end
      ) then 'requestable'
      else 'unsupported'
    end,
    booking.cancellation_status, booking.restoration_status, booking.refund_status,
    booking.fulfilment_mode
  from public.class_bookings booking
  join public.class_businesses business on business.id = booking.business_id
  join public.class_business_locations location
    on location.business_id = booking.business_id and location.id = booking.location_id
  join public.class_booking_quotes quote
    on quote.business_id = booking.business_id and quote.id = booking.quote_id
  where booking.customer_id = candidate_customer_id
    and booking.start_datetime > now()
    and booking.status in ('confirmed', 'waitlisted', 'cancel_pending', 'unknown')
  order by booking.start_datetime, booking.created_at
  limit least(greatest(candidate_limit, 1), 50);
$$;

create or replace function public.purge_expired_class_mindbody_webhook_diagnostics()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count bigint;
begin
  delete from public.class_mindbody_webhook_diagnostics where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.dispatch_class_lifecycle_worker()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  worker_url text := nullif(current_setting('app.settings.class_lifecycle_worker_url', true), '');
  worker_secret text := nullif(current_setting('app.settings.class_lifecycle_worker_secret', true), '');
  request_id bigint;
begin
  if worker_url is null or worker_secret is null then return null; end if;
  if worker_url !~ '^https://' or length(worker_secret) < 32 then
    raise exception 'Class lifecycle worker dispatch settings are invalid';
  end if;
  select net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Revvi-Worker-Secret', worker_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end;
$$;

select cron.schedule(
  'class-lifecycle-24-hour-sweep',
  '17 * * * *',
  'select public.enqueue_class_lifecycle_24_hour_sweep();'
);
select cron.schedule(
  'class-mindbody-webhook-diagnostics-retention',
  '*/15 * * * *',
  'select public.purge_expired_class_mindbody_webhook_diagnostics();'
);
select cron.schedule(
  'class-lifecycle-worker-dispatch',
  '* * * * *',
  'select public.dispatch_class_lifecycle_worker();'
);

create view public.class_booking_support_cases
with (security_invoker = true)
as
select
  booking.business_id,
  business.display_name as business_name,
  booking.id as booking_id,
  booking.customer_id,
  booking.status as booking_status,
  booking.cancellation_status,
  booking.restoration_status,
  booking.refund_status,
  booking.fulfilment_mode,
  booking.class_name,
  booking.start_datetime,
  booking.provider_site_id,
  booking.provider_class_id,
  booking.provider_visit_id,
  booking.provider_roster_booking_id,
  booking.provider_waitlist_entry_id,
  booking.provider_sale_id,
  booking.provider_transaction_id,
  booking.error_code,
  write_lock.status as booking_write_lock_status,
  cancellation_lock.status as cancellation_write_lock_status,
  lifecycle.status as lifecycle_queue_status,
  lifecycle.purpose as lifecycle_purpose,
  lifecycle.reason_code as lifecycle_reason_code,
  lifecycle.attempt_count as lifecycle_attempt_count,
  booking.last_webhook_event_at,
  booking.last_lifecycle_reconciled_at
from public.class_bookings booking
join public.class_businesses business on business.id = booking.business_id
left join public.class_booking_write_locks write_lock
  on write_lock.booking_id = booking.id and write_lock.status = 'active'
left join public.class_cancellation_write_locks cancellation_lock
  on cancellation_lock.booking_id = booking.id and cancellation_lock.status = 'active'
left join public.class_lifecycle_reconciliation_queue lifecycle
  on lifecycle.booking_id = booking.id and lifecycle.status in ('queued', 'processing', 'requires_support')
where public.has_class_operations_access(booking.business_id)
  and (
    booking.status in ('pending', 'requires_action', 'cancel_pending', 'failed', 'unknown')
    or write_lock.id is not null or cancellation_lock.id is not null or lifecycle.id is not null
  );

create or replace function public.resolve_class_booking_support_case(
  candidate_booking_id uuid,
  candidate_resolution public.class_support_resolution,
  candidate_evidence_summary text
)
returns public.class_bookings
language plpgsql
security definer
set search_path = public
as $$
declare booking_row public.class_bookings%rowtype;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'operations authentication is required'; end if;
  if candidate_evidence_summary is null or length(trim(candidate_evidence_summary)) not between 10 and 1000 then
    raise exception 'support evidence summary must be between 10 and 1000 characters';
  end if;
  select booking.* into booking_row from public.class_bookings booking
  where booking.id = candidate_booking_id for update;
  if booking_row.id is null then raise no_data_found using message = 'Class Booking support case was not found'; end if;
  if not public.has_class_operations_access(booking_row.business_id) then
    raise insufficient_privilege using message = 'operations access is required for this Business';
  end if;
  if booking_row.status not in ('pending', 'requires_action', 'cancel_pending', 'unknown', 'failed') then
    raise exception 'only an unresolved Class Booking support case can be resolved';
  end if;

  insert into public.class_booking_support_actions (
    business_id, booking_id, actor_user_id, resolution, evidence_summary
  ) values (
    booking_row.business_id, booking_row.id, auth.uid(), candidate_resolution,
    trim(candidate_evidence_summary)
  );

  update public.class_bookings set
    status = case candidate_resolution
      when 'booking_confirmed' then 'confirmed'::public.class_booking_status
      when 'booking_failed' then 'failed'::public.class_booking_status
      when 'cancellation_confirmed' then 'cancelled'::public.class_booking_status
      else 'confirmed'::public.class_booking_status
    end,
    cancellation_status = case candidate_resolution
      when 'cancellation_confirmed' then 'confirmed'::public.class_provider_attempt_status
      when 'cancellation_failed' then 'failed'::public.class_provider_attempt_status
      else cancellation_status
    end,
    confirmed_at = case when candidate_resolution = 'booking_confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
    cancelled_at = case when candidate_resolution = 'cancellation_confirmed' then coalesce(cancelled_at, now()) else cancelled_at end,
    restoration_status = case when candidate_resolution = 'cancellation_confirmed'
      and fulfilment_mode = 'existing_entitlement' then 'unknown'::public.class_provider_attempt_status
      else restoration_status end,
    refund_status = case when candidate_resolution = 'cancellation_confirmed' then null else refund_status end,
    error_code = null, error_message = null, last_lifecycle_reconciled_at = now()
  where id = booking_row.id returning * into booking_row;

  update public.class_booking_provider_attempts attempt set
    status = case
      when attempt.status = 'unknown' then 'reconciled'::public.class_provider_attempt_status
      when candidate_resolution in ('booking_failed', 'cancellation_failed')
        then 'failed'::public.class_provider_attempt_status
      else 'confirmed'::public.class_provider_attempt_status
    end,
    completed_at = now(),
    reconciled_at = case when attempt.status = 'unknown' then now() else attempt.reconciled_at end,
    provider_error_code = null
  where attempt.business_id = booking_row.business_id
    and attempt.booking_id = booking_row.id
    and attempt.status in ('pending', 'requires_action', 'unknown')
    and (
      (candidate_resolution in ('booking_confirmed', 'booking_failed')
        and attempt.attempt_type not in ('cancellation', 'waitlist_removal', 'reconciliation'))
      or (candidate_resolution in ('cancellation_confirmed', 'cancellation_failed')
        and attempt.attempt_type in ('cancellation', 'waitlist_removal'))
    );

  update public.class_booking_write_locks set status = 'released', released_at = now()
  where booking_id = booking_row.id and status = 'active';
  update public.class_cancellation_write_locks set status = 'released', released_at = now()
  where booking_id = booking_row.id and status = 'active';
  update public.class_booking_reconciliation_queue set status = 'completed', completed_at = now()
  where booking_id = booking_row.id and status <> 'completed';
  update public.class_lifecycle_reconciliation_queue set status = 'completed', completed_at = now()
  where booking_id = booking_row.id and status <> 'completed';
  return booking_row;
end;
$$;

alter table public.class_cancellation_evidence enable row level security;
alter table public.class_cancellation_write_locks enable row level security;
alter table public.class_lifecycle_reconciliation_queue enable row level security;
alter table public.class_mindbody_webhook_events enable row level security;
alter table public.class_mindbody_webhook_diagnostics enable row level security;
alter table public.class_booking_support_actions enable row level security;

create policy class_cancellation_evidence_operations_select on public.class_cancellation_evidence
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_cancellation_locks_operations_select on public.class_cancellation_write_locks
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_lifecycle_queue_operations_select on public.class_lifecycle_reconciliation_queue
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_mindbody_events_operations_select on public.class_mindbody_webhook_events
for select to authenticated using (public.has_class_platform_operations_access());
create policy class_mindbody_diagnostics_operations_select on public.class_mindbody_webhook_diagnostics
for select to authenticated using (public.has_class_platform_operations_access());
create policy class_booking_support_actions_operations_select on public.class_booking_support_actions
for select to authenticated using (public.has_class_operations_access(business_id));

grant select on public.class_cancellation_evidence to authenticated, service_role;
grant select on public.class_cancellation_write_locks to authenticated, service_role;
grant select on public.class_lifecycle_reconciliation_queue to authenticated, service_role;
grant select on public.class_mindbody_webhook_events to authenticated, service_role;
grant select on public.class_mindbody_webhook_diagnostics to authenticated, service_role;
grant select on public.class_booking_support_actions to authenticated, service_role;
grant select on public.class_booking_support_cases to authenticated, service_role;
grant insert, update on public.class_cancellation_evidence to service_role;
grant insert, update, delete on public.class_cancellation_write_locks to service_role;
grant insert, update, delete on public.class_lifecycle_reconciliation_queue to service_role;
grant insert, update on public.class_mindbody_webhook_events to service_role;
grant insert, delete on public.class_mindbody_webhook_diagnostics to service_role;
grant insert on public.class_booking_support_actions to service_role;

revoke all on function public.claim_class_booking_cancellation(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_class_booking_cancellation(uuid, uuid, text, text) to service_role;
revoke all on function public.finalize_class_booking_cancellation(
  uuid, uuid, uuid, text, public.class_provider_attempt_status, boolean,
  public.class_provider_attempt_status, text, text, text
) from public, anon, authenticated;
grant execute on function public.finalize_class_booking_cancellation(
  uuid, uuid, uuid, text, public.class_provider_attempt_status, boolean,
  public.class_provider_attempt_status, text, text, text
) to service_role;
revoke all on function public.persist_class_entitlement_restoration_baseline(
  uuid, uuid, uuid, text, boolean, boolean, boolean, numeric, timestamptz
) from public, anon, authenticated;
grant execute on function public.persist_class_entitlement_restoration_baseline(
  uuid, uuid, uuid, text, boolean, boolean, boolean, numeric, timestamptz
) to service_role;
revoke all on function public.reconcile_class_booking_cancellation_from_read(
  uuid, uuid, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.reconcile_class_booking_cancellation_from_read(
  uuid, uuid, uuid, boolean, text
) to service_role;
revoke all on function public.record_class_entitlement_restoration_read(
  uuid, uuid, public.class_provider_attempt_status, text
) from public, anon, authenticated;
grant execute on function public.record_class_entitlement_restoration_read(
  uuid, uuid, public.class_provider_attempt_status, text
) to service_role;
revoke all on function public.enqueue_class_mindbody_webhook(
  text, text, text, integer, timestamptz, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.enqueue_class_mindbody_webhook(
  text, text, text, integer, timestamptz, text, text, text, text, text, text, text, text, text
) to service_role;
revoke all on function public.claim_class_mindbody_webhook_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_class_mindbody_webhook_batch(integer) to service_role;
revoke all on function public.process_class_mindbody_webhook(uuid) from public, anon, authenticated;
grant execute on function public.process_class_mindbody_webhook(uuid) to service_role;
revoke all on function public.enqueue_class_lifecycle_24_hour_sweep() from public, anon, authenticated;
grant execute on function public.enqueue_class_lifecycle_24_hour_sweep() to service_role;
revoke all on function public.claim_class_lifecycle_reconciliation_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_class_lifecycle_reconciliation_batch(integer) to service_role;
revoke all on function public.finish_class_lifecycle_reconciliation(
  uuid, public.class_reconciliation_queue_status, text
) from public, anon, authenticated;
grant execute on function public.finish_class_lifecycle_reconciliation(
  uuid, public.class_reconciliation_queue_status, text
) to service_role;
revoke all on function public.list_upcoming_class_bookings(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_upcoming_class_bookings(uuid, integer) to service_role;
revoke all on function public.purge_expired_class_mindbody_webhook_diagnostics() from public, anon, authenticated;
grant execute on function public.purge_expired_class_mindbody_webhook_diagnostics() to service_role;
revoke all on function public.dispatch_class_lifecycle_worker() from public, anon, authenticated;
grant execute on function public.dispatch_class_lifecycle_worker() to service_role;
revoke all on function public.class_cancellation_operation_verified(uuid, public.class_provider_attempt_type)
from public, anon, authenticated;
grant execute on function public.class_cancellation_operation_verified(uuid, public.class_provider_attempt_type)
to service_role;
revoke all on function public.resolve_class_booking_support_case(
  uuid, public.class_support_resolution, text
) from public, anon;
grant execute on function public.resolve_class_booking_support_case(
  uuid, public.class_support_resolution, text
) to authenticated;

revoke all on function public.class_validate_cancellation_evidence() from public;
revoke all on function public.class_protect_cancellation_evidence() from public;
revoke all on function public.class_revoke_cancellation_evidence_on_mapping_change() from public;
revoke all on function public.class_close_cancellation_gate_on_mapping_change() from public;
revoke all on function public.class_disable_cancellation_on_evidence_revoke() from public;
revoke all on function public.class_support_actions_append_only() from public;

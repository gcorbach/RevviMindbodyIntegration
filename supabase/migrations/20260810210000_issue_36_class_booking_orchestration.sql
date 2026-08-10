create type public.class_reconciliation_queue_status as enum (
  'queued',
  'processing',
  'requires_support',
  'completed'
);

alter table public.class_bookings
  add column location_name text check (
    location_name is null or length(trim(location_name)) between 1 and 200
  );

create table public.class_booking_write_locks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  customer_id uuid not null references public.class_revvi_customers(id) on delete restrict,
  booking_id uuid not null,
  attempt_id uuid not null,
  provider public.class_integration_provider not null default 'mindbody',
  provider_site_id text not null check (length(trim(provider_site_id)) > 0),
  provider_class_id text not null check (length(trim(provider_class_id)) > 0),
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

create unique index class_booking_write_locks_one_active_idx
on public.class_booking_write_locks (
  customer_id, provider, provider_site_id, provider_class_id
)
where status = 'active';

create table public.class_booking_reconciliation_queue (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  booking_id uuid not null,
  attempt_id uuid not null,
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
  unique (attempt_id),
  foreign key (business_id, booking_id)
    references public.class_bookings(business_id, id) on delete restrict,
  foreign key (business_id, attempt_id)
    references public.class_booking_provider_attempts(business_id, id) on delete restrict,
  check ((status = 'completed') = (completed_at is not null))
);

create index class_booking_reconciliation_ready_idx
on public.class_booking_reconciliation_queue (available_at, created_at)
where status = 'queued';

comment on table public.class_booking_write_locks is
  'Durable Customer/Class provider-write exclusion. Unknown outcomes retain the active lock until authoritative reconciliation.';

comment on table public.class_booking_reconciliation_queue is
  'Read-only reconciliation work. A queue row never authorizes replay of a Mindbody write.';

create trigger class_booking_write_locks_set_updated_at
before update on public.class_booking_write_locks
for each row execute function public.class_set_updated_at();

create trigger class_booking_reconciliation_set_updated_at
before update on public.class_booking_reconciliation_queue
for each row execute function public.class_set_updated_at();

create trigger class_booking_write_locks_immutable_owner
before update on public.class_booking_write_locks
for each row execute function public.class_prevent_business_reassignment();

create trigger class_booking_reconciliation_immutable_owner
before update on public.class_booking_reconciliation_queue
for each row execute function public.class_prevent_business_reassignment();

create or replace function public.claim_class_booking_attempt(
  candidate_quote_id uuid,
  candidate_customer_id uuid,
  candidate_idempotency_key text,
  candidate_request_fingerprint text,
  candidate_attempt_type public.class_provider_attempt_type,
  candidate_write_token text,
  candidate_class_schedule_id text,
  candidate_class_description_id text,
  candidate_program_id text,
  candidate_session_type_id text,
  candidate_class_name text,
  candidate_staff_name text,
  candidate_start_datetime timestamptz,
  candidate_end_datetime timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_row public.class_booking_quotes%rowtype;
  booking_row public.class_bookings%rowtype;
  attempt_row public.class_booking_provider_attempts%rowtype;
  lock_row public.class_booking_write_locks%rowtype;
  expected_attempt_type public.class_provider_attempt_type;
  location_display_name text;
begin
  if candidate_idempotency_key is null or length(trim(candidate_idempotency_key)) < 16 then
    raise exception 'a valid Class Booking idempotency key is required';
  end if;
  if candidate_request_fingerprint is null
    or candidate_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'a valid Class Booking request fingerprint is required';
  end if;
  if candidate_write_token is null or candidate_write_token !~ '^[0-9a-f]{64}$' then
    raise exception 'a valid Class Booking write token is required';
  end if;
  if candidate_start_datetime is null
    or (candidate_end_datetime is not null and candidate_end_datetime <= candidate_start_datetime) then
    raise exception 'valid Class occurrence times are required';
  end if;

  select attempt.* into attempt_row
  from public.class_booking_provider_attempts attempt
  where attempt.provider = 'mindbody'
    and attempt.idempotency_key = trim(candidate_idempotency_key);

  if attempt_row.id is not null then
    select booking.* into strict booking_row
    from public.class_bookings booking
    where booking.id = attempt_row.booking_id;
    if booking_row.customer_id is distinct from candidate_customer_id
      or attempt_row.request_fingerprint is distinct from candidate_request_fingerprint then
      raise exception 'Class Booking idempotency key conflicts with an existing request';
    end if;
    return jsonb_build_object(
      'shouldWrite', false,
      'booking', jsonb_build_object(
        'id', booking_row.id, 'status', booking_row.status,
        'priceAmount', booking_row.price_amount, 'currency', booking_row.currency,
        'className', booking_row.class_name, 'startAt', booking_row.start_datetime,
        'locationName', booking_row.location_name,
        'providerClassId', booking_row.provider_class_id,
        'providerVisitId', booking_row.provider_visit_id,
        'providerRosterBookingId', booking_row.provider_roster_booking_id,
        'providerWaitlistEntryId', booking_row.provider_waitlist_entry_id
      ),
      'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
    );
  end if;

  select quote.* into quote_row
  from public.class_booking_quotes quote
  where quote.id = candidate_quote_id
  for update;

  if quote_row.id is null then
    raise exception 'Class Booking quote was not found';
  end if;
  if quote_row.customer_id is distinct from candidate_customer_id then
    raise exception 'Class Booking quote belongs to another Customer';
  end if;
  if quote_row.status <> 'open' or quote_row.expires_at <= now() then
    raise exception 'Class Booking quote is not open and current';
  end if;
  expected_attempt_type := case quote_row.fulfilment_mode
    when 'purchase_pricing_option' then 'purchase_booking'::public.class_provider_attempt_type
    when 'existing_entitlement' then 'existing_entitlement_booking'::public.class_provider_attempt_type
    when 'approved_unpaid' then 'approved_unpaid_booking'::public.class_provider_attempt_type
    else null
  end;
  if expected_attempt_type is null or candidate_attempt_type is distinct from expected_attempt_type then
    raise exception 'Class Booking attempt type does not match the quote mode';
  end if;
  if not exists (
    select 1
    from public.class_offer_provider_mappings mapping
    join public.class_revvi_offers offer
      on offer.business_id = mapping.business_id
     and offer.id = mapping.offer_id
     and offer.status = 'active'
    join public.class_businesses business
      on business.id = mapping.business_id
     and business.status = 'active'
    join public.class_business_integrations integration
      on integration.business_id = mapping.business_id
     and integration.id = mapping.integration_id
     and integration.status = 'active'
    join public.class_business_locations location
      on location.business_id = mapping.business_id
     and location.id = mapping.location_id
     and location.enabled
    where mapping.business_id = quote_row.business_id
      and mapping.id = quote_row.mapping_id
      and mapping.status = 'active'
      and mapping.mapping_version = quote_row.mapping_version
      and mapping.fulfilment_mode = quote_row.fulfilment_mode
      and mapping.mode_verified_at is not null
      and mapping.mode_evidence_digest ~ '^[0-9a-f]{64}$'
      and integration.id = quote_row.integration_id
      and location.id = quote_row.location_id
  ) then
    raise exception 'Class Booking quote configuration is no longer active and verified';
  end if;
  select location.display_name into strict location_display_name
  from public.class_business_locations location
  where location.business_id = quote_row.business_id
    and location.id = quote_row.location_id;

  perform pg_advisory_xact_lock(hashtextextended(
    candidate_customer_id::text || ':' || quote_row.provider_site_id || ':' || quote_row.provider_class_id,
    0
  ));

  select write_lock.* into lock_row
  from public.class_booking_write_locks write_lock
  where write_lock.customer_id = candidate_customer_id
    and write_lock.provider = quote_row.provider
    and write_lock.provider_site_id = quote_row.provider_site_id
    and write_lock.provider_class_id = quote_row.provider_class_id
    and write_lock.status = 'active'
  for update;

  if lock_row.id is not null then
    select booking.* into strict booking_row
    from public.class_bookings booking where booking.id = lock_row.booking_id;
    select attempt.* into strict attempt_row
    from public.class_booking_provider_attempts attempt where attempt.id = lock_row.attempt_id;
    return jsonb_build_object(
      'shouldWrite', false,
      'booking', jsonb_build_object(
        'id', booking_row.id, 'status', booking_row.status,
        'priceAmount', booking_row.price_amount, 'currency', booking_row.currency,
        'className', booking_row.class_name, 'startAt', booking_row.start_datetime,
        'locationName', booking_row.location_name,
        'providerClassId', booking_row.provider_class_id,
        'providerVisitId', booking_row.provider_visit_id,
        'providerRosterBookingId', booking_row.provider_roster_booking_id,
        'providerWaitlistEntryId', booking_row.provider_waitlist_entry_id
      ),
      'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
    );
  end if;

  update public.class_booking_quotes set status = 'consumed'
  where id = quote_row.id and status = 'open';

  insert into public.class_bookings (
    business_id, offer_id, quote_id, customer_id, location_id, idempotency_key,
    status, payment_status, provider, provider_site_id, provider_location_id,
    provider_class_id, provider_class_schedule_id, provider_class_description_id,
    provider_program_id, provider_session_type_id, provider_client_id,
    provider_client_unique_id, provider_service_product_id, provider_client_service_id,
    class_name, staff_name, location_name, start_datetime, end_datetime, price_amount, currency
  ) values (
    quote_row.business_id, quote_row.offer_id, quote_row.id, quote_row.customer_id,
    quote_row.location_id, trim(candidate_idempotency_key), 'pending',
    case when quote_row.fulfilment_mode = 'purchase_pricing_option'
      then 'pending'::public.class_payment_status else 'not_required'::public.class_payment_status end,
    quote_row.provider, quote_row.provider_site_id, quote_row.provider_location_id,
    quote_row.provider_class_id, coalesce(candidate_class_schedule_id, quote_row.provider_class_schedule_id),
    candidate_class_description_id, candidate_program_id, candidate_session_type_id,
    quote_row.provider_client_id, quote_row.provider_client_unique_id,
    quote_row.provider_service_product_id, quote_row.provider_client_service_id,
    coalesce(nullif(trim(candidate_class_name), ''), 'Class'),
    nullif(trim(candidate_staff_name), ''), location_display_name,
    candidate_start_datetime, candidate_end_datetime,
    quote_row.grand_total, quote_row.currency
  ) returning * into booking_row;

  insert into public.class_booking_provider_attempts (
    business_id, booking_id, provider, attempt_type, status,
    idempotency_key, request_fingerprint
  ) values (
    quote_row.business_id, booking_row.id, quote_row.provider, candidate_attempt_type,
    'pending', trim(candidate_idempotency_key), candidate_request_fingerprint
  ) returning * into attempt_row;

  insert into public.class_booking_write_locks (
    business_id, customer_id, booking_id, attempt_id, provider,
    provider_site_id, provider_class_id, token_digest
  ) values (
    quote_row.business_id, quote_row.customer_id, booking_row.id, attempt_row.id,
    quote_row.provider, quote_row.provider_site_id, quote_row.provider_class_id,
    encode(extensions.digest(candidate_write_token, 'sha256'), 'hex')
  );

  return jsonb_build_object(
    'shouldWrite', true, 'writeToken', candidate_write_token,
    'booking', jsonb_build_object(
      'id', booking_row.id, 'status', booking_row.status,
      'priceAmount', booking_row.price_amount, 'currency', booking_row.currency,
      'className', booking_row.class_name, 'startAt', booking_row.start_datetime,
      'locationName', booking_row.location_name,
      'providerClassId', booking_row.provider_class_id
    ),
    'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
  );
end;
$$;

create or replace function public.finalize_class_booking_attempt(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_attempt_id uuid,
  candidate_write_token text,
  candidate_booking_status public.class_booking_status,
  candidate_attempt_status public.class_provider_attempt_status,
  candidate_payment_status public.class_payment_status,
  candidate_provider_request_id text,
  candidate_provider_visit_id text,
  candidate_provider_roster_booking_id text,
  candidate_provider_waitlist_entry_id text,
  candidate_provider_client_service_id text,
  candidate_provider_service_product_id text,
  candidate_provider_sale_id text,
  candidate_provider_cart_id text,
  candidate_provider_transaction_id text,
  candidate_provider_payment_id text,
  candidate_error_code text,
  candidate_error_message text,
  candidate_release_write_lock boolean
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
  select booking.* into booking_row from public.class_bookings booking
  where booking.business_id = candidate_business_id and booking.id = candidate_booking_id
  for update;
  select attempt.* into attempt_row from public.class_booking_provider_attempts attempt
  where attempt.business_id = candidate_business_id and attempt.id = candidate_attempt_id
    and attempt.booking_id = candidate_booking_id
  for update;
  select write_lock.* into lock_row from public.class_booking_write_locks write_lock
  where write_lock.business_id = candidate_business_id
    and write_lock.booking_id = candidate_booking_id
    and write_lock.attempt_id = candidate_attempt_id
    and write_lock.status = 'active'
  for update;

  if booking_row.id is null or attempt_row.id is null or lock_row.id is null
    or lock_row.token_digest is distinct from encode(extensions.digest(candidate_write_token, 'sha256'), 'hex') then
    raise exception 'Class Booking write lock could not be verified';
  end if;
  if attempt_row.status <> 'pending' then
    return jsonb_build_object(
      'booking', jsonb_build_object('id', booking_row.id, 'status', booking_row.status),
      'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
    );
  end if;
  if candidate_booking_status = 'confirmed'
    and candidate_provider_visit_id is null
    and candidate_provider_roster_booking_id is null
    and (candidate_provider_sale_id is null or candidate_provider_transaction_id is null) then
    raise exception 'authoritative Mindbody evidence is required to confirm a Class Booking';
  end if;
  if candidate_booking_status = 'waitlisted' and candidate_provider_waitlist_entry_id is null then
    raise exception 'a Mindbody Waitlist Entry is required to mark a Class Booking waitlisted';
  end if;
  if candidate_booking_status = 'unknown' and candidate_release_write_lock then
    raise exception 'an unknown Class Booking outcome must retain its write lock';
  end if;
  if candidate_booking_status = 'requires_action' and candidate_release_write_lock then
    raise exception 'a requires-action Class Booking must retain its write lock';
  end if;

  update public.class_bookings set
    status = candidate_booking_status,
    payment_status = candidate_payment_status,
    provider_visit_id = coalesce(candidate_provider_visit_id, provider_visit_id),
    provider_roster_booking_id = coalesce(candidate_provider_roster_booking_id, provider_roster_booking_id),
    provider_waitlist_entry_id = coalesce(candidate_provider_waitlist_entry_id, provider_waitlist_entry_id),
    provider_client_service_id = coalesce(provider_client_service_id, candidate_provider_client_service_id),
    provider_service_product_id = coalesce(provider_service_product_id, candidate_provider_service_product_id),
    provider_sale_id = coalesce(candidate_provider_sale_id, provider_sale_id),
    provider_cart_id = coalesce(candidate_provider_cart_id, provider_cart_id),
    provider_transaction_id = coalesce(candidate_provider_transaction_id, provider_transaction_id),
    provider_payment_id = coalesce(candidate_provider_payment_id, provider_payment_id),
    error_code = candidate_error_code,
    error_message = candidate_error_message,
    confirmed_at = case when candidate_booking_status = 'confirmed' then now() else confirmed_at end
  where id = booking_row.id
  returning * into booking_row;

  update public.class_booking_provider_attempts set
    status = candidate_attempt_status,
    provider_request_id = candidate_provider_request_id,
    provider_error_code = candidate_error_code,
    error_message = candidate_error_message,
    completed_at = case when candidate_attempt_status in ('confirmed', 'failed') then now() else completed_at end
  where id = attempt_row.id
  returning * into attempt_row;

  if candidate_booking_status = 'unknown' then
    insert into public.class_booking_reconciliation_queue (
      business_id, booking_id, attempt_id, reason_code
    ) values (
      candidate_business_id, candidate_booking_id, candidate_attempt_id,
      coalesce(candidate_error_code, 'PROVIDER_OUTCOME_UNKNOWN')
    ) on conflict (attempt_id) do update
      set status = 'queued', reason_code = excluded.reason_code,
          available_at = least(public.class_booking_reconciliation_queue.available_at, excluded.available_at);
  elsif candidate_release_write_lock then
    update public.class_booking_write_locks
    set status = 'released', released_at = now()
    where id = lock_row.id;
  end if;

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

create or replace function public.enqueue_class_booking_reconciliation(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_attempt_id uuid,
  candidate_reason_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  queue_id uuid;
begin
  if not exists (
    select 1 from public.class_booking_provider_attempts attempt
    join public.class_bookings booking on booking.id = attempt.booking_id
    where attempt.business_id = candidate_business_id
      and attempt.id = candidate_attempt_id
      and booking.id = candidate_booking_id
      and attempt.status = 'unknown'
      and booking.status = 'unknown'
  ) then
    raise exception 'only an unknown Class Booking can enter reconciliation';
  end if;
  insert into public.class_booking_reconciliation_queue (
    business_id, booking_id, attempt_id, reason_code
  ) values (
    candidate_business_id, candidate_booking_id, candidate_attempt_id, candidate_reason_code
  ) on conflict (attempt_id) do update
    set status = 'queued', reason_code = excluded.reason_code
  returning id into queue_id;
  return queue_id;
end;
$$;

create or replace function public.complete_class_booking_reconciliation(
  candidate_business_id uuid,
  candidate_booking_id uuid,
  candidate_attempt_id uuid,
  candidate_booking_status public.class_booking_status,
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
  if candidate_booking_status not in ('confirmed', 'waitlisted', 'failed', 'duplicate') then
    raise exception 'reconciliation requires an authoritative terminal Class Booking status';
  end if;
  select booking.* into booking_row from public.class_bookings booking
  where booking.business_id = candidate_business_id and booking.id = candidate_booking_id
  for update;
  select attempt.* into attempt_row from public.class_booking_provider_attempts attempt
  where attempt.business_id = candidate_business_id and attempt.id = candidate_attempt_id
    and attempt.booking_id = candidate_booking_id
  for update;
  select write_lock.* into lock_row from public.class_booking_write_locks write_lock
  where write_lock.business_id = candidate_business_id
    and write_lock.booking_id = candidate_booking_id
    and write_lock.attempt_id = candidate_attempt_id
    and write_lock.status = 'active'
  for update;
  if booking_row.status <> 'unknown' or attempt_row.status <> 'unknown'
    or lock_row.id is null then
    raise exception 'unknown Class Booking reconciliation lock could not be verified';
  end if;
  if candidate_booking_status = 'confirmed'
    and candidate_provider_visit_id is null
    and candidate_provider_roster_booking_id is null
    and (candidate_provider_sale_id is null or candidate_provider_transaction_id is null) then
    raise exception 'authoritative Mindbody evidence is required to reconcile a confirmed Class Booking';
  end if;
  if candidate_booking_status = 'waitlisted' and candidate_provider_waitlist_entry_id is null then
    raise exception 'a Mindbody Waitlist Entry is required to reconcile a waitlisted Class Booking';
  end if;

  update public.class_bookings set
    status = candidate_booking_status,
    provider_visit_id = coalesce(candidate_provider_visit_id, provider_visit_id),
    provider_roster_booking_id = coalesce(candidate_provider_roster_booking_id, provider_roster_booking_id),
    provider_waitlist_entry_id = coalesce(candidate_provider_waitlist_entry_id, provider_waitlist_entry_id),
    provider_client_service_id = coalesce(provider_client_service_id, candidate_provider_client_service_id),
    provider_service_product_id = coalesce(provider_service_product_id, candidate_provider_service_product_id),
    provider_sale_id = coalesce(candidate_provider_sale_id, provider_sale_id),
    provider_cart_id = coalesce(candidate_provider_cart_id, provider_cart_id),
    provider_transaction_id = coalesce(candidate_provider_transaction_id, provider_transaction_id),
    provider_payment_id = coalesce(candidate_provider_payment_id, provider_payment_id),
    error_code = candidate_error_code,
    confirmed_at = case when candidate_booking_status = 'confirmed' then now() else confirmed_at end
  where id = booking_row.id returning * into booking_row;

  update public.class_booking_provider_attempts set
    status = 'reconciled', reconciled_at = now(), completed_at = now(),
    provider_error_code = candidate_error_code
  where id = attempt_row.id returning * into attempt_row;

  update public.class_booking_write_locks
  set status = 'released', released_at = now()
  where id = lock_row.id;
  update public.class_booking_reconciliation_queue
  set status = 'completed', completed_at = now()
  where attempt_id = attempt_row.id;

  return jsonb_build_object(
    'booking', jsonb_build_object(
      'id', booking_row.id, 'status', booking_row.status,
      'providerVisitId', booking_row.provider_visit_id,
      'providerRosterBookingId', booking_row.provider_roster_booking_id,
      'providerWaitlistEntryId', booking_row.provider_waitlist_entry_id
    ),
    'attempt', jsonb_build_object('id', attempt_row.id, 'status', attempt_row.status)
  );
end;
$$;

alter table public.class_booking_write_locks enable row level security;
alter table public.class_booking_reconciliation_queue enable row level security;

create policy class_booking_write_locks_operations_select
on public.class_booking_write_locks for select to authenticated
using (public.has_class_operations_access(business_id));

create policy class_booking_reconciliation_operations_select
on public.class_booking_reconciliation_queue for select to authenticated
using (public.has_class_operations_access(business_id));

grant select on public.class_booking_write_locks to authenticated, service_role;
grant select on public.class_booking_reconciliation_queue to authenticated, service_role;
grant insert, update, delete on public.class_booking_write_locks to service_role;
grant insert, update, delete on public.class_booking_reconciliation_queue to service_role;

revoke all on function public.claim_class_booking_attempt(
  uuid, uuid, text, text, public.class_provider_attempt_type, text,
  text, text, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_class_booking_attempt(
  uuid, uuid, text, text, public.class_provider_attempt_type, text,
  text, text, text, text, text, text, timestamptz, timestamptz
) to service_role;

revoke all on function public.finalize_class_booking_attempt(
  uuid, uuid, uuid, text, public.class_booking_status,
  public.class_provider_attempt_status, public.class_payment_status,
  text, text, text, text, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.finalize_class_booking_attempt(
  uuid, uuid, uuid, text, public.class_booking_status,
  public.class_provider_attempt_status, public.class_payment_status,
  text, text, text, text, text, text, text, text, text, text, text, text, boolean
) to service_role;

revoke all on function public.enqueue_class_booking_reconciliation(uuid, uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.enqueue_class_booking_reconciliation(uuid, uuid, uuid, text)
to service_role;

revoke all on function public.complete_class_booking_reconciliation(
  uuid, uuid, uuid, public.class_booking_status,
  text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_class_booking_reconciliation(
  uuid, uuid, uuid, public.class_booking_status,
  text, text, text, text, text, text, text, text, text, text
) to service_role;

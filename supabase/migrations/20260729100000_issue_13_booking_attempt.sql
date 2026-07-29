create type public.booking_completion_mode as enum ('disabled', 'free_unpaid');
create type public.booking_attempt_state as enum (
  'created',
  'pending_checkout',
  'unknown',
  'confirmed',
  'failed',
  'expired'
);

alter table public.businesses
  add column completion_mode public.booking_completion_mode not null default 'disabled';

create table public.mindbody_client_mappings (
  business_id uuid not null references public.businesses(id) on delete cascade,
  memberstack_id text not null check (length(trim(memberstack_id)) > 0),
  mindbody_client_id text not null check (length(trim(mindbody_client_id)) > 0),
  verified_email text not null check (length(trim(verified_email)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, memberstack_id),
  unique (business_id, mindbody_client_id)
);

create table public.booking_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  memberstack_id text not null check (length(trim(memberstack_id)) > 0),
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 200),
  location_id uuid not null,
  service_id uuid not null,
  business_name text not null,
  location_name text not null,
  location_timezone text not null,
  service_name text not null,
  mindbody_location_id text not null,
  mindbody_session_type_id text not null,
  selected_start_time timestamptz not null,
  selected_end_time timestamptz,
  duration_minutes integer,
  price numeric(12, 2),
  state public.booking_attempt_state not null default 'created',
  completion_mode public.booking_completion_mode not null,
  expires_at timestamptz not null,
  correlation_id uuid not null default gen_random_uuid(),
  mindbody_client_id text,
  mindbody_appointment_id text,
  mindbody_appointment_unique_id text,
  provider_operation_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, memberstack_id, idempotency_key),
  foreign key (business_id, location_id) references public.business_locations(business_id, id),
  foreign key (business_id, service_id) references public.business_services(business_id, id),
  check (selected_end_time is null or selected_end_time > selected_start_time),
  check (duration_minutes is null or duration_minutes > 0),
  check (price is null or price >= 0)
);

create table public.booking_attempt_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_attempt_id uuid not null references public.booking_attempts(id) on delete cascade,
  correlation_id uuid not null,
  event_type text not null check (length(trim(event_type)) > 0),
  operation text not null check (length(trim(operation)) > 0),
  provider_status integer,
  error_category text,
  latency_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.prevent_booking_attempt_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'booking attempt events are append-only';
end;
$$;

create trigger booking_attempt_events_append_only
before update or delete on public.booking_attempt_events
for each row execute function public.prevent_booking_attempt_event_mutation();

create table public.booking_support_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_attempt_id uuid references public.booking_attempts(id) on delete set null,
  correlation_id uuid not null,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index booking_attempts_customer_idx on public.booking_attempts (business_id, memberstack_id, created_at desc);
create index booking_attempt_events_attempt_idx on public.booking_attempt_events (booking_attempt_id, created_at);
create index booking_support_items_business_idx on public.booking_support_items (business_id, status, created_at);

create trigger mindbody_client_mappings_set_updated_at
before update on public.mindbody_client_mappings
for each row execute function public.set_provider_updated_at();

create trigger booking_attempts_set_updated_at
before update on public.booking_attempts
for each row execute function public.set_updated_at();

create or replace function public.prevent_booking_attempt_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.business_id is distinct from new.business_id
    or old.memberstack_id is distinct from new.memberstack_id
    or old.idempotency_key is distinct from new.idempotency_key
    or old.location_id is distinct from new.location_id
    or old.service_id is distinct from new.service_id
    or old.business_name is distinct from new.business_name
    or old.location_name is distinct from new.location_name
    or old.location_timezone is distinct from new.location_timezone
    or old.service_name is distinct from new.service_name
    or old.mindbody_location_id is distinct from new.mindbody_location_id
    or old.mindbody_session_type_id is distinct from new.mindbody_session_type_id
    or old.selected_start_time is distinct from new.selected_start_time
    or old.selected_end_time is distinct from new.selected_end_time
    or old.duration_minutes is distinct from new.duration_minutes
    or old.price is distinct from new.price
    or old.completion_mode is distinct from new.completion_mode
    or old.expires_at is distinct from new.expires_at
    or old.correlation_id is distinct from new.correlation_id
  then
    raise exception 'booking attempt facts are immutable';
  end if;
  return new;
end;
$$;

create trigger booking_attempts_immutable_facts
before update on public.booking_attempts
for each row execute function public.prevent_booking_attempt_mutation();

create or replace function public.validate_booking_attempt_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = new.state then return new; end if;
  if not (
    (old.state = 'created' and new.state in ('pending_checkout', 'failed', 'expired'))
    or (old.state = 'pending_checkout' and new.state in ('confirmed', 'unknown', 'failed', 'expired'))
    or (old.state = 'unknown' and new.state in ('confirmed', 'failed', 'expired'))
  ) then
    raise exception 'invalid booking attempt state transition from % to %', old.state, new.state;
  end if;
  return new;
end;
$$;

create trigger booking_attempts_valid_transition
before update on public.booking_attempts
for each row execute function public.validate_booking_attempt_transition();

alter table public.mindbody_client_mappings enable row level security;
alter table public.booking_attempts enable row level security;
alter table public.booking_attempt_events enable row level security;
alter table public.booking_support_items enable row level security;

revoke all on public.mindbody_client_mappings from anon, authenticated;
revoke all on public.booking_attempts from anon, authenticated;
revoke all on public.booking_attempt_events from anon, authenticated;
revoke all on public.booking_support_items from anon, authenticated;
grant all on public.mindbody_client_mappings to service_role;
grant all on public.booking_attempts to service_role;
grant all on public.booking_attempt_events to service_role;
grant all on public.booking_support_items to service_role;
grant usage, select on sequence public.booking_attempt_events_id_seq to service_role;

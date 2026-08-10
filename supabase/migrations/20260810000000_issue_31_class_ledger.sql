create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema pg_catalog;

create type public.class_business_status as enum ('pending', 'active', 'disabled');
create type public.class_integration_provider as enum ('mindbody');
create type public.class_integration_status as enum (
  'draft',
  'pending_activation',
  'active',
  'revoked',
  'disabled',
  'error'
);
create type public.class_provider_environment as enum ('sandbox', 'production');
create type public.class_offer_status as enum ('draft', 'active', 'inactive');
create type public.class_offer_fulfilment_mode as enum (
  'purchase_pricing_option',
  'existing_entitlement',
  'approved_unpaid'
);
create type public.class_offer_mapping_status as enum ('draft', 'active', 'disabled');
create type public.class_inventory_entity_kind as enum (
  'program',
  'class_description',
  'session_type',
  'class_schedule',
  'location'
);
create type public.class_quote_status as enum ('open', 'consumed', 'expired', 'invalidated');
create type public.class_quote_calculation_source as enum (
  'checkout_test_cart',
  'service_price',
  'entitlement_balance',
  'approved_unpaid'
);
create type public.class_booking_status as enum (
  'pending',
  'requires_action',
  'confirmed',
  'waitlisted',
  'cancel_pending',
  'cancelled',
  'duplicate',
  'failed',
  'unknown'
);
create type public.class_payment_status as enum (
  'not_required',
  'pending',
  'requires_action',
  'authorized',
  'paid',
  'failed',
  'unknown'
);
create type public.class_provider_attempt_type as enum (
  'client_create',
  'quote',
  'purchase_booking',
  'existing_entitlement_booking',
  'approved_unpaid_booking',
  'waitlist_join',
  'cancellation',
  'waitlist_removal',
  'reconciliation'
);
create type public.class_provider_attempt_status as enum (
  'pending',
  'requires_action',
  'confirmed',
  'failed',
  'unknown',
  'reconciled'
);
create type public.class_support_lock_status as enum ('active', 'released', 'expired');
create type public.class_provider_diagnostic_kind as enum (
  'request_summary',
  'response_summary',
  'reconciliation_evidence',
  'webhook_evidence'
);

create or replace function public.class_array_has_empty_text(values_to_check text[])
returns boolean
language sql
immutable
strict
as $$
  select exists (
    select 1
    from unnest(values_to_check) as candidate(value)
    where length(trim(candidate.value)) = 0
  );
$$;

create or replace function public.class_text_is_redacted(candidate text)
returns boolean
language sql
immutable
strict
as $$
  select lower(candidate) !~ '(^|[^a-z])(authorization|api[_ -]?key|password|source[_ -]?password|token|access[_ -]?token|refresh[_ -]?token|activation[_ -]?code|activation[_ -]?link|card[_ -]?number|account[_ -]?number|cvv|cvc|expiry|payment[_ -]?token)([^a-z]|$)';
$$;

create or replace function public.class_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.class_businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  status public.class_business_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.class_businesses is
  'Production Classes-only tenant ledger. It is independent from the Appointment prototype tables.';

create table public.class_business_integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  provider public.class_integration_provider not null default 'mindbody',
  environment public.class_provider_environment not null default 'sandbox',
  provider_site_id text not null check (length(trim(provider_site_id)) > 0),
  status public.class_integration_status not null default 'draft',
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, id, provider, provider_site_id),
  unique (provider, environment, provider_site_id),
  check (status <> 'active' or activated_at is not null)
);

create table public.class_business_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  integration_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  timezone text not null default 'UTC' check (length(trim(timezone)) > 0),
  provider_location_id text not null check (length(trim(provider_location_id)) > 0),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, id, provider_location_id),
  unique (business_id, id, integration_id, provider_location_id),
  unique (business_id, slug),
  unique (integration_id, provider_location_id),
  foreign key (business_id, integration_id)
    references public.class_business_integrations(business_id, id)
    on delete restrict
);

create table public.class_revvi_customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  memberstack_customer_id text not null unique check (length(trim(memberstack_customer_id)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.class_business_customer_access (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  customer_id uuid not null references public.class_revvi_customers(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, customer_id),
  check (revoked_at is null or revoked_at >= granted_at)
);

create table public.class_business_staff_access (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id),
  check (revoked_at is null or revoked_at >= granted_at)
);

create table public.class_customer_provider_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  customer_id uuid not null references public.class_revvi_customers(id) on delete restrict,
  integration_id uuid not null,
  provider public.class_integration_provider not null default 'mindbody',
  provider_site_id text not null check (length(trim(provider_site_id)) > 0),
  provider_client_id text not null check (length(trim(provider_client_id)) > 0),
  provider_client_unique_id text check (
    provider_client_unique_id is null or length(trim(provider_client_unique_id)) > 0
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, integration_id),
  unique (integration_id, provider_client_id),
  unique (
    business_id, id, customer_id, integration_id, provider, provider_site_id,
    provider_client_id
  ),
  foreign key (business_id, customer_id)
    references public.class_business_customer_access(business_id, customer_id)
    on delete restrict,
  foreign key (business_id, integration_id, provider, provider_site_id)
    references public.class_business_integrations(business_id, id, provider, provider_site_id)
    on delete restrict
);

comment on table public.class_customer_provider_profiles is
  'Site-scoped Mindbody Client identity for a Revvi Customer; never a global Customer attribute.';

create table public.class_revvi_offers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  location_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  fulfilment_mode public.class_offer_fulfilment_mode not null,
  eligible_memberstack_plan_ids text[] not null,
  status public.class_offer_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, id, location_id),
  unique (business_id, slug),
  unique (id, fulfilment_mode),
  foreign key (business_id, location_id)
    references public.class_business_locations(business_id, id)
    on delete restrict,
  check (cardinality(eligible_memberstack_plan_ids) > 0),
  check (array_position(eligible_memberstack_plan_ids, null) is null),
  check (not public.class_array_has_empty_text(eligible_memberstack_plan_ids))
);

create table public.class_offer_provider_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  offer_id uuid not null,
  fulfilment_mode public.class_offer_fulfilment_mode not null,
  integration_id uuid not null,
  location_id uuid not null,
  provider_service_product_id text,
  status public.class_offer_mapping_status not null default 'draft',
  validated_at timestamptz,
  validation_evidence_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offer_id),
  unique (business_id, id),
  unique (business_id, id, offer_id),
  unique (business_id, id, offer_id, integration_id, fulfilment_mode),
  unique (business_id, id, offer_id, integration_id, location_id, fulfilment_mode),
  unique (business_id, id, offer_id, integration_id, fulfilment_mode, provider_service_product_id),
  foreign key (business_id, offer_id)
    references public.class_revvi_offers(business_id, id)
    on delete restrict,
  foreign key (offer_id, fulfilment_mode)
    references public.class_revvi_offers(id, fulfilment_mode)
    on delete restrict,
  foreign key (business_id, integration_id)
    references public.class_business_integrations(business_id, id)
    on delete restrict,
  foreign key (business_id, location_id)
    references public.class_business_locations(business_id, id)
    on delete restrict,
  check (
    (fulfilment_mode = 'purchase_pricing_option' and provider_service_product_id is not null and length(trim(provider_service_product_id)) > 0)
    or (fulfilment_mode <> 'purchase_pricing_option' and provider_service_product_id is null)
  ),
  check (
    (status = 'active' and validated_at is not null and validation_evidence_digest ~ '^[0-9a-f]{64}$')
    or status <> 'active'
  )
);

create table public.class_offer_inventory_allowlist (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  mapping_id uuid not null,
  entity_kind public.class_inventory_entity_kind not null,
  provider_entity_id text not null check (length(trim(provider_entity_id)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mapping_id, entity_kind, provider_entity_id),
  foreign key (business_id, mapping_id)
    references public.class_offer_provider_mappings(business_id, id)
    on delete restrict
);

comment on table public.class_offer_inventory_allowlist is
  'Stable class-family allowlist. Occurrence-specific Mindbody Class.Id is deliberately not a permitted entity kind.';

create table public.class_booking_quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  offer_id uuid not null,
  mapping_id uuid not null,
  integration_id uuid not null,
  location_id uuid not null,
  customer_id uuid not null references public.class_revvi_customers(id) on delete restrict,
  customer_provider_profile_id uuid not null,
  provider public.class_integration_provider not null default 'mindbody',
  provider_site_id text not null check (length(trim(provider_site_id)) > 0),
  provider_location_id text not null check (length(trim(provider_location_id)) > 0),
  provider_class_id text not null check (length(trim(provider_class_id)) > 0),
  provider_class_schedule_id text,
  provider_client_id text not null check (length(trim(provider_client_id)) > 0),
  provider_client_unique_id text check (
    provider_client_unique_id is null or length(trim(provider_client_unique_id)) > 0
  ),
  provider_service_product_id text,
  provider_client_service_id text,
  fulfilment_mode public.class_offer_fulfilment_mode not null,
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  discount_total numeric(12, 2) not null check (discount_total >= 0),
  tax_total numeric(12, 2) not null check (tax_total >= 0),
  grand_total numeric(12, 2) not null check (grand_total >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_calculation public.class_quote_calculation_source not null,
  quote_fingerprint text not null check (quote_fingerprint ~ '^[0-9a-f]{64}$'),
  status public.class_quote_status not null default 'open',
  quoted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, id, offer_id, customer_id, provider_class_id),
  unique (
    business_id, id, offer_id, customer_id, provider_class_id, location_id,
    provider, provider_site_id, provider_location_id
  ),
  foreign key (business_id, offer_id)
    references public.class_revvi_offers(business_id, id)
    on delete restrict,
  foreign key (business_id, offer_id, location_id)
    references public.class_revvi_offers(business_id, id, location_id)
    on delete restrict,
  foreign key (business_id, mapping_id)
    references public.class_offer_provider_mappings(business_id, id)
    on delete restrict,
  foreign key (business_id, mapping_id, offer_id)
    references public.class_offer_provider_mappings(business_id, id, offer_id)
    on delete restrict,
  foreign key (business_id, integration_id)
    references public.class_business_integrations(business_id, id)
    on delete restrict,
  foreign key (business_id, integration_id, provider, provider_site_id)
    references public.class_business_integrations(business_id, id, provider, provider_site_id)
    on delete restrict,
  foreign key (
    business_id, customer_provider_profile_id, customer_id, integration_id, provider,
    provider_site_id, provider_client_id
  ) references public.class_customer_provider_profiles(
    business_id, id, customer_id, integration_id, provider, provider_site_id,
    provider_client_id
  ) on delete restrict,
  foreign key (business_id, location_id, integration_id, provider_location_id)
    references public.class_business_locations(business_id, id, integration_id, provider_location_id)
    on delete restrict,
  foreign key (business_id, mapping_id, offer_id, integration_id, fulfilment_mode)
    references public.class_offer_provider_mappings(
      business_id, id, offer_id, integration_id, fulfilment_mode
    )
    on delete restrict,
  foreign key (business_id, mapping_id, offer_id, integration_id, location_id, fulfilment_mode)
    references public.class_offer_provider_mappings(
      business_id, id, offer_id, integration_id, location_id, fulfilment_mode
    )
    on delete restrict,
  foreign key (
    business_id, mapping_id, offer_id, integration_id, fulfilment_mode,
    provider_service_product_id
  ) references public.class_offer_provider_mappings(
    business_id, id, offer_id, integration_id, fulfilment_mode,
    provider_service_product_id
  ) on delete restrict,
  check (expires_at > quoted_at and expires_at <= quoted_at + interval '15 minutes'),
  check (grand_total = subtotal - discount_total + tax_total)
);

create table public.class_bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  offer_id uuid not null,
  quote_id uuid not null,
  customer_id uuid not null references public.class_revvi_customers(id) on delete restrict,
  location_id uuid not null,
  idempotency_key text not null check (length(trim(idempotency_key)) >= 16),
  status public.class_booking_status not null default 'pending',
  payment_status public.class_payment_status not null default 'unknown',
  cancellation_status public.class_provider_attempt_status,
  restoration_status public.class_provider_attempt_status,
  refund_status public.class_provider_attempt_status,
  provider public.class_integration_provider not null default 'mindbody',
  provider_site_id text not null check (length(trim(provider_site_id)) > 0),
  provider_location_id text not null check (length(trim(provider_location_id)) > 0),
  provider_class_id text not null check (length(trim(provider_class_id)) > 0),
  provider_class_schedule_id text,
  provider_class_description_id text,
  provider_program_id text,
  provider_session_type_id text,
  provider_client_id text,
  provider_client_unique_id text,
  provider_visit_id text,
  provider_roster_booking_id text,
  provider_waitlist_entry_id text,
  provider_service_product_id text,
  provider_client_service_id text,
  provider_sale_id text,
  provider_cart_id text,
  provider_transaction_id text,
  provider_payment_id text,
  class_name text,
  staff_name text,
  start_datetime timestamptz not null,
  end_datetime timestamptz,
  price_amount numeric(12, 2) check (price_amount is null or price_amount >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  cancellation_reason text,
  error_code text,
  error_message text check (
    error_message is null
    or (length(error_message) <= 1000 and public.class_text_is_redacted(error_message))
  ),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, idempotency_key),
  foreign key (business_id, offer_id)
    references public.class_revvi_offers(business_id, id)
    on delete restrict,
  foreign key (business_id, location_id)
    references public.class_business_locations(business_id, id)
    on delete restrict,
  foreign key (business_id, location_id, provider_location_id)
    references public.class_business_locations(business_id, id, provider_location_id)
    on delete restrict,
  foreign key (business_id, quote_id)
    references public.class_booking_quotes(business_id, id)
    on delete restrict,
  foreign key (business_id, quote_id, offer_id, customer_id, provider_class_id)
    references public.class_booking_quotes(business_id, id, offer_id, customer_id, provider_class_id)
    on delete restrict,
  foreign key (
    business_id, quote_id, offer_id, customer_id, provider_class_id, location_id,
    provider, provider_site_id, provider_location_id
  ) references public.class_booking_quotes(
    business_id, id, offer_id, customer_id, provider_class_id, location_id,
    provider, provider_site_id, provider_location_id
  ) on delete restrict,
  check (status <> 'confirmed' or confirmed_at is not null),
  check (status <> 'cancelled' or cancelled_at is not null),
  check (end_datetime is null or end_datetime > start_datetime)
);

comment on column public.class_bookings.provider_class_id is
  'The selected time-specific Mindbody Class.Id; stored only on Quote/Booking facts, never in the durable Offer mapping.';

create table public.class_booking_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  booking_id uuid not null,
  provider public.class_integration_provider not null default 'mindbody',
  attempt_type public.class_provider_attempt_type not null,
  status public.class_provider_attempt_status not null default 'pending',
  idempotency_key text not null check (length(trim(idempotency_key)) >= 16),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_request_id text,
  provider_error_code text,
  error_message text check (
    error_message is null
    or (length(error_message) <= 1000 and public.class_text_is_redacted(error_message))
  ),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, idempotency_key),
  unique (business_id, id),
  foreign key (business_id, booking_id)
    references public.class_bookings(business_id, id)
    on delete restrict,
  check (status not in ('confirmed', 'failed', 'reconciled') or completed_at is not null),
  check (status <> 'reconciled' or reconciled_at is not null)
);

create table public.class_booking_provider_attempt_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  attempt_id uuid not null,
  from_status public.class_provider_attempt_status,
  to_status public.class_provider_attempt_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, attempt_id)
    references public.class_booking_provider_attempts(business_id, id)
    on delete restrict
);

create table public.class_booking_provider_diagnostics (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  attempt_id uuid not null,
  diagnostic_kind public.class_provider_diagnostic_kind not null,
  endpoint_name text not null check (endpoint_name ~ '^[A-Za-z][A-Za-z0-9._/-]{0,127}$'),
  request_id text,
  provider_request_id text,
  status_code integer check (status_code is null or status_code between 100 and 599),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  success boolean not null default false,
  error_code text check (error_code is null or error_code ~ '^[A-Za-z0-9._:-]{1,128}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  foreign key (business_id, attempt_id)
    references public.class_booking_provider_attempts(business_id, id)
    on delete restrict,
  check (expires_at > created_at and expires_at <= created_at + interval '48 hours')
);

comment on table public.class_booking_provider_diagnostics is
  'Allowlisted temporary provider facts only. Free-form request and response payloads are deliberately prohibited.';

create table public.class_booking_support_locks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  booking_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  status public.class_support_lock_status not null default 'active',
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, booking_id)
    references public.class_bookings(business_id, id)
    on delete restrict,
  check (expires_at > acquired_at and expires_at <= acquired_at + interval '30 minutes'),
  check ((status = 'released') = (released_at is not null))
);

create unique index class_booking_support_locks_one_active_idx
on public.class_booking_support_locks (booking_id)
where status = 'active';

create index class_integrations_business_idx on public.class_business_integrations (business_id);
create index class_locations_business_idx on public.class_business_locations (business_id);
create index class_customers_memberstack_idx on public.class_revvi_customers (memberstack_customer_id);
create index class_customer_access_customer_idx on public.class_business_customer_access (customer_id);
create index class_staff_access_user_idx on public.class_business_staff_access (user_id);
create index class_customer_profiles_customer_idx on public.class_customer_provider_profiles (customer_id);
create index class_offers_business_location_idx on public.class_revvi_offers (business_id, location_id);
create index class_inventory_mapping_idx on public.class_offer_inventory_allowlist (mapping_id);
create unique index class_paid_mapping_dedicated_product_idx
on public.class_offer_provider_mappings (
  integration_id, location_id, provider_service_product_id
)
where fulfilment_mode = 'purchase_pricing_option' and status <> 'disabled';
create index class_quotes_customer_expiry_idx on public.class_booking_quotes (customer_id, expires_at);
create index class_bookings_customer_created_idx on public.class_bookings (customer_id, created_at desc);
create index class_attempts_booking_idx on public.class_booking_provider_attempts (booking_id, created_at);
create index class_history_attempt_idx on public.class_booking_provider_attempt_history (attempt_id, created_at);
create index class_diagnostics_expiry_idx on public.class_booking_provider_diagnostics (expires_at);

create trigger class_businesses_set_updated_at
before update on public.class_businesses
for each row execute function public.class_set_updated_at();

create trigger class_integrations_set_updated_at
before update on public.class_business_integrations
for each row execute function public.class_set_updated_at();

create trigger class_locations_set_updated_at
before update on public.class_business_locations
for each row execute function public.class_set_updated_at();

create trigger class_customers_set_updated_at
before update on public.class_revvi_customers
for each row execute function public.class_set_updated_at();

create trigger class_customer_access_set_updated_at
before update on public.class_business_customer_access
for each row execute function public.class_set_updated_at();

create trigger class_staff_access_set_updated_at
before update on public.class_business_staff_access
for each row execute function public.class_set_updated_at();

create trigger class_customer_profiles_set_updated_at
before update on public.class_customer_provider_profiles
for each row execute function public.class_set_updated_at();

create trigger class_offers_set_updated_at
before update on public.class_revvi_offers
for each row execute function public.class_set_updated_at();

create trigger class_mappings_set_updated_at
before update on public.class_offer_provider_mappings
for each row execute function public.class_set_updated_at();

create trigger class_inventory_set_updated_at
before update on public.class_offer_inventory_allowlist
for each row execute function public.class_set_updated_at();

create trigger class_quotes_set_updated_at
before update on public.class_booking_quotes
for each row execute function public.class_set_updated_at();

create or replace function public.class_validate_quote_client_unique_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  profile_unique_id text;
begin
  if new.provider_client_unique_id is null then
    return new;
  end if;

  select profile.provider_client_unique_id into profile_unique_id
  from public.class_customer_provider_profiles profile
  where profile.id = new.customer_provider_profile_id;

  if profile_unique_id is distinct from new.provider_client_unique_id then
    raise exception 'Quote Client Unique ID must match its Site-scoped provider profile';
  end if;
  return new;
end;
$$;

create trigger class_quotes_validate_client_unique_id
before insert or update on public.class_booking_quotes
for each row execute function public.class_validate_quote_client_unique_id();

create trigger class_bookings_set_updated_at
before update on public.class_bookings
for each row execute function public.class_set_updated_at();

create trigger class_attempts_set_updated_at
before update on public.class_booking_provider_attempts
for each row execute function public.class_set_updated_at();

create trigger class_diagnostics_set_updated_at
before update on public.class_booking_provider_diagnostics
for each row execute function public.class_set_updated_at();

create trigger class_locks_set_updated_at
before update on public.class_booking_support_locks
for each row execute function public.class_set_updated_at();

create or replace function public.class_prevent_business_reassignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.business_id is distinct from new.business_id then
    raise exception 'Class ledger business ownership is immutable';
  end if;
  return new;
end;
$$;

create trigger class_integrations_immutable_owner before update on public.class_business_integrations
for each row execute function public.class_prevent_business_reassignment();
create trigger class_locations_immutable_owner before update on public.class_business_locations
for each row execute function public.class_prevent_business_reassignment();
create trigger class_customer_access_immutable_owner before update on public.class_business_customer_access
for each row execute function public.class_prevent_business_reassignment();
create trigger class_staff_access_immutable_owner before update on public.class_business_staff_access
for each row execute function public.class_prevent_business_reassignment();
create trigger class_customer_profiles_immutable_owner before update on public.class_customer_provider_profiles
for each row execute function public.class_prevent_business_reassignment();
create trigger class_offers_immutable_owner before update on public.class_revvi_offers
for each row execute function public.class_prevent_business_reassignment();
create trigger class_mappings_immutable_owner before update on public.class_offer_provider_mappings
for each row execute function public.class_prevent_business_reassignment();
create trigger class_inventory_immutable_owner before update on public.class_offer_inventory_allowlist
for each row execute function public.class_prevent_business_reassignment();
create trigger class_quotes_immutable_owner before update on public.class_booking_quotes
for each row execute function public.class_prevent_business_reassignment();
create trigger class_bookings_immutable_owner before update on public.class_bookings
for each row execute function public.class_prevent_business_reassignment();
create trigger class_attempts_immutable_owner before update on public.class_booking_provider_attempts
for each row execute function public.class_prevent_business_reassignment();
create trigger class_diagnostics_immutable_owner before update on public.class_booking_provider_diagnostics
for each row execute function public.class_prevent_business_reassignment();
create trigger class_locks_immutable_owner before update on public.class_booking_support_locks
for each row execute function public.class_prevent_business_reassignment();

create or replace function public.class_protect_customer_provider_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    old.customer_id, old.integration_id, old.provider, old.provider_site_id,
    old.provider_client_id
  ) is distinct from (
    new.customer_id, new.integration_id, new.provider, new.provider_site_id,
    new.provider_client_id
  ) or (
    old.provider_client_unique_id is not null
    and old.provider_client_unique_id is distinct from new.provider_client_unique_id
  ) then
    raise exception 'Class Customer provider identity is immutable';
  end if;
  return new;
end;
$$;

create trigger class_customer_profiles_protect_identity
before update on public.class_customer_provider_profiles
for each row execute function public.class_protect_customer_provider_identity();

create or replace function public.class_protect_active_mapping_configuration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'active' and (
    (old.offer_id, old.integration_id, old.location_id, old.fulfilment_mode,
      old.provider_service_product_id, old.validated_at, old.validation_evidence_digest)
    is distinct from
    (new.offer_id, new.integration_id, new.location_id, new.fulfilment_mode,
      new.provider_service_product_id, new.validated_at, new.validation_evidence_digest)
  ) then
    raise exception 'active Class mapping configuration is immutable';
  end if;
  return new;
end;
$$;

create trigger class_mappings_protect_active_configuration
before update on public.class_offer_provider_mappings
for each row execute function public.class_protect_active_mapping_configuration();

create or replace function public.class_protect_active_offer_configuration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'active' and (
    (old.location_id, old.fulfilment_mode, old.eligible_memberstack_plan_ids)
    is distinct from
    (new.location_id, new.fulfilment_mode, new.eligible_memberstack_plan_ids)
  ) then
    raise exception 'active Revvi Offer configuration is immutable';
  end if;
  return new;
end;
$$;

create trigger class_offers_protect_active_configuration
before update on public.class_revvi_offers
for each row execute function public.class_protect_active_offer_configuration();

create or replace function public.class_protect_active_location_configuration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.integration_id, old.provider_location_id)
    is distinct from (new.integration_id, new.provider_location_id) then
    raise exception 'Class Location provider identity is immutable';
  end if;
  if old.enabled and not new.enabled and exists (
    select 1 from public.class_offer_provider_mappings mapping
    where mapping.location_id = old.id and mapping.status = 'active'
  ) then
    raise exception 'a Location with active Class mappings cannot be disabled';
  end if;
  return new;
end;
$$;

create trigger class_locations_protect_active_configuration
before update on public.class_business_locations
for each row execute function public.class_protect_active_location_configuration();

create or replace function public.class_protect_active_business_configuration()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'active' and new.status <> 'active' and exists (
    select 1 from public.class_revvi_offers offer
    where offer.business_id = old.id and offer.status = 'active'
  ) then
    raise exception 'a Business with active Revvi Offers cannot be disabled';
  end if;
  return new;
end;
$$;

create trigger class_businesses_protect_active_configuration
before update on public.class_businesses
for each row execute function public.class_protect_active_business_configuration();

create or replace function public.class_validate_mapping_activation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  integration_status public.class_integration_status;
  business_status public.class_business_status;
  location_enabled boolean;
  location_integration_id uuid;
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

  select enabled, integration_id into location_enabled, location_integration_id
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
    select 1 from public.class_offer_inventory_allowlist inventory
    where inventory.mapping_id = new.id and inventory.business_id = new.business_id
  ) then
    raise exception 'active Class mapping requires stable approved inventory';
  end if;

  return new;
end;
$$;

create trigger class_mappings_validate_activation
before insert or update on public.class_offer_provider_mappings
for each row execute function public.class_validate_mapping_activation();

create or replace function public.class_validate_offer_activation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' and not exists (
    select 1 from public.class_businesses business
    where business.id = new.business_id and business.status = 'active'
  ) then
    raise exception 'active Revvi Offer requires an active Business';
  end if;

  if new.status = 'active' and not exists (
    select 1
    from public.class_offer_provider_mappings mapping
    where mapping.offer_id = new.id
      and mapping.business_id = new.business_id
      and mapping.location_id = new.location_id
      and mapping.fulfilment_mode = new.fulfilment_mode
      and mapping.status = 'active'
  ) then
    raise exception 'active Revvi Offer requires one complete active Class mapping';
  end if;
  return new;
end;
$$;

create trigger class_offers_validate_activation
before insert or update on public.class_revvi_offers
for each row execute function public.class_validate_offer_activation();

create or replace function public.class_protect_active_mapping_facts()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  active_mapping boolean;
begin
  select status = 'active' into active_mapping
  from public.class_offer_provider_mappings
  where id = coalesce(old.mapping_id, new.mapping_id);

  if coalesce(active_mapping, false) then
    raise exception 'approved inventory is immutable while its Class mapping is active';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger class_inventory_protect_active_mapping
before insert or update or delete on public.class_offer_inventory_allowlist
for each row execute function public.class_protect_active_mapping_facts();

create or replace function public.class_protect_integration_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.provider, old.environment, old.provider_site_id)
    is distinct from (new.provider, new.environment, new.provider_site_id) then
    raise exception 'Class integration provider identity is immutable';
  end if;
  if new.status <> 'active' and old.status = 'active' and exists (
    select 1 from public.class_offer_provider_mappings mapping
    where mapping.integration_id = old.id and mapping.status = 'active'
  ) then
    raise exception 'an integration with active Class mappings cannot be disabled';
  end if;
  return new;
end;
$$;

create trigger class_integrations_protect_identity
before update on public.class_business_integrations
for each row execute function public.class_protect_integration_identity();

create or replace function public.class_validate_booking_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if not (
    (old.status = 'pending' and new.status in (
      'requires_action', 'confirmed', 'waitlisted', 'duplicate', 'failed', 'unknown'
    ))
    or (old.status = 'requires_action' and new.status in (
      'confirmed', 'waitlisted', 'failed', 'unknown'
    ))
    or (old.status = 'unknown' and new.status in (
      'confirmed', 'waitlisted', 'duplicate', 'failed', 'cancelled'
    ))
    or (old.status = 'confirmed' and new.status in ('cancel_pending', 'cancelled', 'unknown'))
    or (old.status = 'waitlisted' and new.status in ('confirmed', 'cancel_pending', 'cancelled', 'unknown'))
    or (old.status = 'cancel_pending' and new.status in (
      'confirmed', 'waitlisted', 'cancelled', 'failed', 'unknown'
    ))
  ) then
    raise exception 'invalid Class Booking transition from % to %', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger class_bookings_valid_transition
before update on public.class_bookings
for each row execute function public.class_validate_booking_transition();

create or replace function public.class_validate_payment_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.payment_status = new.payment_status then
    return new;
  end if;
  if not (
    (old.payment_status = 'unknown' and new.payment_status in (
      'not_required', 'pending', 'requires_action', 'failed'
    ))
    or (old.payment_status = 'pending' and new.payment_status in (
      'requires_action', 'authorized', 'paid', 'failed', 'unknown'
    ))
    or (old.payment_status = 'requires_action' and new.payment_status in (
      'authorized', 'paid', 'failed', 'unknown'
    ))
    or (old.payment_status = 'authorized' and new.payment_status in ('paid', 'failed', 'unknown'))
  ) then
    raise exception 'invalid Class payment transition from % to %', old.payment_status, new.payment_status;
  end if;
  return new;
end;
$$;

create trigger class_bookings_valid_payment_transition
before update on public.class_bookings
for each row execute function public.class_validate_payment_transition();

create or replace function public.class_validate_attempt_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if not (
    (old.status = 'pending' and new.status in ('requires_action', 'confirmed', 'failed', 'unknown'))
    or (old.status = 'requires_action' and new.status in ('confirmed', 'failed', 'unknown'))
    or (old.status = 'unknown' and new.status in ('confirmed', 'failed', 'reconciled'))
  ) then
    raise exception 'invalid Class provider attempt transition from % to %', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger class_attempts_valid_transition
before update on public.class_booking_provider_attempts
for each row execute function public.class_validate_attempt_transition();

create or replace function public.class_record_attempt_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.class_booking_provider_attempt_history (
      business_id, attempt_id, from_status, to_status
    ) values (
      new.business_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status
    );
  end if;
  return new;
end;
$$;

create trigger class_attempts_record_history
after insert or update on public.class_booking_provider_attempts
for each row execute function public.class_record_attempt_history();

create or replace function public.class_history_is_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Class provider attempt history is append-only';
end;
$$;

create trigger class_attempt_history_append_only
before update or delete on public.class_booking_provider_attempt_history
for each row execute function public.class_history_is_append_only();

create or replace function public.purge_expired_class_provider_diagnostics()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.class_booking_provider_diagnostics
  where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_class_provider_diagnostics() from public;
revoke all on function public.purge_expired_class_provider_diagnostics() from anon;
revoke all on function public.purge_expired_class_provider_diagnostics() from authenticated;
grant execute on function public.purge_expired_class_provider_diagnostics() to service_role;

select cron.schedule(
  'class-provider-diagnostics-retention',
  '*/15 * * * *',
  'select public.purge_expired_class_provider_diagnostics();'
);

create or replace function public.class_jwt_memberstack_customer_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'memberstack_customer_id', ''),
    nullif(auth.jwt() -> 'app_metadata' ->> 'memberstack_id', '')
  );
$$;

create or replace function public.has_class_platform_operations_access()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform_operations')::boolean, false);
$$;

create or replace function public.has_class_customer_access(candidate_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.class_business_customer_access access
    join public.class_revvi_customers customer on customer.id = access.customer_id
    where access.business_id = candidate_business_id
      and access.revoked_at is null
      and customer.auth_user_id = auth.uid()
      and customer.memberstack_customer_id = public.class_jwt_memberstack_customer_id()
  );
$$;

create or replace function public.has_class_staff_access(candidate_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.class_business_staff_access access
    where access.business_id = candidate_business_id
      and access.user_id = auth.uid()
      and access.revoked_at is null
  );
$$;

create or replace function public.has_class_operations_access(candidate_business_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.has_class_staff_access(candidate_business_id)
    or public.has_class_platform_operations_access();
$$;

create or replace function public.is_class_customer(candidate_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.class_revvi_customers customer
    where customer.id = candidate_customer_id
      and customer.auth_user_id = auth.uid()
      and customer.memberstack_customer_id = public.class_jwt_memberstack_customer_id()
  );
$$;

create or replace function public.class_customer_in_operations_scope(candidate_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.class_business_customer_access access
    where access.customer_id = candidate_customer_id
      and public.has_class_operations_access(access.business_id)
  );
$$;

alter table public.class_businesses enable row level security;
alter table public.class_business_integrations enable row level security;
alter table public.class_business_locations enable row level security;
alter table public.class_revvi_customers enable row level security;
alter table public.class_business_customer_access enable row level security;
alter table public.class_business_staff_access enable row level security;
alter table public.class_customer_provider_profiles enable row level security;
alter table public.class_revvi_offers enable row level security;
alter table public.class_offer_provider_mappings enable row level security;
alter table public.class_offer_inventory_allowlist enable row level security;
alter table public.class_booking_quotes enable row level security;
alter table public.class_bookings enable row level security;
alter table public.class_booking_provider_attempts enable row level security;
alter table public.class_booking_provider_attempt_history enable row level security;
alter table public.class_booking_provider_diagnostics enable row level security;
alter table public.class_booking_support_locks enable row level security;

create policy class_businesses_select_scope on public.class_businesses
for select to authenticated using (
  public.has_class_customer_access(id) or public.has_class_operations_access(id)
);
create policy class_integrations_operations_select on public.class_business_integrations
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_locations_select_scope on public.class_business_locations
for select to authenticated using (
  public.has_class_customer_access(business_id) or public.has_class_operations_access(business_id)
);
create policy class_customers_select_self_or_operations on public.class_revvi_customers
for select to authenticated using (
  public.is_class_customer(id)
  or public.class_customer_in_operations_scope(id)
);
create policy class_customer_access_select_scope on public.class_business_customer_access
for select to authenticated using (
  public.is_class_customer(customer_id)
  or public.has_class_operations_access(business_id)
);
create policy class_staff_access_select_scope on public.class_business_staff_access
for select to authenticated using (
  user_id = auth.uid() or public.has_class_platform_operations_access()
);
create policy class_customer_profiles_operations_select on public.class_customer_provider_profiles
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_offers_select_scope on public.class_revvi_offers
for select to authenticated using (
  (status = 'active' and public.has_class_customer_access(business_id))
  or public.has_class_operations_access(business_id)
);
create policy class_mappings_operations_select on public.class_offer_provider_mappings
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_inventory_operations_select on public.class_offer_inventory_allowlist
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_quotes_select_scope on public.class_booking_quotes
for select to authenticated using (
  public.is_class_customer(customer_id)
  or public.has_class_operations_access(business_id)
);
create policy class_bookings_select_scope on public.class_bookings
for select to authenticated using (
  public.is_class_customer(customer_id)
  or public.has_class_operations_access(business_id)
);
create policy class_attempts_operations_select on public.class_booking_provider_attempts
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_history_operations_select on public.class_booking_provider_attempt_history
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_diagnostics_operations_select on public.class_booking_provider_diagnostics
for select to authenticated using (public.has_class_operations_access(business_id));
create policy class_locks_operations_select on public.class_booking_support_locks
for select to authenticated using (public.has_class_operations_access(business_id));

grant select on public.class_businesses to authenticated, service_role;
grant select on public.class_business_integrations to authenticated, service_role;
grant select on public.class_business_locations to authenticated, service_role;
grant select on public.class_revvi_customers to authenticated, service_role;
grant select on public.class_business_customer_access to authenticated, service_role;
grant select on public.class_business_staff_access to authenticated, service_role;
grant select on public.class_customer_provider_profiles to authenticated, service_role;
grant select on public.class_revvi_offers to authenticated, service_role;
grant select on public.class_offer_provider_mappings to authenticated, service_role;
grant select on public.class_offer_inventory_allowlist to authenticated, service_role;
grant select on public.class_booking_quotes to authenticated, service_role;
grant select on public.class_bookings to authenticated, service_role;
grant select on public.class_booking_provider_attempts to authenticated, service_role;
grant select on public.class_booking_provider_attempt_history to authenticated, service_role;
grant select on public.class_booking_provider_diagnostics to authenticated, service_role;
grant select on public.class_booking_support_locks to authenticated, service_role;

grant insert, update, delete on public.class_businesses to service_role;
grant insert, update, delete on public.class_business_integrations to service_role;
grant insert, update, delete on public.class_business_locations to service_role;
grant insert, update, delete on public.class_revvi_customers to service_role;
grant insert, update, delete on public.class_business_customer_access to service_role;
grant insert, update, delete on public.class_business_staff_access to service_role;
grant insert, update, delete on public.class_customer_provider_profiles to service_role;
grant insert, update, delete on public.class_revvi_offers to service_role;
grant insert, update, delete on public.class_offer_provider_mappings to service_role;
grant insert, update, delete on public.class_offer_inventory_allowlist to service_role;
grant insert, update, delete on public.class_booking_quotes to service_role;
grant insert, update, delete on public.class_bookings to service_role;
grant insert, update, delete on public.class_booking_provider_attempts to service_role;
grant insert on public.class_booking_provider_attempt_history to service_role;
grant insert, update, delete on public.class_booking_provider_diagnostics to service_role;
grant insert, update, delete on public.class_booking_support_locks to service_role;

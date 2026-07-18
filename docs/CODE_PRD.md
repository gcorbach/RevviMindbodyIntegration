# Revvi × Mindbody Booking Integration

## Code PRD

**Version:** 1.1 — Phase 0 consolidation
**Status:** Ready for foundation/read implementation; provider writes remain gated
**Project type:** Controlled MVP / pilot
**Estimated implementation budget:** 120 hours
**Initial production target:** One Mindbody partner
**Initial booking type:** Classes only

**Binding MVP scope decision:** The 120-hour pilot supports exactly one approved booking mode for one activated Mindbody Site:

1. an explicit existing `ClientService` pass;
2. a studio-approved free/unpaid booking; or
3. a Mindbody-hosted redirect/opaque payment flow that Mindbody confirms in writing and Revvi verifies in a controlled sandbox.

Raw card data must never enter Webflow, browser JavaScript, Supabase, Revvi logs, or any other Revvi-controlled infrastructure. If no approved no-raw-card booking mode is available, the 120-hour deliverable becomes the availability, eligibility, client-resolution, quote, and operational foundation plus a non-paid pilot. This scope decision is derived from [`MINDBODY_FINDINGS.md`](MINDBODY_FINDINGS.md).

---

# 1. Purpose

Build a secure booking integration that allows eligible Revvi members to view and book approved Mindbody classes without leaving the Revvi website.

The implementation will extend Revvi’s existing platform rather than replace it:

* Webflow remains the frontend and CMS.
* Memberstack remains the member login and membership system.
* Supabase becomes the application database and backend API layer.
* Mindbody remains the source of truth for schedules, availability, purchases, rosters, bookings, and cancellations.

The first implementation is a controlled pilot for one Mindbody partner. The architecture should support additional partners later without requiring a rewrite.

---

# 2. MVP Goals

The MVP must allow an eligible Revvi member to:

1. Log into Revvi through Memberstack.
2. Open a Mindbody-enabled partner page.
3. View eligible upcoming classes.
4. Select a class.
5. Confirm the Revvi offer and a short-lived, Mindbody-calculated quote.
6. Complete the supported Mindbody booking flow.
7. Receive a successful or failed booking response.
8. Have the booking stored locally in Supabase.
9. View their upcoming Revvi bookings.
10. Request cancellation of a supported booking and receive a confirmed, pending, unknown, or failed result.

The MVP must also allow Revvi administrators to configure partner and offer mappings through the Supabase dashboard.

---

# 3. Explicit Non-Goals

The following are not included in the first implementation:

* Appointment booking.
* Private sessions.
* Spa or massage workflows.
* Mindbody Affiliate API.
* Mindbody Partner Network integration.
* Mindbody Partner Store listing.
* Custom Revvi admin application.
* Partner self-service portal.
* Automated refunds, returns, voids, or financial compensation.
* No-show mutation.
* General late-cancellation penalty calculation or a guarantee of penalty-free cancellation.
* Automatic selection among multiple existing Mindbody passes.
* Cross-regional client/pass behavior.
* Package and membership management.
* Retail purchases.
* Gift card purchases.
* Promo code automation.
* Non-Mindbody booking providers.
* Advanced financial reconciliation.
* Revvi handling, storing, or transmitting raw payment card data.
* Broad multi-partner rollout during the pilot.

The MVP does include the minimum existing-pass discovery needed to select an explicit `ClientServiceId`, plus booking/cancellation reconciliation needed to avoid false success and unsafe retries.

---

# 4. Technical Stack

## 4.1 Frontend

```txt
Webflow
Memberstack browser SDK
Vanilla JavaScript or TypeScript compiled to browser JavaScript
```

The frontend will be embedded into existing Webflow pages using attributes and a bundled JavaScript file.

Webflow must not contain:

* Mindbody credentials.
* Supabase service-role credentials.
* Business-critical authorization logic.
* Raw provider responses.
* Payment-sensitive data.

---

## 4.2 Backend

```txt
Supabase Postgres
Supabase Edge Functions
TypeScript
Deno runtime
```

Supabase was selected because it provides:

* Managed PostgreSQL.
* Edge Functions.
* Environment secrets.
* SQL migrations.
* Database administration UI.
* Function logs.
* Row Level Security.
* A low-cost starting point for light pilot traffic.
* A migration path to a paid plan or another PostgreSQL host later.

---

## 4.3 External Systems

```txt
Memberstack
Mindbody Public API V6.0
Transactional email provider, optional
```

“Consumer Bookings” is the current Public API commercial category, not the separate Mindbody Consumer API. Affiliate API, Partner Network, and Consumer API behavior are outside this PRD.

The initial implementation may use Memberstack only for member identity and membership context.

A complete webhook-driven Memberstack synchronization process is optional for the first pilot unless server-side eligibility cannot be validated safely without it.

---

# 5. High-Level Architecture

Provider reads may be retried with bounded backoff. Provider writes pass through a serialized attempt/state-machine layer. Mindbody webhooks feed a durable queue, but reads remain the reconciliation authority because webhook delivery is duplicate-prone, unordered, time-limited, and incomplete for financial/pass changes.

```txt
┌─────────────────────────────┐
│         Webflow UI          │
│                             │
│ Partner page                │
│ Class schedule              │
│ Booking confirmation        │
│ Upcoming bookings           │
└──────────────┬──────────────┘
               │
               │ Memberstack member context
               │ HTTPS requests
               ▼
┌─────────────────────────────┐
│   Supabase Edge Functions   │
│                             │
│ Eligibility                 │
│ Availability                │
│ Booking                     │
│ Cancellation                │
│ Provider adapter            │
└──────────────┬──────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌──────────────┐  ┌────────────────┐
│  Supabase DB │  │ Mindbody API   │
│              │  │                │
│ Mappings     │  │ Schedules      │
│ Members      │  │ Pricing        │
│ Bookings     │  │ Bookings       │
│ Logs         │  │ Cancellations  │
└──────────────┘  └────────────────┘
```

---

# 6. Repository Structure

Recommended repository structure:

```txt
revvi-booking/
├── README.md
├── package.json
├── tsconfig.json
├── .env.example
├── docs/
│   ├── CODE_PRD.md
│   ├── MINDBODY_FINDINGS.md
│   ├── PILOT_SETUP.md
│   └── SUPPORT_PLAYBOOK.md
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql
│   │   ├── 0002_rls_policies.sql
│   │   └── 0003_seed_provider.sql
│   ├── seed.sql
│   └── functions/
│       ├── _shared/
│       │   ├── auth/
│       │   │   ├── memberstack.ts
│       │   │   └── request-context.ts
│       │   ├── database/
│       │   │   ├── client.ts
│       │   │   └── repositories.ts
│       │   ├── providers/
│       │   │   ├── booking-provider.ts
│       │   │   └── mindbody/
│       │   │       ├── client.ts
│       │   │       ├── mapper.ts
│       │   │       ├── types.ts
│       │   │       └── errors.ts
│       │   ├── http/
│       │   │   ├── cors.ts
│       │   │   ├── response.ts
│       │   │   └── errors.ts
│       │   ├── logging/
│       │   │   ├── api-log.ts
│       │   │   └── redaction.ts
│       │   └── validation/
│       │       └── schemas.ts
│       ├── booking-eligibility/
│       │   └── index.ts
│       ├── partner-availability/
│       │   └── index.ts
│       ├── booking-quote/
│       │   └── index.ts
│       ├── create-booking/
│       │   └── index.ts
│       ├── upcoming-bookings/
│       │   └── index.ts
│       ├── cancel-booking/
│       │   └── index.ts
│       └── memberstack-webhook/
│           └── index.ts
├── webflow/
│   ├── src/
│   │   ├── index.ts
│   │   ├── api.ts
│   │   ├── member.ts
│   │   ├── availability.ts
│   │   ├── booking.ts
│   │   ├── upcoming-bookings.ts
│   │   └── ui.ts
│   └── dist/
│       └── revvi-booking.js
└── tests/
    ├── unit/
    ├── integration/
    └── fixtures/
```

A single repository is recommended for the MVP so database migrations, Edge Functions, frontend integration code, and documentation stay synchronized.

---

# 7. Domain Model

## 7.1 Partner

A Revvi wellness partner.

A partner may have one or more locations and one or more booking-provider integrations.

## 7.2 Partner Integration

Configuration connecting a Revvi partner to an external booking provider.

For Mindbody, this includes the Mindbody Site ID and activation status.

## 7.3 Offer

A Revvi-specific benefit that is available to eligible membership tiers.

An offer may map to:

* A Mindbody pricing option.
* A location.
* A class category.
* A class type.
* A specific service or session type.

The exact mapping fields will depend on the confirmed Mindbody API model.

## 7.4 Provider Mapping

The connection between a Revvi offer and the provider identifiers required to display or book eligible inventory.

## 7.5 Booking

Revvi’s local representation of a booking created in Mindbody.

Mindbody remains the source of truth for the actual roster and operational booking status.

## 7.6 Member Eligibility

The server-side determination of whether a Memberstack member may use a particular Revvi offer.

---

# 8. Database Schema

All primary keys should use UUIDs.

All tables should include:

```sql
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

An `updated_at` trigger should update the value on row modification.

---

## 8.1 Enums

```sql
create type integration_provider as enum (
  'mindbody'
);

create type integration_status as enum (
  'draft',
  'pending_activation',
  'active',
  'revoked',
  'disabled',
  'error'
);

create type offer_status as enum (
  'draft',
  'active',
  'inactive'
);

create type booking_status as enum (
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

create type payment_status as enum (
  'not_required',
  'pending',
  'requires_action',
  'authorized',
  'paid',
  'failed',
  'unknown'
);

create type provider_attempt_type as enum (
  'client_create',
  'quote',
  'purchase_booking',
  'existing_pass_booking',
  'free_unpaid_booking',
  'waitlist_join',
  'cancellation',
  'waitlist_removal',
  'reconciliation'
);

create type provider_attempt_status as enum (
  'pending',
  'requires_action',
  'confirmed',
  'failed',
  'unknown',
  'reconciled'
);

create type api_log_direction as enum (
  'outbound',
  'inbound'
);
```

---

## 8.2 Members

```sql
create table public.members (
  id uuid primary key default gen_random_uuid(),

  memberstack_member_id text not null unique,
  email text,
  first_name text,
  last_name text,

  membership_status text,
  membership_plan_id text,
  membership_plan_name text,

  eligible_tiers text[] not null default '{}',
  eligibility_override boolean,

  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Notes:

* `eligibility_override` supports pilot testing.
* The long-term eligibility model may need a separate membership table.
* For the MVP, a simplified member snapshot is acceptable.

---

## 8.3 Partners

```sql
create table public.partners (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  slug text not null unique,
  status text not null default 'active',

  webflow_item_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 8.4 Partner Integrations

```sql
create table public.partner_integrations (
  id uuid primary key default gen_random_uuid(),

  partner_id uuid not null
    references public.partners(id)
    on delete cascade,

  provider integration_provider not null,

  provider_site_id text not null,
  status integration_status not null default 'draft',

  activation_reference text,
  activated_at timestamptz,
  revoked_at timestamptz,
  last_permission_check_at timestamptz,
  last_permission_error_code text,

  chargeable_location_count integer,
  billing_verified_at timestamptz,
  commercial_approval_reference text,
  approved_product_name text,
  use_case_approved_at timestamptz,
  retention_approval_reference text,

  configuration jsonb not null default '{}'::jsonb,

  last_verified_at timestamptz,
  last_successful_request_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (partner_id, provider)
);
```

Do not store API secrets or raw activation codes/links in `configuration` or `activation_reference`. The reference is a ticket/approval identifier only.

Secrets must be stored as Supabase project secrets.

Before activation, list every location represented by the Site ID, record `chargeable_location_count`, and obtain Revvi commercial approval. Track per-billing-cycle API calls, booking attempts/confirmations, retries, cancellations, duplicate submissions, and activated locations. Alert on budget thresholds without assuming that only calls above 5,000 are billable.

---

## 8.5 Partner Locations

```sql
create table public.partner_locations (
  id uuid primary key default gen_random_uuid(),

  partner_id uuid not null
    references public.partners(id)
    on delete cascade,

  partner_integration_id uuid
    references public.partner_integrations(id)
    on delete cascade,

  provider_location_id text,
  name text not null,

  address_line_1 text,
  address_line_2 text,
  city text,
  region text,
  postal_code text,
  country text,
  timezone text not null,

  status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 8.6 Partner Offers

```sql
create table public.partner_offers (
  id uuid primary key default gen_random_uuid(),

  partner_id uuid not null
    references public.partners(id)
    on delete cascade,

  title text not null,
  slug text not null,

  description text,

  eligible_tiers text[] not null default '{}',
  status offer_status not null default 'draft',

  booking_provider integration_provider,

  cancellation_policy text,
  preparation_instructions text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (partner_id, slug)
);
```

`cancellation_policy` is versioned Revvi/studio-authored display text. It is not a claim that `Program.CancelOffset` is a complete or guaranteed provider cancellation rule. Store the policy approval/version in `configuration` or a dedicated policy table if it changes during the pilot.

---

## 8.7 Offer Provider Mappings

```sql
create table public.offer_provider_mappings (
  id uuid primary key default gen_random_uuid(),

  offer_id uuid not null
    references public.partner_offers(id)
    on delete cascade,

  partner_integration_id uuid not null
    references public.partner_integrations(id)
    on delete cascade,

  provider_site_id text not null,
  provider_service_product_id text not null,
  provider_service_barcode_id text,

  configuration jsonb not null default '{}'::jsonb,

  status text not null default 'draft',
  effective_from timestamptz,
  effective_to timestamptz,
  last_validated_at timestamptz,
  validation_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

`provider_service_product_id` is Mindbody `Service.ProductId`. Do not use the barcode-like `Service.Id` or a service name as the canonical mapping key. A time-specific `Class.Id` must never be stored as a durable offer mapping.

Use child allowlist rows for inventory boundaries:

```sql
create table public.offer_provider_allowlist (
  id uuid primary key default gen_random_uuid(),
  offer_provider_mapping_id uuid not null
    references public.offer_provider_mappings(id)
    on delete cascade,

  entity_type text not null check (
    entity_type in ('location', 'program', 'class_description', 'session_type')
  ),
  provider_entity_id text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (offer_provider_mapping_id, entity_type, provider_entity_id)
);
```

The `configuration` field may contain safe filtering rules, for example:

```json
{
  "excluded_staff_ids": [],
  "days_in_advance": 14
}
```

---

## 8.8 Bookings

```sql
create table public.bookings (
  id uuid primary key default gen_random_uuid(),

  member_id uuid not null
    references public.members(id),

  partner_id uuid not null
    references public.partners(id),

  offer_id uuid not null
    references public.partner_offers(id),

  partner_location_id uuid
    references public.partner_locations(id),

  provider integration_provider not null,

  provider_site_id text not null,
  provider_location_id text,

  provider_class_id text,
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

  status booking_status not null default 'pending',
  payment_status payment_status not null default 'unknown',
  cancellation_status provider_attempt_status,
  restoration_status provider_attempt_status,
  refund_status provider_attempt_status,

  class_name text,
  staff_name text,

  start_datetime timestamptz not null,
  end_datetime timestamptz,

  price_amount numeric(12, 2),
  currency text default 'USD',

  cancellation_reason text,
  cancelled_at timestamptz,

  error_code text,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Do not store raw provider snapshots on bookings. Persist only the minimum typed identifiers and Revvi-owned display/support facts needed for the pilot. Permission to retain provider identifiers and transaction facts beyond 48 hours is a production gate.

Provider writes and uncertain outcomes require separate attempts:

```sql
create table public.provider_attempts (
  id uuid primary key default gen_random_uuid(),

  booking_id uuid
    references public.bookings(id),

  provider integration_provider not null,
  attempt_type provider_attempt_type not null,
  status provider_attempt_status not null default 'pending',

  idempotency_key text not null,
  request_fingerprint text not null,
  provider_request_id text,
  provider_error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  reconciled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (provider, idempotency_key)
);
```

Short-lived provider-calculated quotes require a typed record:

```sql
create table public.booking_quotes (
  id uuid primary key default gen_random_uuid(),

  member_id uuid not null references public.members(id),
  offer_id uuid not null references public.partner_offers(id),
  partner_integration_id uuid not null
    references public.partner_integrations(id),

  provider_site_id text not null,
  provider_class_id text not null,
  provider_client_id text not null,
  provider_client_unique_id text,
  provider_service_product_id text,
  provider_client_service_id text,

  booking_mode text not null check (
    booking_mode in ('existing_pass', 'free_unpaid', 'mindbody_redirect')
  ),

  subtotal numeric(12, 2) not null,
  discount_total numeric(12, 2) not null,
  tax_total numeric(12, 2) not null,
  grand_total numeric(12, 2) not null,
  currency text not null,
  provider_calculation text not null,

  quote_fingerprint text not null,
  status text not null default 'active',
  expires_at timestamptz not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Quotes expire after a short configured interval and are never proof of reserved capacity. Recalculate immediately before a live paid write and require user reconfirmation if the material total changes.

---

## 8.9 Provider API Logs

```sql
create table public.provider_api_logs (
  id uuid primary key default gen_random_uuid(),

  provider integration_provider not null,
  direction api_log_direction not null default 'outbound',

  partner_id uuid
    references public.partners(id),

  booking_id uuid
    references public.bookings(id),

  function_name text not null,
  endpoint_name text not null,

  request_id text,
  provider_request_id text,

  status_code integer,
  duration_ms integer,

  success boolean not null default false,

  error_code text,
  error_message text,

  request_fact_summary jsonb,
  response_fact_summary jsonb,

  expires_at timestamptz not null default (now() + interval '48 hours'),

  created_at timestamptz not null default now()
);
```

Full requests and responses must not be stored. Summaries must be allowlisted, redacted, and automatically deleted at `expires_at`. Long-lived metrics should be aggregate counts without provider/client payloads.

---

## 8.10 Webhook Events

```sql
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),

  provider text not null,
  external_event_id text,
  event_type text not null,

  processing_status text not null default 'pending',

  payload_fingerprint text,
  diagnostic_payload_encrypted bytea,
  error_message text,

  processed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now(),

  unique (provider, external_event_id)
);
```

The receiver may retain an encrypted diagnostic payload only long enough to verify/process the event and no longer than 48 hours. Store durable typed effects separately. Webhook signature verification must use the exact raw request body before parsing.

---

# 9. Database Security

## 9.1 General Rule

The browser should not have broad direct access to application tables.

All booking operations should go through Edge Functions.

The Supabase service-role key must only be used inside server-side Edge Functions.

---

## 9.2 Row Level Security

Enable RLS on all public tables.

For the initial Memberstack-based architecture:

* Deny anonymous direct table access by default.
* Deny browser writes to booking tables.
* Edge Functions use the service role after performing member validation.
* Admin operations are initially performed through the Supabase dashboard.

Example default policy posture:

```sql
alter table public.members enable row level security;
alter table public.partners enable row level security;
alter table public.partner_integrations enable row level security;
alter table public.partner_locations enable row level security;
alter table public.partner_offers enable row level security;
alter table public.offer_provider_mappings enable row level security;
alter table public.offer_provider_allowlist enable row level security;
alter table public.bookings enable row level security;
alter table public.provider_attempts enable row level security;
alter table public.booking_quotes enable row level security;
alter table public.member_provider_profiles enable row level security;
alter table public.provider_api_logs enable row level security;
alter table public.webhook_events enable row level security;
```

No broad anonymous policies should be added during the MVP.

---

# 10. Environment Variables and Secrets

Example `.env.example`:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

ALLOWED_ORIGINS=https://www.revvi.co,https://revvi.webflow.io

MEMBERSTACK_SECRET_KEY=
MEMBERSTACK_WEBHOOK_SECRET=

MINDBODY_API_KEY=
MINDBODY_SOURCE_NAME=
MINDBODY_BASE_URL=
MINDBODY_API_VERSION=v6
MINDBODY_ENVIRONMENT=sandbox
MINDBODY_AUTH_MODE=api_key

# Only add these if Mindbody confirms the approved token flow.
MINDBODY_OAUTH_CLIENT_ID=
MINDBODY_OAUTH_CLIENT_SECRET=

EMAIL_PROVIDER_API_KEY=
EMAIL_FROM_ADDRESS=
```

`MINDBODY_SOURCE_NAME` is non-secret integration metadata. Do not introduce `MINDBODY_SOURCE_PASSWORD`, staff credentials, or OAuth secrets unless Mindbody confirms they are required. Per-site/user access and refresh tokens belong in an encrypted token store with expiry/revocation metadata, not a static shared environment value. Production secrets must be separate from sandbox secrets. Tokens and credentials must be redacted from all logs.

---

# 11. Provider Abstraction

Even though the MVP only supports Mindbody, core application code should not depend directly on Mindbody response objects.

Define a provider interface:

```ts
export interface BookingProvider {
  getAvailability(
    input: AvailabilityInput,
  ): Promise<AvailabilityResult>;

  getBookingQuote(
    input: BookingQuoteInput,
  ): Promise<BookingQuoteResult>;

  createBooking(
    input: CreateProviderBookingInput,
  ): Promise<CreateProviderBookingResult>;

  getBooking(
    input: GetProviderBookingInput,
  ): Promise<ProviderBooking>;

  cancelBooking(
    input: CancelProviderBookingInput,
  ): Promise<CancelProviderBookingResult>;

  reconcileBooking(
    input: ReconcileProviderBookingInput,
  ): Promise<ReconcileProviderBookingResult>;
}
```

Normalized availability type:

```ts
export interface AvailableSession {
  provider: "mindbody";

  siteId: string;
  locationId: string;

  classId: string;
  classScheduleId?: string;
  classDescriptionId?: string;
  programId?: string;
  sessionTypeId?: string;

  name: string;
  description?: string;

  staffId?: string;
  staffName?: string;

  startAt: string;
  endAt?: string;
  timezone: string;

  maxCapacity: number | null;
  webCapacity: number | null;
  totalBooked: number | null;
  webBooked: number | null;
  estimatedAvailableSlots: number | null;

  availabilityState:
    | "available"
    | "full"
    | "waitlist_available"
    | "outside_booking_window"
    | "cancelled"
    | "client_ineligible"
    | "unknown";
  availabilityReasons: string[];

  provisionalPrice?: {
    amount: number;
    currency: string;
    serviceProductId?: string;
  };

  metadata?: Record<string, unknown>;
}
```

`classId` is Mindbody `Class.Id`, the time-specific occurrence. It is the public `sessionId` if the frontend keeps that alias. `estimatedAvailableSlots` must remain `null` when the provider does not expose enough information. The server must never derive bookability solely from `MaxCapacity - TotalBooked`.

Normalized quote and write results:

```ts
export interface BookingQuoteResult {
  quoteId: string;
  expiresAt: string;
  classId: string;
  clientId: string;
  clientUniqueId?: string;
  serviceProductId?: string;
  clientServiceId?: string;
  bookingMode:
    | "existing_pass"
    | "free_unpaid"
    | "mindbody_redirect";
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  currency: string;
  providerCalculation: "mindbody_test_cart" | "not_required";
  quoteFingerprint: string;
}

export interface ProviderWriteResult {
  status: "confirmed" | "waitlisted" | "requires_action" | "failed" | "unknown";
  certainty: "provider_confirmed" | "provider_rejected" | "unknown";
  visitId?: string;
  rosterBookingId?: string;
  waitlistEntryId?: string;
  clientServiceId?: string;
  saleId?: string;
  cartId?: string;
  transactionId?: string;
  paymentId?: string;
  requiredAction?: {
    type: "redirect";
    url: string;
    expiresAt?: string;
  };
}
```

Normalized provider error:

```ts
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly providerDetails?: unknown,
  ) {
    super(message);
  }
}
```

---

# 12. Authentication and Member Identity

## 12.1 MVP Approach

The Webflow frontend retrieves the current Memberstack member.

The frontend sends a Memberstack member token or verifiable identity proof to the Edge Function.

The Edge Function must not trust:

* A raw member ID sent without verification.
* A frontend-provided membership tier.
* A frontend-provided eligibility boolean.

The exact verification approach depends on Memberstack’s available server-side token validation mechanism.

If direct token validation is not practical, use this fallback:

1. Sync Memberstack members into Supabase through signed webhooks.
2. Require a signed short-lived booking token generated from a trusted server-side process.
3. For controlled pilot users, use a temporary allowlist only during testing.

A production booking should never be authorized only because the browser says the user is eligible.

---

## 12.2 Request Context

Every member-facing Edge Function should create a request context:

```ts
export interface RequestContext {
  requestId: string;
  origin: string | null;

  member: {
    id: string;
    memberstackMemberId: string;
    email?: string;
    eligibleTiers: string[];
  };

  receivedAt: Date;
}
```

---

# 13. Edge Function API Contracts

All successful responses should use:

```json
{
  "ok": true,
  "data": {},
  "requestId": "uuid"
}
```

All failed responses should use:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Friendly message",
    "retryable": false
  },
  "requestId": "uuid"
}
```

Internal stack traces and raw provider errors must not be returned to the browser.

---

## 13.1 Booking Eligibility

### Endpoint

```txt
POST /functions/v1/booking-eligibility
```

### Request

```json
{
  "partnerSlug": "pilot-partner",
  "offerId": "uuid"
}
```

Member identity is supplied through the authorization mechanism, not through the JSON body.

### Response

```json
{
  "ok": true,
  "data": {
    "eligible": true,
    "reason": null,
    "member": {
      "firstName": "Gabriella"
    },
    "offer": {
      "id": "uuid",
      "title": "Revvi Member Single Class"
    }
  },
  "requestId": "uuid"
}
```

### Eligibility Rules

A member is eligible when:

* The member exists.
* The membership status is active.
* The offer is active.
* The partner integration is active.
* The member tier intersects with the offer’s eligible tiers.
* No explicit eligibility override blocks the member.

---

## 13.2 Partner Availability

### Endpoint

```txt
POST /functions/v1/partner-availability
```

POST is preferred over GET because the request may contain filters and verified member context.

### Request

```json
{
  "partnerSlug": "pilot-partner",
  "offerId": "uuid",
  "startDate": "2026-08-01",
  "endDate": "2026-08-14",
  "locationId": "optional-uuid"
}
```

### Response

```json
{
  "ok": true,
  "data": {
    "partner": {
      "id": "uuid",
      "name": "Partner Name",
      "slug": "pilot-partner"
    },
    "offer": {
      "id": "uuid",
      "title": "Revvi Member Single Class"
    },
    "sessions": [
      {
        "sessionId": "mindbody-class-id",
        "classId": "mindbody-class-id",
        "classScheduleId": "mindbody-class-schedule-id",
        "name": "Pilates Reformer",
        "staffName": "Instructor Name",
        "startAt": "2026-08-03T14:00:00Z",
        "endAt": "2026-08-03T15:00:00Z",
        "timezone": "Africa/Johannesburg",
        "estimatedAvailableSlots": null,
        "availabilityState": "available",
        "availabilityReasons": [],
        "provisionalPrice": {
          "amount": 32,
          "currency": "ZAR",
          "serviceProductId": "mindbody-product-id"
        }
      }
    ]
  },
  "requestId": "uuid"
}
```

### Rules

* Date range must have a maximum allowed duration.
* Default range should be 14 days.
* Inventory must be filtered using the active offer mapping.
* Ineligible members must not receive bookable inventory.
* Raw Mindbody data must not be returned.
* Treat `sessionId` as an alias of the required Mindbody `Class.Id`; never use `ClassScheduleId` as an occurrence ID.
* Do not promise or display numeric remaining spots when capacity fields are null, hidden, or contradictory.
* Availability is provisional and must be re-read with resolved client context before quote/booking.

---

## 13.3 Booking Quote

### Endpoint

```txt
POST /functions/v1/booking-quote
```

### Purpose

Perform a final pre-booking validation before displaying the confirmation screen.

### Request

```json
{
  "offerId": "uuid",
  "sessionId": "provider-session-id"
}
```

### Response

```json
{
  "ok": true,
  "data": {
    "quoteId": "signed-or-stored-reference",
    "expiresAt": "2026-08-03T12:10:00Z",
    "quoteFingerprint": "sha256-of-normalized-quote-inputs",
    "bookingMode": "existing_pass",
    "session": {
      "classId": "mindbody-class-id",
      "name": "Pilates Reformer",
      "startAt": "2026-08-03T14:00:00Z",
      "locationName": "Downtown Studio"
    },
    "price": {
      "subtotal": 32,
      "discountTotal": 0,
      "taxTotal": 0,
      "grandTotal": 32,
      "currency": "ZAR",
      "serviceProductId": "mindbody-product-id",
      "clientServiceId": "existing-pass-id",
      "providerCalculation": "mindbody_test_cart"
    },
    "cancellationPolicy": {
      "displayText": "Cancellation policy is supplied by the pilot studio.",
      "certainty": "studio_reported"
    }
  },
  "requestId": "uuid"
}
```

The quote must be client-aware, expire after a short period, and be recalculated immediately before any purchase. For a paid path, use `CheckoutShoppingCart(Test=true)` as the provider-calculated quote candidate. A successful Test cart is not a capacity reservation and does not guarantee that a later live total is unchanged.

---

## 13.4 Create Booking

### Endpoint

```txt
POST /functions/v1/create-booking
```

### Request

```json
{
  "quoteId": "signed-or-stored-reference",
  "idempotencyKey": "client-generated-uuid"
}
```

The quote fixes the approved `bookingMode`; the browser cannot choose or override it. Raw PAN, CVV, expiry, billing-card data, or an unverified generic payment token must never be accepted by this endpoint. A Mindbody redirect completion reference may be accepted only through a separate, documented completion endpoint after that flow is approved and tested.

### Processing Flow

1. Authenticate the member.
2. Validate the request.
3. Check the idempotency key.
4. Resolve the quote.
5. Ensure the quote belongs to the member.
6. Ensure the quote has not expired.
7. Revalidate eligibility.
8. Revalidate the active partner mapping.
9. Resolve the exact Mindbody client and explicit ClientService/Product selected by the quote.
10. Re-read the selected Class with client context and re-run the Test cart where payment applies.
11. Reject a material quote change and require user reconfirmation.
12. Create the local booking and a pending provider attempt in one database transaction.
13. Acquire a member/class write lock and call Mindbody once using the quote’s approved mode.
14. Store distinct provider references and mark the attempt `confirmed`, `requires_action`, `failed`, or `unknown`.
15. On timeout or ambiguous response, do not replay; enqueue reconciliation and return `unknown`/pending support status.
16. Log only allowlisted typed facts and return a normalized result.

### Response

```json
{
  "ok": true,
  "data": {
    "booking": {
      "id": "local-booking-uuid",
      "status": "confirmed",
      "providerReferences": {
        "classId": "mindbody-class-id",
        "visitId": "mindbody-visit-id"
      },
      "className": "Pilates Reformer",
      "startAt": "2026-08-03T14:00:00Z",
      "locationName": "Downtown Studio",
      "price": {
        "amount": 32,
        "currency": "ZAR"
      }
    }
  },
  "requestId": "uuid"
}
```

### Idempotency

The same `idempotencyKey` must identify one Revvi provider attempt. Revvi must serialize its own writes and return the existing local attempt when the key is repeated. It cannot guarantee that Mindbody applied an ambiguous write exactly once.

If the request is repeated:

* Return the existing confirmed booking.
* Return the existing pending result if still processing.
* Return the failed result only when Mindbody explicitly rejected the write before commit and retry is safe.
* Return `unknown` while reconciliation is required.

Do not automatically retry uncertain provider booking failures.

---

## 13.5 Upcoming Bookings

### Endpoint

```txt
POST /functions/v1/upcoming-bookings
```

### Request

```json
{
  "limit": 20
}
```

### Response

```json
{
  "ok": true,
  "data": {
    "bookings": [
      {
        "id": "uuid",
        "status": "confirmed",
        "partnerName": "Partner Name",
        "className": "Pilates Reformer",
        "startAt": "2026-08-03T14:00:00Z",
        "locationName": "Downtown Studio",
        "cancellationState": "requestable"
      }
    ]
  },
  "requestId": "uuid"
}
```

Only bookings belonging to the authenticated member may be returned.

---

## 13.6 Cancel Booking

### Endpoint

```txt
POST /functions/v1/cancel-booking
```

### Request

```json
{
  "bookingId": "local-booking-uuid",
  "reason": "Member requested cancellation"
}
```

### Processing Flow

1. Authenticate the member.
2. Fetch the local booking.
3. Confirm booking ownership.
4. Confirm this pilot booking mode supports a cancellation request.
5. Reconcile the current Class, Client Visit/Schedule, and waitlist state.
6. Determine whether this is roster cancellation or waitlist removal.
7. Display the studio-reported rule; do not promise penalty-free eligibility from `Program.CancelOffset` alone.
8. Create a cancellation attempt and mark the booking `cancel_pending`.
9. Submit exactly once using Class + Client/Unique Client + optional Visit, or WaitlistEntry ID for a waitlist.
10. Verify the result through provider reads/webhook evidence.
11. Mark the booking `cancelled`, `failed`, or `unknown`; never restore the previous local status after an ambiguous outcome.
12. Re-read the exact ClientService and record restoration separately without promising it.
13. Return normalized status. Refund status remains separate and manual.

### Response

```json
{
  "ok": true,
  "data": {
    "bookingId": "uuid",
    "status": "cancelled",
    "cancelledAt": "2026-08-01T10:00:00Z",
    "passRestoration": "unknown",
    "refund": "not_requested"
  },
  "requestId": "uuid"
}
```

Cancellation never implies a refund or pass restoration. Automated Return Sale, original-tender refunds, voids, and compensation are disabled in this MVP.

---

## 13.7 Memberstack Webhook

### Endpoint

```txt
POST /functions/v1/memberstack-webhook
```

### Requirements

* Verify the webhook signature.
* Store the external event ID.
* Ignore duplicate events.
* Update the local member snapshot.
* Store a redacted event payload.
* Return success quickly.
* Log processing failures.

Supported events should initially include:

* Member created.
* Member updated.
* Plan added.
* Plan removed.
* Membership cancelled.
* Membership expired.

Exact event names must be mapped to Memberstack’s actual webhook event names.

---

## 13.8 Mindbody Webhook

### Endpoint

```txt
POST /functions/v1/webhooks/mindbody
```

Requirements:

1. Read and preserve the exact raw request body.
2. Verify the Mindbody signature before parsing or acknowledging the event.
3. Compute a payload fingerprint and deduplicate by stable event ID where supplied, otherwise by a documented composite fingerprint.
4. Return `2xx` only after the event is durably queued.
5. Process asynchronously and tolerate duplicates and out-of-order delivery.
6. Apply typed changes to bookings/attempts; do not retain a durable raw payload.
7. Expire encrypted diagnostics within 48 hours.
8. Reconcile relevant events through Public API reads before treating them as final financial or pass-restoration authority.
9. Monitor subscription health and run a full 24-hour reconciliation sweep because delivery stops after Mindbody’s retry window and has no guaranteed backfill.

Initial events are class-roster-booking created/status/cancelled, waitlist created/cancelled, class/class-schedule changes, and client-sale created. No general payment, return, transaction, or ClientService-change webhook is assumed.

---

# 14. Mindbody Client Requirements

Create a dedicated API client.

```ts
export interface MindbodyClientConfig {
  baseUrl: string;
  apiVersion: "v6";
  environment: "sandbox" | "production";
  apiKey: string;
  sourceName?: string;
  authorizationProvider?: {
    getToken(input: {
      siteId: string;
      operation: string;
    }): Promise<{ token: string; expiresAt?: string } | null>;
  };
}
```

Example client responsibilities:

```ts
export class MindbodyClient {
  getSites(input: SiteRequest): Promise<unknown>;
  getLocations(input: SiteScopedRequest): Promise<unknown>;
  getPrograms(input: ProgramsRequest): Promise<unknown>;
  getClassDescriptions(input: ClassDescriptionsRequest): Promise<unknown>;
  getClassSchedules(input: ClassSchedulesRequest): Promise<unknown>;
  getClasses(input: ClassesRequest): Promise<unknown>;
  getStaff(input: StaffRequest): Promise<unknown>;
  getServices(input: ServicesRequest): Promise<unknown>;

  getClients(input: ClientsRequest): Promise<unknown>;
  getClientDuplicates(input: ClientDuplicatesRequest): Promise<unknown>;
  getRequiredClientFields(input: SiteScopedRequest): Promise<unknown>;
  addClient(input: AddClientRequest): Promise<unknown>;
  getClientServices(input: ClientServicesRequest): Promise<unknown>;

  checkoutShoppingCart(input: CheckoutRequest): Promise<unknown>;
  addClientToClass(input: AddClientToClassRequest): Promise<unknown>;
  removeClientFromClass(input: RemoveClientFromClassRequest): Promise<unknown>;
  getWaitlistEntries(input: WaitlistRequest): Promise<unknown>;
  removeFromWaitlist(input: RemoveWaitlistRequest): Promise<unknown>;

  getClientSchedule(input: ClientScheduleRequest): Promise<unknown>;
  getClientVisits(input: ClientVisitsRequest): Promise<unknown>;
  getClassVisits(input: ClassVisitsRequest): Promise<unknown>;
  getSales(input: SalesRequest): Promise<unknown>;
  getTransactions(input: TransactionsRequest): Promise<unknown>;
}
```

The raw client returns provider responses.

A separate mapper must normalize them into internal domain types.

Every method receives `siteId` explicitly where the endpoint is site-scoped. The client adds the API key and an operation-appropriate optional authorization token. Do not spread Mindbody response types throughout the application. Automated `ReturnSale` and raw-card checkout methods are deliberately absent from the MVP client.

---

# 15. Mindbody Client Matching

The booking flow may require a Mindbody client record.

Client resolution is required before a client-aware quote or booking:

1. Search with the least-privilege staff authorization required by Mindbody.
2. Treat email as searchable but not unique.
3. Run exact duplicate detection using normalized first name, last name, and email.
4. Fail closed on multiple plausible matches; never merge automatically.
5. If no match exists, retrieve the Site's required client fields, validate consented values, use `AddClient(Test=true)` where supported, then create once behind a sandbox/production feature flag.
6. Store both Site-scoped `Client.Id`/RSSID and `Client.UniqueId`.

Persistent client mapping is required once a profile is resolved:

```sql
create table public.member_provider_profiles (
  id uuid primary key default gen_random_uuid(),

  member_id uuid not null
    references public.members(id),

  partner_integration_id uuid not null
    references public.partner_integrations(id),

  provider integration_provider not null,
  provider_site_id text not null,
  provider_client_id text not null,
  provider_client_unique_id text,

  resolution_status text not null default 'resolved',
  verification_status text not null default 'unverified',
  verified_at timestamptz,
  ambiguity_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (member_id, partner_integration_id)
);
```

No Mindbody password is required by the documented `AddClient` contract. Waiver/liability behavior remains a pilot-specific legal and sandbox gate.

---

# 16. Payment Architecture

## 16.1 Hard Boundary

The MVP assumes:

* Revvi does not receive, transmit, log, or store raw PAN, CVV, expiry, or billing-card data.
* Mindbody or the partner’s Mindbody-connected merchant account processes payment.
* Any approved paid flow is hosted/redirected by Mindbody or uses an opaque mechanism explicitly documented and approved for Revvi.
* Sensitive payment fields are never written to Supabase logs or tables.

Standard `CheckoutShoppingCart` accepts raw card fields. It must not be wired to a Webflow → Supabase → Mindbody flow. Phase 0 did not establish a supported generic browser payment token.

## 16.2 Development Gate

Before implementing production payment:

* Obtain written confirmation of the pilot’s no-raw-card payment method, processor/region eligibility, authentication, SCA/redirect lifetime, and safe recovery flow.
* Complete security/PCI review.
* Prove Test-cart totals, live recalculation, redirect completion, purchase-plus-Class IDs, declines, and ambiguous timeout behavior in controlled fixtures.
* Persist only provider-created payment/sale/transaction references and masked facts permitted by Mindbody’s retention response.

## 16.3 Scope Change

If Revvi must directly collect or transmit raw card data, paid booking is removed from this MVP and must be separately designed, reviewed, estimated, and approved.

The 120-hour scope does not include building a custom PCI-compliant payment form.

## 16.4 Allowed Pilot Booking Modes

Enable exactly one mode per pilot integration:

```txt
existing_pass      Explicit tested ClientServiceId; no automatic pass selection
free_unpaid        Only with written studio approval and tested provider settings
mindbody_redirect  Only after written Mindbody approval and sandbox proof
```

All other modes fail closed. Paid production remains disabled until every gate above is satisfied.

---

# 17. Frontend Integration

## 17.1 Webflow Attributes

Recommended markup contract:

```html
<div
  data-revvi-booking
  data-partner-slug="pilot-partner"
  data-offer-id="OFFER_UUID"
>
  <div data-booking-loading hidden></div>
  <div data-booking-error hidden></div>
  <div data-booking-empty hidden></div>
  <div data-booking-sessions></div>
  <div data-booking-confirmation hidden></div>
</div>
```

Session template:

```html
<div data-booking-session-template hidden>
  <div data-session-name></div>
  <div data-session-time></div>
  <div data-session-staff></div>
  <div data-session-location></div>
  <div data-session-price></div>
  <button type="button" data-session-book>
    Book
  </button>
</div>
```

Upcoming booking component:

```html
<div data-revvi-upcoming-bookings>
  <div data-upcoming-loading hidden></div>
  <div data-upcoming-error hidden></div>
  <div data-upcoming-empty hidden></div>
  <div data-upcoming-list></div>
</div>
```

---

## 17.2 Frontend State

```ts
type BookingWidgetState =
  | { status: "idle" }
  | { status: "loading-eligibility" }
  | { status: "ineligible"; message: string }
  | { status: "loading-availability" }
  | { status: "showing-availability"; sessions: AvailableSession[] }
  | { status: "loading-quote"; sessionId: string }
  | { status: "confirming"; quote: BookingQuote }
  | { status: "submitting"; quote: BookingQuote }
  | { status: "requires-payment-action"; redirectUrl: string }
  | { status: "pending-reconciliation"; bookingId: string; message: string }
  | { status: "success"; booking: BookingConfirmation }
  | { status: "error"; message: string; retryable: boolean };
```

---

## 17.3 Frontend Rules

* Disable the booking button while a booking request is active.
* Generate a new idempotency key for each intentional booking attempt.
* Reuse the same key only to retrieve the existing local attempt after a network failure; do not use it to replay an unknown provider write.
* Never display raw API errors.
* Never expose provider secrets or internal database IDs unnecessarily.
* Format times in the partner location’s timezone.
* Display availability as stale after a booking attempt and refresh it.
* Do not assume a displayed slot remains available.
* Display numeric remaining spots only when the normalized value is non-null and internally consistent.
* Do not say “cancelled,” “pass restored,” or “refunded” until each state is independently confirmed.

---

# 18. CORS and Request Security

Allowed origins should be configured through secrets.

Example:

```ts
const allowedOrigins = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
```

Requirements:

* Reject unsupported origins.
* Handle `OPTIONS` requests.
* Allow only required headers.
* Do not use `Access-Control-Allow-Origin: *` for authenticated endpoints.
* Add request IDs.
* Add sensible request body size limits.
* Validate all JSON using a schema library such as Zod.

---

# 19. Validation

Suggested schemas:

```ts
const availabilityRequestSchema = z.object({
  partnerSlug: z.string().min(1),
  offerId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  locationId: z.string().uuid().optional(),
});

const createBookingRequestSchema = z.object({
  quoteId: z.string().min(1),
  idempotencyKey: z.string().uuid(),
}).strict();

const cancelBookingRequestSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
```

---

# 20. Error Codes

Use stable internal error codes:

```txt
AUTH_REQUIRED
MEMBER_NOT_FOUND
MEMBERSHIP_INACTIVE
OFFER_NOT_FOUND
OFFER_INACTIVE
MEMBER_NOT_ELIGIBLE
PARTNER_NOT_FOUND
INTEGRATION_NOT_CONFIGURED
INTEGRATION_INACTIVE
OFFER_MAPPING_NOT_FOUND
SESSION_NOT_FOUND
SESSION_NOT_BOOKABLE
SESSION_FULL
AVAILABILITY_UNKNOWN
CLIENT_MATCH_AMBIGUOUS
CLIENT_FIELDS_REQUIRED
CLIENT_CREATION_FAILED
PASS_NOT_FOUND
PASS_SELECTION_AMBIGUOUS
QUOTE_EXPIRED
QUOTE_INVALID
QUOTE_CHANGED
BOOKING_DUPLICATE
BOOKING_PROVIDER_FAILED
BOOKING_STATUS_UNKNOWN
BOOKING_NOT_FOUND
BOOKING_NOT_OWNED
BOOKING_NOT_CANCELLABLE
CANCELLATION_PROVIDER_FAILED
CANCELLATION_STATUS_UNKNOWN
PASS_RESTORATION_UNKNOWN
PAYMENT_REQUIRED
PAYMENT_FAILED
PAYMENT_ACTION_REQUIRED
PAYMENT_ARCHITECTURE_DISABLED
PROVIDER_RATE_LIMITED
PROVIDER_UNAVAILABLE
VALIDATION_ERROR
INTERNAL_ERROR
```

Friendly user messages should be mapped separately.

Example:

```ts
const publicMessages: Record<string, string> = {
  SESSION_FULL:
    "This class is no longer available. Please choose another time.",
  MEMBER_NOT_ELIGIBLE:
    "Your current membership does not include this offer.",
  PROVIDER_UNAVAILABLE:
    "Booking is temporarily unavailable. Please try again shortly.",
};
```

---

# 21. Logging and Redaction

Every provider request should log:

* Request ID.
* Function name.
* Provider.
* Endpoint name.
* Partner ID.
* Booking ID where applicable.
* Duration.
* Status code.
* Success state.
* Normalized error code.
* Redacted request summary.
* Redacted response summary.

Fields to redact recursively:

```txt
authorization
apiKey
password
sourcePassword
token
accessToken
refreshToken
activationCode
activationLink
cardNumber
accountNumber
cvv
cvc
expiry
paymentToken
```

Prefer an allowlist of safe fields over relying only on recursive redaction. Provider API summaries, encrypted webhook diagnostics, and temporary reconciliation evidence must have an `expires_at` no later than 48 hours. A deletion job and deletion-failure alert are required before production.

Logs must help answer:

* Did Revvi submit the booking?
* Did Mindbody accept it?
* Which local booking corresponds to it?
* Was a duplicate request attempted?
* Was cancellation accepted?
* Was the response uncertain?

---

# 22. Idempotency and Uncertain State

Booking creation can produce an uncertain outcome when:

* The request times out.
* Mindbody responds after the Edge Function stops waiting.
* Revvi receives a network error after Mindbody created the booking.

Rules:

1. Store the local pending booking before calling Mindbody.
2. Create a provider-attempt row with an idempotency key and normalized request fingerprint.
3. Serialize writes for the same member/Class and return the existing local attempt for a repeated key.
4. Keep native Add Client to Class quick deduplication enabled, but do not treat its undocumented window as an exactly-once guarantee.
5. Store provider request references and distinct resource IDs.
6. Do not automatically issue another provider write after an uncertain failure.
7. Mark the attempt and local booking `unknown`.
8. Reconcile through Client Schedule, Client Visits, Class Visits, Waitlist Entries, Sales, Transactions, and relevant webhooks.
9. Move to `confirmed`, `failed`, or `reconciled` only when evidence supports it.
10. Keep a support lock until the outcome is known. Checkout, cancellation, waitlist removal, and returns have no confirmed native idempotency guarantee.

---

# 23. Admin Workflow

No custom admin UI is included.

Revvi administrators will use the Supabase dashboard to manage:

* Partners.
* Partner integrations.
* Partner locations.
* Offers.
* Offer mappings.
* Integration status.
* Pilot eligibility overrides.
* Booking support records.
* Client-resolution ambiguity.
* Provider attempts in `unknown` state.
* Webhook/subscription and 24-hour reconciliation status.
* Retention-deletion failures.

Production support actions must be explicit and audited. The Supabase dashboard must not expose a generic “retry write” action for an unknown provider outcome. Financial compensation remains a manual studio/finance workflow outside the API.

Create database views where useful:

```sql
create view public.admin_partner_offer_mappings as
select
  p.name as partner_name,
  p.slug as partner_slug,
  pi.provider_site_id,
  pi.status as integration_status,
  po.title as offer_title,
  po.status as offer_status,
  opm.provider_service_product_id,
  opm.status as mapping_status
from public.partners p
join public.partner_integrations pi
  on pi.partner_id = p.id
join public.partner_offers po
  on po.partner_id = p.id
left join public.offer_provider_mappings opm
  on opm.offer_id = po.id;
```

Pilot studio onboarding must verify and record:

- approved Site and every chargeable Location;
- Site currency, IANA timezone, tax-inclusive mode, and per-staff pricing;
- class online visibility, scheduling window, open-space visibility, and waitlist decision;
- Revvi `Service.ProductId`, barcode if needed, sale/use locations, Program/Class Description/Session Type allowlists, activation/expiry, and discontinuation process;
- required client fields, duplicate handling, waiver/liability behavior, and dedicated least-privilege integration user where required;
- explicit ClientService deduction behavior or the approved free/unpaid/redirect mode;
- payment processor/region and SCA/redirect behavior when payment is enabled;
- cancellation display policy, early/late behavior, pass restoration checks, and provider email settings.

---

# 24. Testing Strategy

## 24.1 Unit Tests

Test:

* Eligibility evaluation.
* Offer mapping selection.
* Mindbody response normalization.
* Error mapping.
* Redaction.
* Availability state/reason derivation with null and contradictory capacity.
* ProductId/barcode separation and offer allowlist intersection.
* Client matching and ambiguous duplicate handling.
* Quote fingerprinting and material-change detection.
* Cancellation requestability without claiming penalty-free eligibility.
* Idempotency behavior.
* Unknown-state transitions and reconcile-before-retry behavior.
* Webhook signature, dedupe, and reordering.
* 48-hour diagnostic deletion.
* Date range validation.
* Public error messages.

## 24.2 Integration Tests

Test with mocked Mindbody responses:

* Availability retrieval.
* Empty availability.
* Invalid Site ID.
* API authentication failure.
* Staff token missing, expired, revoked, and insufficient permissions.
* Full class.
* Hidden/null capacity and waitlist availability.
* Client duplicate ambiguity and mode-specific required fields.
* Existing pass found, absent, expired, and multiple eligible passes.
* Test-cart tax, discount, total, and changed live re-quote.
* Successful booking.
* Failed payment.
* Successful provider booking with local DB failure.
* Provider timeout.
* Duplicate booking request.
* Successful cancellation.
* Failed cancellation.
* Cancellation committed despite timeout/error, then reconciled.
* Pass restored, not restored, and restoration unknown.
* Duplicate/out-of-order/missing webhook events.
* Member ineligible.
* Offer mapping missing.

## 24.3 Sandbox Tests

Test against Mindbody sandbox:

* Credentials.
* API key + Site ID and every endpoint’s optional/required staff/OAuth token and permission mode.
* Sites, Locations, Programs, Class Descriptions, Class Schedules, Classes, Staff, and Services pagination.
* ProductId versus barcode behavior in service filters, cart metadata, and reconciliation.
* Null/hidden capacity, booking windows, full classes, waitlists, and anonymous/client-aware `IsAvailable`.
* Client lookup, duplicate detection, required fields, Test creation, and real creation.
* Explicit ClientService selection, pass deduction, and new Product purchase.
* Test cart and supported live booking mode, including tax, discounts, intro restrictions, and per-staff pricing.
* Purchase-plus-Class IDs success, provider rejection, timeout, and reconciliation.
* Early/late cancellation, already-cancelled state, waitlist removal, pass restoration, and ambiguous timeout.
* Provider and Revvi email combinations.
* Webhook signature, duplicates, reordering, retry window, and 24-hour polling convergence.
* Cache/diagnostic expiry and retention deletion.
* Waiver behavior.

Cross-regional, merchant/SCA, processor failures, and comprehensive payment fixtures may require a custom sandbox or direct Mindbody assistance. Do not mark these tested without controlled evidence.

## 24.4 Browser Tests

Test:

* Logged-out member.
* Eligible member.
* Ineligible member.
* Loading state.
* Empty state.
* Provider error.
* Booking success.
* Booking double-click.
* Network timeout.
* Mobile layout.
* Booking history.
* Cancellation confirmation.

---

# 25. Acceptance Criteria

The MVP is ready for pilot when all of the following are true.

No production provider write may be enabled until Revvi has recorded:

1. Mindbody’s written approval of the curated multi-studio use case and exact API product;
2. the effective commercial schedule and chargeable location count;
3. the endpoint authentication/permission matrix;
4. written retention classification or exception for durable provider references;
5. pilot Site activation and controlled sandbox evidence;
6. an approved no-raw-card booking mode and security/PCI sign-off where payment applies; and
7. operational readiness for unknown outcomes, webhooks, polling, and manual compensation.

## Backend

* Supabase schema is deployed through migrations.
* Secrets are not committed to source control.
* Mindbody requests run only through Edge Functions.
* Provider responses are normalized.
* Provider errors are logged safely.
* Revvi idempotency, write serialization, provider attempts, unknown states, and reconcile-before-retry are implemented.
* Local bookings record Class, client, Visit/roster/waitlist, ClientService/Product, and sale/transaction/payment references separately when present.
* Failed and ambiguous bookings have explicit status, certainty, and error fields.
* Raw provider payloads are not stored durably, and the 48-hour deletion job is tested.

## Authentication

* Logged-out visitors cannot book.
* Member identity is verified server-side.
* Ineligible members cannot create bookings.
* Members cannot view or cancel another member’s booking.

## Availability

* Eligible class availability can be retrieved for the pilot partner.
* Inventory is filtered through the active Revvi offer mapping.
* Times display in the correct partner timezone.
* Empty and error states are supported.
* Null or hidden capacity does not produce a fabricated slot count.
* `Class.Id` is used as the occurrence key and `Service.ProductId` as the pricing-option key.

## Booking

* Client matching fails closed on ambiguity and stores Site-scoped Client/RSSID + Unique ID.
* A pilot member can create a booking through exactly one approved pilot mode.
* The booking appears in the partner’s Mindbody roster or booking system.
* The local Supabase booking is marked confirmed.
* Repeated browser submission returns the existing Revvi attempt; ambiguous provider outcomes are not replayed.
* Failed booking attempts do not display success.
* Existing-pass booking uses an explicit tested ClientService ID.
* Paid booking, if enabled, uses an approved no-raw-card path and a revalidated provider-calculated quote.

## Cancellation

* A member can request cancellation of their own supported booking.
* Cancellation is submitted to Mindbody.
* The result is verified or remains `unknown`; ambiguous writes are not replayed.
* Failed cancellations do not falsely show success.
* Pass restoration and refund status are shown separately and never inferred from cancellation.

## Operations

* Revvi can configure the pilot partner through Supabase.
* Known limitations are documented.
* A manual reconciliation process exists.
* A queued reconciliation path, support lock/view, webhook dedupe, and 24-hour sweep exist.
* Written Mindbody use-case/commercial/auth/retention responses are attached to the integration record.
* Production payment handling, if used, has been formally confirmed, sandbox-proven, and approved by security/PCI review.
* Automated refunds, returns, and no-show mutation remain disabled.

---

# 26. Development Milestones

## Milestone 1 — Backend Foundation

**Target effort:** 20 hours

Deliverables:

* Repository.
* Supabase project.
* Initial migrations.
* Core database schema.
* Provider-attempt/state-machine schema.
* Edge Function scaffold.
* Shared response and error utilities.
* Secrets configuration.
* Allowlisted provider logging and 48-hour deletion job.

Completion condition:

The development environment can deploy and invoke a test Edge Function that reads and writes through the server-side Supabase client.

---

## Milestone 2 — Mindbody Read Integration

**Target effort:** 18 hours

Deliverables:

* Mindbody API client.
* Authentication/configuration.
* Sites, Locations, Programs, Class Descriptions, Classes, and Services retrieval.
* Class Schedules and Staff only where required.
* Response normalization.
* Error mapping.
* Provider request logs.

Completion condition:

The application can retrieve and normalize class availability from the configured Mindbody test site.

---

## Milestone 3 — Partner Mapping and Eligibility

**Target effort:** 18 hours

Deliverables:

* Pilot partner seed/configuration.
* Offer and provider mappings.
* Member eligibility logic.
* Memberstack identity integration.
* Eligibility endpoint.
* Availability filtering.
* Required Site-scoped client profile schema and fail-closed resolution state.

Completion condition:

Only an eligible test member can retrieve bookable inventory for the configured Revvi offer.

---

## Milestone 4 — Webflow Availability UI

**Target effort:** 14 hours

Deliverables:

* Webflow markup contract.
* Frontend API client.
* Memberstack integration.
* Availability cards.
* Loading, empty, error, and ineligible states.
* Responsive behavior.
* Unknown-capacity and pending-reconciliation states.

Completion condition:

An eligible member can view normalized pilot partner availability on the Webflow page.

---

## Milestone 5 — Booking Creation

**Target effort:** 24 hours

Deliverables:

* Quote endpoint.
* Booking endpoint.
* Client lookup/duplicate/required-fields flow.
* Client-aware Test-cart quote where required.
* Explicit ClientService or approved pilot booking mode.
* Local booking and provider-attempt transaction.
* Mindbody write call behind feature flags.
* Distinct provider-reference persistence.
* Revvi idempotency, write lock, and unknown outcome handling.
* Success and failure UI.
* Basic provider/client mapping where required.

Completion condition:

An eligible pilot user can create one supported class booking through the single approved pilot mode; the result appears in Mindbody and Supabase, or remains safely unknown without replay.

---

## Milestone 6 — Booking History and Cancellation

**Target effort:** 14 hours

Deliverables:

* Upcoming bookings endpoint.
* Webflow booking history.
* Cancellation endpoint.
* Cancellation attempts and separate restoration/refund status.
* Reconciliation reads and queued unknown-state handling.
* Minimum Mindbody webhook receiver, dedupe, and 24-hour sweep.
* Support lock/view.
* Cancellation result UI.

Completion condition:

A member can view and request cancellation of their supported pilot booking without false success, refund, or pass-restoration claims.

---

## Milestone 7 — Pilot Testing and Handover

**Target effort:** 12 hours

Deliverables:

* Sandbox and pilot testing.
* Endpoint auth/permission test record.
* Booking/cancellation timeout and webhook convergence tests.
* Bug fixes within the agreed MVP scope.
* Pilot configuration notes.
* Known limitations.
* Support and reconciliation guide.
* Deployment notes.

Completion condition:

The integration is ready for a controlled pilot with one Mindbody partner.

---

# 27. Effort Budget

```txt
Backend foundation                    20 hours
Mindbody read integration             18 hours
Mapping and eligibility               18 hours
Webflow availability UI               14 hours
Booking creation                      24 hours
History, cancellation, reconciliation 14 hours
Testing and handover                  12 hours
────────────────────────────────────────────
Total                                120 hours
```

The 120-hour total is a delivery constraint for the binding one-Site/one-booking-mode pilot at the top of this PRD. It is not an estimate for standard raw-card checkout, multiple payment variants, automated refunds, comprehensive waitlists, cross-regional behavior, or general production rollout.

When uncertainty affects the budget, priority must be:

1. Secure backend foundation.
2. Availability retrieval.
3. Eligibility.
4. Booking creation.
5. Local booking records.
6. Unknown-state reconciliation and support locks.
7. Pilot testing.
8. Basic cancellation.
9. Confirmation email.
10. Waivers.
11. Additional partner support.

Lower-priority features may be deferred to a later phase rather than compromising booking reliability.

---

# 28. Development Order

Recommended implementation sequence:

```txt
1. Create repository and Supabase project.
2. Write schema migrations.
3. Build shared Edge Function utilities.
4. Implement provider abstraction.
5. Implement Mindbody read client.
6. Validate sandbox authentication/permissions and read endpoints.
7. Seed one pilot partner, Product ID, and inventory allowlists.
8. Implement member identity, eligibility, and Site-scoped client resolution.
9. Implement availability state normalization and endpoint.
10. Build Webflow availability UI.
11. Obtain written product, commercial, retention, and booking-mode approvals.
12. Implement client-aware quote and quote revalidation.
13. Implement the one approved booking mode behind feature flags.
14. Implement provider attempts, write locks, unknown states, and reconciliation before enabling writes.
15. Implement upcoming bookings and support view.
16. Implement Mindbody webhook intake, dedupe, and 24-hour polling sweep.
17. Implement basic cancellation only after controlled sandbox proof.
18. Run end-to-end pilot tests and document support/manual compensation.
```

---

# 29. Phase 2 Candidates

After the pilot, a separate phase may include:

* Additional Mindbody partners.
* Appointment booking.
* Partner self-service onboarding.
* Custom Revvi admin dashboard.
* Full Memberstack webhook synchronization.
* Automated confirmation emails.
* Waiver presentation and acceptance.
* Advanced reconciliation beyond the minimum unknown-state queue and 24-hour sweep.
* Advanced monitoring and analytics beyond minimum failure/retention/subscription alerts.
* Provider health dashboards.
* Refund workflows.
* Automated pass selection and cross-regional client/pass behavior.
* Waitlist joining and promotion workflows.
* No-show mutation.
* Additional Mindbody payment modes, SCA variants, and saved-card selection.
* Additional booking providers.
* Supabase paid-plan migration.
* Queue-based background processing.
* Reporting and booking analytics.

---

# 30. Definition of Done

The project is complete when:

* The code is committed to the agreed repository.
* Database migrations can recreate the required schema.
* Required Edge Functions are deployed.
* The pilot partner is configured.
* An eligible member can view availability.
* Client identity is resolved without automatic duplicate merging.
* An eligible member can create a class booking through the single approved pilot mode.
* The booking appears in Mindbody.
* The booking is stored in Supabase.
* Repeated local submissions are deduplicated and ambiguous provider writes are reconciled before retry.
* A member can view their booking.
* Basic cancellation works where sandbox-proven, and refund/pass restoration remain separate.
* Webhook intake, reconciliation, support locks, and 48-hour diagnostic deletion are operating.
* Known limitations are documented.
* Product approval, commercial terms, authentication permissions, and retention treatment are recorded in writing.
* Payment handling, if enabled, has been officially confirmed and no raw card data enters Revvi infrastructure.
* Revvi has received deployment, configuration, and support notes.

# Eligible members and partner isolation

The reported second member passed current Memberstack Test Plan authorization for
availability and provider writes. Quote creation then failed before Mindbody
because the hosted Site -99 adapter required the mapping's legacy
`sandbox_demo_customer_id` to equal the caller. The database repeated that rule
for discovered quote Products, booking attempts, cancellation restoration, and
Client reset recovery.

Booking access follows the authenticated member's current plan and the selected
Business/Location/Offer. A sandbox payment capability belongs to the Offer, not
to one designated member. The shared runtime predicate now retains the enabled
Site -99, Location 1, fictitious Cash boundary without a Customer allowlist.
A forward migration removes the corresponding database restrictions. The legacy
Customer column remains optional metadata for rolling deployment compatibility;
application contexts no longer read it. Product registration remains server-only
and requires current Customer access to the exact Business/mapping.

Partner isolation continues through the existing composite database keys and
server-resolved contexts: Client profiles belong to Customer plus integration;
quotes and bookings retain their Customer, Business, Offer, Location, and Site;
production staff credentials are selected by integration ID without fallback.
Current plan authorization and production activation/evidence requirements remain
in force. This change does not establish live onboarding evidence for additional
production partners.

## Verification

- The new two-member quote regression fails against the original adapter with
  `SITE_99_SANDBOX_CONTEXT_DENIED` and passes with this change. It exercises the
  real quote engine through the hosted runtime provider, with independent Client
  identities and quote fingerprints.
- `pnpm test`: 273 passed; 11 optional browser cases skipped. Coverage includes
  wrong-plan and mixed Business/Location/Offer rejection, tenant credential
  selection, quote ownership, and cancellation behavior.
- All migrations applied to an isolated local Supabase instance, with the normal
  seed: 435 pgTAP assertions passed across 13 files.
- The expanded Site -99 database regression separately passed all 37 assertions
  using a `supabase_admin` login and `SET ROLE service_role`. This matters because
  the pilot write trigger exempts `session_user = postgres`; an ordinary fixture
  run alone would not exercise that trigger. Both members claim independent
  booking writes. The same member can retain separate profiles at two Sites,
  including identical provider Client IDs; mixed partner references are denied.
- Before deployment, the forward migration and 37 assertions also passed in a
  hosted transaction that was rolled back. Hosted fixtures reused the existing
  Site -99 integration with a temporary Offer and two synthetic Customers,
  explicitly excluding existing member profiles. No fixture bookings persisted.
- The independent local provider runner completed a live Site -99
  `book-and-cancel` journey: Cash checkout, Client visit, roster, and schedule
  evidence confirmed; cancellation confirmed; remaining entitlement restored
  from 4 to 5. The temporary staff token was revoked and the shared staff lease
  released. This was a synthetic provider test, not either member's booking.

The local Webflow demo deliberately uses a new synthetic Client per committed
run and a loopback-only identity adapter. It has no persistent single-member
allowlist to remove. Its live provider journey was verified separately from the
hosted function/database path. No Webflow contract or asset change is required.

The authenticated second-member browser journey remains the user's final check;
server and database regressions do not substitute for that live browser result.

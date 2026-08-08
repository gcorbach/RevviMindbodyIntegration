# Sandbox Business pilot operations

This runbook controls the pre-approval Business-to-Business pilot against the Mindbody sandbox. Mindbody remains authoritative for provider results; the Revvi operational ledger records tenant-scoped readiness, Booking attempts, evidence references, and staff actions.

## Ownership

- Platform operations owns evidence recording, activation, deactivation, and rollback.
- Booking support owns unknown-outcome alerts and reconciliation under `docs/operations/booking-support.md`.
- The responsible platform-operations actor must be identifiable in every readiness change.
- Business staff cannot promote a Business or read another Business's readiness record.

## Sandbox diagnostics and evidence

Run diagnostics with Revvi's server-side API key and sandbox Site ID. Never paste secrets, provider bodies, customer profile data, PAN/CVV, or raw notification content into evidence or limitations.

Record a passing, timestamped evidence reference for every check:

1. `site_activation`: Revvi's application is activated for the configured sandbox Site.
2. `sandbox_connectivity`: authenticated Public API calls succeed for that Site.
3. `approved_locations` and `approved_services`: the enabled Revvi catalogue matches the intended sandbox records.
4. `live_availability`: the selected Location and service return bookable availability.
5. `client_mapping`: unique-match, create, conflict, and ambiguous Mindbody Client paths were validated.
6. `branding` and `support_contact`: approved pilot presentation and an owned support route are recorded.
7. `checkout_or_non_paid`: record `supported_checkout` evidence or an explicit `approved_non_paid` decision matching the Business completion mode.
8. `transactional_messages`: describe observed Mindbody behaviour and record accepted payment or notification limitations.
9. `tenant_isolation`: the automated cross-Business suite passed.
10. `booking_lifecycle`: the automated complete Booking-attempt lifecycle suite passed, including unknown and expired outcomes.
11. `controlled_booking`: reference a confirmed, tenant-owned controlled Booking attempt.

Evidence references should point to durable, access-controlled test output or approval records. Accepted limitations must say what is unavailable in sandbox and who accepted the constraint; they are not waivers for failed safety checks.

## Promotion

1. Confirm the Business is configured for `sandbox` and has at least one enabled approved Location and service.
2. Confirm all thirteen checks are passing and were verified after the most recent deactivation.
3. Confirm the checkout/non-paid decision matches the configured completion mode, transactional-message behaviour is recorded, and the configured support contact is present.
4. Confirm there are no unresolved unknown Booking outcomes or open unknown-outcome support items.
5. Activate only the selected Business through the `business-readiness` staff API. Do not edit `booking_enabled` directly.
6. Re-read the readiness record and verify `status=active`, the tenant flag is enabled, the responsible actor and activation action are recorded, and other Businesses are unchanged.
7. Perform one final smoke check as a Revvi Customer for that Business without reusing the controlled Booking's idempotency key.

## Rollback and incidents

Deactivate the Business immediately for an incident, material readiness failure, revoked Site Activation, or provider-configuration drift. Deactivation stops new Booking attempts only. It does not delete operational history, cancel anything in Mindbody, repeat a provider write, or change an existing Booking outcome.

After rollback:

1. Use the support view to reconcile unknown outcomes before any promotion attempt.
2. Preserve evidence and audit actions; add new records rather than editing history.
3. Correct the incident or configuration.
4. Re-run and re-record all thirteen checks after the deactivation timestamp.
5. Re-enable only through the normal activation gate. A direct feature-flag override is not a recovery path.

A changed sandbox Site ID is an automatic rollback: the readiness fingerprint is cleared, the tenant flag is disabled, and a system-authored `site_activation_changed` action is recorded.

## Production handoff after Mindbody approval

Do not promote or overwrite sandbox evidence for production. Before production activation is implemented, add environment-scoped readiness records so sandbox and production evidence remain separate and immutable. Then complete real Site Activation and repeat the full checklist against the Business's actual Locations, services, availability, payment configuration, transactional messaging, branding, support ownership, isolation, lifecycle, and controlled Booking. Production enablement remains blocked until that separate implementation and verification are complete.

# Classes-only pilot activation

This runbook activates one Revvi Offer for one Mindbody Business, Location, environment, fulfilment mode, and mapping version. It never activates the retained Appointment prototype. Mindbody remains authoritative for Class inventory, roster, Visit, entitlement, sale, and cancellation results.

## What activation does

Availability and client-aware quotes may be tested while a pilot is inactive. A new Mindbody Booking write is allowed only when `class_offer_provider_mappings.pilot_write_enabled` is true and the provider-write boundary can re-prove all of the following:

- the Business, integration, Location, Revvi Offer, and mapping are active;
- the exact mapping version and selected fulfilment mode are still verified;
- a classes-only readiness row is active for the same environment;
- every mandatory controlled-evidence kind is current; and
- no required evidence has been revoked.

Database owners can construct transactional test fixtures. Application traffic cannot bypass this gate.

## Choose the pilot scope

Record these identifiers before testing:

- `business_id`, Mindbody Site ID, confirmed `public_api_consumer_booking` product/use case, and effective chargeable Location count;
- `integration_id` and `environment` (`sandbox` or `production`);
- `location_id`, Mindbody Location ID, and IANA timezone;
- `offer_id`, exact Memberstack plan IDs, and signed Revvi terms;
- `mapping_id`, `mapping_version`, and exactly one fulfilment mode; and
- the stable Location, Program, Class Description, Session Type, and optional Schedule allowlist.

The initial pilot must use a mode whose own evidence gate is complete. `existing_entitlement` and `approved_unpaid` are available when their controlled proof is current. `purchase_pricing_option` is eligible only after its separate route flag, written payment approval, processor/country/permission/PCI evidence, and controlled recovery proof are all active; otherwise it remains disabled.

## Controlled evidence package

Run the checks against the exact scoped Business and Location. Store full artifacts in an access-controlled system, then record only an opaque reference and SHA-256 digest in Revvi. Never store raw provider bodies, Revvi Customer data, payment data, PAN/CVV, tokens, or notification contents in the readiness ledger.

Every enum value in `class_pilot_evidence_kind` is mandatory:

1. `site_activation` — Mindbody confirms Revvi's application for the exact Site and environment.
2. `api_product_use_case` — Mindbody confirms the Public API / Consumer Booking product and the exact Revvi Class use case.
3. `commercial_terms` and `chargeable_locations` — the effective commercial schedule and typed `chargeable_location_count` cover the Location.
4. `endpoint_permissions` — the real auth matrix proves every read/write/reconciliation endpoint used by the selected mode.
5. `retention_classification` — written retention treatment covers the operational ledger and diagnostics.
6. `signed_offer_terms` — the partner approved Revvi-only terms on the existing approved Classes.
7. `memberstack_plan_eligibility` — exact eligible plans pass and an inactive/unrelated plan fails closed.
8. `class_inventory_allowlist` — only the approved Class taxonomy is returned.
9. `timezone_currency_tax`, `pricing_restrictions`, `required_client_fields`, and `notification_behavior` — observed Business rules and accepted limitations are recorded.
10. `eligible_availability`, `ineligible_revvi_customer_denial`, and `out_of_allowlist_denial` — Revvi Customer-facing boundaries are exercised.
11. `client_resolution` — unique match/create plus ambiguous/conflict paths are exercised without guessing.
12. `quote_and_requote` — the client-aware quote, expiry, recalculation, and changed-total reconfirmation are exercised.
13. `authoritative_booking` — Webflow completion is matched to the exact Mindbody Class roster/Visit and the selected mode's payment, entitlement, or approved-unpaid evidence.
14. `cancellation_convergence`, `unknown_convergence`, and `webhook_convergence` — drills converge by authoritative reads without replay or false success.
15. `diagnostic_expiry` — the 48-hour diagnostic purge is observed.
16. `support_process` and `rollback_drill` — ownership, alerting, manual evidence rules, and fail-closed rollback are exercised.

Record each result through `record_class_pilot_evidence(mapping_id, kind, digest, reference, verifier, observed_at)`. The verifier must identify the responsible operator; the reference must be opaque and safe to retain.

## Activate

Before activation, confirm the readiness query shows no unresolved `pending`, `requires_action`, `cancel_pending`, or `unknown` Booking for the mapping and no queued, processing, or support-bound reconciliation item.

Call `activate_class_pilot(mapping_id)`. It fails unless configuration, selected-mode proof, inventory dimensions, Memberstack plans, evidence completeness, and operational convergence all pass. On success, re-read both rows:

- `class_pilot_readiness.status = 'active'` for the exact mapping version/environment; and
- `class_offer_provider_mappings.pilot_write_enabled = true`.

Then perform one fresh eligible Revvi Customer Webflow smoke Booking with a new idempotency key and verify the exact Mindbody roster/Visit. If that final smoke creates an unknown outcome, stop and reconcile it; do not replay the write.

## Fail closed and recover

Call `deactivate_class_pilot(mapping_id, reason)` for an incident, provider/configuration drift, unresolved outcome, lost approval, or rollback. This blocks new provider writes but does not alter or delete existing Bookings.

Call `revoke_class_pilot_evidence(evidence_id, reason)` when any proof expires or is invalidated. Revocation immediately disables the mapping and preserves the old evidence as history. Record a fresh controlled result for that evidence kind and rerun normal activation; never edit the old digest.

A material mapping/version change also closes the gate automatically. So does drift in Site ID, API product, chargeable Location count, provider Location ID, timezone, Offer Location/mode/status, or exact Memberstack plan IDs. Every evidence row and activation binds a digest of those facts; fresh configuration requires fresh evidence. Sandbox evidence never activates production: production has a distinct integration environment and must repeat the complete package.

## Handover record

The pilot handover must include the scoped IDs, evidence-set digest, activation actor/time, selected mode and disabled alternatives, support owner, alert route, rollback owner, known accepted limitations, and links to controlled artifacts. Do not describe the pilot as ready while any external approval or controlled result is missing.

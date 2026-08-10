# Approved-unpaid Revvi Offer activation

`approved_unpaid` is a deliberate Business arrangement, not a fallback when payment or entitlement selection fails. Keep `approved_unpaid_enabled = false` until the exact Offer mapping has written approval and every controlled behavior below is verified.

Fixture tests prove that the gate fails closed. They are not Mindbody sandbox evidence and must never be used as the evidence digest.

## Controlled sandbox record

Use one stable sandbox Business, Location, Approved Class inventory mapping, Revvi Customer, and future Class occurrence. Store only a SHA-256 digest of the reviewed evidence manifest; do not store the agreement, provider payload, Revvi Customer data, or notification content in the database.

Record one current `class_approved_unpaid_evidence` row for each required kind:

1. `written_business_approval`: identify the signed/current Business approval that permits Revvi Customers to join Classes in the Approved Class inventory without another Mindbody payment.
2. `provider_permissions`: prove the selected staff token and Site can use Add Client to Class for the intended Business and Location.
3. `unpaid_roster_booking`: submit the exact Mindbody Client and `Class.Id` with `RequirePayment=false`, `Waitlist=false`, no `ClientServiceId`, and the reviewed email setting. Verify the exact Visit/roster result and that no Mindbody entitlement, Sale, Cart, Transaction, or Payment was created or consumed.
4. `notification_behavior`: record whether `SendEmail=false` suppresses provider messages and, if notifications are intentionally enabled later, separately verify the recipient, sender, channel, copy, and Business settings before changing runtime configuration.
5. `cancellation_behavior`: remove the controlled roster Booking through the supported provider operation and verify the resulting roster/Visit state. Record any studio-reported limitation; do not promise penalty-free cancellation from `Program.CancelOffset` alone.
6. `booking_reconciliation`: drop or obscure the write response after Mindbody may have accepted the controlled Booking attempt, then prove that Mindbody Client schedule/Visit, Class roster, Sale/Transaction, and verified webhook reads converge without replaying Add Client to Class.

The manifest should identify the Business, Site, Location, Offer mapping/version, approved inventory revision, redacted request shape, before/after roster facts, distinct provider identifiers, timestamps/timezone, fixture version, observed notifications, cancellation result, reconciliation result, operator, and limitations. Explicitly record that no Sale or payment identifier exists for the successful unpaid Booking.

## Activation

Evidence can be recorded only for the current active, validated mapping version. Mapping, validation, or approved inventory changes advance that version and invalidate prior activation.

After all six rows exist, platform operations may set `approved_unpaid_enabled = true`, `mode_verified_at`, and the composite `mode_evidence_digest`, then activate the Revvi Offer. The database rejects mode verification when the feature flag is off or any required proof is absent, and rejects Revvi Offer activation until both mapping gates are complete. Turning the flag off clears mode verification and deactivates the Revvi Offer.

The provider write must remain Add Client to Class with `RequirePayment=false` and `Waitlist=false`. A successful local Booking requires exact Visit or roster evidence. An unexpected Mindbody entitlement, Mindbody pricing option, Sale, Cart, Transaction, Payment, or waitlist result remains unknown and locked for reconciliation; it is never relabelled as approved-unpaid Booking success.

## Production promotion

Do not copy or relabel sandbox evidence. For the production mapping's current version, record one production-environment evidence row per kind. Each row must reference its matching still-verified sandbox row in `source_evidence_id` and identify the reviewed production configuration manifest in `production_equivalence_digest`.

The database locks and revalidates sandbox lineage when production evidence is recorded and whenever production mode verification is enabled. Direct production evidence without sandbox lineage is rejected.

## Revocation

Revoke evidence immediately when written approval is withdrawn, staff permissions or provider settings change, the observed no-payment behavior changes, a notification/cancellation limitation becomes unacceptable, or controlled evidence is found invalid. Revocation disables the mapping feature flag and mode verification. Revoking a sandbox source also revokes every production proof promoted from it.

# Class Booking lifecycle operations

This runbook covers Customer-owned upcoming Bookings, controlled cancellation, Mindbody webhooks, lifecycle reconciliation, and audited support actions. Mindbody remains authoritative. None of these paths retries an uncertain provider write or automates a refund, Return Sale, entitlement replacement, or compensation.

## Activation gates

Keep `class_offer_provider_mappings.cancellation_enabled` false until controlled evidence exists for the current mapping version and environment. Record separate `class_cancellation_evidence` rows for:

- `roster_removal` when confirmed roster Bookings may be cancelled;
- `waitlist_removal` only when the exact waitlist operation was separately proven;
- `authoritative_reconciliation` for the post-write Public API reads;
- `entitlement_restoration_read` for an existing-entitlement Offer.

Evidence must use the active verified mapping version. Production evidence must promote matching, still-current sandbox evidence with an equivalence digest. Revocation or a mapping-version change closes the feature flag. Do not enable cancellation merely because the Mindbody button or endpoint exists.

## Mindbody webhook subscription

Create and activate a Mindbody Webhooks API subscription only after the developer account and pilot Site are approved. Use this receiver URL:

```text
https://<project-ref>.supabase.co/functions/v1/webhooks/mindbody
```

Subscribe initially to the Class roster Booking, Class waitlist, Class/Class Schedule, and Client Sale events listed in `docs/CODE_PRD.md`. Store each subscription's returned `messageSignatureKey` only in `MINDBODY_WEBHOOK_SUBSCRIPTIONS_JSON`, alongside the local integration UUID and exact Site ID. The receiver checks `X-Mindbody-Signature` as `sha256=<base64 HMAC-SHA256 of the exact UTF-8 body>` before parsing, then stores only typed facts and a fingerprint. Mindbody documents duplicate and out-of-order delivery, a ten-second response deadline, retries every fifteen minutes for three hours, and a separate daily Public API sync requirement in its [Webhooks API documentation](https://developers.mindbodyonline.com/WebhooksDocumentation).

Check subscription health during every pilot shift. A valid `202` means the event identity was durably queued; it does not mean the Booking changed locally.

## Worker and 24-hour sweep

Generate a random `CLASS_LIFECYCLE_WORKER_SECRET` of at least 32 characters. Configure the same values as protected database settings used by the dispatcher:

```sql
alter database postgres set app.settings.class_lifecycle_worker_url =
  'https://<project-ref>.supabase.co/functions/v1/class-lifecycle-worker';
alter database postgres set app.settings.class_lifecycle_worker_secret =
  '<same protected worker secret>';
```

The `class-lifecycle-worker-dispatch` cron job invokes the read-only worker every minute when those settings exist. `class-lifecycle-24-hour-sweep` runs hourly and queues any Booking whose last authoritative lifecycle read is at least 24 hours old. Webhook processing also queues matching Bookings. Reconciliation uses Client Schedule, Client Visits, Class Visits, waitlist, Sales, and Transactions as appropriate; it never repeats Add, Checkout, removal, return, or refund writes.

Alert if dispatcher requests fail, webhook events remain `failed`, lifecycle work reaches `requires_support`, a subscription deactivates, or a due Booking has not been reconciled within 24 hours.

## Customer experience

Embed `webflow/history.html` on the authenticated Revvi account page and replace both Supabase URL placeholders. The endpoint verifies the Memberstack JWT, retrieves the Memberstack Customer afresh, resolves the server-owned Revvi Customer, and returns only that Customer's Bookings. A cancellation button appears only when current operation evidence permits it.

`cancelled`, `failed`, and `unknown` are distinct cancellation outcomes. `unknown` remains locked and must not be resubmitted. Refund is displayed as `not_requested`; an existing-entitlement restoration remains `unknown` until separately established. Cancellation never implies either result.

For an existing entitlement, record a typed pre-write baseline for the exact `ClientService.Id` and its actual observation time. Persist it under the cancellation lock before sending the provider write; if persistence fails, do not cancel. Compare the post-cancellation read to that durable baseline. A pass that is merely still usable, an unchanged balance, an unlimited pass, or a missing baseline is not proof of restoration; keep it `unknown` for reconciliation or audited support.

## Support

Use `class_booking_support_cases` for unresolved Class lifecycle work. It is restricted to Business/platform operations and exposes distinct provider references, active locks, queue state, last webhook time, and last lifecycle read. Do not copy customer data or raw provider bodies into support notes.

When authoritative evidence is established outside the automated reader, call `resolve_class_booking_support_case` with the exact resolution and a concise evidence summary. The action is append-only and records the staff actor. Resolution releases local locks and completes queues; it never sends a provider write. If the evidence is not authoritative, leave the case unresolved and escalate to the Business/Mindbody.

## Retention

Raw webhook bodies are never stored. Typed message identity/facts remain for dedupe and audit. Temporary `class_mindbody_webhook_diagnostics` expire no later than 48 hours and are deleted by `class-mindbody-webhook-diagnostics-retention`. Monitor both the cron job and the oldest diagnostic row.

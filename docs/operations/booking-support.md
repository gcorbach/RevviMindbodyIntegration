# Booking support operations

The Booking support view is the staff-only entry point for exceptional Booking work. It reads the tenant-scoped Revvi operational ledger; Mindbody remains authoritative for completed Bookings and provider outcomes.

## Operating expectation

- Treat an unknown-outcome alert as prompt work. Open the correlated attempt as soon as the alert is received and keep it retry-blocked while authoritative evidence is unavailable.
- Review the remaining open queue—ambiguous Clients, repeated reconciliation failures, and relevant expired attempts—by the next business day.
- Filter by Business, support status, correlation ID, or exception category. Platform operations may work across Businesses; Business staff may see only assigned Businesses.

## Investigation

The detail view intentionally exposes only the Booking context and allowlisted operational evidence needed to investigate: current state, provider-operation category, latency, redacted error category, reconciliation history, correlation ID, and whether provider references exist. It does not expose Memberstack identifiers, provider record identifiers, secrets, PAN/CVV, unnecessary customer profile data, event metadata, or raw provider bodies.

Use the correlation ID to relate the queue item, Booking attempt, alert, and immutable event history. For unknown outcomes, wait for the established authoritative reconciliation path to move the Booking attempt to `confirmed`, `failed`, or `expired`. A callback, browser return, staff note, or provider screenshot is not authoritative by itself.

## Staff actions

The view supports one write: recording a resolution on a support item. Each resolution stores the staff actor, timestamp, Business, correlation, and summary in append-only history.

Recording a resolution never changes a Booking-attempt state and never repeats a Mindbody write. An unknown-outcome item cannot be resolved until immutable reconciliation evidence records an authoritative success or absence; expiry from elapsed time is not authoritative evidence. A repeated reconciliation failure may be recorded as escalated or otherwise handled, but the underlying unknown Booking attempt remains retry-blocked. Ambiguous Client work should record what was established without copying customer profile data or provider payloads into the summary.

If an investigation needs a new provider write or a forced confirmation, stop: neither is a support action. Resume only through the Booking-attempt workflow after authoritative reconciliation has satisfied its safety rules.

## Alerts and audit

Creating an unknown-outcome support item also creates a durable staff alert containing only the Business, support-item ID, Booking-attempt ID, correlation ID, category, status, and timestamps. The alert contains no provider payload. Resolution history cannot be edited or deleted; corrections must be recorded as a new operational follow-up outside the immutable entry.

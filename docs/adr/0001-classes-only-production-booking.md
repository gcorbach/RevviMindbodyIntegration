---
status: accepted
date: 2026-08-09
---

# Classes are the production Booking boundary

Production development follows `docs/CODE_PRD.md` and books approved existing Mindbody Class occurrences for eligible Revvi Customers. The appointment implementation created from GitHub issue #10 and issues #11–#19 is retained as a quarantined local sandbox/test prototype because its tenant, identity, idempotency, reconciliation, support, and readiness patterns are useful, but its `/appointment/*` provider operations and appointment identifiers do not satisfy the product scope.

## Consequences

- The production Class path is built in parallel on a new Class-specific Offer, quote, Booking, and provider-reference ledger; the appointment schema is not converted in place.
- Supabase owns each Revvi Offer and its Business, Location, exact Memberstack plan eligibility, approved Class inventory, and one fulfilment mode. Webflow stores presentation content and a stable Offer reference only.
- Mindbody owns Class occurrence availability, client identity, pricing or entitlement, roster state, and financial state.
- A paid Offer maps to one dedicated `Service.ProductId` at one Location. Existing-entitlement and approved-unpaid Offers remain separate modes, and no Offer may activate until its configured mode has controlled evidence.
- Appointment routes, fixtures, and readiness evidence cannot satisfy Class Booking acceptance criteria or be enabled in production.

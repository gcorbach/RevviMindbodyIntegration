## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Site -99 demo and Supabase parity

The local Site -99 Webflow demo and the hosted Supabase functions are two adapters for the same browser contract. Any change to availability, quote, booking, reconciliation, confirmation, cancellation, cleanup, taxonomy or pricing-option discovery, or provider-response normalization in the local demo must also be evaluated and, where applicable, implemented and tested in the corresponding Supabase path. Apply the same rule in the other direction.

Do not treat a passing loopback demo as proof that the Supabase implementation works. Verify the local provider journey and the Supabase function/database path separately, and document any intentional divergence.

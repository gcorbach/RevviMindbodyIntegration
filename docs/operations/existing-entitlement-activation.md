# Existing-entitlement activation

This runbook gates the `existing_entitlement` Offer fulfilment mode. The mode stays unavailable until a controlled Mindbody sandbox run proves all three required behaviors for the current Revvi Offer mapping version. Automated fixture tests validate the gate; they are not sandbox evidence.

## Required controlled run

Use a sandbox Mindbody Client with one known current pass that is valid for the approved Location and Approved Class inventory. Keep raw Mindbody responses in the approved access-controlled evidence store only for the permitted retention period. Supabase stores only SHA-256 evidence digests and normalized operational references.

Prove and review these behaviors separately:

1. `explicit_client_service_selection`: `GetClientServices` returns the intended pass for the selected Class occurrence; the write sends that exact `ClientServiceId`; the returned Visit or roster evidence identifies the same Mindbody Client, Class occurrence, and ClientService. A result that omits or substitutes the pass does not pass.
2. `pass_deduction`: record the normalized before/after state of the exact pass. A finite pass must show the expected decrement. An unlimited pass must retain its documented unlimited semantics. No other pass may change. Record the test fixture, observed rule, reviewer, and time in the external evidence bundle.
3. `booking_reconciliation`: simulate an ambiguous response after the provider may have accepted the write. Client Schedule/Visits and Class roster/Visits must converge on the exact Mindbody Client, Class occurrence, and ClientService without a second write.

Also run the invalid fixtures: no pass, future activation, expired pass, returned pass, exhausted pass, multiple eligible passes, substituted pass, provider rejection, and dropped response. None may produce a false confirmation or an automatic retry.

## Recording evidence

The mapping must already be a sandbox `existing_entitlement` mapping with stable Approved Class inventory and generic validation complete. Record one digest-only row for each behavior using the current `mapping_version`. Do not record provider payloads, Revvi Customer details, credentials, or free-form notes in this ledger.

After all three rows exist, platform operations may set `mode_verified_at` and `mode_evidence_digest` on `class_offer_provider_mappings`. The database rejects that update if a required behavior is missing or belongs to another mapping version. The composite mode digest should identify the reviewed evidence manifest containing the three individual digests.

Only then can quote creation expose `modeEvidenceVerified=true`. Runtime booking still re-reads the selected Class occurrence and exact pass immediately before the write, sends the quote's `ClientServiceId`, and requires the same ClientService in authoritative confirmation or reconciliation evidence.

## Revocation

If a fixture, permission, pass rule, provider contract, or captured result is found invalid, update the affected evidence row from `verified` to `revoked`, setting `revoked_at` and an uppercase `revocation_reason`. Revocation immediately clears the mapping's mode verification and stops new quotes and writes. Evidence rows cannot be rewritten or deleted; record a new verified row after repeating the controlled run.

Any material mapping change creates a new `mapping_version`. Evidence from an older version cannot activate the changed mapping.

## Production promotion

Sandbox evidence is never copied blindly onto a production integration. After the production mapping has its own current validation digest and stable Approved Class inventory, repeat the controlled checks against the real Business configuration. For each required behavior, record a new production-environment evidence row for the production mapping version that references the matching still-verified sandbox evidence row in `source_evidence_id` and identifies the reviewed production configuration manifest in `production_equivalence_digest`.

The database rejects direct production evidence without that source and equivalence review. It also rejects a source from another Business, another behavior, a non-sandbox integration, or a revoked proof. Revoking a sandbox source automatically revokes every promoted proof derived from it and disables the affected production mapping.

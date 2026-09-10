# Recover a missing hosted Site -99 Client

Mindbody public-sandbox resets can remove Clients while Supabase retains their immutable IDs. `CLIENT_PROFILE_STALE` during quote is the expected fail-closed result. Do not overwrite a provider ID, delete Booking history, or infer cancellation from an empty Client lookup.

For any Customer with a profile at an explicitly enabled Site -99 sandbox Offer:

1. Confirm the request's Customer, integration, and stored Client ID/Unique ID in Supabase.
2. Acquire the shared Site -99 staff-operation lease and read the exact Client ID using temporary staff authentication. Require a successful, complete response showing absence; an error or a mismatched identity is not absence. Revoke the staff token and release the lease. Retain a SHA-256 digest of the scoped evidence.
3. Call `retire_missing_site_99_client_profile(profile_id, expected_client_id, expected_unique_id, evidence_digest)` as an operator. It rejects browser callers, a mismatched identity, an already retired profile, and anything outside the designated Site -99/Location-1/sandbox-Cash scope.
4. Verify the original profile is retained as retired/stale, open quotes referencing it are expired, and current quote/availability context has no Client binding.
5. Restart the authenticated Webflow journey. Normal exact identity resolution and the existing approved Client-creation path establish a new current profile. All quote and booking checks still apply.

Historical bookings continue to reference the original profile. Unknown outcomes remain unknown and retain their reconciliation/support work. Retirement is not cancellation, a refund, or a provider-write retry. Do not retire a live Client merely to get around an identity conflict.

## Verified sandbox Client ID reuse

A sandbox reset can also leave the old numeric Client ID assigned to a different test identity. An ID-only lookup is therefore insufficient evidence that the original Client survived. For this case, an operator must confirm the Customer's unchanged original email and full name, verify that the exact stored Client/Unique ID now has different identity fields, and obtain complete successful email-search and duplicate-check responses showing no Client matching the original identity. Any remaining ambiguity, incomplete response, or changed Customer identity blocks this procedure.

Once those facts are verified under the shared staff-operation lease, the same retirement RPC may retire the **obsolete Revvi profile binding** with the combined evidence digest. Its sandbox integration scope, exact-ID, and history-preservation guards still apply. It does not modify, delete, or claim the current provider Client occupying that ID. Normal authenticated quote processing must resolve/create a fresh Client; browser requests never perform automatic retirement. This extends the original-Client absence evidence above to a verified reused ID, not to ordinary production identity conflicts.

The local demo creates a fresh synthetic Client per committed run and does not persist a Customer-to-Client mapping, so it has no corresponding retirement operation. Its provider lookup, booking, and cleanup behavior is unchanged.

## 2026-09-07 incident

Request `a3a50493-2df0-43c4-abd2-9c3b770afe7f` failed during quote, after successful Client search and duplicate-check responses and before a Class booking or sale write. Profile `edd30410-f510-45b8-8c69-0f013a77f4f4` was last updated August 18 and referenced Client/Unique ID `100015644`. A staff-authenticated exact lookup on September 7 returned HTTP 200 with zero Clients; staff-token revocation also returned 200. Evidence digest: `40a07beb58b0f9b142d34e314dec3f05adaaf0d3cfba27dffa146a10c8b01749`.

The retirement migration and replacement-profile flow passed a transaction rolled back against the real hosted database, including unchanged historical Bookings and both current-context resolvers. Seven pgTAP recovery assertions passed against the same scoped records in another rolled-back transaction. The full Node suite passed 261 tests (10 browser-dependent tests skipped). The missing-profile quote regression confirms that normal quote processing does not silently create a replacement.

Applied migration `20260908000000` to the hosted sandbox and retired the exact missing profile with the recorded evidence digest. Post-application checks show `retired=true`, `verification_status=stale`, no current Client returned by quote context, zero open quotes referencing the retired profile, and all five historical bookings retained. A fresh authenticated Webflow quote and booking have not yet been completed after this repair.

## 2026-09-10 incident: both current test Clients disappeared

Quote request `b9f27ed6-5511-4934-8277-7161c886b0e6` reached Mindbody successfully,
then recorded `STORED_CLIENT_NOT_FOUND`. The same Customer had created a Client
and completed provider-calculated quotes at 01:06 UTC after the eligible-member
fix. This failure was not the former Customer allowlist.

Staff-authenticated exact-ID lookups at 11:51–11:53 UTC returned HTTP 200,
`Clients: []`, and complete zero-result pagination for both current bindings:

| Profile | Missing Client / Unique ID | Lookup evidence SHA-256 |
| --- | --- | --- |
| `9e311c83-85cd-4c43-a1f4-9f350abb2e57` | `100015663` | `9a5165e79678cccd94ae8f7d72b7e036bde4cc7f87bd80758aeacfceb2f738d7` |
| `5edfbdf0-443f-4c6f-ab16-a42a23222230` | `100015661` | `75ef88997870e02508d0f41f77dda44652ac6e91d7281b6d466f6192247f4fbc` |

Each lookup held the shared Site -99 staff lease and revoked its temporary token.
The empty exact-ID results establish absence without depending on name/email
search or assuming an overnight reset schedule. Both local bindings were retired
through the existing RPC, first in rollback verification and then committed.
Complete historical Booking rows compared equal before and after each operation;
open quotes tied to the obsolete profiles expired. Post-commit quote contexts
return no current Client for both Customers. No provider Client or Booking was
created, changed, or cancelled during recovery.

The existing missing-stored-Client quote regression passed. A fresh authenticated
browser quote must still verify normal Client resolution/creation. The local demo
has no persistent profile to retire and requires no change. This is an operator
recovery, not automatic reset handling: a later sandbox deletion can require the
same procedure again. Production identity conflicts remain blocked.

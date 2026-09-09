# Hosted quote identity failure — 2026-09-09

The published widget reported `This Class could not be checked safely` after time selection. Supabase recorded live availability and quote traffic despite the user's empty Network view. Quote requests `77808e64-095e-4aa3-8bc3-ddc30cf6cf75`, `8600a035-3a40-47e7-95d3-0592edfd85c5`, and `f057f5c8-3224-4f2f-b92e-9789e43e5a1a` each stopped after successful Client search and duplicate-check responses. Support work recorded `STORED_CLIENT_NOT_FOUND`; no new quote was persisted.

The active Supabase profile `0c3e40c6-a19b-4b97-98f6-036badee1988` points to Site -99 Client/Unique ID `100015645`. A staff-authenticated exact lookup returned that ID successfully. That initial ID-only result was **not sufficient missing-client evidence**, so no retirement was performed at that point.

A second staff-authenticated check searched using the identity fields actually stored on that Mindbody Client. Both email search and duplicate lookup returned exactly Client `100015645` with matching identity fields. Each operation acquired and released the shared sandbox staff lease; temporary staff tokens were revoked successfully. Evidence digest: `92329442acae51d997344bdd86e943dae85a52fe4ec3a8301a31cbcaab6f887b`.

The hosted authorization path takes identity from the current Memberstack Admin response. The local Customer row has no cached email or name fields, so it cannot establish the identity used in the failed requests. Current Revvi profile details and the browser's quote response have been requested to distinguish changed profile details from another identity-resolution discrepancy.

At that stage no Client identity, profile mapping, quote, or Booking was changed. The existing missing-profile regression passed; it confirms that quote processing does not silently replace a stored Client.

## Confirmed original-identity absence and reused ID

The Customer subsequently confirmed the unchanged original email and full name. All three differ from the identity now stored under Client `100015645`. Staff-authenticated searches using the confirmed original identity returned zero Clients and zero duplicate candidates, both with complete zero-result pagination. The old numeric Client/Unique ID still exists with a different test identity. This supports sandbox ID reuse rather than a Customer profile edit. Mindbody's [release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes) explicitly mention overnight sandbox resets; the precise reset time was not established.

Combined lookup evidence digest: `093901e86b84295d25d7474d00428969208f16b020c7945cfda615620f55641b`. The shared staff lease was released and the temporary token revoked successfully. Recovery follows the verified-ID-reuse variant in [the operator procedure](../operations/site-99-client-reset.md). The different provider Client must remain untouched.

The retirement was verified in a rolled-back hosted database transaction, then applied with the same assertions in a committed transaction. The obsolete profile is retained as retired/stale, there is no current Client binding for this Customer/integration, and no open quote references the old profile. Complete Booking rows for the Customer compared equal before and after retirement. Post-commit availability and quote context reads both returned a cleared Client binding. No provider Client was altered or created, and no new Booking was made. The next authenticated quote can use normal identity resolution and approved Client creation; that fresh browser journey remains to be verified.

There is no local-demo mutation: the local adapter creates a fresh synthetic identity per committed run and has no persistent Customer-to-Client mapping to retire. No function or widget deployment is needed for this operator recovery.

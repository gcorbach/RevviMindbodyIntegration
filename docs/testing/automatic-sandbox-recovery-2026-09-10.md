# Automatic sandbox Client recovery

The regression reproduces the returning-Customer failure after a sandbox Client
disappears: the original quote engine throws `CLIENT_PROFILE_STALE` before
creating a replacement. The new enabled-sandbox path verifies complete exact-ID
absence, retires the obsolete binding, and continues normal approved resolution
within the same quote. Reused IDs require the original verified identity digest;
unknown identity evidence, ambiguity, live matching identities, disabled routes,
production environments, lookup failures, and failed retirement do not create a
replacement. Duplicate-only candidates cannot seed an unverified identity digest.

The hosted quote entrypoint holds the cross-request Site -99 staff lease across
context refresh, Client resolution/recovery, and quote persistence. Nested provider
operations reuse that lease. Concurrent requests reload the profile after obtaining
the lease. Waiting is bounded to 60 seconds and the existing lease expiry remains
300 seconds; a provider outage can still produce a retryable failure.

## Automated verification

- The missing-Client quote regression failed against the original implementation
  with `CLIENT_PROFILE_STALE`; it passes for missing and reused-ID recovery.
- `pnpm test`: 279 passed; 11 optional browser tests skipped.
- All local database suites: 444 pgTAP assertions passed across 13 files.
- The new migration plus the 46-assertion sandbox suite passed in a rolled-back
  hosted transaction using an isolated Offer and synthetic Customers at the
  existing Site -99 integration. Existing member records were excluded.
- Database assertions cover missing IDs without legacy identity evidence,
  reused IDs with original evidence, changed identity, wrong owner, replay,
  immutable original digest through the persistence RPC, and retained Bookings.
- HTTP-handler concurrency coverage verifies profile reload after the lease and
  one replacement for simultaneous requests.

## Live provider and hosted database verification

The real quote handler/engine, runtime provider, and Supabase catalogue were run
against live Mindbody and the hosted database with a synthetic authorized-identity
fixture. This exercises the post-authorization server path; it is not a claim that
a real Memberstack browser session was replayed.

A synthetic Customer was seeded with a local binding to Client `2147483000` only
after the new exact-ID adapter proved that ID absent. Two simultaneous requests
then both returned HTTP 200 and usable stored quotes. There was exactly one
`AddClient` request, one retired profile, and one current profile with a 64-character
identity digest. The replacement Client was `100015656` and the current profile is
`228aca2b-9dbf-43e5-9894-c5b29c252968`. Quote IDs:
`55c130b9-8777-401e-a3f0-d95016575af3` and
`06636eb4-53c0-4410-baf8-add1630f96d6`.

The synthetic Customer/profile and short-lived quotes remain as test evidence in
the sandbox ledger; no paid Booking was created for this recovery test. It did not
change either staff member's identity or historical Bookings. The initial harness
request used an invalid bearer shape and was rejected before quote processing;
the corrected fixture used the normal bearer parser with a synthetic authorization
dependency. No authentication bypass was deployed.

Separately, the independent local Site -99 provider runner completed a live
`book-and-cancel` journey, including provider confirmation, cancellation, restored
entitlement, revoked staff token, and released staff lease. The local Webflow demo
creates fresh synthetic Clients per committed run and has no persistent returning
Customer binding; it therefore needs no equivalent retirement mutation. Its
provider contract was checked independently of the hosted database recovery.

Migration `20260910120000_automatic_site_99_client_recovery.sql` and the
`booking-quote` / `create-booking` functions are the rollout artifacts. No Webflow
markup, bundle, or republish is required. A legacy reused ID lacking original
identity evidence still requires the documented operator fallback; normal new
profiles acquire that evidence automatically.

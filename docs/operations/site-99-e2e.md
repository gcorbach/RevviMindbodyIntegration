# Site -99 end-to-end runner

This command exercises Mindbody's public Business sandbox only. It cannot target another Site or API origin, does not accept secrets as command-line arguments, disables provider notifications, and prints normalized evidence rather than raw provider bodies. Quote, checkout, and cancellation evidence includes SHA-256 digests of normalized secret-free request facts. Provider request IDs are retained only when Mindbody supplies an allowlisted response header; Site `-99` currently returns none and is recorded as `null`.

## Load credentials into the current process

Use temporary environment variables. Do not create a tracked `.env` file and do not paste credentials into terminal history.

```powershell
$env:MINDBODY_API_KEY = Read-Host "Mindbody sandbox API key"
$env:MINDBODY_SANDBOX_USERNAME = Read-Host "Mindbody sandbox staff username"
$mindbodyPassword = Read-Host "Mindbody sandbox staff password" -AsSecureString
$env:MINDBODY_SANDBOX_PASSWORD = [System.Net.NetworkCredential]::new("", $mindbodyPassword).Password
$env:MINDBODY_SANDBOX_SITE_ID = "-99"
```

The runner defaults to the current public-sandbox Client, Yoga taxonomy, Location, and Product search hints. `probe` and `quote` use that harmless sample Client. `book-and-cancel` instead creates a run-unique, non-personal synthetic Client after checking required fields. Override search hints only with currently re-read Site `-99` identifiers:

```powershell
$env:MINDBODY_SANDBOX_CLIENT_ID = "<sandbox client ID>"
$env:MINDBODY_SANDBOX_LOCATION_ID = "1"
$env:MINDBODY_SANDBOX_PROGRAM_ID = "27"
$env:MINDBODY_SANDBOX_CLASS_DESCRIPTION_ID = "223"
$env:MINDBODY_SANDBOX_SESSION_TYPE_ID = "250"
$env:MINDBODY_SANDBOX_PRODUCT_ID = "1424"
```

## Modes

Read-only API-key catalogue connectivity, staff-token issuance/harmless read/revocation, and current fixture discovery:

```powershell
pnpm sandbox:mindbody probe
```

Add two consecutive `Test=true` client-aware quotes and prove neither changed Visits, roster, client schedule, Sales, Transactions, or ClientServices:

```powershell
pnpm sandbox:mindbody quote
```

Perform one committed fictitious Cash purchase-plus-Class Booking for a unique synthetic Client; reconcile the exact Sale, Payment, ClientService, Visit, roster, and client schedule; test cancellation without changing state; cancel the exact Visit; and reconcile removal:

```powershell
$env:MINDBODY_SANDBOX_WRITE_CONFIRM = "BOOK_AND_CANCEL_SITE_-99"
pnpm sandbox:mindbody book-and-cancel
```

The write phrase is deliberately exact. The command still fails if the configured Site is not `-99` or the API origin is not Mindbody's official production-origin sandbox surface.

## Clear the process environment

```powershell
Remove-Item Env:MINDBODY_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:MINDBODY_SANDBOX_USERNAME -ErrorAction SilentlyContinue
Remove-Item Env:MINDBODY_SANDBOX_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:MINDBODY_SANDBOX_SITE_ID -ErrorAction SilentlyContinue
Remove-Item Env:MINDBODY_SANDBOX_CLIENT_ID -ErrorAction SilentlyContinue
Remove-Item Env:MINDBODY_SANDBOX_WRITE_CONFIRM -ErrorAction SilentlyContinue
$mindbodyPassword = $null
```

## Interpretation

A passing run proves the current public-sandbox provider lifecycle. It does not approve a production tender, prove a future Business's settings, or activate production. The output records the API-key-only Sites/Locations/Programs/Class Descriptions/Classes/Services matrix and confirms that the temporary staff token was revoked. Cash may legitimately have a Sale Payment but no separate Transaction row; the runner records `transactionId: null` instead of fabricating one. Site `-99` rejects `AddClient(Test=true)`, so the runner validates required fields and performs one guarded, uniquely identified `Test=false` synthetic Client creation. The runner never replays the committed checkout; duplicate and unknown orchestration remain deterministic repository tests.

The public fixture observed on 2026-08-18 uses Product `1424` for the Yoga mapping. Rediscover it before a later run rather than assuming that identifier is permanent. The live Checkout response places the sale reference at `ShoppingCart.SaleId`; the subsequent Sale item identifies the Mindbody pricing option through `PurchasedItems[].Id` and does not echo the selected Class ID. Revvi therefore snapshots the exact Client/Class Visit and Product-matching ClientService identifiers before Checkout, then confirms only when the returned Sale ID, Mindbody Client, Mindbody pricing option, Cash Payment, a new exact Client Visit, the same new Class roster Visit, and a new exact ClientService all agree. This prevents a new Sale from being joined to an older enrollment. `ClientSchedule` remains a useful corroborating read but is not a Revvi Customer-facing confirmation requirement for this hosted adapter because Site `-99` did not return the designated Mindbody Client's otherwise verified Visit there. It remains part of issue #57's broader evidence checklist, so the hosted acceptance record must report that surface as missing rather than claiming it passed.

Every hosted Site `-99` provider operation obtains a durable Supabase lease before issuing a temporary staff token and releases the lease only after token revocation. The five-minute lease exceeds the adapter's maximum bounded provider-operation time; contention and unconfirmed release fail closed. This serializes tokens across separate Edge requests, not merely within one function instance.

Hosted demo cleanup also requires the current mapping's `cancellation_enabled` gate plus verified `roster_removal` and `authoritative_reconciliation` evidence for the same mapping version. Do not enable that gate from a booking-only test; first complete the targeted Test-then-commit cancellation and authoritative absence read described above.

See [the 2026-08-17 controlled evidence](../testing/mindbody-site-99-e2e-2026-08-17.md) and [the access-model research](../research/mindbody-public-sandbox-access-and-e2e.md).

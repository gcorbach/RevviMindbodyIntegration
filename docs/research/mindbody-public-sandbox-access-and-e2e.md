# Mindbody public sandbox access model and pre-go-live Class journey

Researched: 2026-08-17

Scope: Mindbody Public API V6, public Business sandbox Site `-99`, and the Revvi classes-only implementation. Sources are Mindbody-owned developer material and Mindbody's generated Public API SDK. No credential or token value is recorded here.

## Decision

Revvi can and should prove its classes-only provider journey against public sandbox Site `-99` **before** Mindbody grants live access. A production Business Site is not a prerequisite for this milestone. Mindbody's own onboarding sequence is developer account, sandbox build/test, then go-live approval and activation. [Mindbody Developer Portal](https://developers.mindbodyonline.com/)

The three available pieces are different credentials or contexts:

| Piece | What it is | What it does not do |
| --- | --- | --- |
| Revvi developer API key | A server-side application credential issued for the Revvi developer application. Send it in `Api-Key` on Public API requests. | It does not sign into the Business web application, identify a Revvi Customer, or grant staff permissions. |
| Site ID `-99` | The tenant selector for Mindbody's free public Business sandbox. Send it in `SiteId` on site-scoped requests. | It is not a secret or a Location ID. It does not identify Revvi's future production Business. |
| Sandbox Business/staff login | A staff identity for the Business administration application. With the app key and Site ID, its username/password can be exchanged server-side for a temporary staff user token. | It is not a Revvi Customer login and must never be used as the Revvi Customer identity in a Booking. |

Mindbody's generated SDK documents `API-Key` as the custom authentication header, requires `siteId` on the operations reviewed, and describes `POST /public/v6/usertoken/issue` as the way to obtain a staff user token when staff members interact through an integration. [Mindbody Public API reference](https://developers.mindbodyonline.com/ui/documentation/public-api), [Mindbody-generated Public API SDK](https://github.com/mindbody/Mindbody-API-SDKs)

In practical terms:

```text
Revvi server
  app identity:    Api-Key: <server secret>
  target Business: SiteId: -99
  optional actor:  Authorization: <temporary staff user token>

Revvi Customer
  Memberstack identity -> tenant-scoped Mindbody Client ID
  (never the sandbox staff account)
```

The API key belongs only in Supabase/server configuration. It must not be embedded in Webflow, browser JavaScript, logs, screenshots, evidence files, or a Git commit. Mindbody's developer portal shows `Api-Key` and `SiteId` as the base Public API request context, with `Authorization` added for user-authorized examples. [Mindbody Developer Portal examples](https://developers.mindbodyonline.com/)

## What the API key alone permits

The API key identifies an active developer application/source and gives it access to Public API operations for Sites available to that application. In the free developer environment, that includes public sandbox Site `-99`. It is sufficient for public/consumer-mode inventory reads such as Sites, Locations, Programs, Class Descriptions, Class Schedules, Classes, and Services when the endpoint and Business settings permit them. The official endpoint catalogue lists those site, class, client, and sale capabilities. [Public API endpoint catalogue](https://developers.mindbodyonline.com/Resources/Endpoints)

It is not correct to infer that the key alone grants every field or write:

- Mindbody documents that `GET Classes` can hide capacity fields in consumer mode when no user token is supplied and the Business disables its consumer capacity setting. A staff/source-authorized token can expose those fields regardless of that consumer setting. [API release notes: GetClasses consumer-mode capacity](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- The generated SDK marks the staff authorization header optional for `GetClasses`, `GetClassVisits`, `CheckoutShoppingCart`, `AddClientToClass`, and `RemoveClientFromClass`, but optional at the transport/schema level is not an endpoint-wide permission guarantee. Business configuration, operation mode, and staff permissions still apply. [Mindbody-generated Public API SDK](https://github.com/mindbody/Mindbody-API-SDKs)
- Current Site `-99` evidence confirmed two generated query/response contracts that older Revvi assumptions missed: `GET ClientSchedule` uses `request.clientId`; `GET ClassVisits` uses `request.classID` and exposes the exact roster Visit under `Class.Visits`. Both former assumptions returned incomplete evidence without a transport error, so regression tests must pin these shapes.
- The final controlled responses exposed no request/correlation identifier in the reviewed allowlisted headers. Evidence therefore stores SHA-256 digests of normalized, secret-free request facts and records provider request IDs as unavailable rather than fabricating them.
- Mindbody explicitly enforces the staff **Make Unpaid Reservation** permission when staff credentials/token are supplied to unpaid class/enrollment booking operations. Other operations also have documented staff-permission requirements. [API release notes: unpaid reservations](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- A key or staff token does not authenticate the Revvi Customer. The Revvi Customer is represented by a Mindbody Client selected by `ClientId`/`UniqueClientId`; Revvi derives that mapping from the separately authenticated Memberstack identity.

Therefore, the safe rule is: always send the server-side app key and explicit Site ID; add the least-privilege, short-lived staff token only where the sandbox evidence shows that business-mode authority is required. Record the result endpoint by endpoint instead of declaring the entire API “API-key only” or “staff-token required.”

## How the Business login becomes an API authorization token

Mindbody's current generated V6 SDK documents this exchange:

1. `POST /public/v6/usertoken/issue`
2. Headers: `Api-Key`, `SiteId`, `Content-Type: application/json`
3. JSON body: staff `Username` and `Password`
4. Response: `AccessToken`, `TokenType`, UTC `Expires`, and a `User` object
5. Supply the temporary token in the `Authorization` header on later operations that need it

The password is used only at the token-issuance boundary. The response token represents the staff user and inherits the Business permissions applicable to that user. It is an actor credential, not an additional application key. This staff-token issue request has no OAuth scope parameter; Mindbody's OAuth/consumer-identity mechanisms are separate flows and should not be conflated with it. Mindbody documents renewal as extending the token by 24 hours from the current expiry, up to seven renewals, and provides a revoke operation. [User Token operations in the Mindbody-generated SDK](https://github.com/mindbody/Mindbody-API-SDKs/raw/main/PublicAPI/mindbody-public-api-python_generic_lib.zip), [API release notes: current UserToken issue/renew operations](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)

Credential handling rules:

- Issue, renew, use, and revoke the token only from the server.
- Hold username, password, and token only in process memory or an approved secret store; never put them in request diagnostics or provider evidence.
- Log only safe facts such as issuance success, expiry, redacted user type/ID, endpoint, HTTP status, and provider request ID.
- Revoke the token at the end of a controlled run where practical; otherwise let it expire.
- Do not reuse the public sandbox Business staff account as a production integration pattern. A real activated Business must use the authentication/authorization method Mindbody approves for that Site.

### Authorization-header compatibility check

The generated Mindbody SDK treats the caller's authorization value as the final `Authorization` header value, and Mindbody's public code example also passes a token directly. Revvi's current shared transport in `supabase/functions/_shared/mindbody-http.js` prefixes configured user tokens with `Bearer `. That is a contract difference, even if the sandbox accepts both forms for some operations.

On 2026-08-17, a controlled read used the exact Revvi sandbox application key and Site `-99`. `GET Sites` returned HTTP 200, `POST UserToken/Issue` returned HTTP 200 with a temporary token held only in memory, and a one-client read returned HTTP 200 with both the official direct-token form and Revvi's current `Bearer <token>` form. No key, password, token, or client data was printed or persisted. The current transport is therefore compatible with this public sandbox, although endpoint-specific permission checks remain necessary. [Mindbody Developer Portal examples](https://developers.mindbodyonline.com/), [Mindbody-generated Public API SDK](https://github.com/mindbody/Mindbody-API-SDKs)

## What Site `-99` and the Business web login are

The `/ASP/adm/` page is the Mindbody **Business/studio administration** application. It manages the sandbox studio's clients, schedules, classes, visits, pricing options, sales, and staff. It is not a consumer account or a Revvi Customer sandbox.

Mindbody exposes one free public sandbox and separately sells custom sandboxes with more control and flexibility over Business data. Its developer portal uses Site `-99` throughout public examples. It is therefore reasonable to treat `-99` as shared, fictitious integration test data, but “shared database” is an inference rather than wording Mindbody publishes. It is not a configurable stand-in for an actual Business's production settings. [Mindbody sandbox FAQ](https://developers.mindbodyonline.com/ui/faq), [Mindbody Developer Portal examples](https://developers.mindbodyonline.com/)

The public sandbox is refreshed on an overnight cycle. Mindbody's release notes explicitly refer to the sandbox reset and to preserving updated credentials across that reset. Test data must therefore be treated as disposable and rediscovered at the start of a run. [API release notes: sandbox reset](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)

Consequences:

- Do not build the run around permanent client, class, visit, or sale records.
- Re-read the candidate Class and pricing option immediately before each run; do not assume a previously observed future Class ID still exists.
- Do not edit schedules, pricing, permissions, or shared fixtures merely to make Revvi's test pass.
- Use synthetic client data and disable all email/SMS/receipt flags.
- Expect other developers and the overnight reset to change observable data.
- Sandbox Cash/test tenders and sandbox merchant configuration prove API behavior only. They do not prove a Business's live processor, alternative-payment eligibility, tax rules, or commercial configuration.

## Safe pre-go-live end-to-end evidence plan

The run should prove one exact `Site -> Location -> Class occurrence -> Product -> Client -> Booking/Visit -> cancellation` chain. It should not rely only on HTTP 200 responses.

### Phase 1 — connectivity and auth matrix, no writes

1. Validate that the configured app key can read Site `-99` using `GET Sites`; record only the Site ID/name/currency and provider request ID.
2. Read Locations, Programs, Class Descriptions, future Classes, and online Services with `Api-Key` + `SiteId` only.
3. Issue a staff token without logging the request body or response token.
4. Repeat one harmless read with the temporary authorization token and record whether staff-only/capacity fields differ.
5. Write an endpoint matrix for the exact run: API-key only accepted/rejected, staff token accepted/rejected, and any permission error. Do not probe by repeatedly submitting invalid credentials.

This establishes what the two credentials actually do in Site `-99` instead of relying on a universal assumption.

### Phase 2 — pin one disposable run fixture

1. Select a future, uncancelled, online-viewable Yoga Class within its scheduling window and with available capacity.
2. Pin its exact Site, physical Location, Program, Class Description, Session Type, optional Class Schedule, staff, and Class occurrence IDs for this run.
3. Select exactly one non-discontinued, online Service/Product whose sale and use Location restrictions cover the checkout and Class Locations.
4. Resolve a dedicated synthetic sandbox Client by a run-unique, non-personal identifier. Read Required Client Fields before creation and create it with one guarded `Test=false` call. The current Site `-99` contract rejects `AddClient(Test=true)` with `InvalidParameter` / “Test mode is not allowed for this endpoint,” despite the generated request model exposing `Test`; preserve that observed limitation and do not pretend a preflight occurred. Do not send notifications.
5. Read the client's applicable `ClientServices` before any quote or Booking and record only identifiers, state, expiry, and remaining-use facts needed for comparison.

The previously observed Yoga fixture may be used as a search hint, but no identifier should be trusted until the current run re-reads and validates it.

### Phase 3 — prove quote validation is non-committing

1. Submit `CheckoutShoppingCart` with the exact Client, Product, Class, Locations, `Test=true`, `InStore=false`, tax calculation, location-restriction enforcement, and the sandbox-only fictitious tender required by Site `-99`.
2. Record provider subtotal, discount, tax, and grand total plus a digest of the redacted request facts.
3. Immediately re-read Client Visits, Class Visits/roster, Client Schedule, Sales, and relevant Client Services.
4. Assert that the test cart created no Sale, Transaction, Booking, Visit, or entitlement change.
5. Repeat the quote immediately before the committed sandbox checkout and require the exact expected total.

Mindbody defines `CheckoutShoppingCart(Test=true)` as validation/calculated-total mode in which the transaction does not take place, and `Test=false` as database-affecting. [Checkout Shopping Cart operation](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/checkout-shopping-cart), [Mindbody-generated checkout request model](https://github.com/mindbody/Mindbody-API-SDKs/raw/main/PublicAPI/mindbody-public-api-python_generic_lib.zip)

### Phase 4 — perform one committed sandbox purchase plus Class Booking

1. Use the same synthetic Client, exact Product, exact future Class ID, and sandbox-only non-card tender.
2. Submit one `CheckoutShoppingCart(Test=false)` with `ClassIds` so the purchase and Class Booking are requested together.
3. Never send a real card, invented test PAN/CVV, or production payment token.
4. On a success response, do not mark the journey proven yet. Read the exact Sale, Payment, and any separately exposed Transaction, then read Client Visits, Class Visits/roster, Client Schedule, and Client Services.
5. Require all facts to converge on the same Site, Client, Class, Product, Visit/roster Booking, Sale, Payment, and any Transaction the selected tender exposes. Site `-99` Cash produced a Payment but no separate Transaction row; this is an explicit limitation, not missing evidence to fabricate. Mindbody's June 2026 release notes state that a valid Class ID in `CheckoutShoppingCart` creates the Class Booking with the sale and that the Visit is discoverable through Client Visits and Class Visits. [API release notes: checkout creates Class Booking](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)

If Site `-99` rejects a committed sandbox Cash/non-card checkout, preserve the rejection as evidence and do not substitute a real card. An existing-entitlement `AddClientToClass` or explicitly unpaid Booking may still prove the roster lifecycle, but it must be reported as a fallback lifecycle test—not as proof of purchase-plus-booking.

### Phase 5 — cancel the exact client Booking and reconcile

1. Call `RemoveClientFromClass(Test=true)` first with the exact Client, Class, and Visit IDs, early-cancel mode, and notifications disabled. Assert no state change.
2. Call `RemoveClientFromClass(Test=false)` for that same Visit.
3. Never call `CancelSingleClass`; that cancels the Class occurrence for every attendee rather than removing the synthetic Client.
4. Re-read Client Visits, Class Visits/roster, Client Schedule, and Client Services until the cancellation converges or the bounded reconciliation window expires.
5. Record entitlement use/restoration separately from Booking cancellation. Do not infer a refund, returned sale, or restored visit merely because the roster entry disappeared.

Mindbody documents `Test=true` on `RemoveClientFromClass` as validation without affecting data and supports `VisitId` to target the specific Visit. [Remove Client From Class operation](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/remove-client-from-class), [Mindbody-generated removal request model](https://github.com/mindbody/Mindbody-API-SDKs/raw/main/PublicAPI/mindbody-public-api-python_generic_lib.zip)

### Phase 6 — manual Business-UI confirmation and cleanup

Use the Business web application only as a second view of the authoritative API evidence:

- Find the synthetic Client.
- Confirm the Class roster/Visit appeared after the committed Booking.
- Confirm it is cancelled/removed afterward.
- Confirm the sandbox sale and any pricing-option state separately.
- Revoke the staff token and discard every local secret/token value.

The API read-back remains the automated acceptance oracle; the Business UI screenshot is supporting evidence and must redact names, email, credentials, and unrelated sandbox clients.

## Evidence required to call the sandbox journey complete

- App-key-only connectivity to Site `-99` and a documented endpoint auth matrix.
- Temporary staff token issuance/use/revocation with no secret material persisted.
- One current, fully identified Yoga Class and matching online Product.
- One synthetic, non-personal sandbox Client.
- A `Test=true` quote and immediate re-quote with no resulting write.
- A `Test=false` sandbox purchase-plus-Class request using no real card.
- Exact provider read-back for Sale/Transaction, Booking/Visit/roster, schedule, and entitlement facts—or an explicit provider rejection if public sandbox commerce cannot commit.
- A targeted `RemoveClientFromClass` and authoritative post-cancellation read-back.
- Redacted request/response digests and provider request IDs sufficient to reproduce or audit the run.

This evidence is appropriate for the Mindbody go-live submission. It proves the Revvi integration can operate against Mindbody's sandbox and separates app identity, Business authority, and Revvi Customer identity correctly.

It does **not** prove that a future Business has activated Revvi, configured the Revvi-only Offer, enabled an approved live payment method, or accepted operational terms. Those are post-approval Business activation/pilot gates, not reasons to block the public-sandbox end-to-end milestone.

## Repository implications

- GitHub issue `#55` is the correct immediate pre-go-live milestone: prove Site `-99` end to end.
- Issue `#41` should not require a production Business before Mindbody approval. Its production-Business portion belongs after approval/Site activation; any pre-approval acceptance criterion should be satisfied by the Site `-99` report.
- The current quote adapter already exercises a client-aware `CheckoutShoppingCart(Test=true)` and must remain test-only for its Cash tender.
- The `Authorization` header-format difference described above is resolved for Site `-99`: both forms were accepted by the controlled harmless read. Keep the current transport and continue endpoint-specific permission testing.
- The committed sandbox run must be feature-gated and impossible to point at a production Site accidentally.

## First-party sources

- [Mindbody Developer Portal and sandbox/go-live sequence](https://developers.mindbodyonline.com/)
- [Mindbody Public API V6 reference](https://developers.mindbodyonline.com/ui/documentation/public-api)
- [Mindbody Public API endpoint catalogue](https://developers.mindbodyonline.com/Resources/Endpoints)
- [Mindbody API FAQ: public versus custom sandbox](https://developers.mindbodyonline.com/ui/faq)
- [Mindbody API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- [Mindbody-owned generated SDK repository](https://github.com/mindbody/Mindbody-API-SDKs)
- [Mindbody-generated Public API Python SDK archive](https://github.com/mindbody/Mindbody-API-SDKs/raw/main/PublicAPI/mindbody-public-api-python_generic_lib.zip)

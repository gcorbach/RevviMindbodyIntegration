# Mindbody Site -99 classes-only end-to-end evidence

Observed: 2026-08-17

Environment: Mindbody public Business sandbox Site `-99`

Scope: Direct Public API provider journey. Secrets, temporary tokens, client identity, and raw provider bodies are omitted.

## Result

The controlled provider journey passed from current Class discovery through quote, committed sandbox purchase-plus-Booking, authoritative Visit read-back, test cancellation, committed cancellation, and final read-back.

This proves that Revvi's developer application can exercise the classes-only provider lifecycle before Mindbody grants production access. It does not prove Webflow/Memberstack integration, a production merchant route, or a production Business Site.

The provider run is paired with the repository's local application evidence rather than mislabeled as one live external chain. All 183 application tests passed, covering Webflow Offer/Location binding, Memberstack eligibility denial, quote/requote, idempotent Booking orchestration, unknown reconciliation, paid return handling, Revvi Customer history, and cancellation UI. All 386 database tests passed and schema lint reported no errors. Memberstack remains a local/test Revvi Customer identity boundary because no Memberstack test credentials were supplied for this pre-go-live run.

## Authentication evidence

| Check | Result |
| --- | --- |
| API-key-only `GET Sites`, Classes, and applicable Services for Site `-99` | HTTP 200 |
| `POST UserToken/Issue` using the sandbox staff identity | HTTP 200; token held only in process memory |
| Harmless one-client read with direct token in `Authorization` | HTTP 200 |
| Same read with Revvi's current `Bearer <token>` form | HTTP 200 |
| `DELETE UserToken/Revoke` after the controlled run | HTTP 200; token discarded |

The API key value, staff credentials, returned token, and client data were neither printed nor persisted.

The final guarded repository command was run live in `book-and-cancel` mode after its delayed-visibility, failure-cleanup, and token-revocation tests passed. It used a unique synthetic Client and passed with cart `3e776018-af3f-4778-8760-405daa3b2692`, Sale `100170591`, Cash Payment `168233`, ClientService `100257607`, Visit `100343812`, no separate Transaction ID, exact Client Visit/Class roster/Client Schedule evidence, a preserved Visit after test cancellation, confirmed removal after committed cancellation, and staff-token revocation. The command is locked to Site `-99` and the official API origin.

## Disposable run scope

The run rediscovered the current fixture rather than trusting an old Class occurrence:

- Location `1`
- Program `27` (`Yoga`)
- Class Description `223` (`Yoga`)
- Session Type `250` (`Hatha Yoga`)
- Class Schedule `2152`
- staff `100000285`
- committed Class occurrence `19364`
- online Service/Product `1431`
- provider-calculated grand total `$13.00 USD`
- run-unique, non-personal synthetic Client; identifier omitted

These identifiers are fictitious sandbox data and may change after a reset.

## Quote and no-write proof

1. A fresh eligible Yoga occurrence and exact applicable online Product were read from Site `-99`.
2. Two consecutive `CheckoutShoppingCart(Test=true)` calls used `InStore=false`, tax calculation, Location restrictions, notifications disabled, the exact Product and Class IDs, and the sandbox Cash tender.
3. Both returned HTTP 200 with subtotal `$13.00`, discount `$0.00`, tax `$0.00`, and grand total `$13.00`.
4. Before/after reads of Client Visits, Class roster, Client Schedule, Sales, Transactions, and ClientServices were identical.

The normalized quote request digest was `8a8281b3eb7966af5f337bcc7798cc431e3a9a3188613c93655ac1eb0bad9e88`. Site `-99` returned no provider request/correlation identifier in the reviewed response headers; the runner records that field as `null` rather than inventing a reference.

The Test cart therefore calculated the client-aware price without creating a Class Booking.

## Committed sandbox purchase and Booking

The immediate quote was followed once by `CheckoutShoppingCart(Test=false)` using the same Client, Product, Class, Location, total, and fictitious Cash tender. The request was not replayed.

| Fact | Observed evidence |
| --- | --- |
| Checkout | HTTP 200 |
| Shopping cart | `3e776018-af3f-4778-8760-405daa3b2692`; normalized request digest `15c65c42213b694a24a34a4b2eef31a2e3d430f5ea8c4f616975f0dc83e57696` |
| Sale | `100170591`, exact Product `1431`, not returned |
| Payment | `168233`, Cash, `$13.00` |
| Transaction | No separate Transaction ID or `GET Transactions` row was exposed for this Cash sale |
| ClientService | `100257607`, exact Product `1431`; consumed one-session state was `Current=false`, `Remaining=0` |
| Class Visit | `100343812`, exact Class `19364` on Client Visits, Class roster, and Client Schedule |

Site `-99` exposes the Class roster under `Class.Clients` rather than only top-level `Visits`. The checkout response, Sale/Product/payment facts, consumed ClientService, exact Client Visit, roster, and client schedule jointly prove that this sandbox purchase created the requested Class Booking. The absent Cash Transaction is recorded as a provider limitation, not fabricated or treated as a card/processor result.

## Cancellation proof

1. `RemoveClientFromClass(Test=true)` targeted the exact Client, Class, and Visit, disabled notifications, and returned HTTP 200.
2. An immediate `GET ClientVisits` reread showed the exact Visit still active.
3. `RemoveClientFromClass(Test=false)` used the same identifiers and returned HTTP 200.
4. The final authoritative rereads no longer returned the exact Visit on Client Visits, the Class roster, or Client Schedule.
5. The exact ClientService changed to `Current=true`, `Remaining=1`, proving restoration for this one-session fixture. The Sale remained not returned and its Cash Payment remained recorded, so no refund is claimed.

The normalized exact-cancellation request digest was `fb14a16f3e97b30baa0215f2f808411a0d13605d9f881ec2c78a6b35580eff05`. As with checkout, Site `-99` exposed no provider request ID header, which is recorded explicitly as unavailable.

This proves targeted Revvi Customer Booking cancellation and exact entitlement restoration for this one-session sandbox fixture. No class-wide cancellation endpoint was called, and no refund or returned Sale is claimed.

## Boundaries and follow-up

- Cash is a fictitious public-sandbox tender. This is not evidence that Cash or any other payment route is approved for production.
- The Sale exposes a Payment record but no separate Cash Transaction record. Sandbox reconciliation must preserve that distinction.
- The public sandbox can reset and is less controllable than a custom sandbox; every run must rediscover current Class inventory.
- Site `-99` rejects `AddClient(Test=true)` although the generated request model exposes `Test`; the guarded runner reads required fields and creates one unique synthetic Client with `Test=false`.
- `GET ClientSchedule` requires the generated nested query name `request.clientId`; the live run caught and corrected the former `ClientIds` assumption.
- `GET ClassVisits` requires `request.classID` and returns the roster under `Class.Visits`; the live run caught and corrected the former `ClassId`/top-level-Visits assumption.
- The runner deliberately does not replay a committed checkout. Duplicate and ambiguous-outcome behavior is covered by local orchestration tests so a safety drill cannot create a second real sandbox charge/Booking.

## Sources

- [Mindbody Public API V6 reference](https://developers.mindbodyonline.com/ui/documentation/public-api)
- [Mindbody API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- [Mindbody public versus custom sandbox FAQ](https://developers.mindbodyonline.com/ui/faq)
- [Mindbody-generated SDKs](https://github.com/mindbody/Mindbody-API-SDKs)

# Mindbody Business setup for a Revvi-specific Class Offer

Researched: 2026-08-08
Scope: first-party Mindbody developer, webhook, FAQ, and business-support material only. The current operation pages in the Public API portal are authoritative for request/response schemas; several business-support pages did not expose their article bodies without an authenticated browser session, so this report does not invent exact Core UI click paths.

## Decision summary

A partner Business can configure the commercial and scheduling ingredients that Revvi needs: an activated Mindbody Site, a selected Location, an online-visible scheduled Class, and one or more approved pricing options or another explicit entitlement arrangement. Revvi can then discover Site, Location, class taxonomy, Class occurrence, pricing-option, client-pass, roster, Visit, sale, and transaction identifiers through Mindbody APIs.

The first Revvi pilot uses **one shared pricing option across the Offer's Class families** at one Location, while the schema permits a reviewed Product set for future formats. Revvi should store `Services[].ProductId` as the commercial key and `Class.Id` as the occurrence key. It must not use a displayed name, `Service.Id`, or barcode as a substitute. Existing client entitlements must be resolved to an exact client-service/pass record before booking.

Partner configuration does **not** by itself establish a compliant paid checkout. Mindbody documents API-driven checkout and SCA/alternative-payment redirects, but the reviewed first-party material does not establish a general Mindbody-hosted checkout that keeps every raw-card field out of Revvi. Paid Offers therefore remain gated on a written Mindbody-approved payment route plus sandbox proof. An existing-pass or explicitly approved free/unpaid mode is technically better bounded, but its exact authentication/permission behavior must also be sandbox-proven.

## Verified facts

### Connection, Business, and Location

- Public API production onboarding is ordered: create a developer account, build in the sandbox, obtain Mindbody go-live approval, request a **site-specific activation code/link**, and have the Business owner activate it. This authorizes Revvi's application for that Business; the Business should not give Revvi staff credentials or an API key. [Public API getting started](https://developers.mindbodyonline.com/ui/documentation/public-api)
- Mindbody's API and commercial model is based on Site ID. One Site ID may represent one or several Locations, so Site and Location are separate authorization/configuration facts. [Mindbody API FAQ](https://developers.mindbodyonline.com/ui/faq)
- The Public API exposes Site/location information, Programs, Session Types, class schedules/classes, class registration, pricing options, packages, purchases, client visits, and staff permissions. [Public API endpoint catalogue](https://developers.mindbodyonline.com/Resources/Endpoints)
- A Location has its own ID and tax fields, and a Class Schedule is tied to `siteId`, `locationId`, `classScheduleId`, and `classDescriptionId`. A single Class occurrence has `classId`, `classScheduleId`, `locationId`, `classDescriptionId`, timestamps, cancellation state, online-viewing intent, staff, and waitlist state. [Webhooks API: Location, Class Schedule, and Class events](https://developers.mindbodyonline.com/WebhooksDocumentation)

### Class inventory and visibility

- Mindbody distinguishes a Class Schedule (the recurring group) from a Class (one occurrence at a specific date/time). Revvi must book the occurrence's `Class.Id`, not the schedule ID. [Webhooks API: Class Schedule and Class](https://developers.mindbodyonline.com/WebhooksDocumentation)
- Class Schedule capacity includes both `maxCapacity` and `webCapacity`. The Class event exposes whether a Class is intended for online viewing and whether waitlisting is available. [Webhooks API](https://developers.mindbodyonline.com/WebhooksDocumentation)
- In unauthenticated/consumer mode, `GET Classes` no longer returns hidden classes. When the Business disables “Consumer Mode Show # Open Class Spaces,” capacity fields can be `null`; a staff/source-authenticated response may still include them. Revvi must not infer a numeric remaining capacity from missing values. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- Booking windows are Business-configured restrictions; a booking outside the configured window fails. This platform behavior is documented for Mindbody subscribers, but the Affiliate API's request/response schema is not evidence for the Public API schema. [Affiliate API: Bookings and Booking Windows](https://developers.mindbodyonline.com/AffiliateDocumentation)
- Mindbody's class model links the occurrence through its Class Description to Program and Session Type concepts. The current Public API operation schemas for `GET Programs`, `GET Session Types`, `GET Class Descriptions`, `GET Class Schedules`, and `GET Classes` must be captured during integration validation; names are display data, not stable authorization keys. [Public API V6 reference](https://developers.mindbodyonline.com/ui/documentation/public-api)

### Pricing option, package, free, and entitlement facts

- `GET Services` is Mindbody's pricing-option read. Mindbody added `SellOnline`, `Membership`, and `IsIntroOffer`, and later included options marked “only sell in contract or package.” These flags affect discovery/sale behavior and must be preserved rather than replaced with Revvi assumptions. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- `ProductId` and `BarcodeId` can differ; Mindbody explicitly fixed `Update Services` validation for that case. A dedicated Offer mapping must therefore store the returned `Services[].ProductId`, not barcode and not a name-derived value. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- Class-roster webhooks define `itemId` as the Business's pricing-option ID and explicitly equate it to `Services[].ProductId`. They separately expose `clientPassId`, which may be `null`, and pass session/activation/expiration facts. [Webhooks API: `classRosterBooking.created`](https://developers.mindbodyonline.com/WebhooksDocumentation)
- `GET ClientServices` returns client-owned services/passes and `ProductId`, allowing them to be related to `GET Services`. Mindbody also returns activation behavior and enforces configured activation, expiry, session, membership, Program, and Location restrictions. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- Location restrictions on pricing options are real provider rules; Mindbody has corrected cross-regional cases where those restrictions were bypassed. Revvi should select an entitlement only when Mindbody says it is valid for the selected Location and class Program. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- Mindbody exposes packages and contracts as distinct concepts in addition to pricing options. A purchased pricing option becomes a pass in the client's account; a package/contract may contain or govern pricing options, so Revvi must map the final usable pricing option/pass as well as any package/contract product. [Public API endpoint catalogue](https://developers.mindbodyonline.com/Resources/Endpoints), [Affiliate API: bookings](https://developers.mindbodyonline.com/AffiliateDocumentation)
- A free/unpaid reservation is a distinct operation mode. When staff credentials/token are used, `AddClientToClass` respects the staff **Make Unpaid Reservation** permission and rejects the write when that permission is absent. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)

### Quote, booking, cancellation, and reconciliation

- `CheckoutShoppingCart(Test=true)` exists, includes provider tax/total calculation behavior, and has had fixes for rounding and tax rates. Its `CalculateTax` capability confirms that the provider—not Revvi—can calculate the authoritative cart total. A Test cart is not a live purchase or Booking. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes), [current `CheckoutShoppingCart` operation](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/checkout-shopping-cart)
- As of June 2026, `CheckoutShoppingCart` can create a Class Booking alongside a sale when given a valid Class ID; the resulting Visit can be found through `GET ClientVisits` and `GET ClassVisits`. This is the strongest documented paid-booking candidate, but the exact cart/payment schema and commercial authorization still require validation. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- `AddClientToClass` creates the roster Booking; Mindbody added booking-request deduplication and fixed confirmation email/SMS when `SendEmail=true`. Provider deduplication is useful but does not replace Revvi's durable idempotency and unknown-outcome handling. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes), [current `AddClientToClass` operation](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/add-client-to-class)
- `RemoveClientFromClass` accepts a Visit ID so a specific client Visit can be removed. Mindbody has documented cases where cancellation returned a server error while still taking effect, so any timeout/5xx must be reconciled by reading the roster/Visit before retry. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes), [current `RemoveClientFromClass` operation](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/remove-client-from-class)
- Class-roster created, status-updated, and cancelled webhooks carry Site, Location, Class, roster Booking, Client, `itemId`/Product, and client-pass references. They are reconciliation signals, not a substitute for a local idempotent attempt ledger and follow-up reads. [Webhooks API](https://developers.mindbodyonline.com/WebhooksDocumentation)

### Client identity and payment constraints

- Client IDs are Site-scoped public identifiers; `clientUniqueId` is system-generated, immutable, and unique for the Business. Revvi should persist both returned identifiers against the Revvi Customer and Site. [Webhooks API: Client events](https://developers.mindbodyonline.com/WebhooksDocumentation)
- Mindbody prevents creation of a duplicate Client with the same first name, last name, and email and returns a V6 `InvalidClientCreation` error. Existing ambiguity still requires fail-closed resolution rather than automatic merging. Home Location defaults to the first active Location if omitted, so Revvi should explicitly provide/validate the selected active Home Location where the current operation permits it. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- Public API payment is integration-driven. For SCA, the API may return bank `AuthenticationUrl` values and requires the integration to retain transaction state and make a second checkout call; the callback alone does not establish purchase success. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- Mindbody supports Public API alternative-payment flows, including Apple Pay when enabled by the Business in its payments portal, but the reviewed public material does not establish a generic hosted checkout page or opaque browser tokenization contract for Revvi. Raw PAN/CVV must therefore remain disabled unless Mindbody supplies and approves a specific no-raw-card contract. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- Card processing through the Public API depends on the Business having an active Mindbody merchant account and a supported processor/country combination. [Mindbody API FAQ](https://developers.mindbodyonline.com/resources/faqs)
- Mindbody's API terms prohibit caching Mindbody-derived data for more than 48 hours and specifically restrict collecting, storing, transferring, or using cardholder data and other personal data. Revvi must keep API credentials server-side, never persist PAN/CVV, and obtain Mindbody's written approval for the minimum durable Booking references it needs. [Mindbody API Terms of Use](https://developers.mindbodyonline.com/Resources/DeveloperAgreement)
- `GET Sites` exposes a nullable `PerStaffPricing` flag when one Site ID is requested. `CheckoutShoppingCart` supports provider tax calculation. Revvi must quote against the selected Site, Location, Class, staff, client, and pricing option rather than caching a flat advertised amount. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)

## Recommended Business/admin setup (inference from the verified model)

These are implementation recommendations, not claims that Mindbody documents this exact “Revvi Offer” workflow.

1. **Activate Revvi's application for the Business Site.** The authorised Business owner completes Mindbody's site-specific activation; Revvi reads and records the returned Site and selected Location IDs.
2. **Choose one already scheduled class inventory set at one Location.** Record exact Program, Class Description, Session Type, and (where deliberately narrow) Class Schedule IDs returned by Public API. Do not authorize by the word “Yoga.” Require each returned occurrence to match the Site, Location, active/visible state, and configured identifier intersection.
3. **Configure the class for customer booking.** The Business makes the intended schedule/class online-visible, sets web capacity, booking/open-close windows, waitlist policy, cancellation window, online cancellation behavior, and confirmation settings. Revvi validates the observed `GET Classes` behavior anonymously and client-aware.
4. **Create a dedicated Offer arrangement.** Preferred pilot: a clearly named pricing option such as “Revvi — Yoga — [Location]”, with the agreed price/visit count, activation/expiry, tax treatment, sale/use Location restrictions, and assignment only to the intended class category/inventory. If the commercial deal is a package or contract, record that container separately and still identify the actual usable pricing option/pass.
5. **Decide one fulfilment mode per Offer.** Store an enum such as `existing_client_service`, `purchase_pricing_option_and_book`, or `approved_unpaid`; never choose dynamically from whatever Mindbody happens to return.
6. **Verify the identifiers server-side.** Persist Site ID, Location ID, inventory allowlist IDs, `Services[].ProductId`, any package/contract ID, and the exact ClientService/pass ID used for an individual Booking. Keep Service ID, barcode, names, and Webflow values as non-authoritative metadata only.
7. **Validate provider pricing.** Run a client-aware `Test=true` cart/re-quote using the selected Class and Product; record subtotal, provider discounts, taxes, total, staff/location effects, and expiry. Re-run immediately before any live purchase.
8. **Prove one complete sandbox journey.** Create/resolve Client, obtain/purchase the approved entitlement, create the Class roster Booking, read it through class/client visits, cancel it, verify pass restoration separately, and reconcile webhooks. Repeat against the real Business configuration before activation.

## Exact identifiers Revvi should persist

| Concern | Provider identifier | Use |
| --- | --- | --- |
| Business authorization | `SiteId` | Tenant/provider boundary |
| Selected branch | `Location.Id` | Fixed Webflow Booking context and provider restriction |
| Inventory taxonomy | `Program.Id`, `ClassDescription.Id`, `SessionType.Id` | Explicit configured inventory allowlist; never names |
| Recurring schedule | `ClassSchedule.Id` | Optional narrowing/reconciliation; not the occurrence Booking key |
| Class occurrence | `Class.Id` | Availability choice and Booking target |
| Pricing option | `Services[].ProductId` | Authoritative Offer commercial mapping and webhook `itemId` |
| Non-authoritative aliases | `Service.Id`, `BarcodeId`, names | Diagnostic/display only; do not substitute for ProductId |
| Revvi Customer at Site | Client public ID/RSSID plus `clientUniqueId` | Client matching and reconciliation |
| Owned entitlement | exact ClientService/pass ID plus its `ProductId` | Explicit pass selection and restoration tracking |
| Confirmed roster state | Visit ID and class-roster Booking ID | Cancellation and reconciliation |
| Payment | sale, transaction, payment, authentication IDs | Quote/purchase state; store separately from Booking/Visit |

## Unresolved questions requiring Mindbody API Support and controlled sandbox evidence

1. Which API product and authentication mode does Mindbody approve for Revvi's Memberstack-authenticated B2B2C Class Booking use case: API key/Site activation only, OAuth consumer identity, or a staff/source token for each operation?
2. Provide an endpoint-by-endpoint auth/permission matrix for `GET Services`, `GET ClientServices`, `CheckoutShoppingCart(Test/live)`, `AddClientToClass`, `RemoveClientFromClass`, roster/Visit reconciliation, and webhooks. Confirm whether normal paid/existing-pass customer Bookings need a staff token. Confirm the current 2026 cancellation permission requirements for removing one client from a Class, distinct from cancelling an entire Class.
3. Does the current V6 `AddClientToClass` contract allow Revvi to submit an explicit `ClientServiceId` for deterministic pass selection? If not, what supported operation atomically binds the intended ClientService to the Class Visit, and how should multiple eligible passes be handled?
4. For a new paid pricing option, is `CheckoutShoppingCart` with `ClassIds` the approved atomic purchase-and-roster route for this use case? Which request field accepts `Services[].ProductId`, and must any `Service.Id` or barcode also be supplied?
5. What no-raw-card payment method is approved in South Africa and for the pilot Business's processor: Apple Pay/other alternative payment, a Mindbody-hosted or opaque token flow, a saved Mindbody payment method, or none? Supply test fixtures and confirm PCI boundaries in writing.
6. Which Business-side pricing configuration makes the dedicated option available to Public API checkout while keeping it exclusive from ordinary Mindbody consumers if exclusivity is required? Confirm interactions among `SellOnline`, “only sell in contract/package,” membership restrictions, promo codes, and Public API `InStore`/consumer mode.
7. Confirm the precise Core UI setup and API effect for sale Location versus use Location restrictions, taxes, activation/expiry, number of visits, Program/class applicability, intro restrictions, and per-staff pricing. Confirm which returned fields prove each rule.
8. For a package deal, identify whether Revvi purchases a Package, Contract, or pricing option, the corresponding endpoint, and the resulting `ClientServiceId`/ProductId relationship. Confirm cancellation restoration and refund behavior for each arrangement.
9. For a free/unpaid Offer, confirm the approved authentication mode and whether **Make Unpaid Reservation** is necessary; identify how Revvi can distinguish a deliberate free arrangement from an accidental unpaid Visit.
10. Confirm required Client fields for this Business and mode, waiver/signature behavior, duplicate/cross-regional resolution, Home Location rules, and whether Revvi may create the Client without collecting data beyond Memberstack's profile.
11. Confirm booking-window, web-capacity, hidden-Class, waitlist, cancellation, late-cancel, no-show, notification, and pass-restoration behavior through Public API for the pilot Site. Supply the Business-admin support instructions that govern those settings.
12. Confirm webhook delivery/retention expectations and the durable-storage classification allowed for Site, Client, Class, Visit, roster, ClientService/Product, sale, and transaction references.

## Pilot activation evidence checklist

- Mindbody go-live approval and Site activation record.
- Exact Site and Location IDs returned by Public API.
- Captured Program/Class Description/Session Type/Class Schedule allowlist and sample eligible/ineligible Class IDs.
- Dedicated pricing-option screenshot/export plus matching `GET Services` response showing `ProductId`, flags, price/tax, and restrictions.
- Client-aware `GET ClientServices` evidence for a usable and unusable entitlement, including exact ClientService/pass ID.
- `Test=true` provider quote and immediate re-quote evidence.
- Written approved payment/auth route, or explicit existing-pass/free-mode approval.
- Controlled roster Booking with Class, Visit, roster Booking, Product, ClientService/pass, sale/transaction references separated.
- Controlled cancellation plus separately verified pass restoration/refund state.
- Webhook and polling convergence evidence, including a simulated ambiguous write.

## First-party sources

- [Mindbody Public API V6 getting started and current operation reference](https://developers.mindbodyonline.com/ui/documentation/public-api)
- [Mindbody Public API endpoint catalogue](https://developers.mindbodyonline.com/Resources/Endpoints)
- [Mindbody API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- [Mindbody Webhooks API documentation](https://developers.mindbodyonline.com/WebhooksDocumentation)
- [Mindbody API FAQ](https://developers.mindbodyonline.com/ui/faq)
- [Mindbody API Terms of Use](https://developers.mindbodyonline.com/Resources/DeveloperAgreement)
- [Mindbody Affiliate API documentation](https://developers.mindbodyonline.com/AffiliateDocumentation) — used only for first-party platform behavior around Business-configured booking windows and passes, not as the Public API schema.
- [Mindbody Support: find the product ID for a pricing option](https://support.mindbodyonline.com/s/article/How-to-find-the-product-ID-for-a-pricing-option?language=en_US)
- [Mindbody Support: pricing-option management](https://support.mindbodyonline.com/s/article/How-to-edit-pricing-options-on-the-Pricing-screen?language=en_US)
- [Mindbody Support: membership restrictions](https://support.mindbodyonline.com/s/article/203268453-Setup-membership-restrictions-for-classes-products-pricing-options-and-contracts-packages?language=en_US)
- [Mindbody Support: off-peak classes and pricing](https://support.mindbodyonline.com/s/article/209557468-Classes-How-to-create-off-peak-classes-and-pricing?language=en_US)

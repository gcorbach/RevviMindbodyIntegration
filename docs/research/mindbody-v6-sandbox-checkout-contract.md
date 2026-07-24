# Mindbody Public API V6 sandbox checkout contract

Researched: 2026-07-21  
Scope: Mindbody-owned Public API V6 documentation, release notes, and the repository's recorded sandbox observations. This replaces neither a real sandbox checkout execution nor production certification.

## Decision

The documented V6 evidence is sufficient to build the **server-side, feature-gated checkout orchestration**, but not to claim that an `Api-Key` + `SiteId` pair alone is an approved, complete customer card-payment contract. In particular, the public material reviewed does not publish test PAN/CVV fixtures, a browser tokenisation/hosted-field contract, or an endpoint-by-endpoint auth/permission matrix.

Do not send a real PAN/CVV. Implement the request model only from the current portal operation schema at build time, then execute `Test: true` with sandbox-only data and preserve the resulting request/response evidence.

## What the official documentation proves

| Subject | Docs-proven fact | Consequence |
| --- | --- | --- |
| Request context | Public API requests use `Api-Key` and target `SiteId`; Mindbody also documents optional user/OAuth authorisation for operations that require it. The published material does not say those two headers alone authorise every sale or appointment operation. [Public API reference](https://developers.mindbodyonline.com/ui/documentation/public-api) | Keep an operation-specific optional authorization-token capability. Do not code an API-key-only guarantee. |
| Checkout endpoint | `POST /sale/checkoutshoppingcart` is the Public API endpoint for completing service/product purchases. The current operation reference is the authoritative schema, including its cart, payment, `ClassIds`, `VisitIds`, and test-mode fields. [Checkout Shopping Cart](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/checkout-shopping-cart) | Use the portal schema rather than guessing field names/types or copying a third-party SDK. |
| Test mode | Mindbody release notes explicitly refer to `CheckoutShoppingCart(Test=true)` and a test/in-store response fix. This proves a `Test` checkout mode exists; it does **not** document a payment fixture or guarantee that every tender works in the public sandbox. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes) | First checkout execution must be sandbox-only and `Test: true`; treat unsupported tender/error results as evidence, not as a reason to substitute real cards. |
| Booking attached to sale | The project’s official-source consolidation records the V6 checkout reference as supporting a purchase with `ClassIds`, and reconciliation of unpaid visits with `VisitIds`. It does not establish universal atomicity or the exact appointment-link representation. [Checkout Shopping Cart](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/checkout-shopping-cart) | For a class flow, prefer one proven checkout-plus-class request. For appointments, do not infer that `ClassIds` applies; verify the current portal schema and sandbox response. |
| Card/tender fields | The current checkout operation documents credit-card, stored-card, and other payment types; the Public API FAQ limits API card processing to studios with an active Mindbody merchant account and supported processor/country combination. Neither source establishes a Revvi-safe browser card collection method. [Checkout Shopping Cart](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/checkout-shopping-cart), [API FAQ](https://developers.mindbodyonline.com/resources/faqs) | A raw-card field in the server API schema is not permission to transmit it through Revvi. Keep raw-card checkout disabled pending a documented opaque/redirect/saved-card path. |
| SCA | For SCA-capable credit-card payments, `ConsumerPresent` and `PaymentAuthenticationCallbackUrl` are documented. First checkout can return `Transactions` containing `TransactionID` and optional `AuthenticationUrl`; redirect the consumer to every required challenge, then repeat checkout with **all** relevant `TransactionIDs` to capture. If no challenge is returned, no second checkout is required. [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes) | Persist a pending attempt and transaction IDs server-side; do not mark paid/confirmed from the callback alone. |
| AddAppointment | `POST /appointment/addappointment` is a V6 endpoint. Release notes explicitly distinguish consumer and staff/business-mode behavior, and a staff-user-token permission is documented for certain other endpoints; the public material reviewed does not provide a universal "API key only" auth statement for AddAppointment. [Add Appointment](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/appointment/add-appointment), [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes) | Treat AddAppointment authentication as mode-dependent until exercised against the sandbox contract. Do not introduce staff credentials into the customer flow merely because staff mode exists. |

## Sandbox-proven observations already recorded

These are local, historical observations—not claims made by Mindbody documentation.

- A sandbox request to `POST /appointment/addappointment` with only `Api-Key` and `SiteId` headers (no user token), a single appointment object, and `Test: true` succeeded. The obsolete `AddAppointmentRequests` wrapper was rejected. [Sandbox validation record](../testing/mindbody-sandbox-payment-validation.md)
- The repository has **not** executed `CheckoutShoppingCart`; therefore no checkout cart shape, tender, SCA response, appointment linkage, or `Test: true` result is sandbox-proven yet. [Sandbox validation record](../testing/mindbody-sandbox-payment-validation.md)

## Explicitly unknown from official V6 material

1. Supported sandbox PAN, CVV, expiry, stored-card fixture, and any test-only payment-method ID.
2. Whether the sandbox Site's merchant configuration accepts a card/alternative payment in `Test: true` mode.
3. The exact current checkout `PaymentInfo`/payment-item shape and mandatory fields without reading the live portal operation schema; release notes are not a substitute for that schema.
4. Whether `Api-Key` + `SiteId` alone is sufficient for customer checkout, and which permissions/token are required if it is not.
5. An API-supported browser tokenisation, hosted-fields, or generic hosted-checkout mechanism that keeps PAN/CVV out of Revvi.
6. The exact correct sequence for **paid appointments** (create appointment before sale, sale before appointment, or a single cart link) and its atomicity.

## Sandbox next step

Use the V6 portal's current generated request example as the fixture source; make one `Test: true` checkout only after selecting a sandbox-supported non-sensitive payment method. Record redacted headers, request keys/types (never values for secrets or card data), response, and whether `Transactions` requires the SCA second call. If the portal does not supply a usable sandbox tender fixture, retain paid checkout as disabled: the V6 sources do not license inventing one.


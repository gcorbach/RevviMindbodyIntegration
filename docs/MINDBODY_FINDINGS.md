# Mindbody Integration Findings

**Project:** Revvi × Mindbody Public API integration  
**Updated:** 2026-07-18  
**Scope:** Consolidation of the original findings and the four Phase 0 research reports  
**Production status:** No sandbox request was performed during Phase 0. Nothing in this document is sandbox-confirmed.

This document supersedes the earlier findings file. It removes repeated research tasks, incorporates the Phase 0 results, and keeps uncertain or correspondence-only conclusions explicitly qualified. Affiliate API and Consumer API behavior are not used as evidence for Public API V6 behavior.

## 1. Evidence rules

| Label | Meaning |
|---|---|
| **Confirmed — official documentation** | Directly supported by current Mindbody-owned documentation, its official generated Public API SDK, release notes, Webhooks documentation, terms, security policy, or pricing pages. |
| **Confirmed — correspondence record** | Recorded in the prior findings as Mindbody correspondence, but the underlying email/ticket was not supplied and could not be independently verified. |
| **Inferred** | A defensible implementation conclusion drawn from confirmed evidence, but not stated by Mindbody for Revvi’s exact use case. |
| **Unconfirmed** | Not established by available documentation, correspondence, or testing. |
| **Requires Mindbody response** | Material product, contractual, billing, authentication, or runtime behavior that needs a written answer. |
| **Requires sandbox verification** | Runtime behavior that must be demonstrated with controlled fixtures before production. |

Later or endpoint-specific official material is preferred over older general FAQs, but a conflict is recorded rather than silently resolved. A historical release-note fix is evidence of a risk or narrow behavior, not proof that the old defect persists.

## 2. Executive conclusion

- **Public API V6.0 is the technically appropriate API.** “Consumer Bookings” is a Public API commercial category; it is not the separate Mindbody Consumer API. **Confirmed — official documentation.** [Getting Started](https://developers.mindbodyonline.com/ui/documentation/public-api), [developer pricing](https://developers.mindbodyonline.com/), [Consumer API introduction](https://developers.mindbodyonline.com/ui/documentation/consumer-api)
- Revvi’s prior Public API / Consumer Bookings direction remains recorded as agreed in Mindbody correspondence. The emails were not supplied, so this is **Confirmed — correspondence record**, not proof of contractual approval.
- Revvi’s curated, multi-studio, consumer-facing model still needs written approval. Public API onboarding supports site-specific authorization, but API Terms restrictions concerning third-party use, aggregation, commercial display, and caching create an unresolved legal/product gate. **Requires Mindbody response.** [API Terms, especially sections 8.11, 8.15, 8.18 and 8.19](https://developers.mindbodyonline.com/Resources/DeveloperAgreement)
- The read path, normalized identifiers, partner/offer mappings, defensive availability model, state machines, reconciliation reads, webhook receiver, redaction, and short-lived caches can be built now. **Inferred from confirmed endpoint contracts.**
- Paid production booking is **NO-GO today**. The standard checkout model accepts raw card details; no supported hosted-fields or opaque browser token flow was found. Alternative redirect and stored-card paths may work only for eligible/configured partners and remain unverified. [Checkout Shopping Cart](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/checkout-shopping-cart), [Get Alternative Payment Methods](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/get-alternative-payment-methods)
- Basic cancellation is technically possible, but production cancellation is gated on policy semantics, permissions, pass restoration, email behavior, ambiguous-outcome reconciliation, and controlled testing. Cancellation does not imply a refund. [Remove Client From Class](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/remove-client-from-class)
- Automated refunds, original-tender refunds, no-show mutation, and automated financial compensation are outside the safe MVP on current evidence.

## 3. Product, commercial terms, authentication, and activation

### 3.1 Product and authorization

- Public API V6 supports site-scoped business data and class-booking operations. **Confirmed — official documentation.**
- A live partner’s business owner must activate Revvi for that Site ID after Revvi receives live approval. Activation is per Site, and a Site may contain multiple locations. **Confirmed — official documentation.** [Getting Started](https://developers.mindbodyonline.com/ui/documentation/public-api), [developer FAQ](https://developers.mindbodyonline.com/ui/faq)
- No MVP capability has been shown to require Affiliate API, Partner Network participation, or the separate Consumer API. This is **Inferred**, not a contractual promise. Mindbody must confirm it.
- A successful sandbox call or site activation does not prove Revvi’s business model is approved under the API Terms. **Inferred.**

### 3.2 Published commercial facts

The following figures were retrieved on 2026-07-17 and must be reconfirmed before go-live:

| Charge | Published amount | Status |
|---|---:|---|
| Public sandbox | USD 0 | **Confirmed — official documentation** |
| Site-access API calls | USD 0.002 per call | **Confirmed — official documentation** |
| Low-volume access | Free when under 5,000 calls per billing cycle | **Confirmed wording; charging algorithm unconfirmed** |
| Consumer Bookings location fee | USD 15 per location per integration | **Confirmed — official documentation** |
| Consumer class booking | USD 1.30 per class booking | **Confirmed — official documentation** |
| Consumer appointment booking | USD 2.50 per booking; outside MVP | **Confirmed — official documentation** |
| Virtual booking | Free | **Confirmed wording; classification rules unconfirmed** |
| Custom sandbox without/with sample data | USD 500 / USD 1,000 once, then USD 500 annually | **Confirmed — official documentation** |

Sources: [developer pricing](https://developers.mindbodyonline.com/), [developer FAQ](https://developers.mindbodyonline.com/ui/faq), [API Terms](https://developers.mindbodyonline.com/Resources/DeveloperAgreement).

The published Public API table contains no 20% Affiliate/Partner Network fee. The prior findings also record that such a fee was not intended. Its absence is not proof that no negotiated, processing, tax, regional, activation, certification, or other charge applies. **Requires Mindbody response.**

Unresolved billing details include the 5,000-call threshold scope and calculation, which calls count, the booking-fee trigger and cancellation credit, chargeable locations under a partly used Site, and whether billing starts at go-live or 30 days after subscriber-data access. The FAQ and Terms conflict on the last point.

### 3.3 Authentication and secret handling

- The core request context is `API-Key` plus the target `SiteId`. Some operations require an additional user authorization token and permissions. **Confirmed — official documentation.** [Public API reference](https://developers.mindbodyonline.com/ui/documentation/public-api)
- Exact token type, role, permissions, lifetime, refresh, and revocation behavior for Revvi’s client, checkout, booking, cancellation, sales, and transaction calls remain **Unconfirmed**.
- OAuth appears in current documentation, but it is not established as mandatory for Revvi’s unattended server-to-server flow. **Unconfirmed.**
- Credentials and tokens must remain server-to-server and out of Webflow, browser JavaScript, source control, logs, and provider snapshots. **Confirmed — official documentation.** [Mindbody Security Policy](https://www.mindbodyonline.com/company/legal/security-policy)
- `SourceName` is integration metadata, not proven to be a secret. A fixed `SourcePassword` model is not supported by current core evidence and must not be implemented unless Mindbody confirms it.
- Mindbody reserves the right to delete low-activity API credentials; the Security Policy describes low activity as fewer than 100 calls over 30 days. Whether this applies unchanged to low-volume production integrations requires confirmation.

### 3.4 Environment and activation gaps

The public sandbox is intended for development, and production requires live approval, billing setup, and partner activation. It remains unclear whether sandbox and production use different keys or base URLs, which shared sandbox fixtures are guaranteed, what resets, and which activation roles, expiry rules, revocation delays, and error codes apply.

## 4. Classes, inventory, availability, and pricing

### 4.1 Resource and identifier model

```text
Site
  Location
  Program
    Session Type
      Class Description
        Class Schedule (recurring definition)
          Class (one occurrence at a date/time)

Service / pricing option
  ProductId = canonical pricing-option identity
  Id        = barcode-like identity; keep separate
```

- Use `Class.Id` as the time-specific bookable instance and send it as `ClassId`. `ClassScheduleId` is the recurring schedule reference. **Confirmed — official documentation.** [Get Classes](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/get-classes), [Get Class Schedules](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/get-class-schedules)
- Use `(provider, SiteId, entity type, provider ID)` as the internal identity boundary and store provider IDs as text. Site-scoped composite identity is **Inferred**; Mindbody should confirm ID uniqueness and reuse rules.
- Map an offer to `Service.ProductId`, never service name or barcode `Service.Id`. Store the barcode separately only when an endpoint demonstrably needs it. **Confirmed — official documentation for identity; mapping design inferred.** [Get Services](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/get-services), [Webhooks reference](https://developers.mindbodyonline.com/WebhooksDocumentation)
- Durable offer mappings should contain Site context, Product ID, and approved Location/Program/Class Description/optional Session Type allowlists. They must not contain individual time-specific Class IDs. **Inferred.**

### 4.2 Availability

- Use Get Classes as the primary member-facing occurrence/availability read. Use Get Class Schedules only for recurrence or schedule-specific validation. **Confirmed — official documentation for endpoint contracts; selection inferred.**
- Do not calculate remaining capacity as `MaxCapacity - TotalBooked`. Capacity fields can be null or hidden; `WebCapacity`, web bookings, waitlist state, booking windows, client identity, cancellation, and studio settings also affect bookability. **Confirmed — official documentation.**
- `IsAvailable` is documented as whether the supplied client can book. Its exact anonymous meaning is not sufficiently defined to be the sole final gate. Numeric remaining slots and anonymous `IsAvailable` semantics require Mindbody confirmation and sandbox proof.
- Availability should be a state with reasons, including `available`, `full`, `waitlist_available`, `outside_booking_window`, `cancelled`, `client_ineligible`, and `unknown`. A successful read does not reserve capacity; booking can still fail with `ClassOnlineSignUpsFull`.
- Waitlisting is a separate capability. If it is not explicitly implemented and tested, Revvi should show the class as unavailable rather than silently joining a waitlist. **Inferred.**

### 4.3 Pricing and quote

- Public API calls a pricing option a `Service`; discover candidates with Get Services, ideally filtered by selected `ClassId`. **Confirmed — official documentation.**
- Get Services `LocationId` calculates tax context; it does not filter services to allowed locations. Validate returned `SellAtLocationIds` and `UseAtLocationIds`. **Confirmed — official documentation.**
- `Price` and `OnlinePrice` are configured price inputs and may vary by staff. They are not a safe final customer total. **Confirmed — official documentation.**
- Use `CheckoutShoppingCart(Test=true)` for a client-aware provider calculation of subtotal, discount, tax, and grand total, then recalculate immediately before a live purchase. This is the best documented quote mechanism; quote lifetime and exact equality with live checkout remain **Unconfirmed**. [Checkout Shopping Cart](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/checkout-shopping-cart)
- Introductory offers, membership restrictions, existing passes, account credit, contracts, activation/expiry rules, related programs, and per-staff pricing make eligibility client-dependent. Discovery results must not be presented as a guaranteed price or eligibility decision.
- No native “Revvi member” entitlement or API-only visibility switch was found. Studios must configure a Revvi-specific pricing option, while Revvi enforces Memberstack eligibility and server-side allowlists. **Inferred; API-only visibility requires Mindbody response.**

### 4.4 Required read operations

The supported read foundation is Sites, Locations, Programs, Class Descriptions, Class Schedules, Classes, Staff, and Services, with offset pagination and normalized errors. Relevant official endpoints: [Get Sites](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/site/get-sites), [Get Locations](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/site/get-locations), [Get Programs](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/site/get-programs), [Get Class Descriptions](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/get-class-descriptions), [Get Staff](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/staff/get-staff).

## 5. Clients, entitlements, payment, and booking

### 5.1 Client identity

- `Client.Id`/RSSID and immutable `Client.UniqueId` are distinct Site-contextual identifiers. Neither is a universal cross-site person ID. Store both with Site ID. **Confirmed — official documentation.** [Get Clients](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/client/get-clients)
- Email is searchable but not unique. Mindbody blocks a new case-insensitive first-name + last-name + email triple, while historical duplicates may exist. **Confirmed — official documentation.** [Get Client Duplicates](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/client/get-client-duplicates)
- Client lookup and duplicate detection require a staff token. Fail closed on multiple plausible matches and never merge automatically. **Confirmed for token requirement; matching policy inferred.**
- Before Add Client, read the Site and mode-specific required client fields. First and last name are always required; other required fields depend on studio configuration and Consumer/Business Mode. A password is not a documented Add Client requirement. [Get Required Client Fields](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/client/get-required-client-fields), [Add Client](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/client/add-client)
- Cross-regional associations expose separate Site/client tuples and are unavailable in the public sandbox. They do not establish automatic local client creation. **Confirmed in part; creation behavior unconfirmed.**

### 5.2 Existing passes and booking modes

- Client Services can identify purchased passes usable for a selected class. `ClientService.Id` identifies the purchased pass; `ProductId` identifies the pricing option; Visit ID identifies the attendance/booking record. These IDs are not interchangeable. [Get Client Services](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/client/get-client-services)
- Existing passes cannot simply be ignored. When booking with an existing pass, explicitly select the tested `ClientServiceId`. Automatic selection/deduction order is **Unconfirmed**.
- Checkout Shopping Cart supports purchase plus `ClassIds` in one call, purchase without booking, and reconciliation of unpaid visits with `VisitIds`. Purchase-plus-booking input support is **Confirmed**; all-or-nothing failure and timeout semantics require sandbox verification.
- Add Client to Class supports explicit existing-pass, free, unpaid/pay-later, and waitlist modes through `ClientServiceId`, `RequirePayment`, and `Waitlist`. Which modes the pilot may use and which permissions/settings govern them remain unconfirmed. [Add Client to Class](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/add-client-to-class)

### 5.3 Payment boundary

- Standard checkout accepts raw PAN, expiry, CVV, and billing data. **Confirmed — official documentation.**
- No supported hosted card fields, iframe, client-side tokenization SDK, or reusable opaque card token was found in the current Public API reference or official SDK. Documentation silence does not prove that a separately provisioned product does not exist. **Unconfirmed.**
- Passing raw card data from Webflow through Supabase to Mindbody would put it inside Revvi-controlled infrastructure even if it is never stored. This violates the MVP’s stronger no-raw-card boundary and requires a separate PCI/security/compliance design. **Inferred.**
- Alternative checkout provides redirect operations for supported methods, including documented iDEAL/Apple Pay cases. Current SDK restrictions and June 2026 Apple Pay release notes are not fully aligned, so pilot eligibility requires a written answer and sandbox proof. [Initiate Alternative Checkout](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/initiate-checkout-shopping-cart-using-alternative-payments), [Complete Alternative Checkout](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/complete-checkout-shopping-cart-using-alternative-payments), [release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- Stored-card checkout is documented, but current client models expose only metadata such as last four, not a clearly reusable opaque selector. Multiple-card disambiguation, authentication, CVV, and suitability for Revvi are unresolved.

### 5.4 Idempotency and reconciliation

- Since September 2025, identical Add Client to Class requests made in quick succession are deduplicated unless the skip header is set. The fingerprint and window are not documented. Checkout, cancellation, waitlist removal, and returns have no equivalent confirmed guarantee. **Confirmed in part.** [release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- Revvi must serialize writes per user/booking, persist request fingerprints and attempt states, and never replay a write whose outcome may be unknown. Local idempotency cannot prove the provider did not commit. **Inferred.**
- Reconcile booking outcomes with Client Schedule, Client Visits, Class Visits, Waitlist Entries, Sales, Transactions, and relevant webhooks before retrying. [Get Client Schedule](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/client/get-client-schedule), [Get Client Visits](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/client/get-client-visits), [Get Class Visits](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/get-class-visits), [Get Sales](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/get-sales), [Get Transactions](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/get-transactions)
- Store Class, Visit, class-roster-booking, waitlist entry, ClientService, Product, Sale, cart, transaction, and payment references distinctly. A single ambiguous `provider_booking_id` or `provider_purchase_id` is insufficient.

### 5.5 Confirmation emails and waivers

- Add Client to Class and checkout have separate `SendEmail` controls; behavior depends on token mode, permission, studio settings, operation, and waitlist state. Suppression is therefore only partly resolved. **Confirmed in part; requires sandbox verification.**
- Keep provider email flags off by default until tested; send Revvi confirmation only after provider state is confirmed and duplicate behavior is understood. **Inferred.**
- `LiabilityRelease` exists on the client model, but whether a studio’s waiver blocks booking, how consent must be captured, and whether Revvi may record it remain unconfirmed. Waiver acceptance needs pilot-specific legal and sandbox validation.

## 6. Cancellation, refunds, webhooks, and operations

### 6.1 Cancellation

- Remove a confirmed booking with `RemoveClientFromClass` using Site, Class, Client/Unique Client, and optional Visit ID. `VisitId` and webhook `classRosterBookingId` are distinct. **Confirmed — official documentation.**
- Remove a waitlist entry separately: retrieve `WaitlistEntryId`, then call Remove From Waitlist. A repeated removal is not documented as idempotent success. [Get Waitlist Entries](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/get-waitlist-entries), [Remove From Waitlist](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/remove-from-waitlist)
- `LateCancel` is supported, but its effect on penalties or passes is not established. `Program.CancelOffset` lacks documented unit, timezone, override, and enforcement semantics. Revvi must not promise a penalty-free deadline from it alone.
- No class-specific no-show mutation endpoint was found. Member self-service no-show is out of MVP.
- A successful cancellation removes/changes the visit; it does not refund a sale. Pass restoration is proven only for a narrow documented cross-regional bulk-removal case and must not be generalized. Compare the exact ClientService before and after.
- A prior release note records that cancellation could return `500` even when the cancellation committed. It is operational-risk evidence: after a timeout or provider error, reconcile before replaying.

### 6.2 Refunds and compensation

- Return Sale is a business-mode whole-sale operation by `SaleId`, but its current generated description conflicts with newer release notes concerning account-credit and supported tenders. **Confirmed conflict; requires Mindbody response.** [Return Sale](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/return-sale), [release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- No verified general Public API operation was found for original-tender card refunds, card voids, partial line returns, or processor settlement. Permission enum names are not endpoint contracts.
- Automated refunds and compensation must remain disabled. Purchase-success/booking-failure cases require a support lock, reconciliation, and manual studio/financial handling.

### 6.3 Webhooks and reliability

- Relevant events include class-roster-booking created/status/cancelled, waitlist created/cancelled, class updated, class-schedule cancelled, client-sale created, and narrowly membership-assignment cancelled. No general sale-return, payment-status, transaction, or ClientService-change event is documented. [Webhooks reference](https://developers.mindbodyonline.com/WebhooksDocumentation)
- Webhooks are not exactly once or ordered. Mindbody retries non-2xx/timeouts every 15 minutes for up to three hours and recommends a Public API sync every 24 hours. **Confirmed — official documentation.**
- Webhooks are evidence, not the sole synchronous authority. Verify signatures, deduplicate, tolerate reordering, reconcile through reads, and run a 24-hour sweep.
- All reads may use bounded transient retries. Writes that may have reached Mindbody must enter `unknown` and be reconciled, not replayed.
- Current rate limits, scope, headers, `Retry-After`, and production availability expectations remain unconfirmed. [Mindbody status](https://status.mindbodyonline.com/)

### 6.4 Data retention

- API Terms section 8.19 prohibits caching Mindbody Data beyond 48 hours. **Confirmed — official documentation.**
- Whether Revvi may retain operational provider IDs, normalized booking facts, amounts, and audit/accounting references beyond 48 hours is unresolved. **Requires Mindbody response.**
- Raw `provider_snapshot`, API log payload, webhook payload, card/client response, and token storage are not acceptable defaults. Persist minimal typed Revvi-owned facts; encrypt and expire any temporary diagnostic payload within 48 hours or sooner.

## 7. Consolidated contradiction and ambiguity register

| Topic | Conflicting claims/evidence | Resolution |
|---|---|---|
| Product choice | Prior findings say Public API / Consumer Bookings was selected; live onboarding and Terms still require approval. | Technical direction retained; production product/use-case approval remains open. |
| Affiliate/20% fee | Correspondence record says not applicable; official Public API pricing does not list it, but no Revvi contract was supplied. | Do not budget it as confirmed; obtain written full-fee confirmation. |
| API free allowance | Prior wording implied “first 5,000 free, then excess billed”; current page says free when under 5,000 per billing cycle. | Charging algorithm and threshold scope remain open. |
| Billing start | FAQ says immediately at go-live; Terms say fees commence 30 days after subscriber-data access. | Direct written answer required. |
| Sandbox limits | Current page publishes free sandbox without a limit; older FAQ says 1,000 calls/day. | Do not encode a limit until portal/support confirms it. |
| Authentication | Earlier PRD/source-password model conflicts with current API-key + Site ID evidence and optional user/OAuth tokens. | Use a pluggable auth provider; endpoint token/permission matrix remains gated. |
| Multi-studio use | Onboarding contemplates developers connecting businesses; Terms restrict third-party use and aggregation. | Written Revvi-specific approval required. |
| Retention | PRD proposes durable provider snapshots/log JSON; Terms impose a 48-hour cache limit. | Remove raw durable payloads; seek permission for minimum durable references. |
| Available slots | Earlier findings expected an available-capacity field; documented model has nullable/hidden counters and client-aware `IsAvailable`. | Use state/reasons and nullable counts; do not promise numeric spots. |
| Pricing location filter | Earlier question treated `LocationId` as a filter; Get Services uses it for tax. | Validate sale/use location arrays instead. |
| Authoritative price | Earlier findings allowed returned service price to be authoritative; cart calculation includes client/tax/discount rules. | Availability price is provisional; Test cart is the quote candidate. |
| Pricing-option ID | `Service.Id` and `ProductId` were ambiguous. Webhooks/models identify ProductId as the product identity and Id as barcode-like. | Canonicalize ProductId, but sandbox-test exact cart metadata/filter usage. |
| Purchase + booking | Earlier report left atomic input support open; checkout explicitly accepts `ClassIds`. | Input support confirmed; transaction atomicity and timeout behavior still open. |
| Existing passes | Earlier scope could defer pass recognition; booking models make ClientService selection central. | Explicitly discover/select passes or narrow the pilot; never rely on silent selection. |
| Payment pass-through | PRD says card details/token may pass through a secure provider mechanism; standard checkout requires raw card fields and no supported token flow was found. | Raw-card Revvi transit is rejected; approved redirect/saved-card/no-payment flow required. |
| Apple Pay | June 2026 release notes broaden availability; generated SDK still describes MBPS/Stripe/Location 98 restrictions. | Pilot eligibility requires direct confirmation and test. |
| Idempotency | PRD promises one provider booking per idempotency key; native protection is documented only for quick duplicate AddClientToClass requests. | Promise serialized attempts and reconciliation, not impossible provider uniqueness after unknown outcomes. |
| Cancellation and refund | Earlier scope could imply a cancellation flow handles the booking commercially. Cancellation has no refund input/result. | Keep cancellation, pass restoration, and refund as separate states. |
| Pass restoration | Narrow cross-regional bulk behavior exists; no general local/late/expired/unlimited guarantee exists. | Never claim restoration without post-action evidence. |
| Return Sale | Generated endpoint description and newer release notes disagree on eligible return methods/account credit. | Manual only; no automated compensation. |
| Email | Multiple operations expose `SendEmail`, but token, permission, setting, and message type differ. | Default off and test each flow before enabling Revvi mail. |
| Webhook scope | PRD has a webhook table, but provider delivery is duplicate/unordered and lacks key financial events. | Add queue/dedupe/reconciliation/polling; webhook presence alone is insufficient. |
| 120-hour scope | Original budget assumes simple booking/cancellation; Phase 0 shows state machines, reconciliation, support locks, retention controls, and payment gating. | Feasible only for a narrowed pilot; not for the current full paid-production interpretation. |

## 8. Source record and limitations

### Phase 0 reports

- [`01_API_PRODUCT_AND_AUTH.md`](../../01_API_PRODUCT_AND_AUTH.md)
- [`02_CLASSES_AND_PRICING.md`](../../02_CLASSES_AND_PRICING.md)
- [`03_CLIENT_PAYMENT_BOOKING.md`](../../03_CLIENT_PAYMENT_BOOKING.md)
- [`04_CANCELLATION_AND_OPERATIONS.md`](../../04_CANCELLATION_AND_OPERATIONS.md)

### Core official sources

- [Public API V6 documentation and Getting Started](https://developers.mindbodyonline.com/ui/documentation/public-api)
- [Official Public API SDK repository](https://github.com/mindbody/Mindbody-API-SDKs)
- [Developer pricing](https://developers.mindbodyonline.com/)
- [Developer FAQ](https://developers.mindbodyonline.com/ui/faq)
- [Public API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- [Public API endpoint overview](https://developers.mindbodyonline.com/Resources/Endpoints)
- [Webhooks documentation](https://developers.mindbodyonline.com/WebhooksDocumentation)
- [API Terms of Use](https://developers.mindbodyonline.com/Resources/DeveloperAgreement)
- [Security Policy](https://www.mindbodyonline.com/company/legal/security-policy)
- [API Support](https://support.mindbodyonline.com/s/contactapisupport)

Evidence limitations:

- No developer portal login, API key, Site activation, staff token, controllable sandbox, merchant fixtures, callback domain, test inbox, or failure-injection facility was supplied.
- The original correspondence was not supplied. Correspondence claims are preserved but not promoted to official or contract-confirmed facts.
- The developer portal is dynamically rendered. Exact operation models were cross-checked against Mindbody’s official generated SDK.
- Public pricing, terms, endpoints, and release behavior are time-sensitive and must be reconfirmed before production.
- This is technical/product research, not a legal, PCI, privacy, tax, financial, or accounting opinion.

## 9. Confirmed implementation decisions

The following are the implementation decisions that can be adopted now. “Decision” means the project can design/build this way; it does not turn inferred runtime behavior into a Mindbody-confirmed fact.

1. Target **Mindbody Public API V6.0**. Treat Consumer Bookings as pricing terminology, not the Consumer API. Keep Affiliate API, Partner Network, and Consumer API code outside MVP unless Mindbody directs otherwise.
2. Keep all provider credentials, staff/OAuth tokens, and payment secrets server-side. Use a configurable auth provider supporting API key, per-request Site ID, and an optional bearer token.
3. Require a written product/use-case approval gate and a separate site-activation state per pilot partner.
4. Use `Class.Id` as the occurrence/session ID and `Service.ProductId` as the pricing-option ID. Store all provider IDs as text with Site context.
5. Use Get Classes for member-facing occurrences. Represent availability as a state with reasons and nullable capacity; do not promise numeric slots when evidence is incomplete.
6. Use server-side offer allowlists for Site, Location, Product, Program, Class Description, and optional Session Type. Never use service names or durable Class IDs as mappings.
7. Split availability from quote. Treat service price as provisional; use a short-lived, client-aware Test cart quote and recalculate before purchase.
8. Store Site + Client/RSSID + Unique Client ID for resolved client profiles. Fail closed on duplicates and never auto-merge.
9. Discover existing ClientServices and select an explicit pass or explicit new Product. Do not rely on implicit provider pass selection.
10. Reject raw-card transit through Webflow or Supabase. Enable paid booking only through a written-approved, tested redirect/opaque/saved-card path that passes security/compliance review.
11. Prefer purchase plus Class IDs in one checkout for a new paid option after sandbox proof. Use Add Client to Class only for an explicit existing-pass, approved free/unpaid, or separately implemented waitlist path.
12. Model booking, purchase, cancellation, restoration, and refund as separate states and attempts. Preserve all provider references distinctly.
13. Serialize writes, retain local idempotency keys, and put ambiguous writes into `unknown`. Reconcile before retrying; do not promise provider exactly-once behavior.
14. Implement cancellation as a saga. Use Class + Client/Unique Client + optional Visit, and treat waitlist removal separately. Do not claim refund or pass restoration from cancellation alone.
15. Keep automated refunds, Return Sale, no-show mutation, and automated financial compensation disabled for MVP.
16. Treat signed webhooks as supplementary evidence. Deduplicate, tolerate reordering, reconcile with reads, and run the documented 24-hour sync.
17. Store minimal typed facts. Expire cached provider data and diagnostic payloads within 48 hours unless Mindbody grants a written exception; do not durably store raw provider snapshots.
18. Keep all write paths behind sandbox/production feature flags and require a controlled pilot-site test matrix before enabling them.

## 10. Blockers

1. Written approval that Revvi’s curated multi-studio model is permitted under Public API V6 and the cited API Terms restrictions.
2. Written full commercial schedule, including threshold billing, location count, booking triggers/credits, billing start, taxes, and confirmation that no Affiliate/revenue-share fee applies.
3. Developer portal access, current sandbox details, test Site, staff identity/token, controllable fixtures, and a pilot partner willing to activate Revvi.
4. Endpoint-by-endpoint authentication, token, role, and permission confirmation for client, checkout, booking, cancellation, sales, transaction, and return operations.
5. Written retention permission/classification for durable provider IDs, booking/accounting facts, and audit records beyond 48 hours.
6. A no-raw-card payment architecture approved for the pilot, plus security/PCI review and controlled merchant/SCA/redirect testing. Without it, paid production is blocked.
7. Sandbox proof for ProductId/cart metadata, Test quote totals, existing-pass choice, purchase+booking failure semantics, deduplication, timeout reconciliation, and provider emails.
8. Sandbox proof for cancellation permissions/policy, early/late behavior, already-cancelled cases, waitlist removal, pass restoration, ambiguous timeouts, webhook convergence, and emails.
9. Support and operational readiness: locks, unknown-state queues, reconciliation jobs, webhook handling, retention deletion, alerts, and a documented manual compensation process.
10. Qualified legal/security/financial decisions where this document identifies API Terms, PCI, refunds, taxes, or accounting issues.

## 11. Questions to email Mindbody

Send one consolidated request with Revvi’s use-case diagram, proposed data flow, pilot country/processor, and example partner configuration.

1. Confirm that Public API V6 with Consumer Bookings is approved for Revvi’s paid membership platform showing and booking classes from multiple curated, contracted studios, each activating its own Site ID. Does it require Affiliate API, Partner Network, Partner Store, aggregator approval, certification, or another agreement? How do Terms sections 8.11 and 8.15 apply?
2. Confirm the full fee schedule and effective date. Is USD 0.002 charged only above 5,000 calls or to all calls after crossing the threshold; what entity owns the threshold; which errors/retries/webhooks/sandbox calls count; when does billing start; and which events incur or reverse the USD 1.30 class-booking fee?
3. Is USD 15 charged for every location under an activated Site ID even if Revvi exposes only one? Confirm that no Affiliate, Partner Network, referral, revenue-share, 20%, activation, certification, support, processor, regional, minimum, or other unpublished charge applies.
4. For Get Classes, Get Clients/duplicates/required fields, Add Client, Client Services, Test/live Checkout Shopping Cart, Add Client to Class, Remove Client from Class, waitlist operations, Sales, Transactions, and Return Sale, specify required headers, token type, named permissions, and Consumer/Business Mode behavior.
5. Is OAuth required or recommended? If so, provide grant, scopes, expiry, refresh, revocation, and per-site authorization behavior. If a staff identity is required, specify the least-privilege role and whether each studio needs a dedicated integration user.
6. Are sandbox/production API keys or hosts different? What are the current shared sandbox Site ID, call limits, reset schedule, guaranteed fixtures, test cards, SCA/redirect support, email behavior, and failure-injection options? Which scenarios require a custom sandbox?
7. Confirm the meaning of anonymous `Class.IsAvailable` and the supported way, if any, to display remaining online spots from capacity fields and waitlist state.
8. Confirm that `Service.ProductId` is the canonical value for Get Services filters, cart metadata, purchased-item reconciliation, and booking webhooks. When is barcode `Service.Id` required?
9. Can a pricing option be hidden from Mindbody’s ordinary storefront but sold through an approved Public API integration? Can it be restricted to an external Revvi cohort, or must Revvi enforce eligibility independently?
10. Is `CheckoutShoppingCart(Test=true)` the supported authoritative quote, what client/promotion/tax/pass rules does it apply, how long is it valid, and what exact metadata identifies the Product?
11. Does purchase plus `ClassIds` commit atomically for every supported payment method, including timeouts? Does checkout have idempotency or safe CartId replay behavior?
12. When `ClientServiceId` is omitted, how does Mindbody choose/deduct an existing pass? Can Revvi force the newly purchased Revvi Product? What cross-regional/local-client behavior is supported?
13. What hosted fields, iframe, tokenization SDK, opaque token, saved-card selector, or redirect payment path is officially supported for Public API V6? Confirm pilot processor/region eligibility, SCA lifetimes/recovery, multiple stored-card selection, and whether June 2026 Apple Pay availability supersedes SDK restrictions.
14. Define Add Client to Class deduplication fingerprint/window. Is any dedup/idempotency provided for checkout, cancellation, waitlist removal, Update Client Visit, or Return Sale?
15. Define `Program.CancelOffset`: unit, sign, timezone, DST, overrides, and enforcement. Is consumer-mode cancellation supported, and can staff mode bypass policy?
16. For normal, late, no-show, expired, unlimited, unpaid, free, local, and cross-regional bookings, state whether cancellation restores or forfeits the exact ClientService. Does single Remove Client from Class have the restoration guarantee documented for narrow bulk cross-regional behavior?
17. Reconcile Return Sale documentation with the newer account-credit release notes. What items/tenders can be returned, is partial/original-tender refund or void supported, can it be tested, what permissions are required, and how are settlement and ambiguous timeouts reconciled?
18. Confirm exact emails/receipts generated by Add Client, checkout+class, Add Client to Class, waitlist, cancellation, class cancellation, and returns for each `SendEmail`, token, and studio-setting combination.
19. Confirm current rate limits, scope, headers, `Retry-After`, outage/maintenance behavior, webhook replay/backfill availability, and whether additional financial/pass-change webhook events exist.
20. Under Terms section 8.19, may Revvi retain Site, Location, Class, Client, Visit, roster-booking, Waitlist, ClientService, Product, Sale, cart, Payment, Transaction, Return Sale, normalized status, timestamps, and monetary totals beyond 48 hours for support, accounting, fraud, and audit? Identify fields that must expire and any written exception/DPA process.

## 12. Changes required in `CODE_PRD.md`

1. Rename the target consistently to **Mindbody Public API V6.0 with Consumer Bookings commercial pricing**; distinguish it from Consumer API and Affiliate API.
2. Add hard production gates for written use-case approval, pricing/version reference, pilot activation, retention approval, payment/security approval, and completed sandbox evidence.
3. Replace `SourcePassword` assumptions with a pluggable authentication provider: API key, per-request Site ID, optional bearer token, expiry/refresh metadata, endpoint permission tests, and separate environment configuration.
4. Expand partner integration activation fields: `pending/active/revoked/failed`, timestamps, last permission check/error, chargeable location count, billing verification, and approval/ticket references. Do not store raw activation codes/links.
5. Correct provider types: required Class occurrence ID; optional Class Schedule, Program, Class Description, and Session Type IDs; all IDs as text with Site context.
6. Replace `provider_pricing_option_id` / ambiguous service fields with canonical `provider_service_product_id` and an optional separate barcode ID. Remove durable `provider_class_id` from offer mappings.
7. Replace single mapping columns with effective-dated Location/Program/Class Description/Session Type allowlist rows or arrays and a validation status.
8. Replace `availableSlots: number` and simple `isBookable` with nullable counters, `availabilityState`, and reason codes. Treat displayed price as provisional.
9. Expand quote contracts with client/pass/Product identity, subtotal, discounts, tax, grand total, currency, provider calculation source, fingerprint, expiry, and revalidation behavior.
10. Make `member_provider_profiles` required after resolution, storing Site, Client/RSSID, Unique Client ID, status, ambiguity, and verification fields. Add client-resolution and required-fields states.
11. Add explicit ClientService/pass selection and separate Product, ClientService, Visit, roster-booking, waitlist, Sale, cart, transaction, and payment references.
12. Split the current booking row/workflow into user-facing booking plus booking, purchase, cancellation, restoration, refund, and reconciliation attempts or equivalent durable state machines. Add `waitlisted`, `duplicate`, `requires_action`, `authorized`, and `unknown` states.
13. Correct idempotency language: Revvi can serialize and deduplicate its own attempts, but cannot guarantee one provider effect after an ambiguous write. Add reconcile-before-retry rules.
14. Replace the generic Webflow payment-token placeholder with a hard disabled state until Mindbody provides an approved redirect/opaque/saved-card contract. Explicitly prohibit PAN/CVV transit through Revvi.
15. Define separate flows for atomic new-option checkout, explicit existing-pass booking, approved free/unpaid booking, and waitlist. Keep unsupported modes feature-gated.
16. Change cancellation to an attempt/saga using Class + Client/Unique Client + optional Visit. Separate waitlist removal, late cancellation, pass restoration, refund, and no-show states. Keep refunds/no-show mutation disabled.
17. Add reconciliation workers, support locks/views, circuit breakers, unknown-state queues, bounded read retries, write replay prohibitions, and provider health/cost metrics.
18. Expand webhook design to signature validation, raw-body verification, dedupe, ordering tolerance, queued processing, subscription health, three-hour delivery limits, and 24-hour polling reconciliation.
19. Remove durable `provider_snapshot` and unrestricted JSON API/webhook logs. Add a provider-data classification registry, redaction rules, encryption/access controls, and 48-hour TTL deletion for cached/raw provider data.
20. Replace the default `America/New_York` timezone with required Site/partner configuration and timezone-aware DST tests.
21. Add studio onboarding checks for locations and fees, currency/timezone/tax, per-staff pricing, open-space visibility, booking/cancellation windows, Product ID, sale/use locations, required client fields, pass behavior, payment processor, emails, waivers, and discontinuation.
22. Expand the sandbox matrix to cover auth modes, permissions, duplicates, null capacity, waitlist, taxes/discounts, existing passes, payment/SCA, atomicity, ambiguous timeouts, cancellation, restoration, email, webhook ordering/duplicates, and 48-hour expiry.
23. Re-scope Milestones 5–7 and the acceptance criteria: paid production, comprehensive cancellation, refunds, advanced reconciliation, and multi-partner rollout cannot all be assumed inside 120 hours.

## 13. Whether the 120-hour MVP remains feasible

**Conditional yes for a deliberately narrowed one-partner pilot; no for the current full paid-production interpretation.**

The 120-hour budget can remain a credible delivery constraint only if the MVP is limited to:

- one activated pilot Site and a very small fixed offer allowlist;
- classes only, with read availability and defensive unknown states;
- one already-approved booking mode: explicit existing pass, free/unpaid booking approved by the studio, or a Mindbody-hosted redirect proven for the pilot;
- no raw-card transit through Revvi;
- no waitlist unless separately tested;
- basic cancellation only after sandbox proof, with no promise of refund or pass restoration;
- manual handling of unknown outcomes and all financial compensation;
- minimal support tooling and a controlled pilot rather than general production readiness.

The 120 hours is not feasible for a scope that also promises standard card checkout, SCA/saved-card variants, automatic pass selection, comprehensive cancellation/refunds, no-show handling, cross-regional behavior, full operational automation, and multi-partner rollout. If Mindbody does not approve a no-raw-card payment path quickly, the viable 120-hour outcome becomes an availability/eligibility/read foundation plus an existing-pass/free pilot—not a paid booking MVP.

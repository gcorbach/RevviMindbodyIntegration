# Mindbody taxonomy and design for partners offering multiple Class families

Researched: 2026-08-20

Scope: first-party Mindbody Public API schemas, endpoint documentation, Webhooks documentation, FAQ, and release notes only.

## Decision summary

Mindbody does not expose a documented `studioType`, `businessType`, or equivalent fitness vertical on its `Site` or `Location` models. A Revvi label such as “yoga studio” is therefore Revvi-owned business classification, not the source of truth for the classes that a partner offers.

For class selection, the best provider-backed reusable identity is `ClassDescription.Id`, scoped by `Site.Id`. A class description is the definition whose name and description are shared by the schedules that use it; a `ClassSchedule.Id` is the recurring schedule, and a `Class.Id` is one bookable occurrence. Each returned class description also links to a broader `Program` and a `SessionType`, and newer schemas expose optional Category/Subcategory tags. Revvi should ingest all of those identifiers, but should introduce its own Class family record rather than forcing every Business's setup into a universal assumption such as “Session Type always means Hot Yoga.”

A suitable conceptual mapping is:

```text
Revvi partner / provider Site
  -> Mindbody Location(s)
    -> Revvi Class family (customer-facing selection)
       -> provider ClassDescription ID (primary reusable definition)
       -> provider Program ID (broader service category)
       -> provider SessionType ID (provider class/session taxonomy)
       -> optional Category/Subcategory IDs (tags; validate per business)
       -> provider ClassSchedule IDs (recurring schedules, when needed)
          -> provider Class IDs (dated bookable occurrences)
```

This supports “Yoga studio → Hot Yoga / Hatha Yoga / Restorative Yoga” without pretending that the studio-level label determines inventory.

## Provider concepts and identifiers

| Concept | Mindbody meaning | Identity and lifecycle | Revvi implication |
| --- | --- | --- | --- |
| Site / business | `Site` has business-level fields including `Id`, name, description, branding, timezone, currency, and subscription/payment configuration. The generated schema has no business-vertical or studio-type property. One Site ID can represent one or several locations. | `Site.Id` is the provider business boundary. | Keep “yoga,” “pilates,” etc. as a Revvi-owned partner classification if useful for discovery. Never use it to authorize a class. Scope every provider taxonomy ID by Site ID. [Get Sites](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/site/get-sites), [Mindbody API FAQ](https://developers.mindbodyonline.com/ui/faq), [official generated SDK snapshot](https://github.com/mindbody/Mindbody-API-SDKs/blob/97d77fdd4974bd49719e73b0cb40fc04b221e9a6/PublicAPI/mindbody-public-api-python_generic_lib.zip) |
| Location | A Site child with its own `Id`, name, address, description, `HasClasses`, coordinates, and tax configuration. Location events carry `siteId` and `locationId`. | `Location.Id` is meaningful beneath the Site, not a Class family. | A Business may offer different Class families at different Locations. Store and filter the Location separately from the Class-family taxonomy. [Get Locations](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/site/get-locations), [Webhooks: Location](https://developers.mindbodyonline.com/WebhooksDocumentation) |
| Program | Mindbody calls this a **service category**. It has `Id`, name, `ScheduleType` (including `Class`), cancellation offset, content formats, and pricing relationships. | `Program.Id` is a broad provider service-category ID. `GET Programs` can filter by `ScheduleType=Class`, online visibility, or exact IDs. | A Program can be useful for broad grouping such as Yoga, but it is too coarse to represent every customer-selectable Class family when one Program contains multiple kinds. [Get Programs](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/site/get-programs), [official SDK](https://github.com/mindbody/Mindbody-API-SDKs/blob/97d77fdd4974bd49719e73b0cb40fc04b221e9a6/PublicAPI/mindbody-public-api-python_generic_lib.zip) |
| Session Type | The schema says a `SessionType` describes session types in a business. It has a unique `Id`, name, `Type` (including `Class`), `ProgramId`, duration/deduction fields, online description, and optional Category/Subcategory data. `GET Session Types` can filter by Program IDs and online-bookable status. | `SessionType.Id` is provider taxonomy linked to a Program. It is also used directly as the appointment service identifier, so its meaning is not limited to class display labels. | Preserve and display it where the business's configuration makes it useful, but do not assume it is always the one customer-facing “class type.” Use its ID as part of validation/mapping, not a globally meaningful enum. [Get Session Types](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/site/get-session-types), [official SDK](https://github.com/mindbody/Mindbody-API-SDKs/blob/97d77fdd4974bd49719e73b0cb40fc04b221e9a6/PublicAPI/mindbody-public-api-python_generic_lib.zip) |
| Class Description | Mindbody defines this as the reusable class definition. It has `Id`, name, long description, active state, image, level, prerequisites, `Program`, `SessionType`, and optional Category/Subcategory values and IDs. The class-description webhook says its name and description apply to all class schedules using it. | `ClassDescription.Id` is the strongest documented reusable identity for a named class definition. It is not a scheduled occurrence. | Default a Class family's provider mapping to an exact class-description ID. Store provider names as mutable display metadata, not identity. [Get Class Descriptions](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/get-class-descriptions), [Webhooks: Class Description](https://developers.mindbodyonline.com/WebhooksDocumentation), [official SDK](https://github.com/mindbody/Mindbody-API-SDKs/blob/97d77fdd4974bd49719e73b0cb40fc04b221e9a6/PublicAPI/mindbody-public-api-python_generic_lib.zip) |
| Class Schedule | A recurring group that says when, where, and with whom classes occur. Webhooks describe it as the group added to the business, not an individual class. Its payload links `classScheduleId` to `classDescriptionId` and `locationId`. | `ClassSchedule.Id` identifies a recurrence/configuration. Changing its end date can add or remove occurrences; cancelling it removes its associated classes. | Store schedule IDs only when the offer must be narrower than the reusable description, or for cache/reconciliation. Do not book this ID. [Get Class Schedules](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/get-class-schedules), [Webhooks: Class Schedule](https://developers.mindbodyonline.com/WebhooksDocumentation) |
| Class | A single class instance at a date and time. It carries its own unique `Id`, `ClassScheduleId`, Location, capacity/availability, timestamps, cancellation/visibility state, staff, and embedded `ClassDescription`. | `Class.Id` is the dated occurrence used for availability and booking. It can disappear when a schedule is cancelled or shortened. | Return it to the client as a live bookable occurrence and revalidate it server-side. Never use a future occurrence ID as the durable “Hot Yoga” mapping. [Get Classes](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/get-classes), [Webhooks: Class](https://developers.mindbodyonline.com/WebhooksDocumentation), [official SDK](https://github.com/mindbody/Mindbody-API-SDKs/blob/97d77fdd4974bd49719e73b0cb40fc04b221e9a6/PublicAPI/mindbody-public-api-python_generic_lib.zip) |
| Category / Subcategory | Current generated schemas expose Category/Subcategory names and IDs on both `ClassDescription` and `SessionType`. `GET Categories` returns categories with nested subcategories, active/primary/secondary flags, and a `Service` flag. However, the generated endpoint text describes its `Service` filter in terms of revenue versus product-revenue categories. | These are optional provider tags with exact IDs; the first-party material reviewed does not establish them as a universal studio vertical or the canonical class-type level. | Ingest them as optional facets. Do not base booking authorization or the sole selector hierarchy on them until representative production businesses show how their Core configuration populates the fields. [Get Categories](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/site/get-categories), [official SDK](https://github.com/mindbody/Mindbody-API-SDKs/blob/97d77fdd4974bd49719e73b0cb40fc04b221e9a6/PublicAPI/mindbody-public-api-python_generic_lib.zip) |
| Pricing option | `GET Services` returns pricing options. A Service has `ProductId` as its unique pricing-option ID, a separate barcode-like `Id`, and `ProgramId`; it is a commercial entitlement, not the Class occurrence or reusable Class definition. | `Services[].ProductId` is the pricing-option identity. | A Class family can have one or more usable pricing options. Keep their IDs separate from Program, SessionType, ClassDescription, Schedule, and Class IDs. [Get Services](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/sale/get-services), [Webhooks API](https://developers.mindbodyonline.com/WebhooksDocumentation) |

### What a “Hot Yoga” Class family should mean

A normalized Revvi Class family should have its own durable ID and mutable display fields, then carry exact provider mappings such as:

- `mindbody_site_id` (required scope);
- allowed `mindbody_location_id` values;
- one primary `mindbody_class_description_id` per mapping row;
- the expected `mindbody_program_id` and `mindbody_session_type_id` for defensive validation;
- optional Category/Subcategory IDs for filtering;
- optional Class Schedule IDs only if the business needs schedule-level narrowing;
- effective/active state and last validation time.

This indirection is important because real Mindbody businesses can choose names and taxonomy granularity differently. One may configure Program=`Yoga`, SessionType=`Hatha Yoga`, ClassDescription=`Beginning Hatha`; another may put the customer-facing phrase in the Class Description and use a generic Session Type. The schemas support both shapes; they do not define a universal ontology. That conclusion is an inference from the separate provider objects and link fields, not a documented Mindbody configuration rule.

## Relevant discovery and availability reads

An inventory sync for one Site should page through:

1. `GET Sites` for the provider business (request one Site ID when full details are needed).
2. `GET Locations` for physical/virtual locations.
3. `GET Programs` with `ScheduleType=Class`, and optionally `OnlineOnly=true`.
4. `GET Session Types`, filtered by the discovered Program IDs and optionally `OnlineOnly=true`.
5. `GET Class Descriptions` with `IncludeInactive=false`; it can also filter by Program, Location, staff, or a scheduled-class date window.
6. Optionally `GET Categories` to hydrate Category/Subcategory display facets.
7. `GET Classes` for the displayed date window, using exact allowed Location, Program, SessionType, and ClassDescription IDs. The operation also accepts Class Schedule IDs and individual Class IDs.
8. `GET Class Schedules` only when recurring-schedule data is needed for administration, narrowing, or reconciliation.

All these collection operations are paginated. The generated SDK states a default limit of 100, so a one-page assumption will silently omit inventory for sufficiently large businesses. [official generated Public API SDK](https://github.com/mindbody/Mindbody-API-SDKs/blob/97d77fdd4974bd49719e73b0cb40fc04b221e9a6/PublicAPI/mindbody-public-api-python_generic_lib.zip)

`GET Classes` is the correct live availability source: its response combines the occurrence ID, timestamps, location, embedded class definition, availability/cancellation/visibility state, and capacity fields. A selector can first present the normalized Class families, then query occurrences that match the chosen family's exact provider mapping. The booking write must still use and revalidate the selected `Class.Id`.

## Change and synchronization behavior

- `classDescription.updated` is sent when a class name or description changes. Mindbody explicitly tells caches to call `GET ClassDescriptions` and update all classes associated with schedules that use the description. A December 2025 fix made this webhook fire even when the description has no associated schedule. [Webhooks: Class Description](https://developers.mindbodyonline.com/WebhooksDocumentation), [API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- `classSchedule.created` and `.updated` carry Site, Location, Class Schedule, and Class Description IDs plus recurrence/capacity/staff data. A changed schedule end date adds or removes occurrences. `classSchedule.cancelled` means all classes associated with the schedule are removed. [Webhooks: Class Schedule](https://developers.mindbodyonline.com/WebhooksDocumentation)
- `class.updated` represents a change to one dated occurrence and includes `siteId`, `locationId`, `classId`, `classScheduleId`, and `classDescriptionId`. [Webhooks: Class](https://developers.mindbodyonline.com/WebhooksDocumentation)
- Site and Location create/update/deactivate events are documented. The reviewed webhook catalog does not document Program, SessionType, Category, or Subcategory change events. Treat that absence as a polling requirement, not proof that these records never change. [Webhooks API](https://developers.mindbodyonline.com/WebhooksDocumentation)
- `GET Classes` supports `LastModifiedDate` and returns records modified on or after it. `GET Class Descriptions`, `GET Programs`, `GET Session Types`, and `GET Categories` do not expose an equivalent modified-since query in the current generated SDK, even though a class description carries a `LastUpdated` value. Those catalogues require bounded full refreshes. [Get Classes](https://developers.mindbodyonline.com/ui/documentation/public-api#/http/mindbody-public-api-v6-0/api-endpoints/class/get-classes), [official SDK](https://github.com/mindbody/Mindbody-API-SDKs/blob/97d77fdd4974bd49719e73b0cb40fc04b221e9a6/PublicAPI/mindbody-public-api-python_generic_lib.zip)
- Webhook delivery is retry-based, can duplicate, and is not a complete cache protocol. Mindbody recommends idempotent event handling and a Public API cache sync every 24 hours. It retries failed deliveries every 15 minutes and stops after three hours. [Webhooks reliability and best practices](https://developers.mindbodyonline.com/WebhooksDocumentation)

Recommended behavior is therefore webhook-triggered targeted refresh plus a daily paginated full catalogue refresh. For near-term availability, query `GET Classes` for a rolling date window rather than attempting to maintain an unbounded permanent occurrence catalogue.

## Consequences for the feature design

1. Replace the assumption “partner has one studio type, therefore one class type” with a one-to-many collection of Class families.
2. Keep Revvi's partner/studio classification separate from provider inventory taxonomy.
3. Give each Class family a stable Revvi ID and map it to exact Site-scoped Mindbody IDs; names are mutable display data.
4. Use `ClassDescription.Id` as the default reusable provider mapping, while preserving and validating Program and SessionType IDs and permitting optional schedule-level narrowing.
5. Show multiple Class-family choices only when they have at least one active, online-visible, allowed occurrence in the requested horizon; distinguish “configured but no upcoming Classes” from deleted/deactivated configuration.
6. Keep pricing-option Product IDs separate. Multiple class descriptions might share a pricing option, and one class might be payable by multiple options.
7. Model Category/Subcategory as optional facets until production evidence establishes consistent use across partners.
8. Reconcile taxonomy changes daily even when webhooks are enabled, because the webhook catalog does not cover every taxonomy object.

## Codebase investigation

The production system is closer to supporting this than the current Webflow journey suggests. Its durable safety model is Offer-scoped, not studio-type-scoped.

### What already supports more than one family

- `class_revvi_offers` permits multiple Offers for the same Business and Location. Its uniqueness rules are on Business/Offer identity and Business/slug, not one Offer per Location. [Class ledger migration](../../supabase/migrations/20260810000000_issue_31_class_ledger.sql)
- One Offer mapping can contain multiple Location, Program, Class Description, Session Type, and Class Schedule allowlist rows. [Class ledger migration](../../supabase/migrations/20260810000000_issue_31_class_ledger.sql)
- Availability requests Mindbody with arrays of approved taxonomy IDs, then rechecks the returned Location, active/cancelled state, Class Description, Program, Session Type, optional schedule, date range, and exact Product ID before returning a Class occurrence. [Availability module](../../supabase/functions/_shared/class-availability.js)
- Normalized occurrences already carry `classDescriptionId`, `programId`, `sessionTypeId`, name, and description, so two approved descriptions can be rendered with different provider names. [Availability module](../../supabase/functions/_shared/class-availability.js)
- Authorization, quote, Booking attempt, Booking, lifecycle, cancellation, reconciliation, and support records carry exact Offer, mapping, Location, and occurrence references. Those modules do not assume that a Business has only one Class Description. [Offer authorization](../../supabase/functions/_shared/class-offer-authorization.js), [Class ledger migration](../../supabase/migrations/20260810000000_issue_31_class_ledger.sql)
- The Mindbody read adapter already paginates all collection endpoints. [Mindbody Class read adapter](../../supabase/functions/_shared/mindbody-class-read.js)

These capabilities mean the Booking engine should not be rewritten. The change belongs ahead of, and inside the configuration resolved by, the existing Offer availability seam.

### The actual single-family assumptions

1. The Webflow embed requires one preselected `data-offer-id`; its contract test explicitly describes “one stable Offer.” There is no production catalogue or Class-family selector. [Webflow embed](../../webflow/embed.html), [widget contract test](../../tests/production/webflow-widget-contract.test.mjs)
2. `offer-class-availability` requires `offerId` and immediately resolves one mapping. It returns a flat occurrence list rather than named Class-family groups. [Availability request](../../supabase/functions/_shared/class-availability-request.js), [availability catalogue](../../supabase/functions/_shared/class-availability-catalogue.js)
3. Approved inventory is stored as independent sets by entity kind. It does not preserve the correlation “Class Description A must have Program B and Session Type C.” With several values per kind, the runtime admits any returned combination whose fields independently appear in those sets. Exact Class Description checking makes this safer than name matching, but it cannot represent multiple correlated family mappings cleanly.
4. Inventory and commercial fulfilment share `class_offer_provider_mappings`. Inventory changes bump that mapping's version and invalidate mode, cancellation, and pilot evidence. This is valuable fail-closed behavior, but treating every family as a separate Offer would duplicate eligibility, fulfilment configuration, activation evidence, and operational work. [Existing-entitlement evidence migration](../../supabase/migrations/20260810230000_issue_37_existing_entitlement_evidence.sql), [pilot readiness migration](../../supabase/migrations/20260811230000_issue_41_class_pilot_readiness.sql)
5. The automated availability fixtures prove only one approved Class Description/Program/Session Type tuple. There is no regression test for two selectable families, cross-family authorization, renaming, or one family having no upcoming occurrences. [Availability tests](../../tests/production/class-availability.test.mjs), [Webflow browser tests](../../tests/production/webflow-class-widget-browser.test.mjs)

The binding PRD statement that the Customer reaches an Offer page with Business, Location, and Offer already selected remains compatible with multiple Class families. A Revvi Offer is the benefit and commercial arrangement; a Class family is the customer's inventory choice inside that Offer. [Code PRD](../CODE_PRD.md)

## Options considered

### Use one Revvi Offer per Class family

This needs the fewest schema changes and the current ledger permits it. It is correct only when Hot Yoga and Restorative Yoga truly have different Revvi eligibility, price, fulfilment mode, or activation evidence. Using it solely to obtain two selector cards conflates inventory with commercial terms and causes configuration and evidence duplication.

### Group the current flat occurrence response in the browser

This could group by `classDescriptionId` and provider name with little backend work. It leaves no Revvi-owned family identity or presentation, cannot preserve correlated provider mappings, makes renamed provider data control the UI, and forces the system to fetch a broad mixed schedule before the Customer chooses. It is suitable as a disposable prototype, not the durable model.

### Add Class families beneath the existing Offer mapping

This preserves the proven Offer-scoped Booking pipeline while adding the missing one-to-many inventory concept. Each family gets a Revvi ID and presentation plus one or more correlated provider mappings. The existing Offer mapping remains the commercial and evidence boundary, so a family change can continue to bump its mapping version and fail closed. This is the recommended design.

## Recommended target design

Introduce two normalized tables rather than adding more meaning to the current entity-kind allowlist:

```text
class_offer_families
  id, business_id, offer_id, mapping_id
  slug, display_name, description, display_order, status

class_family_provider_mappings
  id, business_id, class_family_id
  provider_location_id
  provider_class_description_id
  expected_provider_program_id
  expected_provider_session_type_id
  optional provider_category_id / provider_subcategory_id
  optional schedule narrowing in a child allowlist
```

One Class family may have several provider-mapping rows when a Business uses several Class Descriptions for one customer-recognisable choice. Each row preserves the expected tuple instead of constructing a cross-product of independent allowlists. IDs are always interpreted inside the Offer's activated Site and Location.

Keep `provider_service_product_id`, fulfilment mode, mapping version, activation evidence, and write gates on `class_offer_provider_mappings`. Add the selected `class_family_id` to the quote and Booking lineage so support and revalidation can prove which family the Customer selected; do not make it a new payment or fulfilment boundary.

### Deep module and interface

Deepen the current availability module at the same seam rather than introducing family logic in Webflow and every handler:

```ts
listAvailableClassFamilies({
  businessSlug,
  locationId,
  offerId,
  startDate,
  endDate,
  customer,
}): Promise<ClassFamilySummary[]>

getClassFamilyAvailability({
  businessSlug,
  locationId,
  offerId,
  classFamilyId,
  startDate,
  endDate,
  customer,
}): Promise<ClassOccurrence[]>
```

The interface's invariants should be:

- identity and Offer eligibility are checked once per request before family metadata or live inventory is returned;
- every returned family belongs to the exact active Business, Location, Offer, mapping, and current mapping version;
- every returned occurrence matches one complete provider-mapping tuple for the selected family;
- the selector shows only families with at least one live eligible occurrence in the requested horizon, while the response distinguishes a temporarily empty family from an inactive or invalid mapping;
- changing family selection cannot carry a quote or selected `Class.Id` from the previous family;
- quote and Booking writes revalidate the exact family, occurrence, mapping version, and Offer immediately before provider work.

Mindbody is a true external dependency at this seam. Keep the current production HTTP adapter and deterministic test adapter; callers should not learn Mindbody taxonomy or pagination rules.

### Webflow journey

Keep the Offer page's Business, Location, and Offer references. Replace the immediate flat schedule with:

1. authenticate and load available Class families for the chosen date horizon;
2. render no selector when exactly one family is available, otherwise render Revvi-authored family cards or a select control;
3. load/render only the selected family's occurrences;
4. clear selected occurrence, quote, and stale-response state whenever the family changes;
5. keep all existing quote, confirmation, payment-action, reconciliation, cancellation, and history behavior after a valid occurrence is selected.

An optional family ID in the URL may support deep links, but it is only a hint. The server must resolve it against the authenticated Offer context.

## Migration and delivery slices

1. **Characterization:** add two-family tests around the current runtime, including different Class Description/Program/Session Type tuples, and prove the downstream Offer-scoped ledger needs no rewrite.
2. **Schema:** add Class-family and correlated provider-mapping tables, composite tenant/Offer/Location foreign keys, RLS, activation validation, and mapping-version invalidation. Backfill a single default family only for mappings whose existing allowlist can be converted unambiguously. Leave multi-valued ambiguous mappings inactive for operator review rather than inferring a cross-product.
3. **Availability module:** resolve a family catalogue and exact family context, query paginated provider inventory, validate full tuples, and keep the live `Class.Id` as the occurrence key.
4. **HTTP contracts:** add family catalogue/availability inputs and normalized responses. Preserve existing response envelopes and fail-closed Origin, authentication, tenant, and eligibility checks.
5. **Webflow:** add selector states, family switching, stale-request protection, single-family auto-selection, empty-family messaging, and accessible keyboard behavior.
6. **Quote and ledger:** persist/revalidate `class_family_id` through quote, attempt, Booking, diagnostics, lifecycle, and support projections without changing fulfilment-mode selection.
7. **Operations and sync:** update onboarding to capture representative taxonomy, add webhook-triggered refresh plus daily paginated catalogue reconciliation, and require evidence for renamed/deactivated/reclassified families before activation.
8. **Pilot:** validate at least two real multi-family Businesses before treating Session Type or Category/Subcategory as a consistent display hierarchy.

### Required regression scenarios

- Yoga Business with Hot Yoga and Restorative Yoga at one Location under one Offer.
- Two families sharing a Program but using different Class Descriptions and Session Types.
- One family backed by multiple Class Descriptions.
- Same Class Description used at two Locations but approved at only one.
- Provider returns a Class Description with an unexpected Program or Session Type: reject it.
- One family has no upcoming Classes while another is available.
- Family renamed in Mindbody while the Revvi display label remains stable until reviewed.
- Family changes while an old availability request or quote is in flight: discard/invalidate it.
- Customer eligible for the Offer but selecting a family outside its mapping: reject before quote/provider write.
- More than 100 provider records: pagination remains complete; more than the per-request safety limit fails closed.

## Documentation consequences

- Update the binding product model and frontend contract in `docs/CODE_PRD.md` only when the target design is accepted; the current wording does not forbid multiple Class families, but request/response and schema examples are single-family.
- Extend `docs/onboarding/mindbody-business-onboarding.md` with a per-Location Class-family mapping worksheet and the pilot questions below.
- Record an ADR if this design is accepted. Separating Class family from Revvi Offer is hard to reverse, changes the durable schema and request identity, and deliberately rejects the simpler one-Offer-per-family alternative.

## Pilot questions to answer with representative businesses

The first-party schemas establish the available objects but not how consistently Mindbody subscribers configure them. Before hard-coding UI labels or onboarding rules, capture sample responses from at least two multi-type class businesses and answer:

- Which field contains the label their customers recognize as “Hot Yoga”: Program, SessionType, ClassDescription, or Category/Subcategory?
- Can two active Class Descriptions at the same Site share the same Program and SessionType while remaining distinct Class families?
- Are Category/Subcategory populated for classes, and does `GET Categories` enumerate the same IDs returned by ClassDescription/SessionType?
- Can one ClassDescription be scheduled at multiple Locations with different commercial eligibility?
- Which pricing-option Product IDs are valid for each class description and location?
- What changes in each response when an owner renames, deactivates, reclassifies, or unschedules a class definition?

## Source record and limitation

- [Mindbody Public API V6 reference](https://developers.mindbodyonline.com/ui/documentation/public-api)
- [Mindbody official generated API SDK repository](https://github.com/mindbody/Mindbody-API-SDKs), with the Public API Python archive pinned to commit [`97d77fdd4974bd49719e73b0cb40fc04b221e9a6`](https://github.com/mindbody/Mindbody-API-SDKs/commit/97d77fdd4974bd49719e73b0cb40fc04b221e9a6) dated 2025-12-23. The archive's generated controller and model documentation supplied the exact fields and filters summarized above.
- [Mindbody Webhooks API](https://developers.mindbodyonline.com/WebhooksDocumentation)
- [Mindbody API release notes](https://developers.mindbodyonline.com/Resources/ApiReleaseNotes)
- [Mindbody API FAQ](https://developers.mindbodyonline.com/ui/faq)

The generated Public API SDK snapshot predates the research date. Current portal documentation and release notes were checked for later class-taxonomy changes, but representative authenticated production payloads were not available. In particular, the precise business meaning and consistency of Category/Subcategory should be sandbox- and pilot-validated before it drives the customer experience.

# Physical Webflow Site -99 demo

This preview lets Revvi demonstrate the existing Webflow Booking widget against live Mindbody public-sandbox Class data. It is a local, loopback-only provider demo—not a production deployment.

## What the audience sees

1. The already-selected Revvi partner, Offer, and Mindbody public-sandbox Location.
2. Ten approved Class options in step one: eight currently selectable families plus truthful disabled cards for unavailable Sweat and cancelled RPM Spinning.
3. A purple evidence panel listing the exact live Mindbody Class IDs, instructor, availability state, and times returned by the current Site `-99` inventory read. No schedule fixture is embedded in the manual demo.
4. Real dates and times for the selected Class, with duplicate start times distinguished by their live instructor.
5. A client-aware provider quote calculated twice with `Test=true` and no provider mutation.
6. A **Reserve my spot** action using fictitious sandbox Cash; no card details are collected.
7. A truthful confirmation outside the booking widget only after the Sale, Cash Payment, ClientService, Visit, roster, and Client Schedule converge.
8. A ten-minute inspection window in which the exact Visit remains active in Mindbody Business.
9. Manual cleanup from the widget, with automatic and shutdown cleanup as safety backstops.

The page labels that its local identity does not prove Memberstack. The hosted Webflow staging demo must use a real Memberstack test member instead.

The review step intentionally says **Reserve my spot**, not checkout or pay. Site `-99` proves only the fictitious Cash route. Production payment remains gated until an approved hosted, redirect, opaque-token, or saved-card route is known and tested without raw card data entering Revvi.

Mindbody may record that requested sandbox Cash tender under the Site's current configured payment-method label rather than the literal word `Cash`. The demo preserves that returned label separately and confirms only when the exact new Sale has one identified payment for the quoted total; it does not infer that a card named by the sandbox label was supplied or charged.

## Start the preview

From the repository root, install dependencies if needed and build the committed Webflow assets:

```bash
pnpm install
pnpm build:webflow
```

Create `webflow/.env` once with the Site `-99` credentials and stable selectors. The file is gitignored and loaded directly by the dev command, including when it has CRLF line endings:

```dotenv
MINDBODY_API_KEY=<sandbox-api-key>
MINDBODY_SANDBOX_USERNAME=<sandbox-staff-username>
MINDBODY_SANDBOX_PASSWORD=<sandbox-staff-password>
MINDBODY_SANDBOX_SITE_ID=-99
MINDBODY_SANDBOX_CLASS_FAMILIES_JSON='[{"id":"00000000-0000-4000-8000-000000000101","name":"Yoga","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Yoga","classDescriptionName":"Yoga","sessionTypeName":"Hatha Yoga"}]},{"id":"00000000-0000-4000-8000-000000000102","name":"Daily Work Out","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Classes","classDescriptionName":"Daily Work Out","sessionTypeName":"Work out of the day"}]},{"id":"00000000-0000-4000-8000-000000000103","name":"Pilates 101","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Classes","classDescriptionName":"Pilates 101","sessionTypeName":"Pilates"}]},{"id":"00000000-0000-4000-8000-000000000104","name":"Zumba","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Classes","classDescriptionName":"Zumba","sessionTypeName":"Spinning"}]},{"id":"00000000-0000-4000-8000-000000000105","name":"Level 5 Bikram Yoga","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Classes","classDescriptionName":"Level 5 Bikram Yoga","sessionTypeName":"Yoga"}]},{"id":"00000000-0000-4000-8000-000000000106","name":"Body Pump","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Classes","classDescriptionName":"Body Pump","sessionTypeName":"Les Mills"}]},{"id":"00000000-0000-4000-8000-000000000107","name":"RPM Spinning","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Classes","classDescriptionName":"RPM Spinning","sessionTypeName":"Spinning"}]},{"id":"00000000-0000-4000-8000-000000000108","name":"Sweat","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Classes","classDescriptionName":"Sweat","sessionTypeName":"Work out of the day"}]},{"id":"00000000-0000-4000-8000-000000000109","name":"Power Yoga","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Classes","classDescriptionName":"Power Yoga","sessionTypeName":"Yoga"}]},{"id":"00000000-0000-4000-8000-000000000110","name":"Yoga","pricingOptionName":"5 Class Card","selectors":[{"locationName":"Clubville","programName":"Classes","classDescriptionName":"Yoga","sessionTypeName":"Yoga"}]}]'
MINDBODY_SANDBOX_WRITE_CONFIRM=BOOK_AND_CANCEL_SITE_-99
```

Restrict the local file and start the preview from the repository root:

```bash
chmod 600 webflow/.env
pnpm demo:webflow:site99
```

The command clears inherited Mindbody variables before loading `webflow/.env`, so stale values exported by an earlier shell cannot override this file. Do not run `source webflow/.env`; Node's dotenv loader handles quoting and line endings.

If startup stops with `SELECTOR_NO_MATCH` or `PRODUCT_SELECTOR_NO_MATCH`, read the terminal's `detail` and `candidates=` value. Update only the affected stable name to the exact current live record shown there, then restart; do not guess a numeric provider ID.

The selector manifest is stable Revvi configuration. For every demo operation, the runner reads the current Site `-99` Location, Program, Class Description, Session Type, Class occurrence, and Class-filtered `/sale/services` data, then resolves the provider IDs for that operation. Taxonomy and pricing-option names are matched case- and whitespace-insensitively but must identify exactly one current live record. Selector mode ignores any stale `MINDBODY_SANDBOX_PRODUCT_ID`; the package command clears inherited provider variables before loading `webflow/.env`, keeping the normal shell environment separate from the legacy raw-ID investigation path.

The sandbox demo is configured to use the finite `5 Class Card` pricing option because the public sandbox exposes several valid purchase options for the same Class. Its Product ID may change after a reset. The resolved Product must still be returned by Mindbody for each exact current Class, online, not discontinued, valid for sale and use at the selected Location, and shared across all ten selected formats. Site `-99` attaches these pricing options through related Programs, so the runner deliberately keeps related-program results and then applies the exact stable pricing-option name. Missing or duplicate name matches stop the demo with a safe `ProductId:Name` diagnostic. The runner never chooses by price or numeric ID. For controlled investigations only, it still accepts the legacy exact-ID manifest together with a freshly re-read `MINDBODY_SANDBOX_PRODUCT_ID`.

Step one preserves the manifest order and shows all ten approved options from an API-key-only Mindbody catalogue read. Each available card includes its next live occurrence, instructor, duration, and provisional price. The runner validates only one representative occurrence per available family, concurrently, instead of reading pricing for every occurrence; the current ten-family Site `-99` catalogue completed in about 3.6 seconds during implementation verification. Selecting a card is immediate and remains in step one. **Continue** loads and validates only that family's complete current times with at most six concurrent provider reads, then opens step two. The exact selected Class is checked again with the sandbox Client during quote. A configured family that Mindbody reports as unavailable remains visible but disabled, and a family whose observed occurrences are all cancelled remains visible with a **Cancelled** label. Multiple occurrences in the same family stay on one card; when two occurrences share a start time, step two includes the live instructor name so the choices remain distinguishable.

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) on the same computer. The server binds only to `127.0.0.1`; it is not exposed to the local network or internet.

Stop it with `Ctrl+C`. The server first cleans any active demo Booking and only exits after Mindbody confirms removal. If cleanup is not confirmed, it remains running so you can retry. The ignored `webflow/.env` remains available for the next local run; remove it when this sandbox work is finished.

## Automated browser E2E

With the same restricted `webflow/.env`, run:

```bash
pnpm sandbox:webflow:e2e
```

This launches Chrome against the loopback server and drives only the production widget controls: select a live Class, continue, select a live time, obtain the twice-calculated quote, reserve with fictitious Cash, wait for provider evidence, and request exact cleanup from the confirmation screen. The command passes only when the UI confirms cancellation and shutdown confirms that every tracked sandbox Booking was cleaned. It clears inherited provider variables, binds only to `127.0.0.1:3000`, never prints credentials, and always attempts shutdown cleanup even when the browser journey fails.

## How to test it physically

Use this short script during the demonstration:

1. Point out the purple sandbox boundary banner and the already-selected partner and Location.
2. Show the ten configured Class cards in step one. Point out that selectable classes, unavailable Sweat, and cancelled RPM Spinning mirror Mindbody rather than being typed into the page.
3. Select a Class immediately, then click **Continue** to load that family's complete live dates and times. Choose a time and continue to review.
4. Review the provider-calculated quote and cancellation explanation, then click **Reserve my spot** once. The operation can take several seconds because it waits for six independent Mindbody evidence surfaces.
5. Leave the external confirmation page open. Its **Mindbody provider evidence** block gives the exact Site, Class ID, synthetic Client name/ID, Cash Sale ID, Payment ID, Visit ID, and automatic-cleanup time. It explicitly says when the Visit is active.
6. In a second tab, sign in at [Mindbody Business](https://business.mindbodyonline.com/) and select Site `-99`.
7. Search Clients for the exact `Revvi Sandbox …` name or Client ID shown in the evidence block. Open that Client and inspect its upcoming schedule/visits; match the displayed Class ID and Visit ID. You can also open the Class roster for that Class occurrence and find the same Client/Visit. The displayed Cash Sale and Payment are available in the Client's purchase history.
8. Return to the widget and click **Clean up demo Booking**. Double-clicking is suppressed. Wait for **Sandbox Booking verified and removed safely**.
9. Refresh the Mindbody Client or Class roster and confirm the Visit is gone. The sandbox Sale can remain as retained evidence.
10. Refresh the demo page to demonstrate fresh live discovery rather than cached fixture data.

If you do not click the cleanup button, the server attempts exact cleanup after ten minutes. It retries if another provider request is in progress. Pressing `Ctrl+C` also attempts cleanup before shutdown.

If the result says it is being reconciled, do not click again with a new request. Keep the server running and retain the terminal's safe error code so exact cleanup can continue.

## Hosted Revvi staging deployment

The hosted adapter uses the linked Supabase staging project and the normal production-shaped Class endpoints. It is not the loopback demo server:

- `offer-class-availability`
- `booking-quote`
- `create-booking`
- `cancel-booking` (also powers the visible **Clean up demo Booking** action)
- `class-lifecycle-worker` for queued read-only reconciliation

Configure these secret names in Supabase without committing their values:

- `MINDBODY_API_KEY`
- `MINDBODY_SANDBOX_USERNAME`
- `MINDBODY_SANDBOX_PASSWORD`
- `MINDBODY_SANDBOX_CLASS_FAMILIES_JSON` with the same stable-name manifest used by the loopback demo
- the existing Memberstack application, contract-evidence, and server-secret values
- `ALLOWED_ORIGINS` containing the exact published Webflow origin

Before availability, quote, and pre-write quote revalidation, the hosted functions refresh Site `-99` Location, Program, Class Description, Session Type, and pricing-option IDs from that stable-name manifest. The database remains authoritative for the approved Revvi family UUIDs, Offer, Customer, and write gates; a missing family, ambiguous name, or non-Location-1 result fails closed. This prevents the daily sandbox reset from silently leaving Supabase on yesterday's provider IDs.

The server issues a temporary Site `-99` staff token for each provider write operation and revokes it in `finally`; the token is never returned to Webflow or persisted. The database gate additionally requires sandbox environment, Site `-99`, provider Location `1`, payment route `mindbody_sandbox_cash`, and the explicit operator flag. Any authenticated member with the Offer’s eligible plan can use that enabled route; the legacy demo Customer field is not an authorization rule. Mindbody may return the Cash payment under a reset-generated display label; hosted reconciliation preserves that provider label but accepts it only alongside the exact Sale, Payment ID, quoted amount, Product, Class, Client, ClientService, and Visit evidence.

Use the following stable context in the Webflow `/book` widget:

- Business slug: `lastspot-sandbox`
- Location UUID: `df893f87-6ca7-4417-88e9-25067b42ee37`
- Offer UUID: `0b3e181e-a718-4098-aa58-9275763f4419`
- Location label: `Clubville`
- IANA timezone: `Africa/Johannesburg`
- Offer label: `Revvi Yoga Clubville`

Point each `SUPABASE_FUNCTIONS_URL` placeholder in `webflow/embed.html` at `https://hqjgsqlniuhphvhyeejm.supabase.co/functions/v1`. Publish the versioned `webflow/dist/` JavaScript and CSS on an HTTPS origin that Webflow allows, then use the real Memberstack test Customer on the protected page.

The hosted confirmation leaves the exact Visit active until the operator clicks **Clean up demo Booking**. Unlike the loopback preview, hosted Edge Functions do not promise an in-process ten-minute timer; unresolved cleanup stays locked and is handled by the lifecycle reconciliation/support path.

## Boundaries

- The preview cannot target any Mindbody Site other than `-99` or any origin other than Mindbody's official Public API origin.
- Every committed run uses a unique, non-personal synthetic Mindbody Client.
- The Cash tender is fictitious sandbox evidence only.
- This does not prove the production payment route in issue #40 or activate a production Business under issue #41.

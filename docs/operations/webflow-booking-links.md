# Copy booking links into Webflow

In the Supabase project, open **Table Editor → public → webflow_booking_links**. Find the row by `partner_name`, `location_name`, and `offer_name`, then copy `booking_url` into a Webflow Link field named **Booking URL**. Bind the partner/offer page's booking button to that field.

The view derives one row per configured Offer from the existing Business, Location, and Offer records. No one generates or types UUIDs. It updates automatically as those records change; the copied Webflow value does not update automatically, so copy it again if the Business slug or selected Offer changes.

`booking_context_active` means the Business, Location, integration, Offer, and matching provider mapping are active. It does not certify live inventory, member eligibility, or provider-write readiness. Draft and inactive rows remain visible for staff inspection.

`booking_url` targets the current staging Webflow domain. `booking_path` is the relative `/book?...` equivalent for another domain. Change the view's domain when moving to the public site. The view also exposes the three identifiers and display timezone individually for troubleshooting.

The view is for project staff and service-role access, not anonymous browser access, and uses invoker security.

The `/book` widget reads these three URL parameters together before authentication or availability. Incomplete, duplicated, or malformed references fail without falling back to sandbox attributes. A bare `/book` requires a partner link, except when recovering a pending login in the same tab. Fixed-context embeds on other routes continue to use their attributes.

The first availability request omits dates so Supabase chooses today in the authorized Location's timezone. Both availability adapters return `location: { id, name, timezone }`; the widget checks the Location ID and uses this metadata instead of the embed's display defaults. Webflow does not need to add names or timezones to the URL.

## Webflow publishing checklist

1. Keep the existing `/book` embed and its Supabase endpoint attributes. It must load the updated hosted `revvi-booking.js`. Do not gate or redirect the entire `/book` page before the widget can load: Supabase enforces authentication and Offer eligibility.
2. Replace the partner template's old Before `</body>` script with [partner-page.html](../../.tmp/partner-page.html). Configure its wrapper, booking button, location fields, and membership attributes using [the binding instructions](../../.tmp/README.md).
3. Copy the exact Offer's `booking_url` from the Supabase view into the corresponding CMS booking-link field. For a location dropdown, bind it to `data-location-booking-link`; without a dropdown, bind it to the wrapper's `data-booking-link`. Set `data-booking-flow` to `revvi-booking`. Affiliate locations retain their external links and `affiliate` flow.
4. For the sandbox, use the Test Plan binding `data-plan-id="pln_test-plan-0tv40j5v"` as described in the partner instructions.
5. Publish. Start at the partner page, select the location, and follow its booking button. Confirm the URL, displayed Location, Class times, quote, and final booking match the intended Offer.
6. Also open that complete booking link while signed out. Choose **Sign in to book** and confirm the same Offer loads after login.

The widget uses Memberstack's [DOM login modal](https://docs.memberstack.com/hc/en-us/articles/17242931820443-Working-with-Memberstack-DOM-Package-Modals), then resumes on the current URL. If using other Memberstack login/signup buttons on this page, set `data-ms-redirect="current-url"` to preserve the complete URL ([Memberstack guidance](https://docs.memberstack.com/hc/en-us/community/posts/17093001384347-How-to-implement-a-login-modal-that-keeps-users-on-the-current-page-rather-than-redirecting-them)). Same-tab recovery also handles a return to `/book` with missing parameters for up to 30 minutes; it stores only the three references and clears them after successful availability. Cross-domain redirects, another tab, or blocked storage require retaining the full URL. No global redirect to an arbitrary destination is installed.

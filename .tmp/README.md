# Partner template working copy

Paste `partner-page.html` into the partner template's Before `</body>` custom code, replacing the original script. `partner-page.js` is the same source without script tags. These are working files only; nothing has been published or deployed.

## Webflow bindings

On ONE wrapper enclosing all partner content (including tier labels, booking CTAs and locations), add:

| Attribute | Value |
| --- | --- |
| `data-partner-page` | `true` |
| `data-booking-flow` | Bind to CMS `bookingFlow`: exactly `affiliate` or `revvi-booking` |
| `data-booking-link` | The page's booking destination, when there is no location selector. For `revvi-booking`, bind CMS `bookingLink` copied from the Supabase view. For `affiliate`, use the existing external affiliate destination. |

The collection field alone is not visible to JavaScript; these attributes expose its value. If Webflow conditionally renders separate flow wrappers, only the visible/active wrapper should carry `data-partner-page`.

Keep `data-partner-booking-link` on either the actual booking anchor or its direct parent. Multiple booking CTAs within the page are updated together. Keep `.btn-text` on their label spans. Use an empty `data-partner-access-error` text element, initially hidden, with text such as: **We couldn't check your membership. Please refresh and try again.**

Keep existing `data-tier-id` bindings for the production tiers. Alternatively, add `data-plan-id` with an exact allowed Memberstack plan ID to a tier element inside the wrapper. Multiple elements mean any matching active plan may show the booking CTA. This is presentation only: Supabase independently checks the selected Offer's eligibility.

For the sandbox, use `data-plan-id="pln_test-plan-0tv40j5v"` or `data-tier-id="member-test-plan"`. The existing `member-testing` alias still means `pln_testing-free-plan-v65y0e68`; these are DIFFERENT plans. Do not replace that old alias globally. The sandbox page currently publishes `member-complete`; update its allowed-tier binding for the Test Plan intentionally.

Memberstack's DOM member object documents plan connection `status`; it does not always include the Admin API's `active` flag. The working script requires ACTIVE/TRIALING status and rejects explicit `active:false`, while accepting an omitted active flag. Reference: https://docs.memberstack.com/hc/en-us/articles/11234311357211-How-to-Get-a-Member-ID

## Location dropdown

Keep `data-location-city` and `data-location-name` on each `.location-dropdown-name` item.

- Affiliate location: `data-location-link` = its external destination, as before.
- Revvi location: `data-location-booking-link` = that exact location AND Offer's link copied from `webflow_booking_links`.

Do not reuse the partner's default link for every location. A Revvi Offer belongs to one Location. If there are multiple Offers at the same Location, the button/selection must identify the intended Offer too.

With a dropdown, no destination is enabled until selection. Selecting an incomplete item clears the previous destination so the customer cannot accidentally book the previous Location. Without a dropdown, the configured page destination is used directly.

Revvi links must be same-origin `/book` links with exactly one `businessSlug`, `locationId`, and `offerId`. Use `booking_path` from the view if testing on a different Webflow domain; the absolute staging link will intentionally be rejected on another origin. Affiliate URLs accept HTTP(S). Both flows reject javascript/data URLs.

City grouping now detaches items before removing CMS wrappers, retaining item state, and uses a Map so arbitrary city labels are handled correctly. Non-anchor location items receive keyboard controls. Existing gallery and accordion behavior is retained, with a guard against missing accordion content.

## Debug and access

`?debug=true&tier=member-complete` etc. still preview visual states, but disable booking destinations. Debug URLs never grant membership. A Memberstack error shows the error element; inactive/cancelled plans don't unlock the CTA. This browser UI is not authorization for affiliate offers or Supabase bookings. Anything confidential needs actual access controls outside this script.

## Still outstanding on /book

This script only sends the visitor to the configured link. `/book` still needs to read the three parameters before widget initialization and obtain the matching location display/timezone information. Its existing hardcoded sandbox embed does not switch context based on these URLs. It must also preserve that context if login redirects occur. That separate implementation has NOT been included here.

## Checks

`node --check .tmp/partner-page.js` checks syntax. `check-partner-page.mjs` runs isolated browser fixtures for both flows, location selection, bad/missing links, active/inactive membership, Test Plan mismatch, debug behavior, and lookup failure. It uses this workstation's existing Playwright/Chromium installation and `/tmp/revvi-partner-jquery.js`; it is a disposable local harness, not a portable repo test command.

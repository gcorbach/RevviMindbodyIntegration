# Copy booking links into Webflow

In the Supabase project, open **Table Editor → public → webflow_booking_links**. Find the row by `partner_name`, `location_name`, and `offer_name`, then copy `booking_url` into a Webflow Link field named **Booking URL**. Bind the partner/offer page's booking button to that field.

The view derives one row per configured Offer from the existing Business, Location, and Offer records. No one generates or types UUIDs. It updates automatically as those records change; the copied Webflow value does not update automatically, so copy it again if the Business slug or selected Offer changes.

`booking_context_active` means the Business, Location, integration, Offer, and matching provider mapping are active. It does not certify live inventory, member eligibility, or provider-write readiness. Draft and inactive rows remain visible for staff inspection.

`booking_url` targets the current staging Webflow domain. `booking_path` is the relative `/book?...` equivalent for another domain. Change the view's domain when moving to the public site. The view also exposes the three identifiers and display timezone individually for troubleshooting.

The view is for project staff and service-role access, not anonymous browser access, and uses invoker security.

The current `/book` widget still reads embed attributes. Reading these URL parameters and initializing the widget with their context is a separate outstanding change; generated links alone do not make the page switch Offers.

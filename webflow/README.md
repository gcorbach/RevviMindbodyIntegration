# Revvi Offer Class Booking widget

This directory contains the production Webflow widget for one already-selected Revvi Offer and Business Location. Webflow supplies presentation text and the stable Supabase references only. Eligibility, approved Class inventory, price, and Offer fulfilment mode remain server-owned.

## Webflow installation

1. Add the markup from `embed.html` to the existing Offer page.
2. Bind `data-business-slug`, `data-location-id`, and `data-offer-id` to the corresponding stable CMS fields. Bind the display names and Location timezone to their presentation fields.
3. Include `dist/revvi-booking.css` and `dist/revvi-booking.js` after Memberstack's supported DOM package has loaded.
4. Do not add a Location picker. The page has already selected the Location; the widget displays it and sends its stable UUID back to Supabase for validation.

The three endpoint attributes may be omitted when the functions use their standard `/functions/v1/...` paths. They exist so Webflow preview and controlled test deployments can point to an explicitly configured Supabase function origin.

## Build

Run `pnpm build:webflow`. The committed `dist/` files are the only browser assets Webflow needs.

The browser sends exactly one Memberstack bearer JWT. It never sends Memberstack plan IDs, a Mindbody credential, a price, a ProductId, or an Offer fulfilment mode. A displayed price is provisional until the client-aware quote is accepted, and the widget never collects raw card data.

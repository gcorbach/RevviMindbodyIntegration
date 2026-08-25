# Revvi Offer Class Booking widget

This directory contains the production Webflow widget for one already-selected Revvi Offer and Business Location. Webflow supplies presentation text and the stable Supabase references only. Eligibility, approved Class inventory, price, and Offer fulfilment mode remain server-owned.

The `/book` route follows the approved prototype flow: choose a live Class, choose one of its real dates and times, then review the server-owned quote before reserving. The class rows and time buttons are built from the live availability response; the prototype's example partner, Class names, times, and prices are not copied into the production widget.

## Webflow installation

1. Add the markup from `embed.html` to the existing Offer page.
2. Bind `data-business-slug`, `data-location-id`, and `data-offer-id` to the corresponding stable CMS fields. Bind the display names and Location timezone to their presentation fields.
3. Include `dist/revvi-booking.css` and `dist/revvi-booking.js` after Memberstack's supported DOM package has loaded.
4. Do not add a Location picker. The page has already selected the Location; the widget displays it and sends its stable UUID back to Supabase for validation.

The production endpoint attributes may be omitted when the functions use their standard `/functions/v1/...` paths. The demo-cleanup endpoint is inert unless the controlled Site `-99` server returns typed sandbox-demo metadata. These attributes let Webflow preview and controlled test deployments point to an explicitly configured backend origin.

## Build

Run `pnpm build:webflow`. The committed `dist/` files are the only browser assets Webflow needs.

The browser sends exactly one Memberstack bearer JWT. It never sends Memberstack plan IDs, a Mindbody credential, a price, a ProductId, or an Offer fulfilment mode. A displayed price is provisional until the client-aware quote is accepted, and the widget never collects raw card data.

## Physical Site -99 preview

The repository also has a loopback-only preview that renders this exact widget bundle against live Mindbody public-sandbox data. It uses a clearly labelled local demo identity, creates one unique synthetic Mindbody Client, performs a fictitious Cash purchase plus Class Booking, and verifies the provider evidence. The Visit remains active for up to ten minutes so it can be inspected in Mindbody Business. The widget offers exact manual cleanup; the server also cleans on timeout and before shutdown.

Run `pnpm demo:webflow:site99` after loading the sandbox credentials and exact write confirmation described in `docs/operations/webflow-site-99-demo.md`. This preview proves the browser-to-provider demonstration seam; it deliberately does not claim Memberstack authentication, hosted Webflow deployment, or production payment.

# Revvi Offer Class Booking widget

This directory contains the production Webflow widget for one already-selected Revvi Offer and Business Location. Webflow supplies presentation text and the stable Supabase references only. Eligibility, approved Class inventory, price, and Offer fulfilment mode remain server-owned.

The `/book` route follows the approved prototype flow: choose a Class option, choose one of its real dates and times, then review the server-owned quote before reserving. Step one loads one live next occurrence and representative provisional price per available Class family without waiting for pricing reads across every occurrence; configured but currently unavailable or cancelled options remain visible and disabled. Selecting an available family is immediate. **Continue** requests only that family's complete priced times and then opens step two. Step two presents the first three bookable dates directly, exposes later dates through the calendar, and adds instructor names when live occurrences share a start time. Family previews and bookable occurrences remain distinct in the response interface, and the prototype's example studio, Class names, times, and prices are not copied into the production widget.

## Webflow installation

1. Add the markup from `embed.html` to the existing Offer page.
2. Bind `data-business-slug`, `data-location-id`, and `data-offer-id` to the corresponding stable CMS fields. Bind the display names and Location timezone to their presentation fields.
3. The supplied `embed.html` already includes the hosted `revvi-booking.css` and `revvi-booking.js` URLs after Memberstack's supported DOM package has loaded. The repository's GitHub Pages workflow publishes them at:

   - `https://gcorbach.github.io/RevviMindbodyIntegration/revvi-booking.css`
   - `https://gcorbach.github.io/RevviMindbodyIntegration/revvi-booking.js`

   The rail image and heading font are published alongside them; the canonical `embed.html` already points at the hosted image URL. If the repository is renamed or moved, update the hosted URLs in `embed.html` and `history.html`.
4. Do not add a Location picker. The page has already selected the Location; the widget displays it and sends its stable UUID back to Supabase for validation.

## GitHub Pages hosting

After merging the feature branch, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once. The workflow then builds and publishes `webflow/dist` whenever widget source or build inputs change on `main`; it can also be run manually from the Actions tab. The published project-site base is `https://gcorbach.github.io/RevviMindbodyIntegration/`.

The production endpoint attributes may be omitted when the functions use their standard `/functions/v1/...` paths. The demo-cleanup endpoint is inert unless the controlled Site `-99` server returns typed sandbox-demo metadata. These attributes let Webflow preview and controlled test deployments point to an explicitly configured backend origin.

## Build

Run `pnpm build:webflow`. The committed `dist/` files—including the stylesheet, script, rail image, heading font, and Pages landing file—are the browser assets published by GitHub Actions. The workflow runs on changes to the widget and deploys `webflow/dist` to GitHub Pages after changes land on `main` (or when manually dispatched).

The browser sends exactly one Memberstack bearer JWT. It never sends Memberstack plan IDs, a Mindbody credential, a price, a ProductId, or an Offer fulfilment mode. A displayed price is provisional until the client-aware quote is accepted, and the widget never collects raw card data.

## Physical Site -99 preview

The repository also has a loopback-only preview that renders this exact widget bundle against live Mindbody public-sandbox data. Its approved manifest currently produces ten step-one Class cards and the demo shell visibly lists the exact Class IDs, times, instructor, and availability returned by Mindbody; no manual-demo schedule fixture is embedded. It uses a clearly labelled local identity, creates one unique synthetic Mindbody Client, performs a fictitious Cash purchase plus Class Booking, and verifies the provider evidence. The confirmation renders outside the booking widget and shows searchable Client, Class, Sale, Payment, and Visit IDs. The Visit remains active for up to ten minutes so it can be inspected in Mindbody Business. The external confirmation offers exact manual cleanup; the server also cleans on timeout and before shutdown.

Run `pnpm demo:webflow:site99` after loading the sandbox credentials and exact write confirmation described in `docs/operations/webflow-site-99-demo.md`. Run `pnpm sandbox:webflow:e2e` for the unattended production-control journey through Chrome; it books, verifies, and cancels the exact sandbox Visit before exiting. These paths prove the browser-to-provider demonstration seam; they deliberately do not claim Memberstack authentication, hosted Webflow deployment, or production payment.

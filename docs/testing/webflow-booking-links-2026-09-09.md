# Webflow booking links — 2026-09-09

The shared `/book` route now requires a complete Business slug, Location ID, and Offer ID from its URL. The widget rejects partial, duplicate, and invalid parameters before authentication or network calls, rather than borrowing sandbox embed attributes. Other fixed-context routes retain their embed configuration.

The first authenticated availability request omits browser dates. The existing Supabase handler calculates today using the authorized Location's timezone. The hosted discovery module and the local Site -99 adapter now both return Location ID, display name, and timezone; the URL-driven widget requires matching Location metadata. This is an additive response change with no database migration or provider-write change.

The sign-in button opens the Memberstack DOM login modal and resumes the same context. A pending same-tab context can also restore missing URL parameters after a return to `/book` for up to 30 minutes. It is cleared after successful availability. Invalid links cannot reuse pending context. The fallback does not store credentials, change global redirect settings, or cover a page gate that redirects before the widget starts.

## Verification

- Six Node context regressions cover validation, atomic selection, expiry, storage denial, recovery, and mismatched Location metadata.
- Eight Chromium scenarios pass, including URL-selected Offer → quote → booking confirmation, login, parameterless login return, invalid links, and a mismatched server Location. Network/Memberstack responses are controlled fixtures; these are not claims of real customer authentication or a live booking.
- The partner-page script's 11 browser scenarios pass with installed Playwright, Chromium, and jQuery. Its harness now accepts explicit dependency paths.
- Hosted-handler tests verify that an omitted date uses today at the authorized Location, including a UTC/local-date boundary. Hosted discovery and local demo response tests verify their respective Location metadata independently.
- The full Node suite passes: 270 passed, 11 optional browser tests skipped. The dedicated Playwright run passes separately. Trying the older Chrome `--dump-dom` suite reproduced its existing stall; that run and its browser processes were stopped.
- Hosted database read: `webflow_booking_links` returns an active LastSpot/Clubville/Revvi Yoga at Clubville context with the expected three references.
- `offer-class-availability` deployed to sandbox project `hqjgsqlniuhphvhyeejm`; version 26 is ACTIVE and retains its existing Memberstack bearer authentication configuration.

The final authenticated journey on the published Webflow page remains the publishing check. No real provider booking was created by these tests. GitHub Pages permits only `main`; the widget bundle must be deployed from the reviewed merge before Webflow staff follow the [publishing checklist](../operations/webflow-booking-links.md).

To run the dedicated browser regression, install Playwright separately, provide an installed Chromium, then run:

```sh
PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs \
CHROME_PATH=/path/to/chrome \
node --test tests/production/webflow-booking-link-browser.test.mjs
```

For the partner script, also set `JQUERY_PATH=/path/to/jquery.js` and run `node .tmp/check-partner-page.mjs`.

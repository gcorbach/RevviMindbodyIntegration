# Hosted Webflow Site -99 check — 2026-09-07

Result: blocked before authenticated availability; no booking or provider write performed. This is not an end-to-end pass.

## Verified against hosted services

- Published page: https://thes-fantabulous-site-e67dcc.webflow.io/book.
- Linked Supabase project `hqjgsqlniuhphvhyeejm` (`revvi-mindbody-sandbox`) reports `ACTIVE_HEALTHY`.
- Database partner `lastspot-sandbox`, its sandbox Mindbody Site `-99` integration, Clubville Location, Offer, and provider mapping are active. Location is enabled.
- Location UUID: `df893f87-6ca7-4417-88e9-25067b42ee37`; Offer UUID: `0b3e181e-a718-4098-aa58-9275763f4419`.
- Offer eligibility includes `pln_test-plan-0tv40j5v`. Mapping uses `mindbody_sandbox_cash`, with sandbox demo writes enabled for designated Customer `40cc3799-4ff4-4661-bf77-41e302e9881f`.
- That Customer has an active Test Plan snapshot. Its stored email is null, so matching it to the supplied login account is not yet verified.
- Availability, quote, create, cancel, complete-paid-booking, and lifecycle worker functions are deployed and active.
- Availability OPTIONS preflight returns HTTP 200 and allows the exact published Webflow origin.

## Blocking observations

The published HTML still has literal `WEBFLOW_BUSINESS_SLUG`, `SUPABASE_BUSINESS_LOCATION_UUID`, `SUPABASE_OFFER_UUID`, display/timezone placeholders, and `SUPABASE_FUNCTIONS_URL` endpoint placeholders. The widget validates UUIDs before loading availability; these values cannot initialize a valid booking context.

A real Chromium visit redirects `/book` to Memberstack `/login`. Filling the supplied credentials does not permit submission: the submit input remains disabled and the click times out. The login form includes a Turnstile integration. Its exact reason for remaining disabled has not been established; no protection was bypassed.

## Prepared correction and remaining verification

`webflow/embed-site-99.html` is the complete canonical embed with the verified sandbox context and hosted Supabase endpoint URLs substituted. Replace the booking embed on the Webflow page with this file and publish. No Webflow publishing connector is available in this session, so the hosted page has not been changed.

Then complete Memberstack login in a normal browser and verify the authenticated identity matches the designated sandbox Customer. Run availability, family/time selection, quote, and Reserve my spot through the published page. Confirm the Supabase booking record and exact authoritative Mindbody Sale/Payment/ClientService/Visit/roster/schedule evidence, then clean up the exact sandbox booking and verify cancellation. These steps remain outstanding.

The local demo was not rerun: it cannot establish this hosted path. No adapter logic or database configuration was changed during this check.

# Mindbody Business Onboarding

How Revvi connects a real Mindbody Business to the Revvi booking integration.

## Purpose

Revvi uses one server-side Mindbody application integration across many Businesses. A Business does not provide Revvi with an API key or staff credentials. Instead, the Business authorises Revvi's application to access that Business's Mindbody Site ID.

## Ownership and secrets

| Item | Owner | Handling |
| --- | --- | --- |
| Mindbody API key | Revvi | Store only in Supabase Edge Function secrets. Never expose it to a browser or a Business. |
| Mindbody Site ID | Business, authorised for Revvi | Store as the tenant connection identifier for that Business. Use it only server-side with Revvi's API key. |
| Mindbody activation link/code | Mindbody / Revvi onboarding | Send only to the authorised Business owner or administrator. |
| Staff credentials or user tokens | Business | Not part of Revvi's customer booking integration. Do not request or store them. |

## Production onboarding flow

1. **Revvi prepares the integration.**
   - Revvi has an approved Mindbody developer application and an API key for the Revvi integration.
   - The API key is stored in Supabase Edge Function secrets.

2. **Revvi identifies the Business to connect.**
   - Record the Business's legal/operating name, intended Mindbody locations, and authorised onboarding contact.
   - Confirm that the Business is in scope for the Revvi booking product.

3. **Mindbody provides site activation.**
   - Revvi requests a site-specific activation link or code for the Business from Mindbody.
   - This link/code is specific to the Business's Mindbody Site ID.

4. **The Business authorises Revvi.**
   - Revvi sends the activation link/code to the authorised Business owner or administrator.
   - That person signs in to Mindbody and activates Revvi's application for the Business.
   - The Business does not reveal its own credentials or API keys to Revvi.

5. **Revvi creates the tenant connection.**
   - Record the authorised Site ID against the Revvi Business.
   - Record the selected Mindbody Locations belonging to that Site ID.
   - Mark the connection as pending validation, not live.

6. **Revvi validates the connection.**
   - From a server-side Edge Function, call Mindbody using Revvi's API key and the authorised Site ID.
   - Confirm the Site, Locations, session types, availability, and payment types expected for the Business.
   - Confirm the customer-booking and payment flow that Mindbody supports for this Business. Sandbox evidence is sufficient for the pre-approval pilot, but must be repeated against the production Business before production activation.

7. **Revvi validates customer communications.**
   - Configure the Business's Mindbody confirmation email/SMS settings with Revvi-approved branding.
   - Run an acceptance check for recipient, sender, copy, logo/branding, and booking confirmation behaviour.

8. **Revvi marks the Business live.**
   - Enable the Business and its approved Locations in the Revvi booking experience only after every validation check passes.
   - Record the activation date, responsible Revvi operator, and any Business-specific constraints.

## Sandbox versus production

The current Business-to-Business pilot runs against the Mindbody sandbox because Mindbody requires a working sandbox implementation before approval. For this pilot, the sandbox is treated as the Business's tenant-scoped provider environment: all readiness, isolation, lifecycle, controlled-Booking, audit, activation, and rollback gates apply exactly as they will for a production Business.

Sandbox approval evidence does not authorise a production Site and does not prove production payment configuration or notification branding. After Mindbody approves the implementation, production activation must repeat Site Activation, connectivity, catalogue, availability, payment, messaging, branding, controlled-Booking, and isolation verification against the real Business. A sandbox readiness record must never be relabelled as production evidence.

The controlled sandbox pilot procedure is defined in [Sandbox Business pilot operations](../operations/sandbox-business-pilot.md).

## Current validation gates

Before this becomes a production runbook, resolve and document:

- The API-key-only customer booking and payment flow supported by Mindbody.
- Payment methods, merchant-account requirements, and PCI responsibilities for each Business.
- The production confirmation-email/SMS branding configuration available to each Business.
- The exact operational request path for site-specific activation links/codes with Mindbody.

## Source

Mindbody's Public API setup documentation describes the production sequence: build against the sandbox, obtain approval to go live, request a site-specific activation link/code, and have the Business owner activate it: [Mindbody Public API getting started](https://developers.mindbodyonline.com/ui/documentation/public-api).

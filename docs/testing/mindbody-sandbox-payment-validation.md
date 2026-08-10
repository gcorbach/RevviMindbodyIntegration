# Retained Appointment prototype: Mindbody sandbox payment validation

These instructions exercise the historical Appointment prototype only. They are not production Class Booking readiness evidence.

Run these checks in order. Do not send a real card number or a non-test checkout request while the payment model is still unsettled.

## 1. Verify sandbox payment capability

Populate `supabase/functions/.env.local` with the sandbox API key and Studio/Site ID, then start the local Appointment prototype functions through the temporary enabled configuration:

```powershell
pnpm prototype:appointment:functions
```

In a second terminal, call it:

```powershell
Invoke-RestMethod http://localhost:54321/functions/v1/prototype-appointment-sandbox-check
```

This calls only Mindbody's `GET /site/paymenttypes` endpoint. Record the response's payment types and any error without recording credentials.

Stop the serve command with Ctrl+C when the diagnostic session is complete. Its temporary configuration is removed automatically; the production configuration remains disabled.

## 2. Establish a test booking fixture

Create one disposable client (only once per test run):

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:54321/functions/v1/prototype-appointment-sandbox-create-client"
```

The helper creates a `Revvi Sandbox` client with a unique `@example.test` email. Save the returned Mindbody client ID locally for the next request; do not add it to source control.

Then identify an appointment/service that can be booked. The current sandbox discovery uses session type `23` (Nutrition Consultation) and returns live, bookable times from `GET /appointment/bookableitems`. Confirm the service price, location, and available time through the same Site ID.

Mindbody's appointment tutorial demonstrates a **staff** booking flow and requires a staff user token. It is not the intended Revvi customer-booking authentication model. Do not add staff credentials or staff tokens to this project for the Revvi integration.

## 3. Validate checkout without real payment data

Use Mindbody's documented test mode for `CheckoutShoppingCart`, if it is supported for the sandbox flow, and use only Mindbody-provided test payment data. Record the exact request/response shape, whether the endpoint returns an SCA `AuthenticationUrl`, and whether a second checkout call is required.

## Observed sandbox evidence (2026-07-21)

- The sandbox Site ID successfully returned payment types, 96 session types, and live appointment availability across more than one Location.
- `POST /client/addclient` created a disposable client only after the sandbox-required fields were supplied: `BirthDate`, `AddressLine1`, `City`, `State`, `PostalCode`, `MobilePhone`, and `ReferredBy`.
- `POST /appointment/addappointment` takes a single appointment object. The `AddAppointmentRequests` wrapper was rejected for this endpoint.
- Mindbody's appointment tutorial shows a staff-only booking contract. It is useful evidence that a staff token is not appropriate for Revvi's customer journey; the prior booking probes should not be continued as the authentication path for this integration.
- Checkout testing now needs to validate the API-key-only customer booking/payment flow supported by Mindbody, including its client, appointment, and payment endpoints. This remains the open payment-design gate.

## 4. Decide the production payment model

Before building checkout UI, confirm with Mindbody API Support whether the intended production businesses have an API-supported merchant account and which payment methods are allowed. The official FAQ says card processing through the API depends on the studio having an active Mindbody merchant account.

## 5. Verify notification branding separately

The sandbox can prove the API sends a notification only if its business settings allow it. Use a pilot production-like business to verify the sender, logo, copy, and email/SMS recipient for Revvi-branded confirmations.

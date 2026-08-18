# Mindbody Site -99 fixture-drift evidence

Observed: 2026-08-18

Environment: Mindbody public Business sandbox Site `-99`

Scope: Direct Public API provider journey. Secrets, temporary tokens, and synthetic Client identity are omitted. This record supplements rather than replaces the 2026-08-17 evidence because the public sandbox fixture changed.

## Result

The previously evidenced Product `1431` was no longer returned as an applicable online Service for the current Yoga Class. Current discovery returned six applicable Products. Product `1424` (`test 1`) passed the controlled quote, purchase-plus-Booking, authoritative read-back, targeted cancellation, and entitlement-restoration journey.

The guarded run completed with:

- Site `-99`, Location `1`
- Program `27`, Class Description `223`, Session Type `250`, Schedule `2152`
- Class `19364` (`Yoga`) at `2026-08-19T06:20:00`
- Product `1424`
- provider-calculated total `$66.00 USD`
- Sale `100170550`, Cash Payment `168189`
- ClientService `100257554`, Visit `100343797`
- exact Client Visit, Class roster, and Client Schedule confirmation
- committed targeted cancellation and exact one-session entitlement restoration
- successful temporary staff-token revocation

No active Visit was left by the run. No card, production merchant route, production Revvi Customer, or production Business was used.

## Client-field contract drift

Site `-99` returned `IsMale` from `GET ClientRequiredFields`, but `POST AddClient` rejected a request without the site's internal `GenderOptionId`. The current Mindbody-generated `AddClientRequest` exposes the public request field as `Gender`, while `GET Genders` returns each option's numeric `Id` and display `Name`.

The Site-99-only adapter now reads `GET Genders`, requires exactly one active default option, and sends that option's non-empty `Name` as `Gender`. The observed default was `None` with internal ID `1`. This behavior is deliberately restricted to the fictitious public sandbox; Revvi does not infer or fabricate Mindbody Client demographic data for a production Business.

## Evidence manifest

The SHA-256 digest of the exact UTF-8, single-line JSON manifest below is `d577d36969087706ca5cdb968774bf597bd5ed2b355cf4eea93c8c20436f1ff0`.

```json
{"observed":"2026-08-18","siteId":"-99","locationId":"1","classId":"19364","classStart":"2026-08-19T06:20:00","programId":"27","classDescriptionId":"223","sessionTypeId":"250","classScheduleId":"2152","productId":"1424","currency":"USD","grandTotal":"66.00","saleId":"100170550","paymentId":"168189","visitId":"100343797","clientServiceId":"100257554","quoteRequestDigest":"94485d50a5e0f30186c215cded4b5719300d57b45a05ece134640e62379ce764","checkoutRequestDigest":"8ebc0955a664f747f25e18e681164171726b0edc287790a48772e40cddd9356e6","cancellationRequestDigest":"3862e1eb694665f9f5d1713099bb1b4851852e0dbd67b6649cde69adb16d64976","clientVisitConfirmed":true,"rosterConfirmed":true,"clientScheduleConfirmed":true,"cancellationConfirmed":true,"entitlementRestorationObserved":true,"staffTokenRevoked":true}
```

## Hosted staging result

The same fixture was then exercised through the deployed Revvi path: Memberstack test-mode authentication, Supabase staging, the deployed quote and Booking functions, and Mindbody Site `-99`. The final controlled run returned nine eligible Yoga occurrences, created a `$66.00 USD` quote, returned a confirmed purchase-plus-Booking under the adapter version deployed at that time, and cleaned it up through the hosted cancellation endpoint.

The confirmed Booking used Class `20385`, Sale `100170570`, Cash Payment `168209`, Visit `100343803`, and ClientService `100257576`. Hosted cleanup recorded the Booking as `cancelled`, cancellation as `confirmed`, and exact ClientService restoration as `confirmed`. The current mapping version was `9`; its sandbox cancellation gate was backed by the direct run's `roster_removal` and `authoritative_reconciliation` evidence before hosted cleanup was enabled.

The SHA-256 digest of the exact UTF-8, single-line hosted manifest below is `48c8ab2d7ce761c1096eceb3352b49e74a0f098d1d7ef8a9859b0e6893f1d017`.

```json
{"observed":"2026-08-18","environment":"Supabase staging plus Memberstack test mode plus Mindbody Site -99","businessSlug":"lastspot-sandbox","offerId":"0b3e181e-a718-4098-aa58-9275763f4419","locationId":"df893f87-6ca7-4417-88e9-25067b42ee37","mappingId":"68fb8c91-41f8-49ec-ab77-1d4c478ee64d","mappingVersion":9,"classId":"20385","classStart":"2026-08-25T04:20:00Z","productId":"1424","currency":"USD","grandTotal":"66.00","bookingId":"f0bb5928-5d6e-43f4-b02f-23d3419cdfb0","saleId":"100170570","paymentId":"168209","visitId":"100343803","clientServiceId":"100257576","availabilityRequestId":"22d32f02-ee65-4017-b246-2c4a3d1933ef","quoteRequestId":"e1c374ac-ca0c-4613-9b28-5cf8d2cd53f6","bookingRequestId":"bf0b27e6-97ce-450c-addf-1a0d542d0543","cleanupRequestId":"f00203bb-d313-48ec-a552-ec3169841b10","bookingConfirmed":true,"cancellationConfirmed":true,"entitlementRestorationObserved":true}
```

This hosted manifest does not contain independent `rosterConfirmed`, `clientScheduleConfirmed`, or `staffTokenRevoked` facts. The direct provider run above contains those facts, but it cannot be substituted for hosted-path evidence. In particular, Site `-99` omitted the designated hosted Mindbody Client's exact Visit from `ClientSchedule`. The hosted part of issue #57's exact schedule/token evidence criterion therefore remains partial until a later controlled run records those surfaces; this document does not claim otherwise. After this run, the adapter was tightened to require durable pre-Checkout Visit/ClientService baselines and a cross-request staff-operation lease. The historical hosted manifest is not retroactively treated as proof of those new controls.

Three earlier fail-closed hosted attempts exposed fixture-contract drift before this final pass. Each exact provider Visit was removed immediately and each exact one-session ClientService was observed restored. Their durable Booking rows remain `unknown` for audited support resolution; they must not be replayed or represented as confirmed.

## Boundaries

- The public sandbox can refresh without notice; live inventory and applicable Products must be rediscovered before each controlled run.
- Fictitious Cash is evidence for the Site-99 demo route only, not a production payment approval.
- Site `-99` returned no separate Transaction for the Cash payment. The Payment is recorded without inventing Transaction evidence.
- Site `-99` continues to reject `AddClient(Test=true)`, so the runner creates one run-unique synthetic Client with `Test=false` after required-field validation.
- The direct and hosted manifests prove the current staging demo path only. They do not prove a production Memberstack environment, production Supabase deployment, production Mindbody Business, or approved production payment route.

## Sources

- [Mindbody Public API V6 reference](https://developers.mindbodyonline.com/ui/documentation/public-api)
- [Mindbody-generated SDKs](https://github.com/mindbody/Mindbody-API-SDKs)

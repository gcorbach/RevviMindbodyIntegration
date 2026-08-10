# Revvi Booking Integration

The context for planning and building Revvi's integration with Mindbody for booking-related journeys.

## Language

**Revvi**:
The product that provides the customer-facing booking experience in this integration.

**Mindbody**:
The external platform that is the system of record for services, availability, and completed Bookings.

**Mindbody API Key**:
Revvi's application credential for calling the Mindbody Public API from its server-side integration layer. It is owned by Revvi and never supplied by a Business or exposed to a browser.

**Mindbody Site Activation**:
The Mindbody process through which a Business authorises Revvi's application to access that Business's Site ID and data.

**Booking integration**:
The boundary through which Revvi and Mindbody coordinate booking-related journeys.

**Booking**:
A confirmed reservation for a Revvi Customer to attend a selected Class occurrence.
_Avoid_: Appointment, reservation

**Booking attempt**:
The in-progress Revvi journey to create a Booking. A provider write made before an authoritative successful confirmation outcome remains a Booking attempt, not a Booking.

**Booking context**:
The Business, Location, and Revvi Offer already selected when a Revvi Customer enters the Booking journey.
_Avoid_: Booking selection, provider context

**Revvi operational ledger**:
The tenant-scoped Supabase record of Business configuration, Mindbody Client mappings, Booking attempts, and their redacted operational history. It supports orchestration and reconciliation; it is not authoritative for Mindbody availability or completed Bookings.

**Revvi Customer**:
An authenticated person using Revvi to make a Booking.
_Avoid_: Member, user

**Memberstack**:
The identity platform from which Revvi obtains a Revvi Customer's information for this integration.

**Mindbody Client**:
The customer record in Mindbody that corresponds to a Revvi Customer for a Booking.

**Mindbody Checkout**:
The integration-driven Mindbody Public API payment flow for a Booking. A general Mindbody-hosted checkout page has not been established.

**Mindbody pricing option**:
A Business-configured Mindbody product containing the commercial terms for one paid Revvi Offer at one Location. It is identified by Mindbody `Service.ProductId` and remains authoritative for the amount charged.
_Avoid_: Revvi discount, service name, barcode

**Business**:
An independently configured organisation in Revvi with its own Mindbody integration and one or more Locations.

**Location**:
A bookable operating site belonging to a Business and represented in its Mindbody data.

**Revvi Offer**:
A pre-agreed benefit giving eligible Revvi Customers exclusive terms on approved existing Classes at one Business and Location. Supabase is its system of record; Webflow presents it by stable reference, and the underlying Classes do not need to be Revvi-only.
_Avoid_: Class type, Mindbody Service, Revvi-only Class

**Offer eligibility**:
The server-side determination that a Revvi Customer's current Memberstack subscription plan permits use of a Revvi Offer.
_Avoid_: Customer access, browser eligibility

**Offer fulfilment mode**:
The one Business-approved Mindbody arrangement used to complete a Revvi Offer after eligibility is established: purchase its pricing option, use one exact existing entitlement, or create an approved unpaid Booking. A Revvi Offer never switches modes automatically.
_Avoid_: Memberstack payment, automatic pass selection

**Mindbody entitlement**:
One exact ClientService or pass owned by a Mindbody Client and eligible for the selected Class occurrence.
_Avoid_: Revvi subscription, automatically selected pass

**Class occurrence**:
A specific scheduled instance of a class at a Location and time.
_Avoid_: Appointment, class type, session

**Approved Class inventory**:
The existing Business Classes covered by a Revvi Offer, identified through stable Mindbody class-family boundaries so future Class occurrences can be discovered automatically.
_Avoid_: Class name matching, individual Class allowlist

**Revvi-branded Mindbody notification**:
A booking confirmation, receipt, or other transactional message delivered by Mindbody using Revvi-approved branding.

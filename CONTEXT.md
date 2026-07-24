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
A confirmed reservation for a customer to attend a selected service at a selected time.
_Avoid_: Appointment, reservation

**Booking attempt**:
The in-progress Revvi journey to create a Booking. A Mindbody appointment created before an authoritative successful payment or confirmation outcome remains a Booking attempt, not a Booking.

**Revvi Customer**:
An authenticated person using Revvi to make a Booking.
_Avoid_: Member, user

**Memberstack**:
The identity platform from which Revvi obtains a Revvi Customer's information for this integration.

**Mindbody Client**:
The customer record in Mindbody that corresponds to a Revvi Customer for a Booking.

**Mindbody Checkout**:
The integration-driven Mindbody Public API payment flow for a Booking. A general Mindbody-hosted checkout page has not been established.

**Business**:
An independently configured organisation in Revvi with its own Mindbody integration and one or more Locations.

**Location**:
A bookable operating site belonging to a Business and represented in its Mindbody data.

**Revvi-branded Mindbody notification**:
A booking confirmation, receipt, or other transactional message delivered by Mindbody using Revvi-approved branding.

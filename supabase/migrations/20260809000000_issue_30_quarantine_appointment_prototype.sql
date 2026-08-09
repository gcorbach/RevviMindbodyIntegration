comment on type public.booking_completion_mode is
  'Retained Appointment prototype only. Production Class Booking uses the new Class Offer ledger.';

comment on table public.booking_attempts is
  'Retained Appointment prototype attempts from issues 13-19; not production Class Bookings.';

comment on table public.booking_attempt_events is
  'Append-only operational history for the retained Appointment prototype.';

comment on table public.booking_support_items is
  'Support items for the retained Appointment prototype; not production Class support evidence.';

comment on table public.business_checkout_config is
  'Checkout configuration for the retained Appointment prototype; never enables production Class payment.';

comment on table public.business_pilot_readiness is
  'Readiness scaffold for the retained Appointment prototype; cannot activate production Class Booking.';

comment on table public.business_pilot_readiness_checks is
  'Evidence records for the retained Appointment prototype only.';

comment on table public.business_pilot_readiness_actions is
  'Audit actions for the retained Appointment prototype readiness scaffold.';

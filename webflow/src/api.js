const SAFE_ERROR_MESSAGES = Object.freeze({
  AUTHENTICATION_REQUIRED: "Sign in to Revvi to view this Offer.",
  MEMBERSTACK_TOKEN_MISSING: "Sign in to Revvi to view this Offer.",
  MEMBERSTACK_TOKEN_INVALID: "Sign in to Revvi again to view this Offer.",
  AUTHENTICATION_INVALID: "Sign in to Revvi again to view this Offer.",
  SUBSCRIPTION_INACTIVE: "An active Revvi subscription is required for this Offer.",
  CUSTOMER_NOT_FOUND: "Revvi could not verify this Customer for the selected Offer.",
  ELIGIBILITY_OVERRIDE_BLOCKED: "This Offer is not available for your Revvi account.",
  OFFER_INELIGIBLE: "Your current Revvi subscription does not include this Offer.",
  BUSINESS_CONTEXT_MISMATCH: "This Offer is not available at the selected Location.",
  LOCATION_CONTEXT_MISMATCH: "This Offer is not available at the selected Location.",
  OFFER_CONTEXT_MISMATCH: "This Offer is not available at the selected Location.",
  QUOTE_EXPIRED: "That quote expired. Refresh the Class times and try again.",
  QUOTE_CHANGED: "The Class details changed. Refresh the times before confirming.",
  CLASS_UNAVAILABLE: "That Class is no longer available. Refresh the times and choose again.",
  SLOT_UNAVAILABLE: "That Class is no longer available. Refresh the times and choose again.",
});

export class BookingWidgetRequestError extends Error {
  constructor({ code = "REQUEST_FAILED", status = 500, retryable = false } = {}) {
    super(SAFE_ERROR_MESSAGES[code] ?? "Revvi could not complete that request safely.");
    this.name = "BookingWidgetRequestError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

async function postJson(fetcher, endpoint, authorization, body) {
  let response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BookingWidgetRequestError({ code: "NETWORK_FAILURE", status: 0, retryable: true });
  }

  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new BookingWidgetRequestError({
      code: "INVALID_RESPONSE",
      status: response.status,
      retryable: response.status >= 500,
    });
  }
  if (!response.ok || envelope?.ok !== true || !envelope?.data) {
    throw new BookingWidgetRequestError({
      code: typeof envelope?.error?.code === "string"
        ? envelope.error.code
        : typeof envelope?.code === "string" ? envelope.code : "REQUEST_FAILED",
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return envelope.data;
}

export function createBookingWidgetApi({
  fetcher = window.fetch.bind(window),
  availabilityEndpoint = "/functions/v1/offer-class-availability",
  quoteEndpoint = "/functions/v1/booking-quote",
  bookingEndpoint = "/functions/v1/create-booking",
  paymentCompletionEndpoint = "/functions/v1/complete-paid-booking",
  demoCleanupEndpoint = "/functions/v1/cancel-booking",
  upcomingEndpoint = "/functions/v1/upcoming-bookings",
  cancellationEndpoint = "/functions/v1/cancel-booking",
} = {}) {
  return Object.freeze({
    async availability(authorization, context) {
      const { sessions: wireOccurrences, ...data } = await postJson(
        fetcher,
        availabilityEndpoint,
        authorization,
        context,
      );
      return { ...data, occurrences: wireOccurrences };
    },
    async quote(authorization, offerId, classId, classFamilyId) {
      const { session: wireOccurrence, ...data } = await postJson(
        fetcher,
        quoteEndpoint,
        authorization,
        { offerId, sessionId: classId, ...(classFamilyId ? { classFamilyId } : {}) },
      );
      return { ...data, occurrence: wireOccurrence };
    },
    createBooking: (authorization, quoteId, idempotencyKey) => postJson(
      fetcher,
      bookingEndpoint,
      authorization,
      { quoteId, idempotencyKey },
    ),
    completePaidBooking: (authorization, bookingId) => postJson(
      fetcher,
      paymentCompletionEndpoint,
      authorization,
      { bookingId },
    ),
    cleanupDemoBooking: (authorization, demoBookingId) => postJson(
      fetcher,
      demoCleanupEndpoint,
      authorization,
      { bookingId: demoBookingId, reason: "Revvi hosted sandbox demonstration cleanup" },
    ),
    upcomingBookings: (authorization, limit = 20) => postJson(
      fetcher,
      upcomingEndpoint,
      authorization,
      { limit },
    ),
    cancelBooking: (authorization, bookingId, reason) => postJson(
      fetcher,
      cancellationEndpoint,
      authorization,
      { bookingId, reason },
    ),
  });
}

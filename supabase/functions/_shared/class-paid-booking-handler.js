import { BookingOrchestrationError } from "./class-booking.js";
import { failure, headers, json, publicBooking, requestId } from "./class-booking-http.js";
import { ClassCustomerAuthorizationError } from "./class-customer-authorization.js";
import { ClassPaidBookingCompletionError } from "./class-paid-booking-completion.js";
import {
  extractMemberstackBearerToken,
  MemberstackAuthenticationError,
  MemberstackServiceError,
} from "./memberstack.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleClassPaidBookingCompletion(request, dependencies) {
  const id = dependencies.requestId ?? requestId(request);
  const requestedOrigin = request.headers.get("Origin");
  const origin = requestedOrigin && dependencies.allowedOrigins.has(requestedOrigin)
    ? requestedOrigin
    : null;
  if (requestedOrigin && !origin) {
    return failure("ORIGIN_NOT_ALLOWED", "This origin is not authorised.", 403, null, id);
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: headers(origin, id) });
  }
  if (request.method !== "POST") {
    return failure("METHOD_NOT_ALLOWED", "Use POST.", 405, origin, id);
  }

  try {
    const browserToken = extractMemberstackBearerToken(request);
    if (!browserToken) {
      throw new ClassCustomerAuthorizationError(
        "AUTHENTICATION_REQUIRED",
        "Sign in through Revvi to continue.",
        401,
      );
    }
    let input;
    try {
      input = await request.json();
    } catch {
      throw new ClassPaidBookingCompletionError(
        "INVALID_JSON",
        "A valid JSON request body is required.",
        400,
      );
    }
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => key !== "bookingId")
      || typeof input.bookingId !== "string" || !UUID.test(input.bookingId)) {
      throw new ClassPaidBookingCompletionError(
        "INVALID_PAYMENT_COMPLETION_REQUEST",
        "Only a valid server-issued Booking ID may be supplied.",
        400,
      );
    }
    const authorization = await dependencies.authorizeCustomer({ browserToken });
    const result = await dependencies.completeBooking({
      bookingId: input.bookingId,
      customerId: authorization.customer.id,
    }, dependencies);
    const booking = publicBooking(result.booking, {
      includePaymentStatus: true,
      includeRedirect: false,
      optionalPrice: true,
    });
    return json(
      { ok: true, data: { booking }, requestId: id },
      booking.status === "unknown" ? 202 : 200,
      origin,
      id,
    );
  } catch (error) {
    if (error instanceof ClassPaidBookingCompletionError
      || error instanceof BookingOrchestrationError
      || error instanceof ClassCustomerAuthorizationError
      || error instanceof MemberstackServiceError) {
      return failure(error.code, error.message, error.status, origin, id);
    }
    if (error instanceof MemberstackAuthenticationError) {
      return failure(error.code, error.message, 401, origin, id);
    }
    dependencies.logger?.error?.(JSON.stringify({
      event: "class_paid_booking_completion_failed",
      requestId: id,
    }));
    return failure(
      "PAYMENT_COMPLETION_UNAVAILABLE",
      "The paid Class Booking could not be completed safely.",
      503,
      origin,
      id,
    );
  }
}

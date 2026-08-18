import { BookingOrchestrationError } from "./class-booking.js";
import { failure, headers, json, publicBooking, requestId } from "./class-booking-http.js";
import { BookingQuoteError } from "./class-booking-quote.js";
import { OfferAuthorizationError } from "./class-offer-authorization.js";
import {
  extractMemberstackBearerToken,
  MemberstackAuthenticationError,
  MemberstackServiceError,
} from "./memberstack.js";
import { MindbodyClientQuoteError } from "./mindbody-client-quote.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class BookingRequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "BookingRequestError";
    this.code = code;
    this.status = status;
  }
}

function parseRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BookingRequestError("INVALID_REQUEST", "A Class Booking request is required.");
  }
  if (Object.keys(value).some((key) => !["quoteId", "idempotencyKey"].includes(key))) {
    throw new BookingRequestError(
      "UNEXPECTED_FIELD",
      "Only quoteId and idempotencyKey are accepted. Payment, Client, Class, price, and mode facts are server-owned.",
    );
  }
  if (typeof value.quoteId !== "string" || !UUID.test(value.quoteId)) {
    throw new BookingRequestError("INVALID_QUOTE", "A valid Class Booking quote ID is required.");
  }
  if (typeof value.idempotencyKey !== "string" || !UUID.test(value.idempotencyKey)) {
    throw new BookingRequestError("INVALID_IDEMPOTENCY_KEY", "A client-generated UUID idempotency key is required.");
  }
  return { quoteId: value.quoteId, idempotencyKey: value.idempotencyKey };
}

function success(result, origin, id, decorateBooking, details = {}) {
  const publicResult = publicBooking(result.booking);
  const booking = typeof decorateBooking === "function"
    ? decorateBooking({ booking: publicResult, result, ...details })
    : publicResult;
  const status = booking.status === "unknown" ? 202 : 200;
  return json({ ok: true, data: { booking }, requestId: id }, status, origin, id);
}

export async function handleClassBooking(request, dependencies) {
  const id = requestId(request);
  const requestedOrigin = request.headers.get("Origin");
  const origin = requestedOrigin && dependencies.allowedOrigins.has(requestedOrigin) ? requestedOrigin : null;
  if (requestedOrigin && !origin) return failure("ORIGIN_NOT_ALLOWED", "This origin is not authorised.", 403, null, id);
  if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: headers(origin, id) });
  if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", "Use POST.", 405, origin, id);

  try {
    const browserToken = extractMemberstackBearerToken(request);
    if (!browserToken) throw new OfferAuthorizationError("AUTHENTICATION_REQUIRED", "Sign in through Revvi to continue.", 401);
    let rawBody;
    try {
      rawBody = await request.json();
    } catch {
      throw new BookingRequestError("INVALID_JSON", "A valid JSON request body is required.");
    }
    const input = parseRequest(rawBody);
    const locator = await dependencies.catalogue.resolveQuoteLocator(input.quoteId);
    const authorization = await dependencies.authorizeRequest({
      browserToken,
      purpose: "provider_write",
      selectedContext: {
        businessId: locator.businessId,
        locationId: locator.locationId,
        offerId: locator.offerId,
      },
    });
    if (authorization.customer.id !== locator.customerId) {
      throw new OfferAuthorizationError("QUOTE_CUSTOMER_MISMATCH", "This Booking quote belongs to another Revvi Customer.", 403);
    }

    const existing = await dependencies.catalogue.findAttempt({
      customerId: authorization.customer.id,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      if (typeof dependencies.decorateBooking !== "function") return success(existing, origin, id);
      const resolved = await dependencies.catalogue.resolveBookingContext({
        quoteId: input.quoteId,
        customerId: authorization.customer.id,
      });
      return success(existing, origin, id, dependencies.decorateBooking, { authorization, resolved });
    }

    const resolved = await dependencies.catalogue.resolveBookingContext({
      quoteId: input.quoteId,
      customerId: authorization.customer.id,
    });
    const quoteProvider = dependencies.createQuoteProvider(resolved.context, {
      requestId: id,
      customerId: authorization.customer.id,
    });
    const result = await dependencies.executeBooking({
      customer: authorization.customer,
      quote: resolved.quote,
      context: resolved.context,
      idempotencyKey: input.idempotencyKey,
    }, {
      catalogue: dependencies.catalogue,
      now: dependencies.now,
      revalidateQuote: (facts) => dependencies.revalidateQuote(facts, { provider: quoteProvider, now: dependencies.now }),
      validateWriteConfiguration: dependencies.validateWriteConfiguration,
      authorizeWrite: async () => {
        const current = await dependencies.authorizeRequest({
          browserToken,
          purpose: "provider_write",
          selectedContext: {
            businessId: locator.businessId,
            locationId: locator.locationId,
            offerId: locator.offerId,
          },
        });
        if (current.customer.id !== locator.customerId) {
          throw new OfferAuthorizationError("QUOTE_CUSTOMER_MISMATCH", "This Booking quote belongs to another Revvi Customer.", 403);
        }
      },
      createProvider: ({ booking, attempt }) => dependencies.createWriteProvider(resolved.context, {
        requestId: id,
        customerId: authorization.customer.id,
        bookingId: booking.id,
        attemptId: attempt.id,
      }),
    });
    return success(result, origin, id, dependencies.decorateBooking, { authorization, resolved });
  } catch (error) {
    if (error instanceof BookingRequestError
      || error instanceof BookingOrchestrationError
      || error instanceof BookingQuoteError
      || error instanceof OfferAuthorizationError
      || error instanceof MemberstackServiceError) {
      return failure(error.code, error.message, error.status, origin, id);
    }
    if (error instanceof MemberstackAuthenticationError) {
      return failure(error.code, error.message, 401, origin, id);
    }
    if (error instanceof MindbodyClientQuoteError) {
      return failure("PROVIDER_UNAVAILABLE", "Mindbody could not revalidate this Class Booking.", 503, origin, id);
    }
    dependencies.logger?.error?.(JSON.stringify({ event: "class_booking_failed", requestId: id }));
    return failure("BOOKING_UNAVAILABLE", "The Class Booking could not be completed safely.", 503, origin, id);
  }
}

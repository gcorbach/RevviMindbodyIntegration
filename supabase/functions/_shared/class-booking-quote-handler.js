import { BookingQuoteError } from "./class-booking-quote.js";
import { OfferAuthorizationError } from "./class-offer-authorization.js";
import {
  extractMemberstackBearerToken,
  MemberstackAuthenticationError,
  MemberstackServiceError,
} from "./memberstack.js";
import { MindbodyClientQuoteError } from "./mindbody-client-quote.js";
import { Site99LiveContextError } from "./mindbody-site-99-live-context.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BookingQuoteRequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "BookingQuoteRequestError";
    this.code = code;
    this.status = status;
  }
}

function parseRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BookingQuoteRequestError("INVALID_REQUEST", "A booking quote request is required.");
  }
  if (Object.keys(value).some((key) => !["offerId", "sessionId", "classFamilyId"].includes(key))) {
    throw new BookingQuoteRequestError("UNEXPECTED_FIELD", "Only offerId, classFamilyId, and sessionId are accepted.");
  }
  if (typeof value.offerId !== "string" || !UUID.test(value.offerId)) {
    throw new BookingQuoteRequestError("INVALID_OFFER", "A valid Revvi Offer ID is required.");
  }
  const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : "";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) {
    throw new BookingQuoteRequestError("INVALID_CLASS", "A valid Class occurrence ID is required.");
  }
  if (value.classFamilyId !== undefined
    && (typeof value.classFamilyId !== "string" || !UUID.test(value.classFamilyId))) {
    throw new BookingQuoteRequestError("INVALID_CLASS_FAMILY", "A valid Class family ID is required.");
  }
  return {
    offerId: value.offerId,
    classId: sessionId,
    ...(value.classFamilyId !== undefined ? { classFamilyId: value.classFamilyId } : {}),
  };
}

function requestId(request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function headers(origin, id) {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
    "X-Request-Id": id,
  };
}

function json(body, status, origin, id) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin, id) });
}

function failure(code, message, status, origin, id) {
  return json({
    ok: false,
    error: { code, message, retryable: status >= 500 },
    requestId: id,
  }, status, origin, id);
}

export async function handleClassBookingQuote(request, dependencies) {
  const id = requestId(request);
  const requestedOrigin = request.headers.get("Origin");
  const origin = requestedOrigin && dependencies.allowedOrigins.has(requestedOrigin) ? requestedOrigin : null;
  if (requestedOrigin && !origin) {
    return failure("ORIGIN_NOT_ALLOWED", "This origin is not authorised.", 403, null, id);
  }
  if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: headers(origin, id) });
  if (request.method !== "POST") {
    return failure("METHOD_NOT_ALLOWED", "Use POST.", 405, origin, id);
  }
  try {
    const browserToken = extractMemberstackBearerToken(request);
    if (!browserToken) throw new OfferAuthorizationError("AUTHENTICATION_REQUIRED", "Sign in through Revvi to continue.", 401);
    let rawBody;
    try {
      rawBody = await request.json();
    } catch {
      throw new BookingQuoteRequestError("INVALID_JSON", "A valid JSON request body is required.");
    }
    const input = parseRequest(rawBody);
    const locator = await dependencies.catalogue.resolveOfferLocator(input.offerId);
    const authorization = await dependencies.authorizeRequest({
      browserToken,
      // A quote may create the missing Mindbody Client, so it must use the
      // persisted provider-write authorization purpose rather than inventing
      // a read-only purpose outside the database contract.
      purpose: "provider_write",
      selectedContext: locator,
    });
    if (!authorization.customer.identity || authorization.customer.identity.emailVerified !== true) {
      throw new BookingQuoteError("CLIENT_IDENTITY_INCOMPLETE", "Your verified Revvi profile needs an email and full name before booking.", 422);
    }
    const runQuote = async ({ staffLeaseHeld = false } = {}) => {
      const storedContext = await dependencies.catalogue.resolveQuoteContext({
        offerId: input.offerId,
        customerId: authorization.customer.id,
      });
      const context = typeof dependencies.refreshContext === "function"
        ? await dependencies.refreshContext(storedContext, {
          requestId: id,
          customerId: authorization.customer.id,
        })
        : storedContext;
      return dependencies.createQuote({
        customer: authorization.customer,
        identity: authorization.customer.identity,
        classId: input.classId,
        ...(input.classFamilyId ? { classFamilyId: input.classFamilyId } : {}),
        context,
      }, {
        ...dependencies.quoteDependencies,
        provider: dependencies.createProvider(context, { requestId: id, customerId: authorization.customer.id, staffLeaseHeld }),
        catalogue: dependencies.catalogue,
      });
    };
    const quote = typeof dependencies.withQuoteLease === "function"
      ? await dependencies.withQuoteLease({ offerId: input.offerId, customerId: authorization.customer.id }, runQuote)
      : await runQuote();
    const { occurrence, ...quoteFacts } = quote;
    return json({ ok: true, data: { ...quoteFacts, session: occurrence }, requestId: id }, 200, origin, id);
  } catch (error) {
    if (error instanceof BookingQuoteRequestError
      || error instanceof BookingQuoteError
      || error instanceof Site99LiveContextError
      || error instanceof OfferAuthorizationError
      || error instanceof MemberstackServiceError) {
      return failure(error.code, error.message, error.status, origin, id);
    }
    if (error instanceof MemberstackAuthenticationError) {
      return failure(error.code, error.message, 401, origin, id);
    }
    if (error instanceof MindbodyClientQuoteError) {
      return failure("PROVIDER_UNAVAILABLE", "Mindbody could not create a client-aware quote.", 503, origin, id);
    }
    dependencies.logger?.error?.(JSON.stringify({ event: "class_booking_quote_failed", requestId: id }));
    return failure("QUOTE_UNAVAILABLE", "A booking quote could not be created.", 503, origin, id);
  }
}

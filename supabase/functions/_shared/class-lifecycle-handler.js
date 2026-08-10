import { ClassCancellationError } from "./class-cancellation.js";
import { ClassCustomerAuthorizationError } from "./class-customer-authorization.js";
import { ClassLifecycleCatalogueError } from "./class-lifecycle-catalogue.js";
import {
  extractMemberstackBearerToken,
  MemberstackAuthenticationError,
  MemberstackServiceError,
} from "./memberstack.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestId(request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
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

async function body(request) {
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new ClassCancellationError("INVALID_JSON", "A valid JSON request body is required.", 400);
  }
}

async function authorized(request, dependencies) {
  const browserToken = extractMemberstackBearerToken(request);
  return dependencies.authorizeCustomer({ browserToken });
}

function errorResponse(error, origin, id, logger) {
  if (error instanceof ClassCancellationError
    || error instanceof ClassCustomerAuthorizationError
    || error instanceof ClassLifecycleCatalogueError
    || error instanceof MemberstackServiceError) {
    return failure(error.code, error.message, error.status, origin, id);
  }
  if (error instanceof MemberstackAuthenticationError) {
    return failure(error.code, error.message, 401, origin, id);
  }
  logger?.error?.(JSON.stringify({ event: "class_lifecycle_request_failed", requestId: id }));
  return failure("LIFECYCLE_UNAVAILABLE", "The Class Booking lifecycle is temporarily unavailable.", 503, origin, id);
}

function route(request, dependencies) {
  const id = requestId(request);
  const requestedOrigin = request.headers.get("Origin");
  const origin = requestedOrigin && dependencies.allowedOrigins.has(requestedOrigin) ? requestedOrigin : null;
  if (requestedOrigin && !origin) return { response: failure("ORIGIN_NOT_ALLOWED", "This origin is not authorised.", 403, null, id) };
  if (request.method === "OPTIONS") return { response: new Response("ok", { status: 200, headers: headers(origin, id) }) };
  if (request.method !== "POST") return { response: failure("METHOD_NOT_ALLOWED", "Use POST.", 405, origin, id) };
  return { id, origin };
}

export async function handleUpcomingClassBookings(request, dependencies) {
  const context = route(request, dependencies);
  if (context.response) return context.response;
  try {
    const input = await body(request);
    if (Object.keys(input).some((key) => key !== "limit")) {
      throw new ClassCancellationError("INVALID_REQUEST", "Only a result limit may be supplied.", 400);
    }
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new ClassCancellationError("INVALID_LIMIT", "The Booking limit must be between 1 and 50.", 400);
    }
    const authorization = await authorized(request, dependencies);
    const bookings = await dependencies.catalogue.upcomingBookings({
      customerId: authorization.customer.id,
      limit,
    });
    return json({ ok: true, data: { bookings }, requestId: context.id }, 200, context.origin, context.id);
  } catch (error) {
    return errorResponse(error, context.origin, context.id, dependencies.logger);
  }
}

export async function handleCancelClassBooking(request, dependencies) {
  const context = route(request, dependencies);
  if (context.response) return context.response;
  try {
    const input = await body(request);
    if (Object.keys(input).some((key) => !["bookingId", "reason"].includes(key))
      || typeof input.bookingId !== "string" || !UUID.test(input.bookingId)
      || typeof input.reason !== "string" || input.reason.trim().length < 10
      || input.reason.trim().length > 500) {
      throw new ClassCancellationError(
        "INVALID_CANCELLATION_REQUEST",
        "A valid Booking ID and cancellation reason are required.",
        400,
      );
    }
    const authorization = await authorized(request, dependencies);
    const result = await dependencies.cancelBooking({
      bookingId: input.bookingId,
      customerId: authorization.customer.id,
      reason: input.reason.trim(),
    }, dependencies);
    return json(
      { ok: true, data: result, requestId: context.id },
      result.status === "unknown" ? 202 : 200,
      context.origin,
      context.id,
    );
  } catch (error) {
    return errorResponse(error, context.origin, context.id, dependencies.logger);
  }
}

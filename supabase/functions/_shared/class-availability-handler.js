import { ClassAvailabilityError } from "./class-availability.js";
import {
  ClassAvailabilityCatalogueError,
} from "./class-availability-catalogue.js";
import {
  ClassAvailabilityRequestError,
  parseClassAvailabilityRequest,
  resolveClassAvailabilityDateRange,
} from "./class-availability-request.js";
import { OfferAuthorizationError } from "./class-offer-authorization.js";
import {
  extractMemberstackBearerToken,
  MemberstackAuthenticationError,
  MemberstackServiceError,
} from "./memberstack.js";
import { MindbodyClassReadError } from "./mindbody-class-read.js";
import { Site99LiveContextError } from "./mindbody-site-99-live-context.js";

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

function exactServerContext(authorization, configuration) {
  return authorization.business.id === configuration.business.id
    && authorization.location.id === configuration.location.id
    && authorization.offer.id === configuration.offer.id;
}

export async function handleOfferClassAvailability(request, dependencies) {
  const id = requestId(request);
  const requestedOrigin = request.headers.get("Origin");
  const origin = requestedOrigin && dependencies.allowedOrigins.has(requestedOrigin) ? requestedOrigin : null;
  if (requestedOrigin && !origin) {
    return json({ ok: false, code: "ORIGIN_NOT_ALLOWED", error: "This origin is not authorised.", requestId: id }, 403, null, id);
  }
  if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: headers(origin, id) });
  if (request.method !== "POST") {
    return json({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Use POST.", requestId: id }, 405, origin, id);
  }

  try {
    let rawBody;
    try {
      rawBody = await request.json();
    } catch {
      throw new ClassAvailabilityRequestError("INVALID_JSON", "A valid JSON request body is required.");
    }
    const input = parseClassAvailabilityRequest(rawBody);
    const browserToken = extractMemberstackBearerToken(request);
    if (!browserToken) {
      throw new OfferAuthorizationError(
        "AUTHENTICATION_REQUIRED",
        "Sign in through Revvi to continue.",
        401,
      );
    }
    const businessId = await dependencies.catalogue.resolveBusinessIdBySlug(input.businessSlug);
    const authorization = await dependencies.authorizeRequest({
      browserToken,
      purpose: "availability",
      selectedContext: {
        businessId,
        locationId: input.locationId,
        offerId: input.offerId,
      },
    });
    const configuration = await dependencies.catalogue.resolveAvailabilityContext({
      businessSlug: input.businessSlug,
      locationId: input.locationId,
      offerId: input.offerId,
      customerId: authorization.customer.id,
    });
    if (!exactServerContext(authorization, configuration)) {
      throw new OfferAuthorizationError(
        "OFFER_CONTEXT_MISMATCH",
        "The selected Revvi Offer context is not authorised.",
        403,
      );
    }
    const dateRange = resolveClassAvailabilityDateRange({
      startDate: input.startDate,
      endDate: input.endDate,
      timezone: configuration.location.timezone,
      now: dependencies.now(),
    });
    const rawProvider = dependencies.createProvider(configuration);
    const provider = dependencies.instrumentProvider(rawProvider, {
      context: {
        businessId: configuration.business.id,
        offerId: configuration.offer.id,
        locationId: configuration.location.id,
        mappingId: configuration.mapping.id,
      },
      requestId: id,
      recordDiagnostic: (facts) => dependencies.catalogue.recordProviderDiagnostic(facts),
    });
    const liveConfiguration = typeof dependencies.refreshContext === "function"
      ? await dependencies.refreshContext(configuration, { provider, requestId: id })
      : configuration;
    const data = await dependencies.discoverAvailability({
      context: liveConfiguration,
      ...(input.classFamilyId ? { classFamilyId: input.classFamilyId } : {}),
      startAt: dateRange.startAt,
      endAt: dateRange.endAt,
    }, { provider, now: dependencies.now });
    return json({
      ok: true,
      data,
      requestId: id,
    }, 200, origin, id);
  } catch (error) {
    if (error instanceof ClassAvailabilityRequestError
      || error instanceof OfferAuthorizationError
      || error instanceof ClassAvailabilityCatalogueError
      || error instanceof ClassAvailabilityError
      || error instanceof Site99LiveContextError
      || error instanceof MemberstackServiceError) {
      return json({ ok: false, code: error.code, error: error.message, requestId: id }, error.status, origin, id);
    }
    if (error instanceof MemberstackAuthenticationError) {
      return json({ ok: false, code: error.code, error: error.message, requestId: id }, 401, origin, id);
    }
    if (error instanceof MindbodyClassReadError) {
      return json({
        ok: false,
        code: "PROVIDER_UNAVAILABLE",
        error: "Live Class availability is temporarily unavailable.",
        requestId: id,
      }, 503, origin, id);
    }
    dependencies.logger?.error?.(JSON.stringify({ event: "class_availability_failed", requestId: id }));
    return json({
      ok: false,
      code: "AVAILABILITY_UNAVAILABLE",
      error: "Live Class availability is temporarily unavailable.",
      requestId: id,
    }, 503, origin, id);
  }
}

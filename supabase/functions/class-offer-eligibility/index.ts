import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizeClassOfferRequest,
  OfferAuthorizationError,
} from "../_shared/class-offer-authorization.js";
import { createClassOfferCatalogue } from "../_shared/class-offer-catalogue.js";
import {
  createMemberstackAdminClient,
  createMemberstackJwtVerifier,
  createSupabaseMemberstackAdmission,
  extractMemberstackBearerToken,
  MemberstackAuthenticationError,
  MemberstackServiceError,
} from "../_shared/memberstack.js";

function allowedOrigins() {
  return new Set((Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

function responseHeaders(origin: string | null, requestId: string) {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
    "X-Request-Id": requestId,
  };
}

function json(body: Record<string, unknown>, status: number, origin: string | null, requestId: string) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin, requestId) });
}

function isUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

Deno.serve(async (request) => {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins().has(origin)) {
    return json({ ok: false, code: "ORIGIN_NOT_ALLOWED", error: "This origin is not authorised." }, 403, null, requestId);
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(origin, requestId) });
  if (request.method !== "GET") {
    return json({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Use GET." }, 405, origin, requestId);
  }

  const requiredEnvironment = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MEMBERSTACK_APP_ID",
    "MEMBERSTACK_SECRET_KEY",
    "MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST",
  ].filter((name) => !Deno.env.get(name));
  const evidenceDigest = Deno.env.get("MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST") ?? "";
  if (requiredEnvironment.length > 0 || !/^[a-f0-9]{64}$/i.test(evidenceDigest)) {
    return json({ ok: false, code: "CONFIGURATION_ERROR", error: "Offer eligibility is not configured." }, 500, origin, requestId);
  }

  try {
    const url = new URL(request.url);
    const businessId = url.searchParams.get("businessId");
    const locationId = url.searchParams.get("locationId");
    const offerId = url.searchParams.get("offerId");
    if (!isUuid(businessId) || !isUuid(locationId) || !isUuid(offerId)) {
      return json({ ok: false, code: "INVALID_CONTEXT", error: "Valid Business, Location, and Offer IDs are required." }, 400, origin, requestId);
    }
    const browserToken = extractMemberstackBearerToken(request);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const admitMemberstackRequest = createSupabaseMemberstackAdmission(supabase);
    const memberstack = {
      ...createMemberstackJwtVerifier({
        appId: Deno.env.get("MEMBERSTACK_APP_ID")!,
        secretKey: Deno.env.get("MEMBERSTACK_SECRET_KEY")!,
        admitRequest: admitMemberstackRequest,
      }),
      ...createMemberstackAdminClient({
        secretKey: Deno.env.get("MEMBERSTACK_SECRET_KEY")!,
        admitRequest: admitMemberstackRequest,
      }),
    };
    const catalogue = createClassOfferCatalogue(supabase);
    const context = await authorizeClassOfferRequest({
      browserToken,
      purpose: "availability",
      selectedContext: { businessId, locationId, offerId },
    }, { memberstack, catalogue, now: () => new Date() });
    return json({
      ok: true,
      data: {
        authorized: true,
        businessId: context.business.id,
        locationId: context.location.id,
        offerId: context.offer.id,
        checkedAt: context.eligibility.verifiedAt,
      },
      requestId,
    }, 200, origin, requestId);
  } catch (error) {
    if (error instanceof OfferAuthorizationError) {
      return json({ ok: false, code: error.code, error: error.message, requestId }, error.status, origin, requestId);
    }
    if (error instanceof MemberstackAuthenticationError) {
      return json({ ok: false, code: error.code, error: error.message, requestId }, 401, origin, requestId);
    }
    if (error instanceof MemberstackServiceError) {
      return json({ ok: false, code: error.code, error: error.message, requestId }, error.status, origin, requestId);
    }
    console.error(JSON.stringify({ event: "class_offer_authorization_failed", requestId }));
    return json({ ok: false, code: "AUTHORIZATION_UNAVAILABLE", error: "Offer authorization is temporarily unavailable.", requestId }, 503, origin, requestId);
  }
});

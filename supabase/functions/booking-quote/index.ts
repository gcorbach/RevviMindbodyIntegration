import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createClassBookingQuote } from "../_shared/class-booking-quote.js";
import { createClassBookingQuoteCatalogue } from "../_shared/class-booking-quote-catalogue.js";
import { handleClassBookingQuote } from "../_shared/class-booking-quote-handler.js";
import { authorizeClassOfferRequest } from "../_shared/class-offer-authorization.js";
import { createClassOfferCatalogue } from "../_shared/class-offer-catalogue.js";
import {
  createMemberstackAdminClient,
  createMemberstackJwtVerifier,
  createSupabaseMemberstackAdmission,
} from "../_shared/memberstack.js";
import {
  createMindbodyClientQuoteClient,
  instrumentClientQuoteProvider,
} from "../_shared/mindbody-client-quote.js";

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MEMBERSTACK_APP_ID",
  "MEMBERSTACK_SECRET_KEY",
  "MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST",
  "MINDBODY_API_KEY",
  "MINDBODY_STAFF_TOKENS_JSON",
] as const;

function staffTokens() {
  try {
    const parsed = JSON.parse(Deno.env.get("MINDBODY_STAFF_TOKENS_JSON") ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    for (const [integrationId, token] of Object.entries(parsed)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(integrationId)
        || typeof token !== "string" || token.trim().length < 16) return null;
    }
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

function configured() {
  if (requiredEnvironment.some((name) => !Deno.env.get(name))) return false;
  return /^[a-f0-9]{64}$/i.test(Deno.env.get("MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST") ?? "")
    && staffTokens() !== null;
}

function configurationError(request: Request) {
  const suppliedRequestId = request.headers.get("x-request-id");
  const requestId = suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  return new Response(JSON.stringify({
    ok: false,
    error: {
      code: "CONFIGURATION_ERROR",
      message: "Booking quotes are not configured.",
      retryable: true,
    },
    requestId,
  }), {
    status: 500,
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  });
}

Deno.serve(async (request) => {
  if (!configured()) return configurationError(request);
  const now = () => new Date();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const quoteCatalogue = createClassBookingQuoteCatalogue(supabase);
  const authorizationCatalogue = createClassOfferCatalogue(supabase);
  const memberstack = {
    ...createMemberstackJwtVerifier({ appId: Deno.env.get("MEMBERSTACK_APP_ID")!, now }),
    ...createMemberstackAdminClient({
      secretKey: Deno.env.get("MEMBERSTACK_SECRET_KEY")!,
      admitRequest: createSupabaseMemberstackAdmission(supabase),
      now,
    }),
  };
  const configuredStaffTokens = staffTokens()!;
  return handleClassBookingQuote(request, {
    allowedOrigins: new Set(
      (Deno.env.get("ALLOWED_ORIGINS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    catalogue: quoteCatalogue,
    authorizeRequest: (input: Record<string, unknown>) => authorizeClassOfferRequest(
      input,
      { memberstack, catalogue: authorizationCatalogue, now },
    ),
    createProvider: (
      context: {
        business: { id: string };
        offer: { id: string };
        location: { id: string };
        mapping: { id: string };
        integration: { id: string; providerSiteId: string };
      },
      operation: { requestId: string; customerId: string },
    ) => {
      const userToken = configuredStaffTokens[context.integration.id];
      if (!userToken) throw new Error("No staff token is configured for the selected integration.");
      const provider = createMindbodyClientQuoteClient({
        apiKey: Deno.env.get("MINDBODY_API_KEY")!,
        siteId: context.integration.providerSiteId,
        userToken,
        baseUrl: Deno.env.get("MINDBODY_BASE_URL") ?? "https://api.mindbodyonline.com",
        requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
      });
      return instrumentClientQuoteProvider(provider, {
        context: {
          businessId: context.business.id,
          offerId: context.offer.id,
          locationId: context.location.id,
          mappingId: context.mapping.id,
          customerId: operation.customerId,
        },
        requestId: operation.requestId,
        recordDiagnostic: (facts: Record<string, unknown>) => quoteCatalogue.recordProviderDiagnostic(facts),
      });
    },
    createQuote: createClassBookingQuote,
    quoteDependencies: { now, quoteLifetimeMs: 5 * 60_000 },
    logger: console,
  });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cancelClassBooking } from "../_shared/class-cancellation.js";
import { authorizeClassCustomerRequest } from "../_shared/class-customer-authorization.js";
import { createClassLifecycleCatalogue } from "../_shared/class-lifecycle-catalogue.js";
import { handleCancelClassBooking } from "../_shared/class-lifecycle-handler.js";
import { createClassOfferCatalogue } from "../_shared/class-offer-catalogue.js";
import {
  createMemberstackAdminClient,
  createMemberstackJwtVerifier,
  createSupabaseMemberstackAdmission,
} from "../_shared/memberstack.js";
import {
  createMindbodyClassBookingClient,
  instrumentClassBookingProvider,
} from "../_shared/mindbody-class-booking.js";

const requiredEnvironment = [
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MEMBERSTACK_APP_ID",
  "MEMBERSTACK_SECRET_KEY", "MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST",
  "MINDBODY_API_KEY", "MINDBODY_STAFF_TOKENS_JSON",
] as const;

function staffTokens() {
  try {
    const value = JSON.parse(Deno.env.get("MINDBODY_STAFF_TOKENS_JSON") ?? "");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : null;
  } catch { return null; }
}

function configurationError(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  return new Response(JSON.stringify({
    ok: false,
    error: { code: "CONFIGURATION_ERROR", message: "Class cancellation is not configured.", retryable: true },
    requestId,
  }), { status: 500, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } });
}

Deno.serve((request) => {
  const configuredTokens = staffTokens();
  if (requiredEnvironment.some((name) => !Deno.env.get(name)) || !configuredTokens
    || !/^[a-f0-9]{64}$/i.test(Deno.env.get("MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST") ?? "")) {
    return configurationError(request);
  }
  const now = () => new Date();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const customerCatalogue = createClassOfferCatalogue(supabase);
  const catalogue = createClassLifecycleCatalogue(supabase, customerCatalogue);
  const memberstack = {
    ...createMemberstackJwtVerifier({ appId: Deno.env.get("MEMBERSTACK_APP_ID")!, now }),
    ...createMemberstackAdminClient({
      secretKey: Deno.env.get("MEMBERSTACK_SECRET_KEY")!,
      admitRequest: createSupabaseMemberstackAdmission(supabase), now,
    }),
  };
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const dependencies: Record<string, unknown> = {
    allowedOrigins: new Set((Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean)),
    catalogue,
    authorizeCustomer: (input: Record<string, unknown>) => authorizeClassCustomerRequest(
      input, { memberstack, catalogue, now },
    ),
    cancelBooking: cancelClassBooking,
    createProvider: async (claim: { booking: { integrationId: string; businessId: string }; attempt: { id: string } }) => {
      const integration = await catalogue.resolveIntegration(claim.booking.integrationId);
      const userToken = configuredTokens[integration.id];
      if (typeof userToken !== "string" || userToken.trim().length < 16) {
        throw new Error("No staff token is configured for the selected Mindbody integration.");
      }
      return instrumentClassBookingProvider(createMindbodyClassBookingClient({
        apiKey: Deno.env.get("MINDBODY_API_KEY")!, siteId: integration.providerSiteId,
        userToken, baseUrl: Deno.env.get("MINDBODY_BASE_URL") ?? "https://api.mindbodyonline.com",
        requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
      }), {
        context: { businessId: claim.booking.businessId, attemptId: claim.attempt.id },
        requestId,
        recordDiagnostic: (facts: Record<string, unknown>) => catalogue.recordProviderDiagnostic(facts),
      });
    },
    logger: console,
  };
  return handleCancelClassBooking(request, dependencies);
});

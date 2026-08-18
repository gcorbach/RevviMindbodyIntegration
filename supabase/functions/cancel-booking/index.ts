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
import {
  createMindbodyRuntimeProvider,
  mindbodyStaffRuntimeConfigured,
  parseMindbodyStaffTokens,
} from "../_shared/mindbody-runtime-provider.js";
import { createSite99StaffOperationLease } from "../_shared/site-99-staff-operation-lease.js";

const requiredEnvironment = [
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MEMBERSTACK_APP_ID",
  "MEMBERSTACK_SECRET_KEY", "MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST",
  "MINDBODY_API_KEY",
] as const;

function staffTokens() {
  return parseMindbodyStaffTokens(Deno.env.get("MINDBODY_STAFF_TOKENS_JSON")) as Record<string, string> | null;
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
  if (requiredEnvironment.some((name) => !Deno.env.get(name))
    || !mindbodyStaffRuntimeConfigured({
      staffTokens: configuredTokens,
      sandboxUsername: Deno.env.get("MINDBODY_SANDBOX_USERNAME"),
      sandboxPassword: Deno.env.get("MINDBODY_SANDBOX_PASSWORD"),
    })
    || !/^[a-f0-9]{64}$/i.test(Deno.env.get("MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST") ?? "")) {
    return configurationError(request);
  }
  const now = () => new Date();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const withSite99StaffOperationLease = createSite99StaffOperationLease(supabase);
  const customerCatalogue = createClassOfferCatalogue(supabase);
  const catalogue = createClassLifecycleCatalogue(supabase, customerCatalogue);
  const admitMemberstackRequest = createSupabaseMemberstackAdmission(supabase);
  const memberstack = {
    ...createMemberstackJwtVerifier({
      appId: Deno.env.get("MEMBERSTACK_APP_ID")!,
      secretKey: Deno.env.get("MEMBERSTACK_SECRET_KEY")!,
      admitRequest: admitMemberstackRequest,
      now,
    }),
    ...createMemberstackAdminClient({
      secretKey: Deno.env.get("MEMBERSTACK_SECRET_KEY")!,
      admitRequest: admitMemberstackRequest, now,
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
    requiresEntitlementRestoration: async (claim: { booking: { id: string } }) => {
      const providerContext = await catalogue.resolveBookingProviderContext(claim.booking.id);
      return providerContext.integration.environment === "sandbox"
        && providerContext.integration.providerSiteId === "-99"
        && providerContext.location.providerLocationId === "1"
        && providerContext.mapping.paidPaymentRoute === "mindbody_sandbox_cash"
        && providerContext.mapping.sandboxDemoWriteEnabled === true
        && providerContext.mapping.sandboxDemoCustomerId === providerContext.customerId;
    },
    createProvider: async (claim: { booking: { id: string; integrationId: string; businessId: string }; attempt: { id: string } }) => {
      const providerContext = await catalogue.resolveBookingProviderContext(claim.booking.id);
      return instrumentClassBookingProvider(createMindbodyRuntimeProvider({
        context: providerContext,
        customerId: providerContext.customerId,
        apiKey: Deno.env.get("MINDBODY_API_KEY")!,
        staffTokens: configuredTokens,
        sandboxUsername: Deno.env.get("MINDBODY_SANDBOX_USERNAME"),
        sandboxPassword: Deno.env.get("MINDBODY_SANDBOX_PASSWORD"),
        withSite99StaffOperationLease,
        baseUrl: Deno.env.get("MINDBODY_BASE_URL") ?? "https://api.mindbodyonline.com",
        requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
        createProvider: createMindbodyClassBookingClient,
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

import { isEnabledSite99SandboxContext } from "../_shared/site-99-sandbox-context.js";
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
import {
  createMindbodyClassReadClient,
  instrumentClassReadProvider,
} from "../_shared/mindbody-class-read.js";
import { refreshSite99LiveContext } from "../_shared/mindbody-site-99-live-context.js";
import {
  createMindbodyRuntimeProvider,
  mindbodyStaffRuntimeConfigured,
  parseMindbodyStaffTokens,
} from "../_shared/mindbody-runtime-provider.js";
import { createSite99StaffOperationLease } from "../_shared/site-99-staff-operation-lease.js";

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MEMBERSTACK_APP_ID",
  "MEMBERSTACK_SECRET_KEY",
  "MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST",
  "MINDBODY_API_KEY",
] as const;

function staffTokens() {
  return parseMindbodyStaffTokens(Deno.env.get("MINDBODY_STAFF_TOKENS_JSON")) as Record<string, string> | null;
}

function configured() {
  if (requiredEnvironment.some((name) => !Deno.env.get(name))) return false;
  return /^[a-f0-9]{64}$/i.test(Deno.env.get("MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST") ?? "")
    && mindbodyStaffRuntimeConfigured({
      staffTokens: staffTokens(),
      sandboxUsername: Deno.env.get("MINDBODY_SANDBOX_USERNAME"),
      sandboxPassword: Deno.env.get("MINDBODY_SANDBOX_PASSWORD"),
    });
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
      admitRequest: admitMemberstackRequest,
      now,
    }),
  };
  const configuredStaffTokens = staffTokens()!;
  const withSite99StaffOperationLease = createSite99StaffOperationLease(supabase, { waitMs: 60_000 });
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
    refreshContext: (context: any, operation: { requestId: string; customerId: string }) => {
      const provider = instrumentClassReadProvider(createMindbodyClassReadClient({
        apiKey: Deno.env.get("MINDBODY_API_KEY")!,
        siteId: context.integration.providerSiteId,
        baseUrl: Deno.env.get("MINDBODY_BASE_URL") ?? "https://api.mindbodyonline.com",
        requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
      }), {
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
      return refreshSite99LiveContext(context, {
        provider,
        manifest: Deno.env.get("MINDBODY_SANDBOX_CLASS_FAMILIES_JSON"),
      });
    },
    withQuoteLease: async (scope: { offerId: string; customerId: string }, operation: (options?: { staffLeaseHeld: boolean }) => Promise<unknown>) => {
      const context = await quoteCatalogue.resolveQuoteContext(scope);
      if (!isEnabledSite99SandboxContext(context)) return operation();
      // The same cross-request lease used by every sandbox staff operation covers
      // search, reset recovery, Client creation, and persistence as one sequence.
      return withSite99StaffOperationLease(() => operation({ staffLeaseHeld: true }));
    },
    createProvider: (
      context: {
        business: { id: string };
        offer: { id: string };
        location: { id: string };
        mapping: { id: string };
        integration: { id: string; providerSiteId: string };
      },
      operation: { requestId: string; customerId: string; staffLeaseHeld?: boolean },
    ) => {
      const provider = createMindbodyRuntimeProvider({
        context,
        customerId: operation.customerId,
        apiKey: Deno.env.get("MINDBODY_API_KEY")!,
        staffTokens: configuredStaffTokens,
        sandboxUsername: Deno.env.get("MINDBODY_SANDBOX_USERNAME"),
        sandboxPassword: Deno.env.get("MINDBODY_SANDBOX_PASSWORD"),
        withSite99StaffOperationLease: operation.staffLeaseHeld
          ? (work: () => Promise<unknown>) => work()
          : withSite99StaffOperationLease,
        baseUrl: Deno.env.get("MINDBODY_BASE_URL") ?? "https://api.mindbodyonline.com",
        requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
        createProvider: createMindbodyClientQuoteClient,
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

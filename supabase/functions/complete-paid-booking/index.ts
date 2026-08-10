import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createClassPaidBookingCompletionCatalogue } from "../_shared/class-booking-catalogue.js";
import { authorizeClassCustomerRequest } from "../_shared/class-customer-authorization.js";
import { completeClassPaidBooking } from "../_shared/class-paid-booking-completion.js";
import { handleClassPaidBookingCompletion } from "../_shared/class-paid-booking-handler.js";
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
import { openPaymentActionToken } from "../_shared/payment-action-crypto.js";

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MEMBERSTACK_APP_ID",
  "MEMBERSTACK_SECRET_KEY",
  "MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST",
  "MINDBODY_API_KEY",
  "MINDBODY_STAFF_TOKENS_JSON",
  "MINDBODY_PAYMENT_ACTION_ENCRYPTION_KEY",
  "MINDBODY_PAYMENT_ACTION_KEY_VERSION",
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

function encryptionConfiguration() {
  const encryptionKeyHex = Deno.env.get("MINDBODY_PAYMENT_ACTION_ENCRYPTION_KEY") ?? "";
  const keyVersion = Deno.env.get("MINDBODY_PAYMENT_ACTION_KEY_VERSION") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(encryptionKeyHex)
    || !/^[A-Za-z0-9._-]{1,64}$/.test(keyVersion)) return null;
  return { encryptionKeyHex, keyVersion };
}

function configured() {
  return requiredEnvironment.every((name) => Boolean(Deno.env.get(name)))
    && /^[a-f0-9]{64}$/i.test(Deno.env.get("MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST") ?? "")
    && staffTokens() !== null
    && encryptionConfiguration() !== null;
}

function configurationError(request: Request) {
  const supplied = request.headers.get("x-request-id");
  const requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
  return new Response(JSON.stringify({
    ok: false,
    error: {
      code: "CONFIGURATION_ERROR",
      message: "Paid Class Booking completion is not configured.",
      retryable: true,
    },
    requestId,
  }), {
    status: 500,
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  });
}

Deno.serve((request) => {
  if (!configured()) return configurationError(request);
  const now = () => new Date();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const catalogue = createClassPaidBookingCompletionCatalogue(supabase);
  const customerCatalogue = createClassOfferCatalogue(supabase);
  const memberstack = {
    ...createMemberstackJwtVerifier({ appId: Deno.env.get("MEMBERSTACK_APP_ID")!, now }),
    ...createMemberstackAdminClient({
      secretKey: Deno.env.get("MEMBERSTACK_SECRET_KEY")!,
      admitRequest: createSupabaseMemberstackAdmission(supabase),
      now,
    }),
  };
  const configuredStaffTokens = staffTokens()!;
  const suppliedRequestId = request.headers.get("x-request-id");
  const requestId = suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();

  return handleClassPaidBookingCompletion(request, {
    allowedOrigins: new Set(
      (Deno.env.get("ALLOWED_ORIGINS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    requestId,
    catalogue,
    authorizeCustomer: (input: Record<string, unknown>) => authorizeClassCustomerRequest(
      input,
      { memberstack, catalogue: customerCatalogue, now },
    ),
    completeBooking: completeClassPaidBooking,
    openPaymentAction: (
      sealed: Record<string, string>,
      context: Record<string, string>,
    ) => openPaymentActionToken(sealed, context, encryptionConfiguration()!),
    createProvider: (claim: {
      booking: { businessId: string; integrationId: string; providerSiteId: string };
      attempt: { id: string };
      action: { paymentRoute: string };
    }) => {
      const userToken = configuredStaffTokens[claim.booking.integrationId];
      if (!userToken) throw new Error("No staff token is configured for the selected integration.");
      return instrumentClassBookingProvider(createMindbodyClassBookingClient({
        apiKey: Deno.env.get("MINDBODY_API_KEY")!,
        siteId: claim.booking.providerSiteId,
        userToken,
        baseUrl: Deno.env.get("MINDBODY_BASE_URL") ?? "https://api.mindbodyonline.com",
        requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
        paidCompletionRoute: claim.action.paymentRoute,
      }), {
        context: { businessId: claim.booking.businessId, attemptId: claim.attempt.id },
        requestId,
        recordDiagnostic: (facts: Record<string, unknown>) => catalogue.recordProviderDiagnostic(facts),
      });
    },
    logger: console,
  });
});

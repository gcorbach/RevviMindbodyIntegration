import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BookingOrchestrationError, createClassBooking } from "../_shared/class-booking.js";
import { createClassBookingCatalogue } from "../_shared/class-booking-catalogue.js";
import { handleClassBooking } from "../_shared/class-booking-handler.js";
import { revalidateClassBookingQuoteBeforeWrite } from "../_shared/class-booking-quote.js";
import { createClassBookingQuoteCatalogue } from "../_shared/class-booking-quote-catalogue.js";
import { authorizeClassOfferRequest } from "../_shared/class-offer-authorization.js";
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
  createMindbodyClientQuoteClient,
  instrumentClientQuoteProvider,
} from "../_shared/mindbody-client-quote.js";
import { sealPaymentActionToken } from "../_shared/payment-action-crypto.js";
import {
  createMindbodyRuntimeProvider,
  mindbodyStaffRuntimeConfigured,
  parseMindbodyStaffTokens,
} from "../_shared/mindbody-runtime-provider.js";

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

function paymentActionConfiguration() {
  const encryptionKeyHex = Deno.env.get("MINDBODY_PAYMENT_ACTION_ENCRYPTION_KEY") ?? "";
  const keyVersion = Deno.env.get("MINDBODY_PAYMENT_ACTION_KEY_VERSION") ?? "";
  const callbackUrl = Deno.env.get("MINDBODY_PAYMENT_CALLBACK_URL") ?? "";
  try {
    const parsed = new URL(callbackUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  if (!/^[0-9a-f]{64}$/i.test(encryptionKeyHex)
    || !/^[A-Za-z0-9._-]{1,64}$/.test(keyVersion)) return null;
  return { encryptionKeyHex, keyVersion, callbackUrl };
}

function configurationError(request: Request) {
  const suppliedRequestId = request.headers.get("x-request-id");
  const requestId = suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  return new Response(JSON.stringify({
    ok: false,
    error: { code: "CONFIGURATION_ERROR", message: "Class Booking is not configured.", retryable: true },
    requestId,
  }), {
    status: 500,
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  });
}

function decorateHostedSandboxBooking({
  booking,
  authorization,
  resolved,
}: {
  booking: Record<string, any>;
  authorization: { customer: { id: string; identity?: { firstName?: string; lastName?: string } } };
  resolved: {
    quote: { providerClientId?: string | null };
    context: {
      integration?: { environment?: string; providerSiteId?: string };
      location?: { providerLocationId?: string };
      mapping?: {
        paidPaymentRoute?: string | null;
        sandboxDemoWriteEnabled?: boolean;
        sandboxDemoCustomerId?: string | null;
      };
    };
  };
}) {
  const context = resolved.context;
  const sandboxDemo = booking.status === "confirmed"
    && context.integration?.environment === "sandbox"
    && context.integration.providerSiteId === "-99"
    && context.location?.providerLocationId === "1"
    && context.mapping?.paidPaymentRoute === "mindbody_sandbox_cash"
    && context.mapping.sandboxDemoWriteEnabled === true
    && context.mapping.sandboxDemoCustomerId === authorization.customer.id;
  if (!sandboxDemo) return booking;
  const references = booking.providerReferences ?? {};
  const clientName = [
    authorization.customer.identity?.firstName,
    authorization.customer.identity?.lastName,
  ].filter((value) => typeof value === "string" && value.trim()).join(" ")
    || "Revvi sandbox Customer";
  return {
    ...booking,
    sandboxDemo: {
      paymentType: "Fictitious Cash",
      providerEvidenceConfirmed: true,
      demoBookingId: booking.id,
      cleanupStatus: "pending",
      references: {
        clientId: resolved.quote.providerClientId,
        clientName,
        saleId: references.saleId,
        paymentId: references.paymentId,
        visitId: references.visitId ?? references.rosterBookingId,
      },
    },
  };
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
  const bookingCatalogue = createClassBookingCatalogue(supabase, quoteCatalogue);
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
  const providerOptions = (
    context: {
      integration: { id: string; providerSiteId: string };
      location?: { providerLocationId?: string };
      mapping?: {
        paidPaymentRoute?: string | null;
        paidPaymentMethodId?: number | null;
        paidCheckoutLocationId?: number | null;
        sandboxDemoWriteEnabled?: boolean;
        sandboxDemoCustomerId?: string | null;
      };
    },
    operation?: { bookingId?: string },
  ) => {
    const paymentAction = paymentActionConfiguration();
    let paidRoute = null;
    if (paymentAction
      && operation?.bookingId
      && context.mapping?.paidPaymentRoute === "mindbody_alternative_payment"
      && Number.isSafeInteger(context.mapping.paidPaymentMethodId)
      && context.mapping?.paidCheckoutLocationId === 98) {
      const callback = new URL(paymentAction.callbackUrl);
      callback.searchParams.set("booking", operation.bookingId);
      paidRoute = {
        type: context.mapping.paidPaymentRoute,
        paymentMethodId: context.mapping.paidPaymentMethodId,
        checkoutLocationId: context.mapping.paidCheckoutLocationId,
        callbackUrl: callback.toString(),
      };
    }
    return {
      apiKey: Deno.env.get("MINDBODY_API_KEY")!,
      baseUrl: Deno.env.get("MINDBODY_BASE_URL") ?? "https://api.mindbodyonline.com",
      requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
      ...(paidRoute ? { paidRoute } : {}),
    };
  };
  return handleClassBooking(request, {
    allowedOrigins: new Set(
      (Deno.env.get("ALLOWED_ORIGINS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    catalogue: bookingCatalogue,
    authorizeRequest: (input: Record<string, unknown>) => authorizeClassOfferRequest(
      input,
      { memberstack, catalogue: authorizationCatalogue, now },
    ),
    createQuoteProvider: (
      context: {
        business: { id: string };
        offer: { id: string };
        location: { id: string };
        mapping: { id: string };
        integration: { id: string; providerSiteId: string };
      },
      operation: { requestId: string; customerId: string },
    ) => instrumentClientQuoteProvider(
      createMindbodyRuntimeProvider({
        ...providerOptions(context), context, customerId: operation.customerId,
        staffTokens: configuredStaffTokens,
        sandboxUsername: Deno.env.get("MINDBODY_SANDBOX_USERNAME"),
        sandboxPassword: Deno.env.get("MINDBODY_SANDBOX_PASSWORD"),
        createProvider: createMindbodyClientQuoteClient,
      }),
      {
        context: {
          businessId: context.business.id,
          offerId: context.offer.id,
          locationId: context.location.id,
          mappingId: context.mapping.id,
          customerId: operation.customerId,
        },
        requestId: operation.requestId,
        recordDiagnostic: (facts: Record<string, unknown>) => quoteCatalogue.recordProviderDiagnostic(facts),
      },
    ),
    createWriteProvider: (
      context: {
        business: { id: string };
        integration: { id: string; providerSiteId: string };
        location: { providerLocationId: string };
        mapping: {
          paidPaymentRoute?: string | null;
          paidPaymentMethodId?: number | null;
          paidCheckoutLocationId?: number | null;
          sandboxDemoWriteEnabled?: boolean;
          sandboxDemoCustomerId?: string | null;
        };
      },
      operation: { requestId: string; customerId: string; bookingId: string; attemptId: string },
    ) => instrumentClassBookingProvider(
      createMindbodyRuntimeProvider({
        ...providerOptions(context, { bookingId: operation.bookingId }),
        context,
        customerId: operation.customerId,
        staffTokens: configuredStaffTokens,
        sandboxUsername: Deno.env.get("MINDBODY_SANDBOX_USERNAME"),
        sandboxPassword: Deno.env.get("MINDBODY_SANDBOX_PASSWORD"),
        createProvider: createMindbodyClassBookingClient,
      }),
      {
        context: { businessId: context.business.id, attemptId: operation.attemptId },
        requestId: operation.requestId,
        recordDiagnostic: (facts: Record<string, unknown>) => bookingCatalogue.recordProviderDiagnostic(facts),
      },
    ),
    executeBooking: createClassBooking,
    decorateBooking: decorateHostedSandboxBooking,
    revalidateQuote: revalidateClassBookingQuoteBeforeWrite,
    validateWriteConfiguration: ({ quote, context }: {
      quote: { fulfilmentMode: string };
      context: {
        mapping: {
          paidPaymentRoute?: string | null;
          paidPaymentMethodId?: number | null;
          paidCheckoutLocationId?: number | null;
        };
      };
    }) => {
      if (quote.fulfilmentMode === "purchase_pricing_option"
        && context.mapping.paidPaymentRoute !== "mindbody_sandbox_cash"
        && (!paymentActionConfiguration()
          || context.mapping.paidPaymentRoute !== "mindbody_alternative_payment"
          || !Number.isSafeInteger(context.mapping.paidPaymentMethodId)
          || context.mapping.paidCheckoutLocationId !== 98)) {
        throw new BookingOrchestrationError(
          "PAID_ROUTE_NOT_CONFIGURED",
          "The approved Mindbody payment route is not configured in this runtime.",
          503,
        );
      }
    },
    sealPaymentAction: (providerAccessToken: string, actionContext: Record<string, string>) => {
      const configuration = paymentActionConfiguration();
      if (!configuration) throw new Error("Paid payment-action encryption is not configured.");
      return sealPaymentActionToken(providerAccessToken, actionContext, configuration);
    },
    now,
    logger: console,
  });
});

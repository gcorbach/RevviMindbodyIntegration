import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createClassLifecycleCatalogue } from "../_shared/class-lifecycle-catalogue.js";
import { runClassLifecycleWorker } from "../_shared/class-lifecycle-worker.js";
import { createClassOfferCatalogue } from "../_shared/class-offer-catalogue.js";
import {
  createMindbodyClassBookingClient,
  instrumentClassBookingProvider,
} from "../_shared/mindbody-class-booking.js";

function staffTokens() {
  try {
    const value = JSON.parse(Deno.env.get("MINDBODY_STAFF_TOKENS_JSON") ?? "");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : null;
  } catch { return null; }
}

Deno.serve(async (request) => {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const workerSecret = Deno.env.get("CLASS_LIFECYCLE_WORKER_SECRET");
  const configuredTokens = staffTokens();
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!workerSecret || request.headers.get("X-Revvi-Worker-Secret") !== workerSecret) {
    return new Response(JSON.stringify({ ok: false, error: { code: "AUTHENTICATION_INVALID", message: "Worker authentication failed.", retryable: false }, requestId }), {
      status: 401, headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  }
  if (!Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || !Deno.env.get("MINDBODY_API_KEY") || !configuredTokens) {
    return new Response(JSON.stringify({ ok: false, error: { code: "CONFIGURATION_ERROR", message: "Lifecycle worker is not configured.", retryable: true }, requestId }), {
      status: 500, headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const catalogue = createClassLifecycleCatalogue(supabase, createClassOfferCatalogue(supabase));
  try {
    const result = await runClassLifecycleWorker({
      catalogue,
      createProvider: async (context: { booking: { businessId: string; integrationId: string }; attempt: { id: string } }) => {
        const integration = await catalogue.resolveIntegration(context.booking.integrationId);
        const userToken = configuredTokens[integration.id];
        if (typeof userToken !== "string" || userToken.trim().length < 16) {
          throw new Error("Mindbody staff token is unavailable.");
        }
        return instrumentClassBookingProvider(createMindbodyClassBookingClient({
          apiKey: Deno.env.get("MINDBODY_API_KEY")!, siteId: integration.providerSiteId, userToken,
          baseUrl: Deno.env.get("MINDBODY_BASE_URL") ?? "https://api.mindbodyonline.com",
          requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
        }), {
          context: { businessId: context.booking.businessId, attemptId: context.attempt.id },
          requestId,
          recordDiagnostic: (facts: Record<string, unknown>) => catalogue.recordProviderDiagnostic(facts),
        });
      },
    });
    return new Response(JSON.stringify({ ok: true, data: result, requestId }), {
      status: 200, headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  } catch {
    console.error(JSON.stringify({ event: "class_lifecycle_worker_failed", requestId }));
    return new Response(JSON.stringify({ ok: false, error: { code: "WORKER_FAILED", message: "Lifecycle worker failed safely.", retryable: true }, requestId }), {
      status: 503, headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  }
});

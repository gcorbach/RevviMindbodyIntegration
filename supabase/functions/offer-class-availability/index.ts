import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { discoverOfferClassAvailability } from "../_shared/class-availability.js";
import { handleOfferClassAvailability } from "../_shared/class-availability-handler.js";
import { createClassAvailabilityCatalogue } from "../_shared/class-availability-catalogue.js";
import { authorizeClassOfferRequest } from "../_shared/class-offer-authorization.js";
import { createClassOfferCatalogue } from "../_shared/class-offer-catalogue.js";
import {
  createMemberstackAdminClient,
  createMemberstackJwtVerifier,
  createSupabaseMemberstackAdmission,
} from "../_shared/memberstack.js";
import {
  createMindbodyClassReadClient,
  instrumentClassReadProvider,
} from "../_shared/mindbody-class-read.js";

const requiredEnvironment = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MEMBERSTACK_APP_ID",
  "MEMBERSTACK_SECRET_KEY",
  "MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST",
  "MINDBODY_API_KEY",
] as const;

function configured() {
  if (requiredEnvironment.some((name) => !Deno.env.get(name))) return false;
  return /^[a-f0-9]{64}$/i.test(Deno.env.get("MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST") ?? "");
}

function configurationError(request: Request) {
  const suppliedRequestId = request.headers.get("x-request-id");
  const requestId = suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  return new Response(JSON.stringify({
    ok: false,
    code: "CONFIGURATION_ERROR",
    error: "Class availability is not configured.",
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
  const authorizationCatalogue = createClassOfferCatalogue(supabase);
  const availabilityCatalogue = createClassAvailabilityCatalogue(supabase);
  const memberstack = {
    ...createMemberstackJwtVerifier({ appId: Deno.env.get("MEMBERSTACK_APP_ID")!, now }),
    ...createMemberstackAdminClient({
      secretKey: Deno.env.get("MEMBERSTACK_SECRET_KEY")!,
      admitRequest: createSupabaseMemberstackAdmission(supabase),
      now,
    }),
  };

  return handleOfferClassAvailability(request, {
    allowedOrigins: new Set(
      (Deno.env.get("ALLOWED_ORIGINS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    now,
    catalogue: availabilityCatalogue,
    authorizeRequest: (input: Record<string, unknown>) => authorizeClassOfferRequest(
      input,
      { memberstack, catalogue: authorizationCatalogue, now },
    ),
    createProvider: (context: { integration: { providerSiteId: string } }) => createMindbodyClassReadClient({
      apiKey: Deno.env.get("MINDBODY_API_KEY")!,
      siteId: context.integration.providerSiteId,
      baseUrl: Deno.env.get("MINDBODY_BASE_URL") ?? "https://api.mindbodyonline.com",
      requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
    }),
    instrumentProvider: instrumentClassReadProvider,
    discoverAvailability: discoverOfferClassAvailability,
    logger: console,
  });
});

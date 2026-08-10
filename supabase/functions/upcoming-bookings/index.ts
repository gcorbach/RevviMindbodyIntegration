import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeClassCustomerRequest } from "../_shared/class-customer-authorization.js";
import { createClassLifecycleCatalogue } from "../_shared/class-lifecycle-catalogue.js";
import { handleUpcomingClassBookings } from "../_shared/class-lifecycle-handler.js";
import { createClassOfferCatalogue } from "../_shared/class-offer-catalogue.js";
import {
  createMemberstackAdminClient,
  createMemberstackJwtVerifier,
  createSupabaseMemberstackAdmission,
} from "../_shared/memberstack.js";

const requiredEnvironment = [
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MEMBERSTACK_APP_ID",
  "MEMBERSTACK_SECRET_KEY", "MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST",
] as const;

function configurationError(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  return new Response(JSON.stringify({
    ok: false,
    error: { code: "CONFIGURATION_ERROR", message: "Upcoming Class Bookings are not configured.", retryable: true },
    requestId,
  }), { status: 500, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } });
}

Deno.serve((request) => {
  if (requiredEnvironment.some((name) => !Deno.env.get(name))
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
  return handleUpcomingClassBookings(request, {
    allowedOrigins: new Set((Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean)),
    catalogue,
    authorizeCustomer: (input: Record<string, unknown>) => authorizeClassCustomerRequest(
      input, { memberstack, catalogue, now },
    ),
    logger: console,
  });
});

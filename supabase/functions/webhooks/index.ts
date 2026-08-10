import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createMindbodyWebhookCatalogue,
  handleMindbodyWebhook,
  verifyMindbodyWebhook,
} from "../_shared/mindbody-webhook.js";

type Subscription = { integrationId: string; siteId: string; signatureKey: string };

function subscriptions(): Subscription[] | null {
  try {
    const parsed = JSON.parse(Deno.env.get("MINDBODY_WEBHOOK_SUBSCRIPTIONS_JSON") ?? "");
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const normalized = parsed.map((value) => ({
      integrationId: String(value?.integrationId ?? ""),
      siteId: String(value?.siteId ?? ""),
      signatureKey: String(value?.signatureKey ?? ""),
    }));
    return normalized.every((value) => /^[0-9a-f-]{36}$/i.test(value.integrationId)
      && value.siteId.length > 0 && value.signatureKey.length >= 16) ? normalized : null;
  } catch { return null; }
}

Deno.serve((request) => {
  if (!new URL(request.url).pathname.endsWith("/webhooks/mindbody")) {
    return new Response(null, { status: 404 });
  }
  const configuredSubscriptions = subscriptions();
  if (!Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    || !configuredSubscriptions) {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    return new Response(JSON.stringify({
      ok: false,
      error: { code: "CONFIGURATION_ERROR", message: "Mindbody webhook intake is not configured.", retryable: true },
      requestId,
    }), { status: 500, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return handleMindbodyWebhook(request, {
    subscriptions: configuredSubscriptions,
    verify: verifyMindbodyWebhook,
    catalogue: createMindbodyWebhookCatalogue(supabase),
    logger: console,
  });
});

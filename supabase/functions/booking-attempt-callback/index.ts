import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", error: "Use POST." }, 405);
  const expectedSecret = Deno.env.get("MINDBODY_CALLBACK_SECRET");
  if (!expectedSecret || request.headers.get("X-Revvi-Callback-Secret") !== expectedSecret) {
    return json({ code: "CALLBACK_UNAUTHORISED", error: "Callback authentication failed." }, 401);
  }
  const body = await request.json().catch(() => null);
  if (!isUuid(body?.correlationId)) return json({ code: "INVALID_CALLBACK", error: "A correlation ID is required." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ code: "CONFIGURATION_ERROR", error: "Callback configuration is incomplete." }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: attempt, error } = await supabase.from("booking_attempts")
    .select("id,business_id,correlation_id,state")
    .eq("correlation_id", body.correlationId)
    .maybeSingle();
  if (error) return json({ code: "DATABASE_ERROR", error: "Callback correlation could not be recorded." }, 500);
  if (!attempt) return json({ accepted: true }, 202);

  const { error: eventError } = await supabase.from("booking_attempt_events").insert({
    business_id: attempt.business_id,
    booking_attempt_id: attempt.id,
    correlation_id: attempt.correlation_id,
    event_type: "callback_received",
    operation: "booking_callback",
    metadata: {},
  });
  if (eventError) return json({ code: "DATABASE_ERROR", error: "Callback correlation could not be recorded." }, 500);
  // A callback is only a correlation signal; authoritative provider reads settle the attempt.
  return json({ accepted: true }, 202);
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function scaReturn(request: Request) {
  const url = new URL(request.url);
  return { attemptId: url.searchParams.get("attempt"), resumeToken: url.searchParams.get("resume") };
}

Deno.serve(async (request) => {
  const isScaBrowserReturn = request.method === "GET";
  if (isScaBrowserReturn) {
    const { attemptId, resumeToken } = scaReturn(request);
    if (!isUuid(attemptId) || !isUuid(resumeToken)) return json({ code: "INVALID_CALLBACK", error: "A valid SCA return is required." }, 400);
  } else if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", error: "Use POST." }, 405);
  const expectedSecret = Deno.env.get("MINDBODY_CALLBACK_SECRET");
  if (!isScaBrowserReturn && (!expectedSecret || request.headers.get("X-Revvi-Callback-Secret") !== expectedSecret)) {
    return json({ code: "CALLBACK_UNAUTHORISED", error: "Callback authentication failed." }, 401);
  }
  const body = isScaBrowserReturn ? null : await request.json().catch(() => null);
  if (!isScaBrowserReturn && !isUuid(body?.correlationId)) return json({ code: "INVALID_CALLBACK", error: "A correlation ID is required." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ code: "CONFIGURATION_ERROR", error: "Callback configuration is incomplete." }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { attemptId, resumeToken } = scaReturn(request);
  const lookup = supabase.from("booking_attempts").select("id,business_id,location_id,service_id,selected_start_time,correlation_id,state")
  const { data: attempt, error } = isScaBrowserReturn
    ? await lookup.eq("id", attemptId).eq("sca_resume_token", resumeToken).maybeSingle()
    : await lookup.eq("correlation_id", body.correlationId).maybeSingle();
  if (error) return json({ code: "DATABASE_ERROR", error: "Callback correlation could not be recorded." }, 500);
  if (!attempt) return json({ accepted: true }, 202);

  const { error: eventError } = await supabase.from("booking_attempt_events").insert({
    business_id: attempt.business_id,
    booking_attempt_id: attempt.id,
    correlation_id: attempt.correlation_id,
    event_type: isScaBrowserReturn ? "sca_return_received" : "callback_received",
    operation: isScaBrowserReturn ? "checkout_callback" : "booking_callback",
    metadata: {},
  });
  if (eventError) return json({ code: "DATABASE_ERROR", error: "Callback correlation could not be recorded." }, 500);
  if (isScaBrowserReturn) {
    const returnUrl = Deno.env.get("BOOKING_SCA_RETURN_URL");
    if (!returnUrl) return json({ code: "CONFIGURATION_ERROR", error: "SCA return configuration is incomplete." }, 500);
    const [{ data: business }, { data: location }] = await Promise.all([
      supabase.from("businesses").select("slug").eq("id", attempt.business_id).maybeSingle(),
      supabase.from("business_locations").select("slug").eq("business_id", attempt.business_id).eq("id", attempt.location_id).maybeSingle(),
    ]);
    if (!business || !location) return json({ code: "DATABASE_ERROR", error: "SCA return context could not be loaded." }, 500);
    const url = new URL(returnUrl);
    url.searchParams.set("business", business.slug);
    url.searchParams.set("location", location.slug);
    url.searchParams.set("service", attempt.service_id);
    url.searchParams.set("start", attempt.selected_start_time);
    url.searchParams.set("sca", "returned");
    return new Response(null, { status: 302, headers: { Location: url.toString(), "Cache-Control": "no-store" } });
  }
  // A callback is only a correlation signal; authoritative provider reads settle the attempt.
  return json({ accepted: true }, 202);
});

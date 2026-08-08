import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function allowedOrigins() {
  return new Set((Deno.env.get("ALLOWED_ORIGINS") ?? "http://127.0.0.1:3000,http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean));
}

function corsHeaders(origin: string | null, requestId: string) {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Request-Id": requestId,
  };
}

function json(body: Record<string, unknown>, status = 200, origin: string | null = null, requestId = crypto.randomUUID()) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin, requestId), "Content-Type": "application/json" } });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("Authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
}

function readinessResponse(business: any, readiness: any, checks: any[], actions: any[], bookingAttempts: any[]) {
  return {
    business: {
      id: business.id,
      slug: business.slug,
      displayName: business.display_name,
      bookingEnabled: business.booking_enabled,
    },
    readiness: {
      environment: readiness.environment,
      status: readiness.status,
      checkoutMode: readiness.checkout_mode,
      transactionalMessageBehavior: readiness.transactional_message_behavior,
      acceptedLimitations: readiness.accepted_limitations,
      responsibleStaffActor: readiness.responsible_staff_actor,
      activatedAt: readiness.activated_at,
      deactivatedAt: readiness.deactivated_at,
      deactivationReason: readiness.deactivation_reason,
      updatedAt: readiness.updated_at,
      bookingAttemptHistory: {
        total: bookingAttempts.length,
        confirmed: bookingAttempts.filter((attempt) => attempt.state === "confirmed").length,
        unknown: bookingAttempts.filter((attempt) => attempt.state === "unknown").length,
      },
      checks: checks.map((check) => ({
        name: check.check_name,
        passed: check.passed,
        verifiedAt: check.verified_at,
        evidenceRef: check.evidence_ref,
        details: check.details,
        verifiedBy: check.verified_by,
      })),
      actions: actions.map((action) => ({
        action: action.action,
        checkName: action.check_name,
        actorUserId: action.actor_user_id,
        fromStatus: action.from_status,
        toStatus: action.to_status,
        reason: action.reason,
        evidenceRef: action.evidence_ref,
        createdAt: action.created_at,
      })),
    },
  };
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins().has(origin)) return json({ code: "ORIGIN_NOT_ALLOWED", error: "This origin is not authorised." }, 403, null, requestId);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin, requestId) });
  if (!['GET', 'POST'].includes(request.method)) return json({ code: "METHOD_NOT_ALLOWED", error: "Use GET or POST." }, 405, origin, requestId);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ code: "CONFIGURATION_ERROR", error: "Business readiness configuration is incomplete." }, 500, origin, requestId);

  const token = bearerToken(request);
  if (!token) return json({ code: "AUTHENTICATION_REQUIRED", error: "Revvi staff sign-in is required." }, 401, origin, requestId);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return json({ code: "AUTHENTICATION_INVALID", error: "Revvi staff identity could not be verified." }, 401, origin, requestId);
  if (userData.user.app_metadata?.platform_operations !== true) return json({ code: "PLATFORM_OPERATIONS_REQUIRED", error: "Platform operations access is required." }, 403, origin, requestId);

  const body = request.method === "POST" ? await request.json().catch(() => null) : null;
  const businessSlug = request.method === "POST" ? body?.business : new URL(request.url).searchParams.get("business");
  if (!businessSlug) return json({ code: "BUSINESS_REQUIRED", error: "Choose a Business." }, 400, origin, requestId);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  let { data: business, error: businessError } = await supabase.from("businesses").select("id, slug, display_name, booking_enabled").eq("slug", businessSlug).maybeSingle();
  if (businessError) return json({ code: "DATABASE_ERROR", error: "Business context could not be loaded." }, 500, origin, requestId);
  if (!business) return json({ code: "BUSINESS_NOT_FOUND", error: "That Business was not found." }, 404, origin, requestId);
  if (request.method === "POST") {
    let error;
    if (body?.action === "activate") {
      ({ error } = await authClient.rpc("activate_business_pilot", { candidate_business_id: business.id }));
    } else if (body?.action === "record_check") {
      if (typeof body.check !== "string" || typeof body.passed !== "boolean" || typeof body.verifiedAt !== "string" || typeof body.evidenceRef !== "string" || !body.details || typeof body.details !== "object" || Array.isArray(body.details)) {
        return json({ code: "INVALID_READINESS_EVIDENCE", error: "Complete readiness evidence is required." }, 400, origin, requestId);
      }
      ({ error } = await authClient.rpc("record_business_pilot_readiness_check", {
        candidate_business_id: business.id,
        candidate_evidence: {
          check: body.check,
          passed: body.passed,
          verifiedAt: body.verifiedAt,
          evidenceRef: body.evidenceRef,
          details: body.details,
          checkoutMode: body.checkoutMode ?? null,
          transactionalMessageBehavior: body.transactionalMessageBehavior ?? null,
          acceptedLimitations: body.acceptedLimitations ?? null,
        },
      }));
    } else if (body?.action === "deactivate") {
      if (typeof body.reason !== "string") return json({ code: "DEACTIVATION_REASON_REQUIRED", error: "A recorded deactivation reason is required." }, 400, origin, requestId);
      ({ error } = await authClient.rpc("deactivate_business_pilot", { candidate_business_id: business.id, candidate_reason: body.reason }));
    } else {
      return json({ code: "INVALID_READINESS_ACTION", error: "That readiness action is not supported." }, 400, origin, requestId);
    }
    if (error) {
      if (error.message.startsWith("readiness_gates_incomplete:")) {
        return json({
          code: "READINESS_GATES_INCOMPLETE",
          error: "Every sandbox readiness gate needs current passing evidence.",
          missingChecks: error.message.slice("readiness_gates_incomplete:".length).split(",").filter(Boolean),
        }, 409, origin, requestId);
      }
      if (error.message.includes("controlled_booking_evidence_invalid")) return json({ code: "CONTROLLED_BOOKING_EVIDENCE_INVALID", error: "The controlled Booking must be a confirmed Booking for this Business." }, 409, origin, requestId);
      if (error.message.includes("unresolved_booking_outcomes")) return json({ code: "UNRESOLVED_BOOKING_OUTCOMES", error: "Resolve every unknown Booking outcome before activating this Business." }, 409, origin, requestId);
      if (body?.action === "record_check") return json({ code: "INVALID_READINESS_EVIDENCE", error: "That readiness evidence could not be recorded." }, 400, origin, requestId);
      return json({ code: "READINESS_ACTIVATION_FAILED", error: "This Business is not ready for sandbox pilot activation." }, 409, origin, requestId);
    }
    const refreshedBusiness = await supabase.from("businesses").select("id, slug, display_name, booking_enabled").eq("id", business.id).single();
    if (refreshedBusiness.error || !refreshedBusiness.data) return json({ code: "DATABASE_ERROR", error: "Updated Business context could not be loaded." }, 500, origin, requestId);
    business = refreshedBusiness.data;
  }
  const [{ data: readiness, error: readinessError }, { data: checks, error: checksError }, { data: actions, error: actionsError }, { data: bookingAttempts, error: bookingAttemptsError }] = await Promise.all([
    supabase.from("business_pilot_readiness").select("*").eq("business_id", business.id).single(),
    supabase.from("business_pilot_readiness_checks").select("*").eq("business_id", business.id).order("check_name"),
    supabase.from("business_pilot_readiness_actions").select("*").eq("business_id", business.id).order("created_at"),
    supabase.from("booking_attempts").select("state").eq("business_id", business.id),
  ]);
  if (readinessError || checksError || actionsError || bookingAttemptsError || !readiness) return json({ code: "DATABASE_ERROR", error: "Business readiness could not be loaded." }, 500, origin, requestId);
  return json(readinessResponse(business, readiness, checks ?? [], actions ?? [], bookingAttempts ?? []), 200, origin, requestId);
});

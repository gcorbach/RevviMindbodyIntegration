import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPPORT_STATUSES = new Set(["open", "resolved"]);
const EXCEPTION_CATEGORIES = new Set(["ambiguous_client", "unknown_outcome", "reconciliation_failure", "expired_attempt"]);

type DatabaseClient = ReturnType<typeof createClient>;

interface SupportItemRow {
  id: string;
  business_id: string;
  booking_attempt_id: string | null;
  correlation_id: string;
  reason: string;
  exception_category: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolution_summary: string | null;
}

interface BusinessRow { id: string; slug: string; display_name: string }

interface BookingAttemptRow {
  id: string;
  correlation_id: string;
  business_name: string;
  location_name: string;
  location_timezone: string;
  service_name: string;
  selected_start_time: string;
  selected_end_time: string | null;
  duration_minutes: number | null;
  price: number | null;
  state: string;
  completion_mode: string;
  reconciliation_attempts: number;
  reconciliation_last_attempted_at: string | null;
  mindbody_client_id: string | null;
  mindbody_appointment_id: string | null;
  mindbody_checkout_sale_id: string | null;
  mindbody_checkout_transaction_ids: unknown;
}

interface OperationalEventRow {
  booking_attempt_id: string;
  event_type: string;
  operation: string;
  provider_status: number | null;
  error_category: string | null;
  latency_ms: number | null;
  created_at: string;
}

interface SupportAlertRow { booking_support_item_id: string; status: string; created_at: string }

interface LoadSupportItemsOptions {
  supabase: DatabaseClient;
  businessIds: string[];
  itemId?: string | null;
  status?: string | null;
  category?: string | null;
  correlation?: string | null;
}

function allowedOrigins() {
  return new Set((Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));
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
  const value = request.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function platformOperations(user: { app_metadata?: Record<string, unknown> }) {
  return user.app_metadata?.platform_operations === true;
}

function latestOperationalEvent(events: OperationalEventRow[]) {
  return events.findLast((event) => event.latency_ms !== null || event.error_category !== null) ?? events.at(-1) ?? null;
}

function toRedactedOperationalEvent(event: OperationalEventRow) {
  return {
    eventType: event.event_type,
    operation: event.operation,
    providerStatus: event.provider_status,
    errorCategory: event.error_category,
    latencyMs: event.latency_ms,
    createdAt: event.created_at,
  };
}

async function loadSupportItems({ supabase, businessIds, itemId, status, category, correlation }: LoadSupportItemsOptions) {
  let query = supabase
    .from("booking_support_items")
    .select("id,business_id,booking_attempt_id,correlation_id,reason,exception_category,status,created_at,resolved_at,resolution_summary")
    .in("business_id", businessIds)
    .order("created_at", { ascending: false });
  if (itemId) query = query.eq("id", itemId);
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("exception_category", category);
  if (correlation) query = query.eq("correlation_id", correlation);
  const { data, error } = await query;
  if (error) throw error;
  const items = (data ?? []) as SupportItemRow[];
  if (!items.length) return [];

  const itemBusinessIds = [...new Set(items.map((item) => item.business_id))];
  const attemptIds = [...new Set(items.map((item) => item.booking_attempt_id).filter((id): id is string => Boolean(id)))];
  const [{ data: businesses, error: businessesError }, attemptsResult, eventsResult, alertsResult] = await Promise.all([
    supabase.from("businesses").select("id,slug,display_name").in("id", itemBusinessIds),
    attemptIds.length
      ? supabase.from("booking_attempts").select("id,correlation_id,business_name,location_name,location_timezone,service_name,selected_start_time,selected_end_time,duration_minutes,price,state,completion_mode,reconciliation_attempts,reconciliation_last_attempted_at,mindbody_client_id,mindbody_appointment_id,mindbody_checkout_sale_id,mindbody_checkout_transaction_ids").in("id", attemptIds)
      : Promise.resolve({ data: [], error: null }),
    attemptIds.length
      ? supabase.from("booking_attempt_events").select("booking_attempt_id,event_type,operation,provider_status,error_category,latency_ms,created_at").in("booking_attempt_id", attemptIds).order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("booking_support_alerts").select("booking_support_item_id,status,created_at").in("booking_support_item_id", items.map((item) => item.id)),
  ]);
  if (businessesError || attemptsResult.error || eventsResult.error || alertsResult.error) {
    throw businessesError ?? attemptsResult.error ?? eventsResult.error ?? alertsResult.error;
  }

  const businessRows = (businesses ?? []) as BusinessRow[];
  const attemptRows = (attemptsResult.data ?? []) as BookingAttemptRow[];
  const eventRows = (eventsResult.data ?? []) as OperationalEventRow[];
  const alertRows = (alertsResult.data ?? []) as SupportAlertRow[];
  const businessById = new Map(businessRows.map((business) => [business.id, business]));
  const attemptById = new Map(attemptRows.map((attempt) => [attempt.id, attempt]));
  const eventsByAttempt = new Map<string, OperationalEventRow[]>();
  for (const event of eventRows) {
    const events = eventsByAttempt.get(event.booking_attempt_id) ?? [];
    events.push(event);
    eventsByAttempt.set(event.booking_attempt_id, events);
  }
  const alertByItem = new Map(alertRows.map((alert) => [alert.booking_support_item_id, alert]));

  return items.map((item) => {
    const business = businessById.get(item.business_id);
    const attempt = attemptById.get(item.booking_attempt_id);
    const events = eventsByAttempt.get(item.booking_attempt_id) ?? [];
    const latest = latestOperationalEvent(events);
    const alert = alertByItem.get(item.id);
    const authoritativeResultEstablished = events.some((event) =>
      (event.event_type === "reconciliation_confirmed" && event.error_category === "authoritative_success")
      || (event.event_type === "reconciliation_absent" && event.error_category === "authoritative_absence")
    );
    return {
      id: item.id,
      exceptionCategory: item.exception_category,
      supportStatus: item.status,
      reason: item.reason,
      createdAt: item.created_at,
      resolvedAt: item.resolved_at,
      resolutionSummary: item.resolution_summary,
      business: business ? { id: business.id, slug: business.slug, displayName: business.display_name } : null,
      bookingAttempt: attempt ? {
        id: attempt.id,
        correlationId: attempt.correlation_id,
        businessName: attempt.business_name,
        locationName: attempt.location_name,
        locationTimezone: attempt.location_timezone,
        serviceName: attempt.service_name,
        selectedStartTime: attempt.selected_start_time,
        selectedEndTime: attempt.selected_end_time,
        durationMinutes: attempt.duration_minutes,
        price: attempt.price,
        state: attempt.state,
        completionMode: attempt.completion_mode,
        reconciliationAttempts: attempt.reconciliation_attempts,
        reconciliationLastAttemptedAt: attempt.reconciliation_last_attempted_at,
      } : { id: null, correlationId: item.correlation_id, state: null },
      providerOperation: latest ? { category: latest.operation, latencyMs: latest.latency_ms } : null,
      redactedErrorCategory: latest?.error_category ?? item.reason,
      providerReferencePresence: attempt ? {
        client: Boolean(attempt.mindbody_client_id),
        appointment: Boolean(attempt.mindbody_appointment_id),
        checkoutSale: Boolean(attempt.mindbody_checkout_sale_id),
        checkoutTransactions: Array.isArray(attempt.mindbody_checkout_transaction_ids) && attempt.mindbody_checkout_transaction_ids.length > 0,
      } : { client: false, appointment: false, checkoutSale: false, checkoutTransactions: false },
      reconciliationHistory: events.filter((event) => event.operation.includes("reconciliation")).map(toRedactedOperationalEvent),
      authoritativeResultEstablished,
      evidence: events.map(toRedactedOperationalEvent),
      alert: alert ? { status: alert.status, createdAt: alert.created_at } : null,
    };
  });
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins().has(origin)) return json({ code: "ORIGIN_NOT_ALLOWED", error: "This origin is not authorised." }, 403, null, requestId);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin, requestId) });
  if (!["GET", "POST"].includes(request.method)) return json({ code: "METHOD_NOT_ALLOWED", error: "Use GET or POST." }, 405, origin, requestId);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ code: "CONFIGURATION_ERROR", error: "Support operations configuration is incomplete." }, 500, origin, requestId);

  const token = bearerToken(request);
  if (!token) return json({ code: "AUTHENTICATION_REQUIRED", error: "Staff sign-in is required." }, 401, origin, requestId);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return json({ code: "AUTHENTICATION_INVALID", error: "Staff identity could not be verified." }, 401, origin, requestId);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const isPlatformOperations = platformOperations(userData.user);
  const { data: accessRows, error: accessError } = isPlatformOperations
    ? await supabase.from("businesses").select("id")
    : await supabase.from("business_staff_access").select("business_id").eq("user_id", userData.user.id);
  if (accessError) return json({ code: "DATABASE_ERROR", error: "Staff access could not be verified." }, 500, origin, requestId);
  let businessIds = (accessRows ?? []).map((row: { id?: string; business_id?: string }) => row.id ?? row.business_id).filter((id): id is string => Boolean(id));
  if (!businessIds.length) return json({ code: "STAFF_ACCESS_REQUIRED", error: "This account has no Booking support access." }, 403, origin, requestId);

  const url = new URL(request.url);
  const businessSlug = url.searchParams.get("business");
  if (businessSlug) {
    const { data: business, error } = await supabase.from("businesses").select("id").eq("slug", businessSlug).maybeSingle();
    if (error) return json({ code: "DATABASE_ERROR", error: "Business filter could not be loaded." }, 500, origin, requestId);
    if (!business || !businessIds.includes(business.id)) return json({ code: "BUSINESS_ACCESS_DENIED", error: "Staff is not authorised for that Business." }, 403, origin, requestId);
    businessIds = [business.id];
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!isUuid(body?.itemId) || body?.action !== "resolve" || typeof body?.resolution !== "string") {
      return json({ code: "INVALID_SUPPORT_ACTION", error: "Only a recorded support resolution is allowed." }, 400, origin, requestId);
    }
    const { error } = await authClient.rpc("resolve_booking_support_item", { candidate_item_id: body.itemId, candidate_resolution: body.resolution });
    if (error) {
      if (error.message?.includes("authoritative_evidence_required")) return json({ code: "AUTHORITATIVE_EVIDENCE_REQUIRED", error: "An unknown Booking attempt stays retry-blocked until authoritative evidence establishes the result." }, 409, origin, requestId);
      if (error.code === "42501") return json({ code: "BUSINESS_ACCESS_DENIED", error: "Staff is not authorised for that Business." }, 403, origin, requestId);
      if (error.code === "P0002") return json({ code: "SUPPORT_ITEM_NOT_FOUND", error: "That support item was not found." }, 404, origin, requestId);
      if (error.message?.includes("resolution must")) return json({ code: "INVALID_SUPPORT_ACTION", error: "Resolution must be between 10 and 1000 characters." }, 400, origin, requestId);
      console.error(JSON.stringify({ event: "support_resolution_failed", requestId, error_category: error.code }));
      return json({ code: "DATABASE_ERROR", error: "The support resolution could not be recorded." }, 500, origin, requestId);
    }
    try {
      const [item] = await loadSupportItems({ supabase, businessIds, itemId: body.itemId });
      return item ? json({ item }, 200, origin, requestId) : json({ code: "SUPPORT_ITEM_NOT_FOUND", error: "That support item was not found." }, 404, origin, requestId);
    } catch (error) {
      console.error(JSON.stringify({ event: "support_detail_failed", requestId, error_category: error?.code ?? "unknown" }));
      return json({ code: "DATABASE_ERROR", error: "Support detail could not be loaded." }, 500, origin, requestId);
    }
  }

  const status = url.searchParams.get("status");
  const category = url.searchParams.get("category");
  const correlation = url.searchParams.get("correlation");
  const itemId = url.searchParams.get("item");
  if ((status && !SUPPORT_STATUSES.has(status)) || (category && !EXCEPTION_CATEGORIES.has(category)) || (correlation && !isUuid(correlation)) || (itemId && !isUuid(itemId))) {
    return json({ code: "INVALID_FILTER", error: "Support filters are invalid." }, 400, origin, requestId);
  }
  try {
    const items = await loadSupportItems({ supabase, businessIds, itemId, status, category, correlation });
    if (itemId) return items[0] ? json({ item: items[0] }, 200, origin, requestId) : json({ code: "SUPPORT_ITEM_NOT_FOUND", error: "That support item was not found." }, 404, origin, requestId);
    return json({ items, filters: { business: businessSlug, status, category, correlation } }, 200, origin, requestId);
  } catch (error) {
    console.error(JSON.stringify({ event: "support_queue_failed", requestId, error_category: error?.code ?? "unknown" }));
    return json({ code: "DATABASE_ERROR", error: "The Booking support queue could not be loaded." }, 500, origin, requestId);
  }
});

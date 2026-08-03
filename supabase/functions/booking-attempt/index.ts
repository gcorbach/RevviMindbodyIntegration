import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createMindbodyClient,
  createMindbodyTestDouble,
  MindbodyApiError,
  selectEnabledServices,
} from "../_shared/mindbody.js";
import { availabilityResponse, dateRange, localDate, serviceResponse } from "../_shared/availability.js";

const ATTEMPT_WINDOW_MS = Number(Deno.env.get("BOOKING_ATTEMPT_WINDOW_MS") ?? 15 * 60 * 1000);
const CLIENT_RESOLUTION_LOCK_TTL_MS = 30 * 1000;
const CLIENT_RESOLUTION_LOCK_WAIT_ATTEMPTS = Number(Deno.env.get("CLIENT_RESOLUTION_LOCK_WAIT_ATTEMPTS") ?? 150);
const DUPLICATE_WAIT_MS = Number(Deno.env.get("BOOKING_DUPLICATE_WAIT_MS") ?? 100);
const DUPLICATE_WAIT_ATTEMPTS = Number(Deno.env.get("BOOKING_DUPLICATE_WAIT_ATTEMPTS") ?? 150);
const RECONCILIATION_MAX_ATTEMPTS = Number(Deno.env.get("BOOKING_RECONCILIATION_MAX_ATTEMPTS") ?? 3);
const BOOKING_OUTCOME_UNKNOWN_ERROR = "Mindbody's result needs support reconciliation before retrying.";

function allowedOrigins() {
  return new Set((Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));
}

function corsHeaders(origin: string | null, requestId: string) {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "X-Request-Id": requestId,
  };
}

function json(body: Record<string, unknown>, status = 200, origin: string | null = null, requestId = crypto.randomUUID()) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin, requestId), "Content-Type": "application/json" },
  });
}

function requiredEnvironment() {
  return ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "MINDBODY_API_KEY", "MINDBODY_BASE_URL"]
    .filter((name) => !Deno.env.get(name));
}

function bearerToken(request: Request) {
  const value = request.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

function memberstackId(user: { app_metadata?: Record<string, unknown> }) {
  const metadata = user.app_metadata ?? {};
  if (metadata.identity_provider !== "memberstack" || metadata.memberstack_verified !== true) return null;
  return typeof metadata.memberstack_id === "string" && metadata.memberstack_id.length > 0 ? metadata.memberstack_id : null;
}

function verifiedEmail(user: { email?: string | null; email_confirmed_at?: string | null }) {
  if (!user.email || !user.email_confirmed_at) return null;
  return user.email.trim().toLowerCase() || null;
}

function metadataValue(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function minimumClientFields(user: { user_metadata?: Record<string, unknown> }, email: string) {
  const metadata = user.user_metadata ?? {};
  return {
    firstName: metadataValue(metadata, "first_name", "firstName", "given_name"),
    lastName: metadataValue(metadata, "last_name", "lastName", "family_name"),
    email,
  };
}

function resolvedSiteId(business: { provider_environment: string }, configuredSiteId: string) {
  if (business.provider_environment === "sandbox") {
    const sandboxSiteId = Deno.env.get("MINDBODY_SANDBOX_SITE_ID");
    if (!sandboxSiteId) return null;
    if (configuredSiteId === "__MINDBODY_SANDBOX_SITE_ID__") return sandboxSiteId;
    return configuredSiteId === sandboxSiteId ? sandboxSiteId : null;
  }
  return configuredSiteId || null;
}

function isAllowedBaseUrl() {
  const configured = Deno.env.get("MINDBODY_BASE_URL")?.replace(/\/$/, "");
  const canonical = "https://api.mindbodyonline.com/public/v6";
  return configured === canonical || (Deno.env.get("MINDBODY_ALLOW_TEST_DOUBLE") === "true" && !Deno.env.get("DENO_DEPLOYMENT_ID"));
}

function isoDate(value: unknown) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function attemptResponse(attempt: Record<string, any>) {
  const confirmed = attempt.state === "confirmed";
  return {
    bookingAttempt: {
      id: attempt.id,
      state: attempt.state,
      expiresAt: attempt.expires_at,
      business: attempt.business_name,
      location: attempt.location_name,
      locationTimezone: attempt.location_timezone,
      service: attempt.service_name,
      startTime: attempt.selected_start_time,
      endTime: attempt.selected_end_time,
      durationMinutes: attempt.duration_minutes,
      price: attempt.price,
    },
    ...(confirmed ? {
      confirmation: {
        bookingAttemptId: attempt.id,
        providerAppointmentId: attempt.mindbody_appointment_id,
        startTime: attempt.selected_start_time,
        message: "Your Booking is confirmed.",
      },
    } : {}),
  };
}

function bookingDisplayContext({ business, location, service, liveService, selectedDate }: any) {
  return {
    business: {
      slug: business.slug,
      displayName: business.display_name,
      locationBrowserPath: business.location_browser_path,
    },
    location: {
      slug: location.slug,
      displayName: location.display_name,
      timezone: location.timezone,
    },
    service: serviceResponse({ id: service.id, ...liveService }),
    selectedDate,
  };
}

function staleAvailabilityResponse({ business, location, service, liveService, availability, selectedStart, attempt }: any) {
  const context = bookingDisplayContext({ business, location, service, liveService, selectedDate: availability.selectedDate });
  return {
    ...context,
    bookingContext: context,
    availability,
    staleSelection: {
      startTime: selectedStart,
      message: "That time was taken before the Booking was written. Choose a new live time.",
    },
    ...(attempt ? { bookingAttempt: attemptResponse(attempt).bookingAttempt } : {}),
  };
}

function staleBookingResponse(staleResponse: Record<string, unknown>, attempt: Record<string, any>) {
  return {
    code: "SLOT_UNAVAILABLE",
    error: "That time was taken before the Booking was written. Choose a new live time.",
    ...staleResponse,
    bookingAttempt: attemptResponse(attempt).bookingAttempt,
  };
}

function failureStatus(code: string) {
  if (["CLIENT_MATCH_AMBIGUOUS", "CLIENT_MAPPING_CONFLICT", "CLIENT_RESOLUTION_IN_PROGRESS", "CLIENT_RESOLUTION_STALE", "CLIENT_RESOLUTION_UNKNOWN"].includes(code)) return 409;
  if (code === "MINDBODY_UNAVAILABLE" || code === "BOOKING_OUTCOME_UNKNOWN") return 502;
  return 422;
}

function unknownOutcomeResponse(attempt: Record<string, any>) {
  return { code: "BOOKING_RESOLVING", error: "We are resolving your Booking with Mindbody. Do not submit it again.", bookingAttempt: attemptResponse(attempt).bookingAttempt };
}

function expiredAttemptResponse(attempt: Record<string, any>) {
  return { code: "BOOKING_ATTEMPT_EXPIRED", error: "This Booking attempt has expired. Choose a new time.", bookingAttempt: attemptResponse(attempt).bookingAttempt };
}

function notCompletedResponse(attempt: Record<string, any>) {
  return { code: "BOOKING_NOT_COMPLETED", error: "Mindbody confirmed that this Booking was not completed. You may choose a new time.", bookingAttempt: attemptResponse(attempt).bookingAttempt };
}

async function recordEvent(supabase: any, attempt: Record<string, any>, event: Record<string, unknown>) {
  const { error } = await supabase.from("booking_attempt_events").insert({
    ...attemptEventContext(attempt),
    metadata: {},
    ...event,
  });
  if (error) {
    console.error(JSON.stringify({ event: "booking_attempt_event_persist_failed", requestId: attempt.correlation_id, operation: event.operation, error_category: "event_persist_failed" }));
    return false;
  }
  return true;
}

function attemptEventContext(attempt: Record<string, any>) {
  return { business_id: attempt.business_id, booking_attempt_id: attempt.id, correlation_id: attempt.correlation_id };
}

async function createSupportItem(supabase: any, attempt: Record<string, any>, reason: string) {
  await supabase.from("booking_support_items").upsert({ ...attemptEventContext(attempt), reason }, { onConflict: "booking_attempt_id,reason", ignoreDuplicates: true });
}

async function readClientMapping(supabase: any, businessId: string, memberstackIdValue: string) {
  return supabase
    .from("mindbody_client_mappings")
    .select("mindbody_client_id, verified_email")
    .eq("business_id", businessId)
    .eq("memberstack_id", memberstackIdValue)
    .maybeSingle();
}

function mappedClientResolution(mapping: { mindbody_client_id: string; verified_email: string } | null, customerEmail: string) {
  if (!mapping) return null;
  if (mapping.verified_email !== customerEmail) return { code: "CLIENT_MAPPING_CONFLICT", message: "The verified Mindbody Client mapping needs support review.", reason: "CLIENT_MAPPING_CONFLICT" };
  return { client: { providerId: mapping.mindbody_client_id, uniqueId: null, email: customerEmail }, mapped: true, clientCreated: false };
}

async function acquireClientResolutionLock(supabase: any, businessId: string, memberstackIdValue: string) {
  const ownerId = crypto.randomUUID();
  const { error } = await supabase.from("mindbody_client_resolution_locks").insert({
    business_id: businessId,
    memberstack_id: memberstackIdValue,
    owner_id: ownerId,
  });
  if (!error) return { ownerId, acquired: true };
  if (error.code === "23505") return { ownerId, acquired: false };
  return { ownerId, acquired: false, error };
}

async function releaseClientResolutionLock(supabase: any, businessId: string, memberstackIdValue: string, ownerId: string) {
  await supabase
    .from("mindbody_client_resolution_locks")
    .delete()
    .eq("business_id", businessId)
    .eq("memberstack_id", memberstackIdValue)
    .eq("owner_id", ownerId);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function resolveMindbodyClient({ supabase, client, businessId, memberstackIdValue, customerEmail, customerFields, attempt }: any): Promise<any> {
  const initialMapping = await readClientMapping(supabase, businessId, memberstackIdValue);
  if (initialMapping.error) return { code: "DATABASE_ERROR", message: "The Mindbody Client mapping could not be loaded.", reason: "mapping_lookup_failed" };
  const initialResolution = mappedClientResolution(initialMapping.data, customerEmail);
  if (initialResolution) return initialResolution;

  const lock = await acquireClientResolutionLock(supabase, businessId, memberstackIdValue);
  if (lock.error) return { code: "DATABASE_ERROR", message: "The Mindbody Client resolution could not be started.", reason: "client_resolution_lock_failed" };
  if (!lock.acquired) {
    for (let attemptNumber = 0; attemptNumber < CLIENT_RESOLUTION_LOCK_WAIT_ATTEMPTS; attemptNumber += 1) {
      const mapping = await readClientMapping(supabase, businessId, memberstackIdValue);
      if (mapping.error) return { code: "DATABASE_ERROR", message: "The Mindbody Client mapping could not be loaded.", reason: "mapping_lookup_failed" };
      const mappingResolution = mappedClientResolution(mapping.data, customerEmail);
      if (mappingResolution) return mappingResolution;
      const currentLock = await supabase.from("mindbody_client_resolution_locks").select("acquired_at").eq("business_id", businessId).eq("memberstack_id", memberstackIdValue).maybeSingle();
      if (currentLock.error) return { code: "DATABASE_ERROR", message: "The Mindbody Client resolution could not be checked.", reason: "client_resolution_lock_lookup_failed" };
      if (!currentLock.data) return resolveMindbodyClient({ supabase, client, businessId, memberstackIdValue, customerEmail, customerFields, attempt });
      if (Date.now() - new Date(currentLock.data.acquired_at).getTime() > CLIENT_RESOLUTION_LOCK_TTL_MS) {
        return { code: "CLIENT_RESOLUTION_STALE", message: "Your Mindbody Client record needs support review before this Booking can continue.", reason: "CLIENT_RESOLUTION_STALE" };
      }
      await wait(100);
    }
    return { code: "CLIENT_RESOLUTION_IN_PROGRESS", message: "Your Booking needs a moment to finish resolving your Client record. Please try again shortly.", reason: "client_resolution_in_progress" };
  }

  let providerClientMayExist = false;
  let providerClientCreateRequested = false;
  let retainLockForSupport = false;
  try {
    const mapping = await readClientMapping(supabase, businessId, memberstackIdValue);
    if (mapping.error) return { code: "DATABASE_ERROR", message: "The Mindbody Client mapping could not be loaded.", reason: "mapping_lookup_failed" };
    const mappingResolution = mappedClientResolution(mapping.data, customerEmail);
    if (mappingResolution) return mappingResolution;

    await recordEvent(supabase, attempt, { event_type: "provider_read_started", operation: "client_lookup" });
    const clients = await client.findClientsByEmail(customerEmail);
    const matches = (clients ?? []).filter((candidate: any) => candidate.email?.trim().toLowerCase() === customerEmail);
    await recordEvent(supabase, attempt, { event_type: "provider_read_succeeded", operation: "client_lookup" });
    if (matches.length > 1) return { code: "CLIENT_MATCH_AMBIGUOUS", message: "More than one verified-email Mindbody Client matched.", reason: "CLIENT_MATCH_AMBIGUOUS" };

    let resolvedClient = matches[0] ?? null;
    let clientCreated = false;
    if (!resolvedClient) {
      if (!customerFields.firstName || !customerFields.lastName) return { code: "CLIENT_DETAILS_REQUIRED", message: "Your verified name is needed to create a Mindbody Client.", reason: "client_details_required" };
      await recordEvent(supabase, attempt, { event_type: "provider_write_started", operation: "client_create" });
      providerClientCreateRequested = true;
      resolvedClient = await client.createClient(customerFields);
      if (!resolvedClient.providerId) throw new MindbodyApiError("Mindbody did not return a Client identifier.", 502);
      clientCreated = true;
      providerClientMayExist = true;
      await recordEvent(supabase, attempt, { event_type: "provider_write_succeeded", operation: "client_create" });
    }

    const { error: mappingError } = await supabase.from("mindbody_client_mappings").insert({
      business_id: businessId,
      memberstack_id: memberstackIdValue,
      mindbody_client_id: resolvedClient.providerId,
      verified_email: customerEmail,
    });
    if (mappingError) {
      if (mappingError.code !== "23505") {
        retainLockForSupport = providerClientMayExist;
        return { code: "CLIENT_RESOLUTION_UNKNOWN", message: "Your Mindbody Client record needs support review before this Booking can continue.", reason: "CLIENT_RESOLUTION_UNKNOWN" };
      }
      const racedMapping = await readClientMapping(supabase, businessId, memberstackIdValue);
      if (racedMapping.data?.mindbody_client_id !== resolvedClient.providerId || racedMapping.data?.verified_email !== customerEmail) {
        retainLockForSupport = providerClientMayExist;
        return { code: "CLIENT_MAPPING_CONFLICT", message: "The verified Mindbody Client mapping needs support review.", reason: "CLIENT_MAPPING_CONFLICT" };
      }
      resolvedClient = { ...resolvedClient, providerId: racedMapping.data.mindbody_client_id };
    }
    return { client: resolvedClient, mapped: false, clientCreated };
  } catch (error) {
    if (providerClientMayExist || (providerClientCreateRequested && !(error instanceof MindbodyApiError))) {
      retainLockForSupport = true;
      return { code: "CLIENT_RESOLUTION_UNKNOWN", message: "Your Mindbody Client record needs support review before this Booking can continue.", reason: "CLIENT_RESOLUTION_UNKNOWN" };
    }
    if (error instanceof MindbodyApiError) return { code: "MINDBODY_UNAVAILABLE", message: "Mindbody Client resolution is temporarily unavailable.", reason: "client_resolution_failed" };
    return { code: "MINDBODY_UNAVAILABLE", message: "Mindbody Client resolution is temporarily unavailable.", reason: "client_resolution_failed" };
  } finally {
    if (!retainLockForSupport) await releaseClientResolutionLock(supabase, businessId, memberstackIdValue, lock.ownerId);
  }
}

async function markUnknown(supabase: any, attempt: Record<string, any>, reason: string, providerReferences: Record<string, unknown> = {}, latencyMs?: number) {
  const { data: unknownAttempt } = await supabase
    .from("booking_attempts")
    .update({ state: "unknown", ...providerReferences })
    .eq("id", attempt.id)
    .eq("state", "pending_checkout")
    .select()
    .maybeSingle();
  if (!unknownAttempt) {
    const { data: current } = await supabase.from("booking_attempts").select("*").eq("id", attempt.id).maybeSingle();
    return current ?? attempt;
  }
  const current = unknownAttempt;
  await recordEvent(supabase, current, {
    event_type: "provider_write_unknown",
    operation: "appointment_create",
    error_category: reason,
    ...(latencyMs === undefined ? {} : { latency_ms: latencyMs }),
    metadata: { failure_response: { code: "BOOKING_OUTCOME_UNKNOWN", error: BOOKING_OUTCOME_UNKNOWN_ERROR } },
  });
  await createSupportItem(supabase, current, reason);
  return current;
}

async function failAttempt(supabase: any, attempt: Record<string, any>, code: string, message: string, reason = code) {
  const { data: failed, error } = await supabase
    .from("booking_attempts")
    .update({ state: "failed" })
    .eq("id", attempt.id)
    .eq("state", attempt.state)
    .select()
    .maybeSingle();
  if (!error && failed) attempt = failed;
  const supportRequired = ["CLIENT_MATCH_AMBIGUOUS", "CLIENT_MAPPING_CONFLICT", "CLIENT_RESOLUTION_STALE", "CLIENT_RESOLUTION_UNKNOWN"].includes(reason);
  const status = failureStatus(code);
  await recordEvent(supabase, attempt, {
    event_type: "attempt_failed",
    operation: "booking_attempt",
    error_category: reason,
    metadata: { failure_response: { code, error: message, ...(supportRequired ? { supportRequired: true } : {}) } },
  });
  if (supportRequired) {
    await createSupportItem(supabase, attempt, reason);
  }
  return json({ code, error: message, ...(supportRequired ? { supportRequired: true } : {}), bookingAttempt: attemptResponse(attempt).bookingAttempt }, status);
}

async function rejectStaleAttempt({ supabase, attempt, expectedState, staleContext }: any) {
  const { data: failed } = await supabase
    .from("booking_attempts")
    .update({ state: "failed" })
    .eq("id", attempt.id)
    .eq("state", expectedState)
    .select()
    .single();
  const current = failed ?? { ...attempt, state: "failed" };
  const staleResponse = staleAvailabilityResponse({ ...staleContext, attempt: null });
  await recordEvent(supabase, current, {
    event_type: "provider_revalidation_rejected",
    operation: "booking_facts_revalidation",
    error_category: "slot_unavailable",
    metadata: { stale_response: staleResponse },
  });
  await recordEvent(supabase, current, { event_type: "attempt_failed", operation: "booking_attempt", error_category: "slot_unavailable" });
  return { current, staleResponse };
}

function sameBookingFacts(attempt: Record<string, any>, { serviceId, locationId, selectedStart }: { serviceId: string; locationId: string; selectedStart: string }) {
  return new Date(attempt.selected_start_time).getTime() === new Date(selectedStart).getTime()
    && attempt.service_id === serviceId
    && attempt.location_id === locationId;
}

async function waitForAttemptSettlement(supabase: any, attempt: Record<string, any>) {
  let current = attempt;
  for (let attemptNumber = 0; attemptNumber < DUPLICATE_WAIT_ATTEMPTS; attemptNumber += 1) {
    if (!["created", "pending_checkout"].includes(current.state)) return current;
    await wait(DUPLICATE_WAIT_MS);
    const { data } = await supabase.from("booking_attempts").select("*").eq("id", attempt.id).maybeSingle();
    if (!data) return current;
    current = data;
  }
  return current;
}

async function expireAttempt(supabase: any, attempt: Record<string, any>, operation: string) {
  const { data: expired } = await supabase
    .from("booking_attempts")
    .update({ state: "expired" })
    .eq("id", attempt.id)
    .in("state", ["created", "pending_checkout", "payment_needs_attention", "unknown"])
    .select()
    .maybeSingle();
  const current = expired ?? attempt;
  if (expired) await recordEvent(supabase, current, { event_type: "attempt_expired", operation, error_category: "attempt_expired" });
  return current;
}

function isAuthoritativeAppointmentForAttempt(appointment: Record<string, any>, attempt: Record<string, any>) {
  return appointment.clientId === attempt.mindbody_client_id
    && appointment.locationId === attempt.mindbody_location_id
    && appointment.sessionTypeId === attempt.mindbody_session_type_id
    && appointment.startDateTime === new Date(attempt.selected_start_time).toISOString();
}

async function reconcileUnknownAttempt({ supabase, client, attempt }: any) {
  if (attempt.state !== "unknown") return attempt;
  if (new Date(attempt.expires_at).getTime() <= Date.now()) return expireAttempt(supabase, attempt, "appointment_reconciliation");

  const previousAttempts = Number(attempt.reconciliation_attempts ?? 0);
  if (previousAttempts >= RECONCILIATION_MAX_ATTEMPTS) {
    await createSupportItem(supabase, attempt, "RECONCILIATION_EXHAUSTED");
    return attempt;
  }
  const reconciledAt = new Date().toISOString();
  const { data: claimed } = await supabase
    .from("booking_attempts")
    .update({ reconciliation_attempts: previousAttempts + 1, reconciliation_last_attempted_at: reconciledAt })
    .eq("id", attempt.id)
    .eq("state", "unknown")
    .eq("reconciliation_attempts", previousAttempts)
    .select()
    .maybeSingle();
  if (!claimed) {
    const { data: current } = await supabase.from("booking_attempts").select("*").eq("id", attempt.id).maybeSingle();
    return current ?? attempt;
  }

  const startedAt = Date.now();
  await recordEvent(supabase, claimed, { event_type: "reconciliation_read_started", operation: "appointment_reconciliation" });
  let appointments: any[];
  try {
    appointments = await client.findAppointments({
      clientId: claimed.mindbody_client_id,
      startDate: claimed.selected_start_time,
      endDate: new Date(new Date(claimed.selected_start_time).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    const exhausted = claimed.reconciliation_attempts >= RECONCILIATION_MAX_ATTEMPTS;
    await recordEvent(supabase, claimed, {
      event_type: exhausted ? "reconciliation_exhausted" : "reconciliation_uncertain",
      operation: "appointment_reconciliation",
      error_category: "authoritative_read_unavailable",
      latency_ms: Date.now() - startedAt,
    });
    if (exhausted) await createSupportItem(supabase, claimed, "RECONCILIATION_EXHAUSTED");
    return claimed;
  }

  const appointment = appointments.find((candidate) => isAuthoritativeAppointmentForAttempt(candidate, claimed));
  if (appointment) {
    const { data: confirmed } = await supabase
      .from("booking_attempts")
      .update({ state: "confirmed", mindbody_appointment_id: appointment.providerId, mindbody_appointment_unique_id: appointment.uniqueId })
      .eq("id", claimed.id)
      .eq("state", "unknown")
      .gt("expires_at", new Date().toISOString())
      .select()
      .maybeSingle();
    if (confirmed) {
      await recordEvent(supabase, confirmed, { event_type: "reconciliation_confirmed", operation: "appointment_reconciliation", error_category: "authoritative_success", latency_ms: Date.now() - startedAt });
      return confirmed;
    }
    return expireAttempt(supabase, claimed, "appointment_reconciliation");
  }

  const { data: failed } = await supabase
    .from("booking_attempts")
    .update({ state: "failed" })
    .eq("id", claimed.id)
    .eq("state", "unknown")
    .select()
    .maybeSingle();
  const current = failed ?? claimed;
  if (failed) await recordEvent(supabase, current, { event_type: "reconciliation_absent", operation: "appointment_reconciliation", error_category: "authoritative_absence", latency_ms: Date.now() - startedAt });
  return current;
}

async function replayAttempt({ supabase, client, attempt, origin = null, requestId = crypto.randomUUID() }: any) {
  const settled = await waitForAttemptSettlement(supabase, attempt);
  const expired = !["confirmed", "failed", "expired"].includes(settled.state) && new Date(settled.expires_at).getTime() <= Date.now();
  const current = expired
    ? await expireAttempt(supabase, settled, "idempotency_replay")
    : settled.state === "unknown" ? await reconcileUnknownAttempt({ supabase, client, attempt: settled }) : settled;
  await recordEvent(supabase, current, { event_type: "duplicate_request", operation: "idempotency_replay" });
  const { data: staleEvent } = await supabase
    .from("booking_attempt_events")
    .select("metadata")
    .eq("booking_attempt_id", current.id)
    .eq("event_type", "provider_revalidation_rejected")
    .eq("error_category", "slot_unavailable")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (staleEvent?.metadata?.stale_response) {
    return json(staleBookingResponse(staleEvent.metadata.stale_response, current), 409, origin, requestId);
  }
  const { data: failedEvent } = await supabase
    .from("booking_attempt_events")
    .select("metadata")
    .eq("booking_attempt_id", current.id)
    .eq("event_type", "attempt_failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (failedEvent?.metadata?.failure_response) {
    const failure = failedEvent.metadata.failure_response;
    const status = failureStatus(failure.code);
    return json({ ...failure, bookingAttempt: attemptResponse(current).bookingAttempt }, status, origin, requestId);
  }
  if (current.state === "expired") return json(expiredAttemptResponse(current), 409, origin, requestId);
  if (current.state === "failed") return json(notCompletedResponse(current), 409, origin, requestId);
  const status = current.state === "confirmed" ? 200 : current.state === "unknown" ? 202 : current.state === "expired" ? 409 : 202;
  const outcome = current.state === "unknown" ? unknownOutcomeResponse(current) : {};
  return json({ ...outcome, ...attemptResponse(current) }, status, origin, requestId);
}

async function loadCaller(supabaseUrl: string, anonKey: string, token: string) {
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return authClient.auth.getUser(token);
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins().has(origin)) return json({ code: "ORIGIN_NOT_ALLOWED", error: "This origin is not authorised." }, 403, null, requestId);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin, requestId) });
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", error: "Use POST." }, 405, origin, requestId);

  const missing = requiredEnvironment();
  if (missing.length > 0) return json({ code: "CONFIGURATION_ERROR", error: "Booking configuration is incomplete.", missing }, 500, origin, requestId);
  if (!isAllowedBaseUrl()) return json({ code: "SANDBOX_REQUIRED", error: "Only the configured Mindbody boundary is permitted." }, 409, origin, requestId);

  const token = bearerToken(request);
  if (!token) return json({ code: "AUTHENTICATION_REQUIRED", error: "Sign in through Revvi to continue." }, 401, origin, requestId);
  const { data: userData, error: userError } = await loadCaller(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, token);
  if (userError || !userData.user) return json({ code: "AUTHENTICATION_INVALID", error: "Revvi identity could not be verified." }, 401, origin, requestId);
  const customerMemberstackId = memberstackId(userData.user);
  const customerEmail = verifiedEmail(userData.user);
  if (!customerMemberstackId) return json({ code: "MEMBERSTACK_IDENTITY_REQUIRED", error: "A verified Memberstack identity is required." }, 403, origin, requestId);
  if (!customerEmail) return json({ code: "VERIFIED_EMAIL_REQUIRED", error: "A verified email address is required to complete this Booking." }, 403, origin, requestId);
  const customerFields = minimumClientFields(userData.user, customerEmail);

  const body = await request.json().catch(() => null);
  const businessSlug = body?.business;
  const locationSlug = body?.location;
  const serviceId = body?.service;
  const selectedStart = isoDate(body?.startTime);
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (typeof businessSlug !== "string" || typeof locationSlug !== "string" || typeof serviceId !== "string" || !selectedStart || !idempotencyKey || idempotencyKey.length > 200) {
    return json({ code: "INVALID_BOOKING_CONTEXT", error: "Business, Location, service, time, and idempotency data are required." }, 400, origin, requestId);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: identity, error: identityError } = await supabase.from("memberstack_identity_allowlist").select("memberstack_id").eq("memberstack_id", customerMemberstackId).maybeSingle();
  if (identityError) return json({ code: "DATABASE_ERROR", error: "Member identity could not be verified." }, 500, origin, requestId);
  if (!identity) return json({ code: "MEMBERSTACK_IDENTITY_REQUIRED", error: "A verified Memberstack identity is required." }, 403, origin, requestId);

  const { data: business, error: businessError } = await supabase.from("businesses")
    .select("id, slug, display_name, location_browser_path, status, booking_enabled, completion_mode, provider_environment")
    .eq("slug", businessSlug).maybeSingle();
  if (businessError) return json({ code: "DATABASE_ERROR", error: "Business context could not be loaded." }, 500, origin, requestId);
  if (!business) return json({ code: "BUSINESS_UNAVAILABLE", error: "This Business is not available for Booking." }, 409, origin, requestId);
  if (business.completion_mode !== "free_unpaid") return json({ code: "COMPLETION_UNAVAILABLE", error: "Completion is not available for this Business." }, 409, origin, requestId);
  if (business.status !== "active") return json({ code: "BUSINESS_UNAVAILABLE", error: "This Business is not available for Booking." }, 409, origin, requestId);
  if (!business.booking_enabled) return json({ code: "BUSINESS_UNAVAILABLE", error: "This Business is not available for Booking." }, 409, origin, requestId);

  const { data: access, error: accessError } = await supabase.from("business_customer_access").select("business_id").eq("business_id", business.id).eq("memberstack_id", customerMemberstackId).maybeSingle();
  if (accessError) return json({ code: "DATABASE_ERROR", error: "Business context could not be verified." }, 500, origin, requestId);
  if (!access) return json({ code: "BUSINESS_CONTEXT_MISMATCH", error: "This customer is not authorised for that Business." }, 403, origin, requestId);

  const { data: location, error: locationError } = await supabase.from("business_locations").select("id, slug, display_name, timezone, enabled").eq("business_id", business.id).eq("slug", locationSlug).maybeSingle();
  if (locationError) return json({ code: "DATABASE_ERROR", error: "Location context could not be loaded." }, 500, origin, requestId);
  if (!location || !location.enabled) return json({ code: "LOCATION_UNAVAILABLE", error: "This Location is not available." }, 404, origin, requestId);
  const { data: service, error: serviceError } = await supabase.from("business_services").select("id, display_name_override, enabled").eq("id", serviceId).eq("business_id", business.id).eq("location_id", location.id).eq("enabled", true).maybeSingle();
  if (serviceError) return json({ code: "DATABASE_ERROR", error: "Service configuration could not be loaded." }, 500, origin, requestId);
  if (!service) return json({ code: "SERVICE_UNAVAILABLE", error: "This service is not available at the selected Location." }, 404, origin, requestId);

  const [{ data: providerConfig, error: providerConfigError }, { data: providerLocation, error: providerLocationError }, { data: providerService, error: providerServiceError }] = await Promise.all([
    supabase.from("business_provider_config").select("mindbody_site_id").eq("business_id", business.id).maybeSingle(),
    supabase.from("business_location_provider_config").select("mindbody_location_id").eq("business_id", business.id).eq("location_id", location.id).maybeSingle(),
    supabase.from("business_service_provider_config").select("mindbody_session_type_id").eq("business_id", business.id).eq("service_id", service.id).maybeSingle(),
  ]);
  if (providerConfigError || providerLocationError || providerServiceError) return json({ code: "DATABASE_ERROR", error: "Provider configuration could not be loaded." }, 500, origin, requestId);
  const siteId = resolvedSiteId(business, providerConfig?.mindbody_site_id ?? "");
  if (!siteId || !providerLocation?.mindbody_location_id || !providerService?.mindbody_session_type_id) return json({ code: "PROVIDER_NOT_READY", error: "This Business has no enabled provider connection." }, 409, origin, requestId);

  const useTestDouble = Deno.env.get("MINDBODY_ALLOW_TEST_DOUBLE") === "true" && !Deno.env.get("DENO_DEPLOYMENT_ID");
  const client = createMindbodyClient({
    apiKey: Deno.env.get("MINDBODY_API_KEY"),
    baseUrl: Deno.env.get("MINDBODY_BASE_URL"),
    siteId,
    requestTimeoutMs: Number(Deno.env.get("MINDBODY_REQUEST_TIMEOUT_MS") ?? 10_000),
    fetchImpl: useTestDouble ? createMindbodyTestDouble({ apiKey: Deno.env.get("MINDBODY_API_KEY"), siteId }) : fetch,
  });

  const { data: existingAttempt, error: existingAttemptError } = await supabase.from("booking_attempts").select("*").eq("business_id", business.id).eq("memberstack_id", customerMemberstackId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingAttemptError) return json({ code: "DATABASE_ERROR", error: "Booking attempt could not be loaded." }, 500, origin, requestId);
  if (existingAttempt) {
    if (!sameBookingFacts(existingAttempt, { serviceId: service.id, locationId: location.id, selectedStart })) return json({ code: "IDEMPOTENCY_KEY_REUSED", error: "That idempotency key belongs to another Booking." }, 409, origin, requestId);
    return replayAttempt({ supabase, client, attempt: existingAttempt, origin, requestId });
  }

  const { data: unresolvedAttempt, error: unresolvedAttemptError } = await supabase
    .from("booking_attempts")
    .select("*")
    .eq("business_id", business.id)
    .eq("memberstack_id", customerMemberstackId)
    .eq("state", "unknown")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (unresolvedAttemptError) return json({ code: "DATABASE_ERROR", error: "Booking reconciliation could not be loaded." }, 500, origin, requestId);
  if (unresolvedAttempt) {
    const reconciled = await reconcileUnknownAttempt({ supabase, client, attempt: unresolvedAttempt });
    if (reconciled.state === "confirmed") return json(attemptResponse(reconciled), 200, origin, requestId);
    if (reconciled.state === "unknown") return json(unknownOutcomeResponse(reconciled), 202, origin, requestId);
    if (reconciled.state === "expired") return json(expiredAttemptResponse(reconciled), 409, origin, requestId);
    // Authoritative absence is the only result that permits this new provider write.
  }

  let liveSlot: any;
  let liveItems: any[] = [];
  let liveService: any;
  try {
    const liveSessionTypes = await client.getSessionTypes();
    [liveService] = selectEnabledServices(liveSessionTypes, [{ ...service, mindbody_session_type_id: providerService.mindbody_session_type_id }]);
    if (!liveService) return json({ code: "SERVICE_UNAVAILABLE", error: "This service is not available in the live Mindbody catalogue." }, 409, origin, requestId);
    const liveLocations = await client.getLocations();
    if (!liveLocations.some((item) => item.providerId === String(providerLocation.mindbody_location_id))) return json({ code: "LOCATION_CONTEXT_MISMATCH", error: "This Location is not available for the configured Mindbody Site." }, 409, origin, requestId);
    const startDate = new Date(selectedStart).toISOString();
    const endDate = new Date(new Date(selectedStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
    liveItems = await client.getBookableItems({ sessionTypeId: providerService.mindbody_session_type_id, locationId: providerLocation.mindbody_location_id, startDate, endDate });
    liveSlot = liveItems.find((item) => item.startTime === selectedStart && (!item.locationProviderId || item.locationProviderId === String(providerLocation.mindbody_location_id)));
  } catch (error) {
    if (error instanceof MindbodyApiError) return json({ code: "MINDBODY_UNAVAILABLE", error: error.message }, error.status, origin, requestId);
    return json({ code: "MINDBODY_UNAVAILABLE", error: "Live Booking facts are temporarily unavailable." }, 502, origin, requestId);
  }

  const now = Date.now();
  const selectedStartMs = new Date(selectedStart).getTime();
  const expiresAt = new Date(Math.min(now + ATTEMPT_WINDOW_MS, selectedStartMs)).toISOString();
  const refreshedAvailability = availabilityResponse({
    items: liveItems,
    service: liveService,
    selectedDate: localDate(selectedStart, location.timezone),
    timezone: location.timezone,
    locationProviderId: providerLocation.mindbody_location_id,
  });
  const staleContext = { business, location, service, liveService, availability: refreshedAvailability, selectedStart };
  const { data: created, error: createError } = await supabase.from("booking_attempts").insert({
    business_id: business.id,
    memberstack_id: customerMemberstackId,
    idempotency_key: idempotencyKey,
    location_id: location.id,
    service_id: service.id,
    business_name: business.display_name,
    location_name: location.display_name,
    location_timezone: location.timezone,
    service_name: liveService.name,
    mindbody_location_id: String(providerLocation.mindbody_location_id),
    mindbody_session_type_id: String(providerService.mindbody_session_type_id),
    selected_start_time: selectedStart,
    selected_end_time: liveSlot?.endTime ?? null,
    duration_minutes: liveSlot?.durationMinutes ?? liveService.durationMinutes,
    price: liveSlot?.price ?? liveService.price,
    completion_mode: business.completion_mode,
    expires_at: expiresAt,
  }).select().single();
  if (createError) {
    console.error(JSON.stringify({ event: "booking_attempt_create_failed", requestId, error_code: createError.code, error_category: createError.message }));
    if (createError.code === "23505") {
      const { data: raced } = await supabase.from("booking_attempts").select("*").eq("business_id", business.id).eq("memberstack_id", customerMemberstackId).eq("idempotency_key", idempotencyKey).single();
      if (!raced) return json({ code: "BOOKING_ATTEMPT_CONFLICT", error: "The Booking attempt is already being processed." }, 409, origin, requestId);
      if (!sameBookingFacts(raced, { serviceId: service.id, locationId: location.id, selectedStart })) return json({ code: "IDEMPOTENCY_KEY_REUSED", error: "That idempotency key belongs to another Booking." }, 409, origin, requestId);
      return replayAttempt({ supabase, client, attempt: raced, origin, requestId });
    }
    return json({ code: "DATABASE_ERROR", error: "Booking attempt could not be created." }, 500, origin, requestId);
  }
  await recordEvent(supabase, created, { event_type: "attempt_created", operation: "booking_attempt" });
  if (!liveSlot) {
    const { current, staleResponse } = await rejectStaleAttempt({ supabase, attempt: created, expectedState: "created", staleContext });
    return json(staleBookingResponse(staleResponse, current), 409, origin, requestId);
  }
  if (!liveSlot.staffProviderId) return failAttempt(supabase, created, "PROVIDER_NOT_READY", "Mindbody did not return the staff needed for this time.", "provider_staff_missing");
  await recordEvent(supabase, created, { event_type: "provider_revalidation_succeeded", operation: "booking_facts_revalidation", metadata: { checks: ["session_catalogue", "location_catalogue", "availability"] } });

  const resolution = await resolveMindbodyClient({ supabase, client, businessId: business.id, memberstackIdValue: customerMemberstackId, customerEmail, customerFields, attempt: created });
  if (resolution.code) return failAttempt(supabase, created, resolution.code, resolution.message, resolution.reason);
  const uniqueVerifiedEmailClient = resolution.client;
  const clientCreated = resolution.clientCreated === true;

  const { data: claimed, error: claimError } = await supabase.from("booking_attempts").update({ state: "pending_checkout", provider_operation_claimed_at: new Date().toISOString(), mindbody_client_id: uniqueVerifiedEmailClient.providerId }).eq("id", created.id).eq("state", "created").is("provider_operation_claimed_at", null).select().maybeSingle();
  if (claimError) return failAttempt(supabase, created, "DATABASE_ERROR", "The Booking attempt could not be claimed.", "attempt_claim_failed");
  if (!claimed) {
    const { data: current } = await supabase.from("booking_attempts").select("*").eq("id", created.id).single();
    return current ? json(attemptResponse(current), 202, origin, requestId) : json({ code: "BOOKING_ATTEMPT_CONFLICT", error: "The Booking attempt is already being processed." }, 409, origin, requestId);
  }
  await recordEvent(supabase, claimed, { event_type: "attempt_pending_checkout", operation: "state_transition" });
  if (new Date(claimed.expires_at).getTime() <= Date.now()) {
    const { data: expired } = await supabase.from("booking_attempts").update({ state: "expired" }).eq("id", claimed.id).eq("state", "pending_checkout").select().single();
    const current = expired ?? claimed;
    await recordEvent(supabase, current, { event_type: "attempt_expired", operation: "appointment_create", error_category: "attempt_expired_before_provider_write" });
    return json({ code: "BOOKING_ATTEMPT_EXPIRED", error: "This Booking attempt has expired. Choose a new time.", bookingAttempt: attemptResponse(current).bookingAttempt }, 409, origin, requestId);
  }

  let latestItems: any[];
  try {
    latestItems = await client.getBookableItems({
      sessionTypeId: providerService.mindbody_session_type_id,
      locationId: providerLocation.mindbody_location_id,
      ...dateRange(localDate(selectedStart, location.timezone)),
    });
  } catch (error) {
    return failAttempt(supabase, claimed, "MINDBODY_UNAVAILABLE", "Live availability is temporarily unavailable. Try again shortly.", "booking_facts_revalidation_failed");
  }
  const latestAvailability = availabilityResponse({
    items: latestItems,
    service: liveService,
    selectedDate: localDate(selectedStart, location.timezone),
    timezone: location.timezone,
    locationProviderId: providerLocation.mindbody_location_id,
  });
  const latestSlot = latestAvailability.slots.find((slot) => slot.startTime === selectedStart);
  const latestProviderSlot = latestItems.find((item) => item.startTime === selectedStart && (!item.locationProviderId || item.locationProviderId === String(providerLocation.mindbody_location_id)));
  if (!latestSlot || !latestProviderSlot) {
    const { current, staleResponse } = await rejectStaleAttempt({ supabase, attempt: claimed, expectedState: "pending_checkout", staleContext: { ...staleContext, availability: latestAvailability } });
    return json(staleBookingResponse(staleResponse, current), 409, origin, requestId);
  }
  if (!latestSlot.endTime || !latestSlot.durationMinutes) return failAttempt(supabase, claimed, "PROVIDER_NOT_READY", "Mindbody did not return complete facts for this time.", "provider_slot_facts_missing");
  if (!latestProviderSlot.staffProviderId) return failAttempt(supabase, claimed, "PROVIDER_NOT_READY", "Mindbody did not return the staff needed for this time.", "provider_staff_missing");
  if (new Date(claimed.expires_at).getTime() <= Date.now()) {
    const current = await expireAttempt(supabase, claimed, "appointment_create");
    return json(expiredAttemptResponse(current), 409, origin, requestId);
  }
  liveSlot = { ...latestProviderSlot, endTime: latestSlot.endTime, durationMinutes: latestSlot.durationMinutes, price: latestSlot.price };
  await recordEvent(supabase, claimed, { event_type: "provider_write_started", operation: "appointment_create" });

  const providerStartedAt = Date.now();
  try {
    const appointment = await client.addAppointment({ clientId: uniqueVerifiedEmailClient.providerId, locationId: providerLocation.mindbody_location_id, staffId: liveSlot.staffProviderId, sessionTypeId: providerService.mindbody_session_type_id, startDateTime: selectedStart });
    if (appointment.paymentNeedsAttention) {
      const { data: paymentNeedsAttention } = await supabase.from("booking_attempts").update({ state: "payment_needs_attention", mindbody_appointment_id: appointment.providerId, mindbody_appointment_unique_id: appointment.uniqueId }).eq("id", claimed.id).eq("state", "pending_checkout").select().single();
      const current = paymentNeedsAttention ?? claimed;
      await recordEvent(supabase, current, { event_type: "attempt_payment_needs_attention", operation: "appointment_create", error_category: "payment_needs_attention", latency_ms: Date.now() - providerStartedAt });
      return json({ code: "PAYMENT_NEEDS_ATTENTION", error: "Mindbody requires an additional payment action before this Booking can be confirmed.", bookingAttempt: attemptResponse(current).bookingAttempt }, 202, origin, requestId);
    }
    if (!appointment.providerId) throw new MindbodyApiError("Mindbody did not return an appointment identifier.", 502);
    const { data: confirmed, error: confirmationError } = await supabase.from("booking_attempts").update({ state: "confirmed", mindbody_appointment_id: appointment.providerId, mindbody_appointment_unique_id: appointment.uniqueId }).eq("id", claimed.id).eq("state", "pending_checkout").select().single();
    if (confirmationError || !confirmed) {
       const current = await markUnknown(supabase, claimed, "confirmation_persist_failed", { mindbody_appointment_id: appointment.providerId, mindbody_appointment_unique_id: appointment.uniqueId }, Date.now() - providerStartedAt);
      return json(unknownOutcomeResponse(current), 502, origin, requestId);
    }
    await recordEvent(supabase, confirmed, { event_type: "attempt_confirmed", operation: "appointment_create", latency_ms: Date.now() - providerStartedAt });
    return json({ ...attemptResponse(confirmed), ...(clientCreated ? { clientCreated: true } : {}) }, 200, origin, requestId);
  } catch (error) {
    const providerStatus = error instanceof MindbodyApiError ? error.status : 502;
    const state = providerStatus >= 500 ? "unknown" : "failed";
    if (state === "unknown") {
       const current = await markUnknown(supabase, claimed, "provider_unknown", {}, Date.now() - providerStartedAt);
      return json(unknownOutcomeResponse(current), 502, origin, requestId);
    }
    const { data: finalAttempt } = await supabase.from("booking_attempts").update({ state }).eq("id", claimed.id).eq("state", "pending_checkout").select().single();
    const current = finalAttempt ?? claimed;
    await recordEvent(supabase, current, {
      event_type: state === "unknown" ? "provider_write_unknown" : "attempt_failed",
      operation: "appointment_create",
      provider_status: providerStatus,
      error_category: state === "unknown" ? "provider_unknown" : "provider_rejected",
      latency_ms: Date.now() - providerStartedAt,
      metadata: { failure_response: { code: state === "unknown" ? "BOOKING_OUTCOME_UNKNOWN" : "BOOKING_FAILED", error: state === "unknown" ? "Mindbody's result needs support reconciliation before retrying." : "Mindbody could not complete this Booking." } },
    });
    return json({ code: "BOOKING_FAILED", error: "Mindbody could not complete this Booking.", bookingAttempt: attemptResponse(current).bookingAttempt }, 409, origin, requestId);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createMindbodyClient,
  createMindbodyTestDouble,
  MindbodyApiError,
  selectEnabledServices,
} from "../_shared/mindbody.js";

function allowedOrigins() {
  return new Set(
    (Deno.env.get("ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(origin: string | null, requestId: string) {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

function isAllowedSandboxBaseUrl() {
  const configured = Deno.env.get("MINDBODY_BASE_URL")?.replace(/\/$/, "");
  const canonical = "https://api.mindbodyonline.com/public/v6";
  return configured === canonical || (Deno.env.get("MINDBODY_ALLOW_TEST_DOUBLE") === "true" && !Deno.env.get("DENO_DEPLOYMENT_ID"));
}

function bearerToken(request: Request) {
  const value = request.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length) : null;
}

function memberstackId(user: { app_metadata?: Record<string, unknown> }) {
  const metadata = user.app_metadata ?? {};
  if (metadata.identity_provider !== "memberstack" || metadata.memberstack_verified !== true) return null;
  return typeof metadata.memberstack_id === "string" && metadata.memberstack_id.length > 0
    ? metadata.memberstack_id
    : null;
}

function sandboxSiteId(business: { provider_environment: string }, configuredSiteId: string) {
  if (business.provider_environment !== "sandbox") return null;
  const configuredSandboxSiteId = Deno.env.get("MINDBODY_SANDBOX_SITE_ID");
  if (!configuredSandboxSiteId) return null;
  if (configuredSiteId === "__MINDBODY_SANDBOX_SITE_ID__") return configuredSandboxSiteId;
  return configuredSiteId === configuredSandboxSiteId ? configuredSandboxSiteId : null;
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateRange(selectedDate: string) {
  const lookaheadDays = Number(Deno.env.get("MINDBODY_AVAILABILITY_LOOKAHEAD_DAYS") ?? 30);
  const start = new Date(`${selectedDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (Number.isInteger(lookaheadDays) && lookaheadDays > 0 ? lookaheadDays : 30));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function localDate(isoDateTime: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoDateTime));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function serviceResponse(service: { id: string; name: string; description: string | null; durationMinutes: number | null; price: number | null }) {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    durationMinutes: service.durationMinutes,
    price: service.price,
  };
}

function slotResponse(item: { startTime: string; endTime: string | null; durationMinutes: number | null; price: number | null }, service: { durationMinutes: number | null; price: number | null }) {
  const durationMinutes = item.durationMinutes ?? service.durationMinutes;
  const endTime = item.endTime ?? (durationMinutes
    ? new Date(new Date(item.startTime).getTime() + durationMinutes * 60_000).toISOString()
    : null);
  return {
    id: `slot-${item.startTime}`,
    startTime: item.startTime,
    endTime,
    durationMinutes,
    price: item.price ?? service.price,
  };
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigins().has(origin)) {
    return json({ code: "ORIGIN_NOT_ALLOWED", error: "This origin is not authorised." }, 403, null, requestId);
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin, requestId) });
  if (request.method !== "GET") return json({ code: "METHOD_NOT_ALLOWED", error: "Use GET." }, 405, origin, requestId);

  const missing = requiredEnvironment();
  if (missing.length > 0) return json({ code: "CONFIGURATION_ERROR", error: "Availability configuration is incomplete.", missing }, 500, origin, requestId);
  if (!isAllowedSandboxBaseUrl()) return json({ code: "SANDBOX_REQUIRED", error: "Issue #12 only permits the configured Mindbody sandbox." }, 409, origin, requestId);

  const url = new URL(request.url);
  const businessSlug = url.searchParams.get("business");
  const locationSlug = url.searchParams.get("location");
  const serviceId = url.searchParams.get("service") ?? url.searchParams.get("serviceId");
  const selectedDate = url.searchParams.get("date");
  const selectedStart = url.searchParams.get("start") ?? url.searchParams.get("time");
  if (!businessSlug || !locationSlug || !serviceId || !validDate(selectedDate)) {
    return json({ code: "INVALID_CONTEXT", error: "Business, Location, service, and a valid date are required." }, 400, origin, requestId);
  }

  const token = bearerToken(request);
  if (!token) return json({ code: "AUTHENTICATION_REQUIRED", error: "Sign in through Revvi to continue." }, 401, origin, requestId);

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return json({ code: "AUTHENTICATION_INVALID", error: "Revvi identity could not be verified." }, 401, origin, requestId);

  const customerMemberstackId = memberstackId(userData.user);
  if (!customerMemberstackId) return json({ code: "MEMBERSTACK_IDENTITY_REQUIRED", error: "A verified Memberstack identity is required." }, 403, origin, requestId);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: identity, error: identityError } = await supabase
    .from("memberstack_identity_allowlist")
    .select("memberstack_id")
    .eq("memberstack_id", customerMemberstackId)
    .maybeSingle();
  if (identityError) return json({ code: "DATABASE_ERROR", error: "Member identity could not be verified." }, 500, origin, requestId);
  if (!identity) return json({ code: "MEMBERSTACK_IDENTITY_REQUIRED", error: "A verified Memberstack identity is required." }, 403, origin, requestId);

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, slug, display_name, logo_url, brand_primary, brand_accent, support_email, location_browser_path, status, booking_enabled, provider_environment")
    .eq("slug", businessSlug)
    .maybeSingle();
  if (businessError) return json({ code: "DATABASE_ERROR", error: "Business context could not be loaded." }, 500, origin, requestId);
  if (!business || business.status !== "active" || !business.booking_enabled) return json({ code: "BUSINESS_UNAVAILABLE", error: "This Business is not available for booking." }, 409, origin, requestId);

  const { data: access, error: accessError } = await supabase
    .from("business_customer_access")
    .select("business_id")
    .eq("business_id", business.id)
    .eq("memberstack_id", customerMemberstackId)
    .maybeSingle();
  if (accessError) return json({ code: "DATABASE_ERROR", error: "Business context could not be verified." }, 500, origin, requestId);
  if (!access) return json({ code: "BUSINESS_CONTEXT_MISMATCH", error: "This customer is not authorised for that Business." }, 403, origin, requestId);

  const { data: location, error: locationError } = await supabase
    .from("business_locations")
    .select("id, slug, display_name, timezone, enabled")
    .eq("business_id", business.id)
    .eq("slug", locationSlug)
    .maybeSingle();
  if (locationError) return json({ code: "DATABASE_ERROR", error: "Location context could not be loaded." }, 500, origin, requestId);
  if (!location || !location.enabled) return json({ code: "LOCATION_UNAVAILABLE", error: "This Location is not available." }, 404, origin, requestId);

  const { data: service, error: serviceError } = await supabase
    .from("business_services")
    .select("id, display_name_override, enabled")
    .eq("id", serviceId)
    .eq("business_id", business.id)
    .eq("location_id", location.id)
    .eq("enabled", true)
    .maybeSingle();
  if (serviceError) return json({ code: "DATABASE_ERROR", error: "Service configuration could not be loaded." }, 500, origin, requestId);
  if (!service) return json({ code: "SERVICE_UNAVAILABLE", error: "This service is not available at the selected Location." }, 404, origin, requestId);

  const [{ data: providerConfig, error: providerConfigError }, { data: providerLocation, error: providerLocationError }, { data: providerService, error: providerServiceError }] = await Promise.all([
    supabase.from("business_provider_config").select("mindbody_site_id").eq("business_id", business.id).maybeSingle(),
    supabase.from("business_location_provider_config").select("mindbody_location_id").eq("business_id", business.id).eq("location_id", location.id).maybeSingle(),
    supabase.from("business_service_provider_config").select("mindbody_session_type_id").eq("business_id", business.id).eq("service_id", service.id).maybeSingle(),
  ]);
  if (providerConfigError || providerLocationError || providerServiceError) return json({ code: "DATABASE_ERROR", error: "Provider configuration could not be loaded." }, 500, origin, requestId);

  const siteId = sandboxSiteId(business, providerConfig?.mindbody_site_id ?? "");
  if (!siteId || !providerLocation?.mindbody_location_id || !providerService?.mindbody_session_type_id) {
    return json({ code: "PROVIDER_NOT_READY", error: "This Business has no enabled sandbox provider connection." }, 409, origin, requestId);
  }

  try {
    const useTestDouble = Deno.env.get("MINDBODY_ALLOW_TEST_DOUBLE") === "true" && !Deno.env.get("DENO_DEPLOYMENT_ID");
    const client = createMindbodyClient({
      apiKey: Deno.env.get("MINDBODY_API_KEY"),
      baseUrl: Deno.env.get("MINDBODY_BASE_URL"),
      siteId,
      fetchImpl: useTestDouble ? createMindbodyTestDouble({ apiKey: Deno.env.get("MINDBODY_API_KEY"), siteId }) : fetch,
    });
    const [liveLocations, liveSessionTypes] = await Promise.all([client.getLocations(), client.getSessionTypes()]);
    if (!liveLocations.some((item) => item.providerId === String(providerLocation.mindbody_location_id))) {
      return json({ code: "LOCATION_CONTEXT_MISMATCH", error: "This Location is not available for the configured Mindbody Site." }, 409, origin, requestId);
    }
    const [liveService] = selectEnabledServices(liveSessionTypes, [{ ...service, mindbody_session_type_id: providerService.mindbody_session_type_id }]);
    if (!liveService) return json({ code: "SERVICE_UNAVAILABLE", error: "This service is not available in the live Mindbody catalogue." }, 409, origin, requestId);

    const range = dateRange(selectedDate!);
    const liveItems = await client.getBookableItems({
      sessionTypeId: providerService.mindbody_session_type_id,
      locationId: providerLocation.mindbody_location_id,
      ...range,
    });
    const slots = liveItems
      .filter((item) => !item.locationProviderId || item.locationProviderId === String(providerLocation.mindbody_location_id))
      .map((item) => slotResponse(item, liveService))
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
    const selectedDateSlots = slots.filter((slot) => localDate(slot.startTime, location.timezone) === selectedDate);
    const nextSlot = slots.find((slot) => localDate(slot.startTime, location.timezone) > selectedDate!);
    const availability = {
      state: selectedDateSlots.length > 0 ? "available" : "empty",
      selectedDate,
      slots: selectedDateSlots,
      earliestNextAvailability: nextSlot
        ? { date: localDate(nextSlot.startTime, location.timezone), startTime: nextSlot.startTime }
        : null,
    };

    const response: Record<string, unknown> = {
      business: {
        slug: business.slug,
        displayName: business.display_name,
        logoUrl: business.logo_url,
        brand: { primary: business.brand_primary, accent: business.brand_accent },
        supportEmail: business.support_email,
        locationBrowserPath: business.location_browser_path,
      },
      location: {
        slug: location.slug,
        displayName: location.display_name,
        timezone: location.timezone,
      },
      service: serviceResponse(liveService),
      availability,
    };

    if (selectedStart) {
      const selectedSlot = selectedDateSlots.find((slot) => slot.startTime === selectedStart);
      if (!selectedSlot) return json({ code: "SLOT_UNAVAILABLE", error: "That time is no longer available. Choose a refreshed time." }, 409, origin, requestId);
      response.review = {
        business: { displayName: business.display_name },
        location: { displayName: location.display_name },
        service: {
          name: liveService.name,
          durationMinutes: selectedSlot.durationMinutes,
          price: selectedSlot.price,
        },
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
      };
    }

    return json(response, 200, origin, requestId);
  } catch (error) {
    if (error instanceof MindbodyApiError) {
      console.error(JSON.stringify({ event: "mindbody_availability_error", requestId, operation: "availability_lookup", status: error.status }));
      return json({ code: "MINDBODY_UNAVAILABLE", error: error.message }, error.status, origin, requestId);
    }
    console.error(JSON.stringify({ event: "mindbody_availability_error", requestId, operation: "availability_lookup", status: 502 }));
    return json({ code: "MINDBODY_UNAVAILABLE", error: "Live availability is temporarily unavailable." }, 502, origin, requestId);
  }
});

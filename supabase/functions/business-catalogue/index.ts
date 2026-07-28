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

function providerEnvironment() {
  return Deno.env.get("MINDBODY_ENVIRONMENT") ?? "sandbox";
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

function sandboxSiteId(business: { provider_environment: string; mindbody_site_id: string }) {
  if (business.provider_environment !== "sandbox") return null;
  const configuredSandboxSiteId = Deno.env.get("MINDBODY_SANDBOX_SITE_ID");
  if (!configuredSandboxSiteId) return null;
  if (business.mindbody_site_id === "__MINDBODY_SANDBOX_SITE_ID__") {
    return configuredSandboxSiteId;
  }
  return business.mindbody_site_id === configuredSandboxSiteId ? configuredSandboxSiteId : null;
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
  if (missing.length > 0) {
    return json({ code: "CONFIGURATION_ERROR", error: "Catalogue configuration is incomplete.", missing }, 500, origin, requestId);
  }
  if (providerEnvironment() !== "sandbox" || !isAllowedSandboxBaseUrl()) {
    return json({ code: "SANDBOX_REQUIRED", error: "Issue #11 only permits the configured Mindbody sandbox." }, 409, origin, requestId);
  }

  const url = new URL(request.url);
  const untrustedProviderFields = ["siteId", "site_id", "clientId", "client_id", "readiness"];
  if (untrustedProviderFields.some((field) => url.searchParams.has(field))) {
    return json({ code: "UNTRUSTED_PROVIDER_CONTEXT", error: "Provider context must come from tenant configuration." }, 400, origin, requestId);
  }

  const businessSlug = url.searchParams.get("business");
  const locationSlug = url.searchParams.get("location");
  if (!businessSlug || !locationSlug) {
    return json({ code: "INVALID_CONTEXT", error: "Business and Location context are required." }, 400, origin, requestId);
  }

  const token = bearerToken(request);
  if (!token) return json({ code: "AUTHENTICATION_REQUIRED", error: "Sign in through Revvi to continue." }, 401, origin, requestId);

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ code: "AUTHENTICATION_INVALID", error: "Revvi identity could not be verified." }, 401, origin, requestId);
  }

  const customerMemberstackId = memberstackId(userData.user);
  if (!customerMemberstackId) {
    return json({ code: "MEMBERSTACK_IDENTITY_REQUIRED", error: "A verified Memberstack identity is required." }, 403, origin, requestId);
  }

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
  if (!business || business.status !== "active" || !business.booking_enabled) {
    return json({ code: "BUSINESS_UNAVAILABLE", error: "This Business is not available for booking." }, 409, origin, requestId);
  }

  const { data: providerConfig, error: providerConfigError } = await supabase
    .from("business_provider_config")
    .select("mindbody_site_id")
    .eq("business_id", business.id)
    .maybeSingle();
  if (providerConfigError) return json({ code: "DATABASE_ERROR", error: "Business provider configuration could not be loaded." }, 500, origin, requestId);

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
  if (!location || !location.enabled) {
    return json({ code: "LOCATION_UNAVAILABLE", error: "This Location is not available." }, 404, origin, requestId);
  }

  const { data: providerLocation, error: providerLocationError } = await supabase
    .from("business_location_provider_config")
    .select("mindbody_location_id")
    .eq("business_id", business.id)
    .eq("location_id", location.id)
    .maybeSingle();
  if (providerLocationError) return json({ code: "DATABASE_ERROR", error: "Location provider configuration could not be loaded." }, 500, origin, requestId);

  const { data: configuredServices, error: serviceError } = await supabase
    .from("business_services")
    .select("id, display_name_override, enabled")
    .eq("business_id", business.id)
    .eq("location_id", location.id)
    .eq("enabled", true);
  if (serviceError) {
    console.error(JSON.stringify({ event: "catalogue_database_error", requestId, operation: "services", code: serviceError.code, message: serviceError.message }));
    return json({ code: "DATABASE_ERROR", error: "Service configuration could not be loaded." }, 500, origin, requestId);
  }

  const serviceIds = (configuredServices ?? []).map((service) => service.id);
  const { data: providerServices, error: providerServiceError } = serviceIds.length === 0
    ? { data: [], error: null }
    : await supabase
      .from("business_service_provider_config")
      .select("service_id, mindbody_session_type_id")
      .eq("business_id", business.id)
      .in("service_id", serviceIds);
  if (providerServiceError) return json({ code: "DATABASE_ERROR", error: "Service provider configuration could not be loaded." }, 500, origin, requestId);

  const siteId = sandboxSiteId({ ...business, mindbody_site_id: providerConfig?.mindbody_site_id ?? "" });
  const locationProviderId = providerLocation?.mindbody_location_id;
  if (!siteId || !locationProviderId) {
    return json({ code: "PROVIDER_NOT_READY", error: "This Business has no enabled sandbox provider connection." }, 409, origin, requestId);
  }

  const providerServiceIds = new Map((providerServices ?? []).map((service) => [service.service_id, service.mindbody_session_type_id]));
  const configuredServicesWithProviderIds = (configuredServices ?? [])
    .map((service) => ({ ...service, mindbody_session_type_id: providerServiceIds.get(service.id) }))
    .filter((service) => service.mindbody_session_type_id);

  try {
    const useTestDouble = Deno.env.get("MINDBODY_ALLOW_TEST_DOUBLE") === "true" && !Deno.env.get("DENO_DEPLOYMENT_ID");
    const client = createMindbodyClient({
      apiKey: Deno.env.get("MINDBODY_API_KEY"),
      baseUrl: Deno.env.get("MINDBODY_BASE_URL"),
      siteId,
      fetchImpl: useTestDouble
        ? createMindbodyTestDouble({ apiKey: Deno.env.get("MINDBODY_API_KEY"), siteId })
        : fetch,
    });
    const liveLocations = await client.getLocations();
    if (!liveLocations.some((item) => item.providerId === String(locationProviderId))) {
      return json({ code: "LOCATION_CONTEXT_MISMATCH", error: "This Location is not available for the configured Mindbody Site." }, 409, origin, requestId);
    }
    const liveServices = await client.getSessionTypes();
    const services = selectEnabledServices(liveServices, configuredServicesWithProviderIds);

    return json({
      business: {
        id: business.id,
        slug: business.slug,
        displayName: business.display_name,
        logoUrl: business.logo_url,
        brand: { primary: business.brand_primary, accent: business.brand_accent },
        supportEmail: business.support_email,
        locationBrowserPath: business.location_browser_path,
      },
      location: {
        id: location.id,
        slug: location.slug,
        displayName: location.display_name,
        timezone: location.timezone,
      },
      services,
    });
  } catch (error) {
    if (error instanceof MindbodyApiError) {
      console.error(JSON.stringify({ event: "mindbody_catalogue_error", requestId, operation: "catalogue_lookup", status: error.status }));
      return json({ code: "MINDBODY_UNAVAILABLE", error: error.message }, error.status, origin, requestId);
    }
    console.error(JSON.stringify({ event: "mindbody_catalogue_error", requestId, operation: "catalogue_lookup", status: 502 }));
    return json({ code: "MINDBODY_UNAVAILABLE", error: "Live service catalogue is temporarily unavailable." }, 502, origin, requestId);
  }
});

export class ClassAvailabilityCatalogueError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ClassAvailabilityCatalogueError";
    this.code = code;
    this.status = status;
  }
}

function unavailable(message = "Class availability configuration could not be loaded.") {
  return new ClassAvailabilityCatalogueError("AVAILABILITY_CONFIGURATION_UNAVAILABLE", message, 503);
}

function notFound(message) {
  return new ClassAvailabilityCatalogueError("OFFER_AVAILABILITY_NOT_FOUND", message, 404);
}

export function createClassAvailabilityCatalogue(supabase) {
  return Object.freeze({
    async resolveBusinessIdBySlug(businessSlug) {
      const { data, error } = await supabase
        .from("class_businesses")
        .select("id")
        .eq("slug", businessSlug)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw unavailable("The Business availability context could not be loaded.");
      if (!data?.id) throw notFound("This Business has no active Class availability.");
      return data.id;
    },

    async resolveAvailabilityContext({ businessSlug, locationId, offerId, customerId }) {
      const { data, error } = await supabase.rpc("resolve_class_availability_context", {
        candidate_business_slug: businessSlug,
        candidate_location_id: locationId,
        candidate_offer_id: offerId,
        candidate_customer_id: customerId,
      });
      if (error) throw unavailable();
      if (!Array.isArray(data) || data.length !== 1) {
        throw notFound("This Revvi Offer has no active approved Class inventory at the selected Location.");
      }
      const row = data[0];
      return {
        business: {
          id: row.business_id,
          slug: row.business_slug,
          displayName: row.business_name,
        },
        location: {
          id: row.location_id,
          displayName: row.location_name,
          timezone: row.location_timezone,
          providerLocationId: row.provider_location_id,
        },
        offer: {
          id: row.offer_id,
          displayName: row.offer_name,
          fulfilmentMode: row.fulfilment_mode,
        },
        integration: {
          id: row.integration_id,
          providerSiteId: row.provider_site_id,
          status: "active",
        },
        mapping: {
          id: row.mapping_id,
          status: "active",
          providerServiceProductId: row.provider_service_product_id,
        },
        customerProviderProfile: row.provider_client_id
          ? {
            id: row.customer_provider_profile_id,
            providerClientId: row.provider_client_id,
            providerClientUniqueId: row.provider_client_unique_id,
          }
          : null,
        inventoryAllowlist: row.inventory_allowlist,
      };
    },

    async recordProviderDiagnostic(facts) {
      const { error } = await supabase.from("class_availability_provider_diagnostics").insert({
        business_id: facts.businessId,
        offer_id: facts.offerId,
        location_id: facts.locationId,
        mapping_id: facts.mappingId,
        endpoint_name: facts.endpointName,
        request_id: facts.requestId ?? null,
        provider_request_id: facts.providerRequestId ?? null,
        status_code: facts.statusCode ?? null,
        duration_ms: facts.durationMs ?? null,
        success: facts.success === true,
        error_code: facts.errorCode ?? null,
      });
      if (error) throw unavailable("Class provider diagnostics could not be recorded.");
    },
  });
}

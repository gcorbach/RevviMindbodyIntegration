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

function classFamilies(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row?.family_id).map((row) => ({
    id: row.family_id,
    slug: row.family_slug,
    displayName: row.family_name,
    ...(row.family_description ? { description: row.family_description } : {}),
    displayOrder: row.family_display_order ?? 0,
    providerMappings: Array.isArray(row.provider_mappings)
      ? row.provider_mappings.map((mapping) => ({
        id: mapping.id,
        providerLocationId: mapping.providerLocationId,
        providerClassDescriptionId: mapping.providerClassDescriptionId,
        providerProgramId: mapping.providerProgramId,
        providerSessionTypeId: mapping.providerSessionTypeId,
        ...(mapping.providerClassScheduleId
          ? { providerClassScheduleId: mapping.providerClassScheduleId }
          : {}),
      }))
      : [],
  }));
}

async function activePricingOptionIds(supabase, row) {
  if (row?.fulfilment_mode !== "purchase_pricing_option") return [];
  const { data, error } = await supabase
    .from("class_offer_pricing_options")
    .select("provider_service_product_id")
    .eq("business_id", row.business_id)
    .eq("mapping_id", row.mapping_id)
    .eq("status", "active");
  if (error) throw unavailable("The approved Mindbody Product set could not be loaded.");
  return [...new Set((Array.isArray(data) ? data : [])
    .map((option) => String(option?.provider_service_product_id ?? "").trim())
    .filter(Boolean))];
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
      const { data: familyRows, error: familyError } = await supabase.rpc(
        "resolve_class_availability_families",
        {
          candidate_business_id: row.business_id,
          candidate_location_id: row.location_id,
          candidate_offer_id: row.offer_id,
        },
      );
      if (familyError) throw unavailable();
      const families = classFamilies(familyRows);
      const providerServiceProductIds = await activePricingOptionIds(supabase, row);
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
          ...(providerServiceProductIds.length
            ? { providerServiceProductIds }
            : {}),
        },
        customerProviderProfile: row.provider_client_id
          ? {
            id: row.customer_provider_profile_id,
            providerClientId: row.provider_client_id,
            providerClientUniqueId: row.provider_client_unique_id,
          }
          : null,
        inventoryAllowlist: row.inventory_allowlist,
        ...(families.length ? { classFamilies: families } : {}),
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

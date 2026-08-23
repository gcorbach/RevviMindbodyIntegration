import { BookingQuoteError } from "./class-booking-quote.js";

function unavailable(message = "The booking quote configuration could not be loaded.") {
  return new BookingQuoteError("QUOTE_CONFIGURATION_UNAVAILABLE", message, 503);
}

function normalizeClassFamilies(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row?.family_id).map((row) => ({
    id: row.family_id,
    slug: row.family_slug,
    displayName: row.family_name,
    ...(row.family_description ? { description: row.family_description } : {}),
    displayOrder: row.family_display_order ?? 0,
    status: "active",
    providerMappings: Array.isArray(row.provider_mappings) ? row.provider_mappings : [],
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

export function createClassBookingQuoteCatalogue(supabase) {
  return Object.freeze({
    async resolveOfferLocator(offerId) {
      const { data, error } = await supabase.from("class_revvi_offers")
        .select("id, business_id, location_id")
        .eq("id", offerId)
        .maybeSingle();
      if (error) throw unavailable();
      if (!data) throw new BookingQuoteError("OFFER_NOT_FOUND", "This Revvi Offer was not found.", 404);
      return { businessId: data.business_id, locationId: data.location_id, offerId: data.id };
    },

    async resolveQuoteContext({ offerId, customerId }) {
      const { data, error } = await supabase.rpc("resolve_class_booking_quote_context", {
        candidate_offer_id: offerId,
        candidate_customer_id: customerId,
      });
      if (error) throw unavailable();
      if (!Array.isArray(data) || data.length !== 1) {
        throw new BookingQuoteError("QUOTE_CONTEXT_NOT_FOUND", "This Offer has no approved booking quote configuration.", 404);
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
      let paidRoute = null;
      if (row.fulfilment_mode === "purchase_pricing_option") {
        const { data: paidMapping, error: paidMappingError } = await supabase
          .from("class_offer_provider_mappings")
          .select("paid_pricing_option_enabled,paid_payment_route,paid_payment_method_id,paid_checkout_location_id,sandbox_demo_write_enabled,sandbox_demo_customer_id")
          .eq("id", row.mapping_id)
          .eq("mapping_version", row.mapping_version)
          .maybeSingle();
        if (paidMappingError || !paidMapping) throw unavailable("The approved paid checkout route could not be loaded.");
        paidRoute = paidMapping;
      }
      const providerServiceProductIds = await activePricingOptionIds(supabase, row);
      return {
        business: { id: row.business_id },
        location: {
          id: row.location_id,
          displayName: row.location_name,
          providerLocationId: row.provider_location_id,
          timezone: row.location_timezone,
        },
        offer: {
          id: row.offer_id,
          displayName: row.offer_name,
          fulfilmentMode: row.fulfilment_mode,
          cancellationPolicyText: row.cancellation_policy_text,
          cancellationPolicyCertainty: row.cancellation_policy_certainty,
        },
        integration: {
          id: row.integration_id,
          providerSiteId: row.provider_site_id,
          environment: row.provider_environment,
          allowClientCreation: row.allow_client_creation,
        },
        mapping: {
          id: row.mapping_id,
          version: Number(row.mapping_version),
          providerServiceProductId: row.provider_service_product_id,
          ...(providerServiceProductIds.length
            ? { providerServiceProductIds }
            : {}),
          modeEvidenceVerified: row.mode_evidence_verified
            && (paidRoute == null || paidRoute.paid_pricing_option_enabled === true),
          paidPaymentRoute: paidRoute?.paid_payment_route ?? null,
          paidPaymentMethodId: paidRoute?.paid_payment_method_id == null
            ? null
            : Number(paidRoute.paid_payment_method_id),
          paidCheckoutLocationId: paidRoute?.paid_checkout_location_id == null
            ? null
            : Number(paidRoute.paid_checkout_location_id),
          sandboxDemoWriteEnabled: paidRoute?.sandbox_demo_write_enabled === true,
          sandboxDemoCustomerId: paidRoute?.sandbox_demo_customer_id ?? null,
        },
        customerProviderProfile: row.provider_client_id ? {
          id: row.customer_provider_profile_id,
          providerClientId: row.provider_client_id,
          providerClientUniqueId: row.provider_client_unique_id,
        } : null,
        inventoryAllowlist: row.inventory_allowlist,
        classFamilies: normalizeClassFamilies(familyRows),
      };
    },

    async persistProviderProfile(profile) {
      const { data, error } = await supabase.rpc("persist_class_customer_provider_profile", {
        candidate_business_id: profile.businessId,
        candidate_customer_id: profile.customerId,
        candidate_integration_id: profile.integrationId,
        candidate_provider_site_id: profile.providerSiteId,
        candidate_provider_client_id: profile.providerClientId,
        candidate_provider_client_unique_id: profile.providerClientUniqueId,
      });
      if (error || !Array.isArray(data) || data.length !== 1) throw unavailable("The Mindbody Client identity could not be persisted safely.");
      return {
        id: data[0].profile_id,
        providerClientId: data[0].provider_client_id,
        providerClientUniqueId: data[0].provider_client_unique_id,
      };
    },

    async recordAmbiguity(facts) {
      const { error } = await supabase.from("class_client_resolution_support_work").insert({
        business_id: facts.businessId,
        integration_id: facts.integrationId,
        customer_id: facts.customerId,
        reason_code: facts.reasonCode,
        candidate_count: facts.candidateCount,
      });
      if (error) throw unavailable("Client ambiguity support work could not be recorded.");
    },

    async recordProviderDiagnostic(facts) {
      const { error } = await supabase.from("class_quote_provider_diagnostics").insert({
        business_id: facts.businessId,
        offer_id: facts.offerId,
        location_id: facts.locationId,
        mapping_id: facts.mappingId,
        customer_id: facts.customerId,
        endpoint_name: facts.endpointName,
        request_id: facts.requestId,
        provider_request_id: facts.providerRequestId,
        status_code: facts.statusCode,
        duration_ms: facts.durationMs,
        success: facts.success,
        error_code: facts.errorCode,
      });
      if (error) throw unavailable("Mindbody quote diagnostics could not be recorded safely.");
    },

    async persistQuote(quote) {
      const { data, error } = await supabase.from("class_booking_quotes").insert({
        business_id: quote.businessId,
        offer_id: quote.offerId,
        mapping_id: quote.mappingId,
        mapping_version: quote.mappingVersion,
        class_family_id: quote.classFamilyId ?? null,
        integration_id: quote.integrationId,
        location_id: quote.locationId,
        customer_id: quote.customerId,
        customer_provider_profile_id: quote.customerProviderProfileId,
        provider_site_id: quote.providerSiteId,
        provider_location_id: quote.providerLocationId,
        provider_class_id: quote.classId,
        provider_class_schedule_id: quote.providerClassScheduleId,
        provider_client_id: quote.providerClientId,
        provider_client_unique_id: quote.providerClientUniqueId,
        provider_service_product_id: quote.providerServiceProductId,
        provider_client_service_id: quote.providerClientServiceId,
        fulfilment_mode: quote.fulfilmentMode,
        subtotal: quote.subtotal,
        discount_total: quote.discountTotal,
        tax_total: quote.taxTotal,
        grand_total: quote.grandTotal,
        currency: quote.currency,
        provider_calculation: quote.providerCalculation,
        quote_fingerprint: quote.quoteFingerprint,
        status: quote.status,
        quoted_at: quote.quotedAt,
        expires_at: quote.expiresAt,
      }).select("id").single();
      if (error || !data?.id) throw unavailable("The booking quote could not be stored.");
      return { id: data.id };
    },
  });
}

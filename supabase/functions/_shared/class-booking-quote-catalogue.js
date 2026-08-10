import { BookingQuoteError } from "./class-booking-quote.js";

function unavailable(message = "The booking quote configuration could not be loaded.") {
  return new BookingQuoteError("QUOTE_CONFIGURATION_UNAVAILABLE", message, 503);
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
          modeEvidenceVerified: row.mode_evidence_verified,
        },
        customerProviderProfile: row.provider_client_id ? {
          id: row.customer_provider_profile_id,
          providerClientId: row.provider_client_id,
          providerClientUniqueId: row.provider_client_unique_id,
        } : null,
        inventoryAllowlist: row.inventory_allowlist,
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

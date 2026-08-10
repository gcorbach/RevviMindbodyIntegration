import { BookingOrchestrationError } from "./class-booking.js";

function unavailable(message = "The Class Booking ledger is temporarily unavailable.") {
  return new BookingOrchestrationError("BOOKING_LEDGER_UNAVAILABLE", message, 503);
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function booking(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    priceAmount: row.price_amount == null ? null : Number(row.price_amount),
    currency: row.currency,
    className: row.class_name,
    startAt: row.start_datetime,
    locationName: row.location_name,
    providerClassId: row.provider_class_id,
    providerVisitId: row.provider_visit_id,
    providerRosterBookingId: row.provider_roster_booking_id,
    providerWaitlistEntryId: row.provider_waitlist_entry_id,
    providerClientServiceId: row.provider_client_service_id,
    providerServiceProductId: row.provider_service_product_id,
    providerSaleId: row.provider_sale_id,
    providerCartId: row.provider_cart_id,
    providerTransactionId: row.provider_transaction_id,
    providerPaymentId: row.provider_payment_id,
  };
}

function attempt(row) {
  return row ? { id: row.id, status: row.status } : null;
}

function storedPayload(data) {
  if (!data?.booking?.id || !data?.attempt?.id) throw unavailable();
  return { ...data, booking: data.booking, attempt: data.attempt };
}

function quote(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    offerId: row.offer_id,
    mappingId: row.mapping_id,
    mappingVersion: Number(row.mapping_version),
    integrationId: row.integration_id,
    locationId: row.location_id,
    customerId: row.customer_id,
    fulfilmentMode: row.fulfilment_mode,
    classId: row.provider_class_id,
    classScheduleId: row.provider_class_schedule_id,
    providerSiteId: row.provider_site_id,
    providerLocationId: row.provider_location_id,
    providerClientId: row.provider_client_id,
    providerClientUniqueId: row.provider_client_unique_id,
    providerServiceProductId: row.provider_service_product_id,
    providerClientServiceId: row.provider_client_service_id,
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discount_total),
    taxTotal: Number(row.tax_total),
    grandTotal: Number(row.grand_total),
    currency: row.currency,
    quoteFingerprint: row.quote_fingerprint,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

const BOOKING_COLUMNS = [
  "id", "status", "price_amount", "currency", "class_name", "start_datetime",
  "location_name", "provider_class_id",
  "provider_visit_id", "provider_roster_booking_id", "provider_waitlist_entry_id",
  "provider_client_service_id", "provider_service_product_id", "provider_sale_id",
  "provider_cart_id", "provider_transaction_id", "provider_payment_id",
].join(",");

const QUOTE_COLUMNS = [
  "id", "business_id", "offer_id", "mapping_id", "mapping_version", "integration_id",
  "location_id", "customer_id", "fulfilment_mode", "provider_class_id",
  "provider_class_schedule_id", "provider_site_id", "provider_location_id",
  "provider_client_id", "provider_client_unique_id", "provider_service_product_id",
  "provider_client_service_id", "subtotal", "discount_total", "tax_total", "grand_total",
  "currency", "quote_fingerprint", "status", "expires_at",
].join(",");

export function createClassBookingCatalogue(supabase, quoteCatalogue) {
  return Object.freeze({
    async resolveQuoteLocator(quoteId) {
      const { data, error } = await supabase.from("class_booking_quotes")
        .select("id,business_id,offer_id,location_id,customer_id")
        .eq("id", quoteId)
        .maybeSingle();
      if (error) throw unavailable();
      if (!data) throw new BookingOrchestrationError("QUOTE_NOT_FOUND", "This Class Booking quote was not found.", 404);
      return {
        quoteId: data.id,
        businessId: data.business_id,
        offerId: data.offer_id,
        locationId: data.location_id,
        customerId: data.customer_id,
      };
    },

    async resolveBookingContext({ quoteId, customerId }) {
      const { data, error } = await supabase.from("class_booking_quotes")
        .select(QUOTE_COLUMNS)
        .eq("id", quoteId)
        .eq("customer_id", customerId)
        .maybeSingle();
      if (error) throw unavailable();
      if (!data) throw new BookingOrchestrationError("QUOTE_NOT_FOUND", "This Class Booking quote was not found for this Customer.", 404);
      const storedQuote = quote(data);
      const context = await quoteCatalogue.resolveQuoteContext({ offerId: storedQuote.offerId, customerId });
      return { quote: storedQuote, context };
    },

    async findAttempt({ customerId, idempotencyKey }) {
      if (!customerId || !idempotencyKey) return null;
      const { data: bookingRow, error: bookingError } = await supabase.from("class_bookings")
        .select(BOOKING_COLUMNS)
        .eq("customer_id", customerId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (bookingError) throw unavailable();
      if (!bookingRow) return null;
      const { data: attemptRow, error: attemptError } = await supabase.from("class_booking_provider_attempts")
        .select("id,status")
        .eq("booking_id", bookingRow.id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (attemptError || !attemptRow) throw unavailable();
      return { booking: booking(bookingRow), attempt: attempt(attemptRow) };
    },

    async claimAttempt(facts) {
      const writeToken = token();
      const occurrence = facts.occurrence ?? {};
      const { data, error } = await supabase.rpc("claim_class_booking_attempt", {
        candidate_quote_id: facts.quote.id,
        candidate_customer_id: facts.quote.customerId,
        candidate_idempotency_key: facts.idempotencyKey,
        candidate_request_fingerprint: facts.requestFingerprint,
        candidate_attempt_type: facts.attemptType,
        candidate_write_token: writeToken,
        candidate_class_schedule_id: occurrence.classScheduleId,
        candidate_class_description_id: occurrence.classDescriptionId,
        candidate_program_id: occurrence.programId,
        candidate_session_type_id: occurrence.sessionTypeId,
        candidate_class_name: occurrence.name,
        candidate_staff_name: occurrence.staffName,
        candidate_start_datetime: occurrence.startAt,
        candidate_end_datetime: occurrence.endAt,
      });
      if (error) {
        if (/idempotency key conflicts/i.test(error.message ?? "")) {
          throw new BookingOrchestrationError("IDEMPOTENCY_CONFLICT", "This idempotency key belongs to another Class Booking request.", 409);
        }
        if (/not open and current/i.test(error.message ?? "")) {
          throw new BookingOrchestrationError("QUOTE_NOT_OPEN", "This Booking quote has already been used or expired.", 409);
        }
        throw unavailable("The Class Booking attempt could not be claimed safely.");
      }
      return storedPayload(data);
    },

    async completeAttempt(facts) {
      const references = facts.providerReferences ?? {};
      const { data, error } = await supabase.rpc("finalize_class_booking_attempt", {
        candidate_business_id: facts.businessId,
        candidate_booking_id: facts.bookingId,
        candidate_attempt_id: facts.attemptId,
        candidate_write_token: facts.writeToken,
        candidate_booking_status: facts.status,
        candidate_attempt_status: facts.attemptStatus,
        candidate_payment_status: facts.paymentStatus,
        candidate_provider_request_id: facts.providerRequestId,
        candidate_provider_visit_id: references.providerVisitId,
        candidate_provider_roster_booking_id: references.providerRosterBookingId,
        candidate_provider_waitlist_entry_id: references.providerWaitlistEntryId,
        candidate_provider_client_service_id: references.providerClientServiceId,
        candidate_provider_service_product_id: references.providerServiceProductId,
        candidate_provider_sale_id: references.providerSaleId,
        candidate_provider_cart_id: references.providerCartId,
        candidate_provider_transaction_id: references.providerTransactionId,
        candidate_provider_payment_id: references.providerPaymentId,
        candidate_error_code: facts.errorCode,
        candidate_error_message: facts.errorMessage,
        candidate_release_write_lock: facts.releaseWriteLock,
      });
      if (error) throw unavailable("The Mindbody Class Booking result could not be persisted safely.");
      return storedPayload(data);
    },

    async enqueueReconciliation(facts) {
      const { error } = await supabase.rpc("enqueue_class_booking_reconciliation", {
        candidate_business_id: facts.businessId,
        candidate_booking_id: facts.bookingId,
        candidate_attempt_id: facts.attemptId,
        candidate_reason_code: facts.reasonCode,
      });
      if (error) throw unavailable("The unknown Class Booking could not be queued for reconciliation.");
    },

    async completeReconciliation(facts) {
      const references = facts.providerReferences ?? {};
      const { data, error } = await supabase.rpc("complete_class_booking_reconciliation", {
        candidate_business_id: facts.businessId,
        candidate_booking_id: facts.bookingId,
        candidate_attempt_id: facts.attemptId,
        candidate_booking_status: facts.status,
        candidate_provider_visit_id: references.providerVisitId,
        candidate_provider_roster_booking_id: references.providerRosterBookingId,
        candidate_provider_waitlist_entry_id: references.providerWaitlistEntryId,
        candidate_provider_client_service_id: references.providerClientServiceId,
        candidate_provider_service_product_id: references.providerServiceProductId,
        candidate_provider_sale_id: references.providerSaleId,
        candidate_provider_cart_id: references.providerCartId,
        candidate_provider_transaction_id: references.providerTransactionId,
        candidate_provider_payment_id: references.providerPaymentId,
        candidate_error_code: facts.errorCode,
      });
      if (error) throw unavailable("The Class Booking reconciliation result could not be persisted safely.");
      return storedPayload(data);
    },

    async recordReconciliationObservation(facts) {
      const references = facts.providerReferences ?? {};
      const { data, error } = await supabase.rpc("record_class_booking_reconciliation_observation", {
        candidate_business_id: facts.businessId,
        candidate_booking_id: facts.bookingId,
        candidate_attempt_id: facts.attemptId,
        candidate_write_token: facts.writeToken,
        candidate_provider_visit_id: references.providerVisitId,
        candidate_provider_roster_booking_id: references.providerRosterBookingId,
        candidate_provider_waitlist_entry_id: references.providerWaitlistEntryId,
        candidate_provider_client_service_id: references.providerClientServiceId,
        candidate_provider_service_product_id: references.providerServiceProductId,
        candidate_provider_sale_id: references.providerSaleId,
        candidate_provider_cart_id: references.providerCartId,
        candidate_provider_transaction_id: references.providerTransactionId,
        candidate_provider_payment_id: references.providerPaymentId,
        candidate_error_code: facts.errorCode,
      });
      if (error) throw unavailable("The unresolved Mindbody reconciliation evidence could not be persisted safely.");
      return storedPayload(data);
    },

    async recordProviderDiagnostic(facts) {
      const { error } = await supabase.from("class_booking_provider_diagnostics").insert({
        business_id: facts.businessId,
        attempt_id: facts.attemptId,
        diagnostic_kind: facts.diagnosticKind ?? "request_summary",
        endpoint_name: facts.endpointName,
        request_id: facts.requestId,
        provider_request_id: facts.providerRequestId,
        status_code: facts.statusCode,
        duration_ms: facts.durationMs,
        success: facts.success,
        error_code: facts.errorCode,
      });
      if (error) throw unavailable("Mindbody Class Booking diagnostics could not be recorded safely.");
    },
  });
}

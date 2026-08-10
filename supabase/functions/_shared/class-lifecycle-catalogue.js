export class ClassLifecycleCatalogueError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = "ClassLifecycleCatalogueError";
    this.code = code;
    this.status = status;
  }
}

function unavailable(message = "The Class Booking lifecycle ledger is temporarily unavailable.") {
  return new ClassLifecycleCatalogueError("LIFECYCLE_LEDGER_UNAVAILABLE", message, 503);
}

function generateCancellationWriteToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function restorationStatus(value, fulfilmentMode) {
  if (fulfilmentMode !== "existing_entitlement") return "not_applicable";
  if (value === "confirmed") return "restored";
  if (value === "failed") return "not_restored";
  return "unknown";
}

function publicCancellation(data) {
  const booking = data?.booking;
  if (!booking?.id) throw unavailable();
  return {
    bookingId: booking.id,
    status: booking.status,
    cancelledAt: booking.cancelledAt ?? null,
    passRestoration: booking.passRestoration ?? "unknown",
    refund: booking.refund ?? "not_requested",
  };
}

export function createClassLifecycleCatalogue(supabase, customerCatalogue) {
  return Object.freeze({
    resolveCustomer: (memberstackMemberId) => customerCatalogue.resolveCustomer(memberstackMemberId),

    async upcomingBookings({ customerId, limit }) {
      const { data, error } = await supabase.rpc("list_upcoming_class_bookings", {
        candidate_customer_id: customerId,
        candidate_limit: limit,
      });
      if (error) throw unavailable();
      return (data ?? []).map((row) => ({
        id: row.id,
        status: row.status,
        businessName: row.business_name,
        className: row.class_name,
        startAt: row.start_at,
        locationName: row.location_name,
        timezone: row.timezone,
        cancellationState: row.cancellation_state,
        cancellationStatus: row.cancellation_status ?? null,
        passRestoration: restorationStatus(row.restoration_status, row.fulfilment_mode),
        refund: row.refund_status === "confirmed" ? "refunded" : "not_requested",
      }));
    },

    async claimCancellation({ bookingId, customerId, reason }) {
      const writeToken = generateCancellationWriteToken();
      const { data, error } = await supabase.rpc("claim_class_booking_cancellation", {
        candidate_booking_id: bookingId,
        candidate_customer_id: customerId,
        candidate_reason: reason,
        candidate_write_token: writeToken,
      });
      if (error) {
        if (/not found for this Customer/i.test(error.message ?? "")) {
          throw new ClassLifecycleCatalogueError(
            "BOOKING_NOT_FOUND",
            "This Class Booking was not found for the current Revvi Customer.",
            404,
          );
        }
        if (/not currently requestable/i.test(error.message ?? "")) {
          throw new ClassLifecycleCatalogueError(
            "CANCELLATION_NOT_REQUESTABLE",
            "This Class Booking is no longer requestable for cancellation.",
            409,
          );
        }
        if (/lacks the exact provider identifier/i.test(error.message ?? "")) {
          throw new ClassLifecycleCatalogueError(
            "CANCELLATION_IDENTIFIER_MISSING",
            "This Booking cannot be cancelled until its exact Mindbody reference is reconciled.",
            409,
          );
        }
        if (/not enabled by current controlled evidence/i.test(error.message ?? "")) {
          throw new ClassLifecycleCatalogueError(
            "CANCELLATION_UNSUPPORTED",
            "Cancellation is not enabled for this Class Booking.",
            409,
          );
        }
        throw unavailable("The Class cancellation request could not be claimed safely.");
      }
      if (!data?.booking?.id || !data?.attempt?.id) throw unavailable();
      return { ...data, writeToken: data.writeToken ?? writeToken };
    },

    async finalizeCancellation(facts) {
      const { data, error } = await supabase.rpc("finalize_class_booking_cancellation", {
        candidate_business_id: facts.businessId,
        candidate_booking_id: facts.bookingId,
        candidate_attempt_id: facts.attemptId,
        candidate_write_token: facts.writeToken,
        candidate_outcome: facts.outcome,
        candidate_authoritative_cancelled: facts.authoritativeCancelled === true,
        candidate_restoration_status: facts.restorationStatus ?? null,
        candidate_restoration_error_code: facts.restorationErrorCode ?? null,
        candidate_provider_request_id: facts.providerRequestId ?? null,
        candidate_error_code: facts.errorCode ?? null,
      });
      if (error) throw unavailable("The Class cancellation result could not be persisted safely.");
      return publicCancellation(data);
    },

    async persistEntitlementRestorationBaseline(facts) {
      const baseline = facts.baseline;
      const { error } = await supabase.rpc("persist_class_entitlement_restoration_baseline", {
        candidate_business_id: facts.businessId,
        candidate_booking_id: facts.bookingId,
        candidate_attempt_id: facts.attemptId,
        candidate_write_token: facts.writeToken,
        candidate_current: baseline.current,
        candidate_returned: baseline.returned,
        candidate_unlimited: baseline.unlimited,
        candidate_remaining: baseline.remaining,
        candidate_observed_at: baseline.observedAt,
      });
      if (error) throw unavailable("The entitlement restoration baseline could not be persisted safely.");
    },

    async resolveIntegration(integrationId) {
      const { data, error } = await supabase.from("class_business_integrations")
        .select("id,business_id,provider_site_id,environment,status")
        .eq("id", integrationId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw unavailable();
      if (!data) {
        throw new ClassLifecycleCatalogueError(
          "INTEGRATION_UNAVAILABLE",
          "The Mindbody integration for this Booking is not active.",
          409,
        );
      }
      return {
        id: data.id,
        businessId: data.business_id,
        providerSiteId: data.provider_site_id,
        environment: data.environment,
      };
    },

    async recordProviderDiagnostic(facts) {
      const { error } = await supabase.from("class_booking_provider_diagnostics").insert({
        business_id: facts.businessId,
        attempt_id: facts.attemptId,
        diagnostic_kind: facts.diagnosticKind ?? "reconciliation_evidence",
        endpoint_name: facts.endpointName,
        request_id: facts.requestId,
        provider_request_id: facts.providerRequestId,
        status_code: facts.statusCode,
        duration_ms: facts.durationMs,
        success: facts.success,
        error_code: facts.errorCode,
      });
      if (error) throw unavailable("Mindbody lifecycle diagnostics could not be recorded safely.");
    },

    async claimWebhookBatch(limit = 25) {
      const { data, error } = await supabase.rpc("claim_class_mindbody_webhook_batch", {
        candidate_limit: limit,
      });
      if (error) throw unavailable("Mindbody webhook work could not be claimed.");
      return data ?? [];
    },

    async processWebhook(id) {
      const { data, error } = await supabase.rpc("process_class_mindbody_webhook", {
        candidate_event_id: id,
      });
      if (error) throw unavailable("Mindbody webhook work could not be processed.");
      return Number(data ?? 0);
    },

    async claimLifecycleBatch(limit = 25) {
      const { data, error } = await supabase.rpc("claim_class_lifecycle_reconciliation_batch", {
        candidate_limit: limit,
      });
      if (error) throw unavailable("Class lifecycle work could not be claimed.");
      return (data ?? []).map((row) => ({
        id: row.id,
        businessId: row.business_id,
        bookingId: row.booking_id,
        purpose: row.purpose,
        source: row.source,
        attemptCount: Number(row.attempt_count),
      }));
    },

    async resolveLifecycleContext(work) {
      const { data: row, error } = await supabase.from("class_bookings")
        .select([
          "id", "business_id", "quote_id", "status", "fulfilment_mode",
          "provider_class_id", "provider_client_id", "provider_client_unique_id",
          "provider_visit_id", "provider_waitlist_entry_id", "provider_service_product_id",
          "provider_client_service_id", "cancellation_status", "restoration_status",
          "restoration_baseline_current", "restoration_baseline_returned",
          "restoration_baseline_unlimited", "restoration_baseline_remaining",
          "restoration_baseline_observed_at",
        ].join(","))
        .eq("business_id", work.businessId)
        .eq("id", work.bookingId)
        .maybeSingle();
      if (error || !row) throw unavailable("The lifecycle Booking context could not be resolved.");
      const { data: quoteRow, error: quoteError } = await supabase.from("class_booking_quotes")
        .select("integration_id")
        .eq("business_id", row.business_id)
        .eq("id", row.quote_id)
        .maybeSingle();
      if (quoteError || !quoteRow) throw unavailable("The lifecycle integration context could not be resolved.");
      let attemptsQuery = supabase.from("class_booking_provider_attempts")
        .select("id,attempt_type,status")
        .eq("business_id", row.business_id)
        .eq("booking_id", row.id);
      attemptsQuery = work.purpose === "cancellation"
        ? attemptsQuery.in("attempt_type", ["cancellation", "waitlist_removal"])
        : attemptsQuery.not("attempt_type", "in", "(cancellation,waitlist_removal,reconciliation)");
      const { data: attempts, error: attemptError } = await attemptsQuery
        .order("created_at", { ascending: false }).limit(1);
      if (attemptError || !attempts?.[0]) throw unavailable("The lifecycle provider attempt could not be resolved.");
      return {
        work,
        booking: {
          id: row.id,
          businessId: row.business_id,
          status: row.status,
          fulfilmentMode: row.fulfilment_mode,
          classId: row.provider_class_id,
          clientId: row.provider_client_id,
          clientUniqueId: row.provider_client_unique_id,
          visitId: row.provider_visit_id,
          waitlistEntryId: row.provider_waitlist_entry_id,
          serviceProductId: row.provider_service_product_id,
          clientServiceId: row.provider_client_service_id,
          cancellationStatus: row.cancellation_status,
          restorationStatus: row.restoration_status,
          restorationBaseline: row.restoration_baseline_observed_at ? {
            status: "observed",
            clientServiceId: row.provider_client_service_id,
            current: row.restoration_baseline_current,
            returned: row.restoration_baseline_returned,
            unlimited: row.restoration_baseline_unlimited,
            remaining: row.restoration_baseline_remaining == null
              ? null
              : Number(row.restoration_baseline_remaining),
          } : null,
          integrationId: quoteRow.integration_id,
        },
        attempt: { id: attempts[0].id, type: attempts[0].attempt_type, status: attempts[0].status },
      };
    },

    async finishLifecycle({ id, status, errorCode = null }) {
      const { error } = await supabase.rpc("finish_class_lifecycle_reconciliation", {
        candidate_queue_id: id,
        candidate_status: status,
        candidate_error_code: errorCode,
      });
      if (error) throw unavailable("Class lifecycle work could not be completed.");
    },

    async reconcileCancellationFromRead(context, observation) {
      const { error } = await supabase.rpc("reconcile_class_booking_cancellation_from_read", {
        candidate_business_id: context.booking.businessId,
        candidate_booking_id: context.booking.id,
        candidate_attempt_id: context.attempt.id,
        candidate_authoritative_cancelled: observation.authoritativeCancelled === true,
        candidate_error_code: observation.errorCode ?? null,
      });
      if (error) throw unavailable("The authoritative cancellation read could not be persisted.");
    },

    async recordEntitlementRestoration(context, observation) {
      const { error } = await supabase.rpc("record_class_entitlement_restoration_read", {
        candidate_business_id: context.booking.businessId,
        candidate_booking_id: context.booking.id,
        candidate_restoration_status: observation.status,
        candidate_error_code: observation.errorCode ?? null,
      });
      if (error) throw unavailable("The entitlement restoration read could not be persisted.");
    },

    async completeBookingReconciliation(context, observation) {
      const { error } = await supabase.rpc("complete_class_booking_reconciliation", {
        candidate_business_id: context.booking.businessId,
        candidate_booking_id: context.booking.id,
        candidate_attempt_id: context.attempt.id,
        candidate_booking_status: observation.status,
        candidate_provider_visit_id: observation.visitId ?? null,
        candidate_provider_roster_booking_id: observation.rosterBookingId ?? null,
        candidate_provider_waitlist_entry_id: observation.waitlistEntryId ?? null,
        candidate_provider_client_service_id: observation.clientServiceId ?? null,
        candidate_provider_service_product_id: observation.serviceProductId ?? null,
        candidate_provider_sale_id: observation.saleId ?? null,
        candidate_provider_cart_id: observation.cartId ?? null,
        candidate_provider_transaction_id: observation.transactionId ?? null,
        candidate_provider_payment_id: observation.paymentId ?? null,
        candidate_error_code: observation.errorCode ?? null,
      });
      if (error) throw unavailable("The authoritative Booking read could not be persisted.");
    },
  });
}

export { publicCancellation };

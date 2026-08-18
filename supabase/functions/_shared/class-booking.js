export class BookingOrchestrationError extends Error {
  constructor(code, message, status = 409, details = {}) {
    super(message);
    this.name = "BookingOrchestrationError";
    this.code = code;
    this.status = status;
    this.certainty = details.certainty ?? null;
    this.providerErrorCode = details.providerErrorCode ?? null;
  }
}

const MODES = new Map([
  ["purchase_pricing_option", "purchase_booking"],
  ["existing_entitlement", "existing_entitlement_booking"],
  ["approved_unpaid", "approved_unpaid_booking"],
]);

function requiredText(value, code, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BookingOrchestrationError(code, message, 422);
  }
  return value.trim();
}

function validateBinding(input, now) {
  const quote = input?.quote;
  const context = input?.context;
  if (!quote || !context || !input?.customer?.id) {
    throw new BookingOrchestrationError("BOOKING_CONTEXT_INVALID", "The Class Booking context is incomplete.", 500);
  }
  if (quote.customerId !== input.customer.id
    || quote.businessId !== context.business?.id
    || quote.offerId !== context.offer?.id
    || quote.mappingId !== context.mapping?.id
    || quote.mappingVersion !== context.mapping?.version
    || quote.locationId !== context.location?.id
    || quote.fulfilmentMode !== context.offer?.fulfilmentMode) {
    throw new BookingOrchestrationError("QUOTE_BINDING_CHANGED", "The Booking quote no longer matches this Revvi Customer or Offer.", 409);
  }
  if (quote.status !== "open") {
    throw new BookingOrchestrationError("QUOTE_NOT_OPEN", "This Booking quote has already been used.", 409);
  }
  const expiresAt = new Date(quote.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new BookingOrchestrationError("QUOTE_EXPIRED", "This Booking quote expired. Select the Class again.", 409);
  }
  if (context.mapping.modeEvidenceVerified !== true) {
    throw new BookingOrchestrationError("FULFILMENT_MODE_NOT_VERIFIED", "This Offer mode has not passed its controlled Mindbody verification.", 503);
  }
  if (!MODES.has(quote.fulfilmentMode)) {
    throw new BookingOrchestrationError("FULFILMENT_MODE_UNSUPPORTED", "This Offer has an unsupported fulfilment mode.", 503);
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function providerReferences(result = {}) {
  return {
    providerVisitId: result.visitId ?? null,
    providerRosterBookingId: result.rosterBookingId ?? null,
    providerWaitlistEntryId: result.waitlistEntryId ?? null,
    providerClientServiceId: result.clientServiceId ?? null,
    providerServiceProductId: result.serviceProductId ?? null,
    providerSaleId: result.saleId ?? null,
    providerCartId: result.cartId ?? null,
    providerTransactionId: result.transactionId ?? null,
    providerPaymentId: result.paymentId ?? null,
  };
}

function isSandboxCash(context) {
  return context?.integration?.environment === "sandbox"
    && context.integration.providerSiteId === "-99"
    && context?.location?.providerLocationId === "1"
    && context?.mapping?.paidPaymentRoute === "mindbody_sandbox_cash"
    && context.mapping.sandboxDemoWriteEnabled === true;
}

function hasConfirmationEvidence(result, quote, context) {
  if (quote?.fulfilmentMode === "approved_unpaid") {
    return Boolean(result?.visitId || result?.rosterBookingId);
  }
  if (quote?.fulfilmentMode === "purchase_pricing_option") {
    const transactionEvidence = result?.transactionId
      || (isSandboxCash(context) && result?.paymentType === "Cash");
    return Boolean(
      (result?.visitId || result?.rosterBookingId)
      && result?.clientServiceId
      && result?.atomicCheckoutConfirmed === true
      && result?.saleId
      && result?.cartId
      && transactionEvidence
      && result?.paymentId,
    );
  }
  return Boolean(result?.visitId
    || result?.rosterBookingId
    || (result?.atomicCheckoutConfirmed === true && result?.saleId && result?.transactionId));
}

function modeEvidenceMatches(result, quote) {
  if (quote?.fulfilmentMode === "existing_entitlement") {
    return result?.clientServiceId != null
      && String(result.clientServiceId) === String(quote.providerClientServiceId);
  }
  if (quote?.fulfilmentMode === "approved_unpaid") {
    return result?.clientServiceId == null
      && result?.serviceProductId == null
      && result?.saleId == null
      && result?.cartId == null
      && result?.transactionId == null
      && result?.paymentId == null;
  }
  if (quote?.fulfilmentMode === "purchase_pricing_option") {
    return result?.serviceProductId != null
      && String(result.serviceProductId) === String(quote.providerServiceProductId)
      && result?.clientServiceId != null;
  }
  return true;
}

function normalizeProviderOutcome(result, quote, context) {
  if (quote?.fulfilmentMode !== "approved_unpaid"
    && result?.status === "waitlisted" && result.waitlistEntryId) {
    return { status: "waitlisted", attemptStatus: "confirmed", certainty: "provider_confirmed" };
  }
  if (result?.status === "confirmed"
    && result.certainty === "provider_confirmed"
    && hasConfirmationEvidence(result, quote, context)
    && modeEvidenceMatches(result, quote)) {
    return { status: "confirmed", attemptStatus: "confirmed", certainty: "provider_confirmed" };
  }
  if (result?.status === "requires_action"
    && result?.certainty === "provider_confirmed"
    && result?.requiredAction?.type === "redirect"
    && /^https:\/\//i.test(result.requiredAction.url ?? "")) {
    return { status: "requires_action", attemptStatus: "requires_action", certainty: "provider_confirmed" };
  }
  if (result?.status === "failed" && result?.certainty === "provider_rejected") {
    return { status: "failed", attemptStatus: "failed", certainty: "provider_rejected" };
  }
  return { status: "unknown", attemptStatus: "unknown", certainty: "unknown" };
}

function publicResult(stored) {
  return {
    booking: stored.booking,
    attempt: stored.attempt,
  };
}

async function persistOutcome(claim, outcome, result, input, dependencies) {
  const unknown = outcome.status === "unknown";
  const paidPaymentStatus = result?.paymentStatus ?? ({
    confirmed: "paid",
    requires_action: "requires_action",
    failed: "failed",
    unknown: "unknown",
  }[outcome.status] ?? "unknown");
  const stored = await dependencies.catalogue.completeAttempt({
    businessId: input.quote.businessId,
    bookingId: claim.booking.id,
    attemptId: claim.attempt.id,
    writeToken: claim.writeToken,
    status: outcome.status,
    attemptStatus: outcome.attemptStatus,
    paymentStatus: input.quote.fulfilmentMode === "purchase_pricing_option" ? paidPaymentStatus : "not_required",
    providerRequestId: result?.providerRequestId ?? null,
    providerReferences: providerReferences(result),
    requiredAction: outcome.status === "requires_action" ? result.requiredAction : null,
    paymentAction: outcome.status === "requires_action" ? result.paymentAction : null,
    errorCode: result?.errorCode ?? null,
    errorMessage: result?.errorMessage ?? null,
    releaseWriteLock: !new Set(["unknown", "requires_action"]).has(outcome.status),
  });
  if (unknown) {
    await dependencies.catalogue.enqueueReconciliation({
      businessId: input.quote.businessId,
      bookingId: claim.booking.id,
      attemptId: claim.attempt.id,
      reasonCode: result?.errorCode ?? "PROVIDER_OUTCOME_UNKNOWN",
    });
  }
  return publicResult(stored);
}

export async function createClassBooking(input, dependencies) {
  const idempotencyKey = requiredText(
    input?.idempotencyKey,
    "INVALID_IDEMPOTENCY_KEY",
    "A Class Booking idempotency key is required.",
  );
  const existing = await dependencies.catalogue.findAttempt({
    customerId: input?.customer?.id,
    idempotencyKey,
  });
  if (existing) return publicResult(existing);

  const now = dependencies.now();
  validateBinding(input, now);
  const revalidated = await dependencies.revalidateQuote({ quote: input.quote, context: input.context });
  if (typeof dependencies.validateWriteConfiguration === "function") {
    await dependencies.validateWriteConfiguration({ quote: input.quote, context: input.context });
  }
  if (typeof dependencies.authorizeWrite === "function") await dependencies.authorizeWrite();
  const requestFingerprint = await sha256(JSON.stringify({
    quoteFingerprint: input.quote.quoteFingerprint,
    customerId: input.customer.id,
    classId: input.quote.classId,
    fulfilmentMode: input.quote.fulfilmentMode,
    clientServiceId: input.quote.providerClientServiceId,
    serviceProductId: input.quote.providerServiceProductId,
  }));
  const claim = await dependencies.catalogue.claimAttempt({
    quote: input.quote,
    occurrence: revalidated.occurrence,
    idempotencyKey,
    requestFingerprint,
    attemptType: MODES.get(input.quote.fulfilmentMode),
  });
  if (!claim?.shouldWrite) return publicResult(claim);

  let result;
  try {
    const provider = typeof dependencies.createProvider === "function"
      ? await dependencies.createProvider({ booking: claim.booking, attempt: claim.attempt })
      : dependencies.provider;
    result = await provider.createBooking({
      mode: input.quote.fulfilmentMode,
      siteId: input.quote.providerSiteId,
      locationId: input.quote.providerLocationId,
      classId: input.quote.classId,
      clientId: input.quote.providerClientId,
      uniqueClientId: input.quote.providerClientUniqueId,
      clientServiceId: input.quote.providerClientServiceId,
      serviceProductId: input.quote.providerServiceProductId,
      priceAmount: input.quote.grandTotal,
      currency: input.quote.currency,
      idempotencyKey,
    });
  } catch (error) {
    const rejected = error?.certainty === "provider_rejected";
    const observedProviderResult = !rejected && error?.providerResult
      && typeof error.providerResult === "object"
      ? error.providerResult
      : {};
    result = {
      ...observedProviderResult,
      status: rejected ? "failed" : "unknown",
      certainty: rejected ? "provider_rejected" : "unknown",
      errorCode: error?.providerErrorCode ?? error?.code ?? (rejected ? "PROVIDER_REJECTED" : "PROVIDER_OUTCOME_UNKNOWN"),
      errorMessage: rejected ? "Mindbody rejected the Class Booking." : "Mindbody may have accepted the Class Booking.",
    };
  }
  if (result?.status === "requires_action") {
    try {
      if (!result.providerAccessToken
        || result.paymentRoute !== "mindbody_alternative_payment"
        || typeof dependencies.sealPaymentAction !== "function") {
        throw new Error("The provider payment action is incomplete.");
      }
      const actionContext = {
        businessId: input.quote.businessId,
        bookingId: claim.booking.id,
        attemptId: claim.attempt.id,
        route: result.paymentRoute,
      };
      const sealed = await dependencies.sealPaymentAction(result.providerAccessToken, actionContext);
      result = {
        ...result,
        providerAccessToken: undefined,
        paymentAction: { ...sealed, ...actionContext },
      };
    } catch {
      result = {
        status: "unknown",
        certainty: "unknown",
        serviceProductId: input.quote.providerServiceProductId,
        errorCode: "PAYMENT_ACTION_PERSISTENCE_UNAVAILABLE",
        errorMessage: "Mindbody may be waiting for Revvi Customer payment action.",
      };
    }
  }
  return persistOutcome(
    claim,
    normalizeProviderOutcome(result, input.quote, input.context),
    result,
    input,
    dependencies,
  );
}

export async function reconcileClassBooking(input, dependencies) {
  if (!input?.booking?.id || !input?.attempt?.id || !input?.quote?.id) {
    throw new BookingOrchestrationError("RECONCILIATION_CONTEXT_INVALID", "The Class Booking reconciliation context is incomplete.", 500);
  }
  if (!new Set(["pending", "unknown"]).has(input.booking.status)
    || !new Set(["pending", "unknown"]).has(input.attempt.status)) {
    return { booking: input.booking, attempt: input.attempt };
  }
  let result;
  try {
    result = await dependencies.provider.reconcileBooking({
      siteId: input.quote.providerSiteId,
      classId: input.quote.classId,
      clientId: input.quote.providerClientId,
      uniqueClientId: input.quote.providerClientUniqueId,
      clientServiceId: input.quote.providerClientServiceId,
      serviceProductId: input.quote.providerServiceProductId,
      mode: input.quote.fulfilmentMode,
      saleId: input.booking.providerSaleId,
      transactionId: input.booking.providerTransactionId,
      webhookEvidence: input.webhookEvidence,
    });
  } catch {
    return { booking: input.booking, attempt: input.attempt };
  }
  const outcome = normalizeProviderOutcome(result, input.quote);
  if (outcome.status === "unknown") {
    const references = providerReferences(result);
    const hasObservation = result?.errorCode != null
      || Object.values(references).some((value) => value != null);
    if (!hasObservation || typeof dependencies.catalogue.recordReconciliationObservation !== "function") {
      return { booking: input.booking, attempt: input.attempt };
    }
    return dependencies.catalogue.recordReconciliationObservation({
      businessId: input.quote.businessId,
      bookingId: input.booking.id,
      attemptId: input.attempt.id,
      writeToken: input.writeToken,
      providerReferences: references,
      errorCode: result?.errorCode ?? null,
    });
  }
  if (outcome.status === "requires_action") {
    return { booking: input.booking, attempt: input.attempt };
  }
  return dependencies.catalogue.completeReconciliation({
    businessId: input.quote.businessId,
    bookingId: input.booking.id,
    attemptId: input.attempt.id,
    writeToken: input.writeToken,
    status: outcome.status,
    providerReferences: providerReferences(result),
    errorCode: result?.errorCode ?? null,
  });
}

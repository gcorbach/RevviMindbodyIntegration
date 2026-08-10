export class ClassPaidBookingCompletionError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "ClassPaidBookingCompletionError";
    this.code = code;
    this.status = status;
  }
}

function references(value) {
  return {
    providerVisitId: value?.visitId ?? null,
    providerRosterBookingId: value?.rosterBookingId ?? null,
    providerClientServiceId: value?.clientServiceId ?? null,
    providerServiceProductId: value?.serviceProductId ?? null,
    providerSaleId: value?.saleId ?? null,
    providerCartId: value?.cartId ?? null,
    providerTransactionId: value?.transactionId ?? null,
    providerPaymentId: value?.paymentId ?? null,
  };
}

function authoritativePaidSuccess(value, booking) {
  return value?.status === "confirmed"
    && value?.certainty === "provider_confirmed"
    && value?.atomicCheckoutConfirmed === true
    && Boolean(value?.visitId || value?.rosterBookingId)
    && Boolean(value?.clientServiceId)
    && Boolean(value?.saleId)
    && Boolean(value?.cartId)
    && Boolean(value?.transactionId)
    && Boolean(value?.paymentId)
    && String(value?.serviceProductId) === String(booking.providerServiceProductId);
}

export async function completeClassPaidBooking(input, dependencies) {
  const claim = await dependencies.catalogue.claimCompletion(input);
  if (claim.shouldComplete !== true) {
    return {
      booking: claim.actionStatus === "completing"
        ? { ...claim.booking, status: "unknown", paymentStatus: "unknown" }
        : claim.booking,
      attempt: claim.attempt,
    };
  }

  const finalize = (facts) => dependencies.catalogue.finalizeCompletion({
    businessId: claim.booking.businessId,
    bookingId: claim.booking.id,
    attemptId: claim.attempt.id,
    completionToken: claim.completionToken,
    ...facts,
  });

  let providerAccessToken;
  try {
    providerAccessToken = await dependencies.openPaymentAction({
      ciphertext: claim.action.accessTokenCiphertext,
      nonce: claim.action.accessTokenNonce,
      keyVersion: claim.action.encryptionKeyVersion,
    }, {
      businessId: claim.booking.businessId,
      bookingId: claim.booking.id,
      attemptId: claim.attempt.id,
      route: claim.action.paymentRoute,
    });
  } catch {
    return finalize({
      outcome: "unknown",
      errorCode: "PAYMENT_ACTION_TOKEN_UNAVAILABLE",
      providerReferences: references(),
    });
  }

  let provider;
  try {
    provider = await dependencies.createProvider(claim);
  } catch (error) {
    return finalize({
      outcome: "unknown",
      errorCode: error?.code ?? "PAYMENT_PROVIDER_SETUP_FAILED",
      providerReferences: references(),
    });
  }

  let completion;
  try {
    completion = await provider.completePaidBooking({
      paymentRoute: claim.action.paymentRoute,
      providerAccessToken,
      clientId: claim.booking.providerClientId,
    });
  } catch (error) {
    return finalize({
      outcome: "unknown",
      errorCode: error?.code ?? "PAYMENT_COMPLETION_UNKNOWN",
      providerRequestId: error?.diagnostic?.providerRequestId ?? null,
      providerReferences: references(),
    });
  }

  let observation;
  try {
    observation = await provider.reconcileBooking({
      mode: "purchase_pricing_option",
      siteId: claim.booking.providerSiteId,
      classId: claim.booking.providerClassId,
      clientId: claim.booking.providerClientId,
      uniqueClientId: claim.booking.providerClientUniqueId,
      serviceProductId: claim.booking.providerServiceProductId,
      saleId: completion?.saleId ?? null,
      cartId: completion?.cartId ?? null,
      transactionId: completion?.transactionId ?? null,
      paymentId: completion?.paymentId ?? null,
    });
  } catch (error) {
    return finalize({
      outcome: "unknown",
      errorCode: error?.code ?? "PAYMENT_RECONCILIATION_UNAVAILABLE",
      providerReferences: references(completion),
    });
  }

  if (authoritativePaidSuccess(observation, claim.booking)) {
    return finalize({
      outcome: "confirmed",
      errorCode: null,
      providerReferences: references(observation),
    });
  }
  return finalize({
    outcome: "unknown",
    errorCode: observation?.errorCode ?? "PAID_PURCHASE_AND_ROSTER_EVIDENCE_INCOMPLETE",
    providerReferences: references({ ...completion, ...observation }),
  });
}

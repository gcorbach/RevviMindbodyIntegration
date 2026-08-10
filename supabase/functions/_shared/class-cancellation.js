import { MindbodyClassBookingError } from "./mindbody-class-booking.js";

export class ClassCancellationError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "ClassCancellationError";
    this.code = code;
    this.status = status;
  }
}

function cancellationInput(claim) {
  const booking = claim.booking;
  const waitlist = claim.attempt.type === "waitlist_removal";
  return {
    removalType: waitlist ? "waitlist" : "roster",
    classId: booking.providerClassId,
    clientId: booking.providerClientId,
    clientUniqueId: booking.providerClientUniqueId,
    ...(waitlist
      ? { waitlistEntryId: booking.providerWaitlistEntryId }
      : { visitId: booking.providerVisitId }),
  };
}

function storedCancellation(claim) {
  const booking = claim.booking;
  return {
    bookingId: booking.id,
    status: booking.status === "cancel_pending" ? "unknown" : booking.status,
    cancelledAt: booking.cancelledAt ?? null,
    passRestoration: booking.passRestoration ?? "unknown",
    refund: booking.refund ?? "not_requested",
  };
}

export async function cancelClassBooking(input, dependencies) {
  const claim = await dependencies.catalogue.claimCancellation(input);
  if (claim.shouldWrite !== true) return storedCancellation(claim);
  const reconciliationInput = cancellationInput(claim);
  let restorationBaseline = null;
  const finalize = (facts) => dependencies.catalogue.finalizeCancellation({
    businessId: claim.booking.businessId,
    bookingId: claim.booking.id,
    attemptId: claim.attempt.id,
    writeToken: claim.writeToken,
    restorationStatus: claim.booking.fulfilmentMode === "existing_entitlement" ? "unknown" : null,
    ...facts,
  });

  let provider;
  try {
    provider = await dependencies.createProvider(claim);
  } catch (error) {
    return finalize({
      outcome: "unknown",
      authoritativeCancelled: false,
      errorCode: error?.code ?? "CANCELLATION_PROVIDER_SETUP_FAILED",
    });
  }

  const restoration = async () => {
    if (claim.booking.fulfilmentMode !== "existing_entitlement") return null;
    try {
      return await provider.reconcileEntitlementRestoration({
        classId: claim.booking.providerClassId,
        clientId: claim.booking.providerClientId,
        clientServiceId: claim.booking.providerClientServiceId,
        baseline: restorationBaseline,
      });
    } catch (error) {
      return {
        status: "unknown",
        errorCode: error?.code ?? "ENTITLEMENT_RESTORATION_READ_UNAVAILABLE",
      };
    }
  };

  let before;
  try {
    before = await provider.reconcileCancellation(reconciliationInput);
  } catch (error) {
    return finalize({
      outcome: "unknown",
      authoritativeCancelled: false,
      errorCode: error?.code ?? "CANCELLATION_PREWRITE_STATE_UNKNOWN",
    });
  }
  if (before.status === "cancelled" && before.authoritativeCancelled === true) {
    const pass = await restoration();
    return finalize({
      outcome: "confirmed",
      authoritativeCancelled: true,
      restorationStatus: pass?.status ?? null,
      restorationErrorCode: pass?.errorCode ?? null,
    });
  }
  if (before.status !== "active") {
    return finalize({
      outcome: "unknown",
      authoritativeCancelled: false,
      errorCode: before.errorCode ?? "CANCELLATION_PREWRITE_STATE_UNKNOWN",
    });
  }

  if (claim.booking.fulfilmentMode === "existing_entitlement") {
    try {
      const baseline = await provider.readEntitlementState({
        classId: claim.booking.providerClassId,
        clientId: claim.booking.providerClientId,
        clientServiceId: claim.booking.providerClientServiceId,
      });
      restorationBaseline = baseline?.status === "observed" ? baseline : null;
      if (restorationBaseline) {
        await dependencies.catalogue.persistEntitlementRestorationBaseline({
          businessId: claim.booking.businessId,
          bookingId: claim.booking.id,
          attemptId: claim.attempt.id,
          writeToken: claim.writeToken,
          baseline: restorationBaseline,
        });
      }
    } catch {
      if (restorationBaseline) throw new ClassCancellationError(
        "RESTORATION_BASELINE_PERSISTENCE_FAILED",
        "The Class cancellation could not preserve its entitlement baseline safely.",
        503,
      );
      restorationBaseline = null;
    }
  }

  try {
    await provider.cancelBooking(reconciliationInput);
  } catch (error) {
    if (error instanceof MindbodyClassBookingError && error.certainty === "provider_rejected") {
      return finalize({
        outcome: "failed",
        authoritativeCancelled: false,
        errorCode: error.code ?? "CANCELLATION_PROVIDER_REJECTED",
      });
    }
    return finalize({
      outcome: "unknown",
      authoritativeCancelled: false,
      errorCode: error?.code ?? "CANCELLATION_STATUS_UNKNOWN",
    });
  }

  let after;
  try {
    after = await provider.reconcileCancellation(reconciliationInput);
  } catch (error) {
    return finalize({
      outcome: "unknown",
      authoritativeCancelled: false,
      errorCode: error?.code ?? "CANCELLATION_POSTWRITE_STATE_UNKNOWN",
    });
  }
  if (after.status === "cancelled" && after.authoritativeCancelled === true) {
    const pass = await restoration();
    return finalize({
      outcome: "confirmed",
      authoritativeCancelled: true,
      restorationStatus: pass?.status ?? null,
      restorationErrorCode: pass?.errorCode ?? null,
    });
  }
  return finalize({
    outcome: "unknown",
    authoritativeCancelled: false,
    errorCode: after.errorCode ?? "CANCELLATION_NOT_YET_OBSERVED",
  });
}

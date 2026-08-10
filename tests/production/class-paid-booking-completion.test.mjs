import assert from "node:assert/strict";
import test from "node:test";

import { completeClassPaidBooking } from "../../supabase/functions/_shared/class-paid-booking-completion.js";
import { MindbodyClassBookingError } from "../../supabase/functions/_shared/mindbody-class-booking.js";

const claim = Object.freeze({
  shouldComplete: true,
  completionToken: "c".repeat(64),
  booking: {
    id: "booking-a", businessId: "business-a", status: "requires_action",
    paymentStatus: "requires_action", fulfilmentMode: "purchase_pricing_option",
    providerSiteId: "-99", providerClassId: "771", providerClientId: "rss-1",
    providerClientUniqueId: "41", providerServiceProductId: "product-1",
    priceAmount: 115, currency: "ZAR", integrationId: "integration-a",
  },
  attempt: { id: "attempt-a", status: "requires_action" },
  action: {
    id: "action-a", paymentRoute: "mindbody_alternative_payment",
    accessTokenCiphertext: "sealed", accessTokenNonce: "nonce",
    encryptionKeyVersion: "payment-action-v1",
  },
});

function dependencies() {
  const calls = { completionWrites: 0, reads: 0, finalizations: [] };
  const provider = {
    async completePaidBooking(input) {
      calls.completionWrites += 1;
      assert.equal(input.providerAccessToken, "opaque-provider-token");
      assert.equal(input.clientId, "rss-1");
      return {
        status: "accepted", certainty: "unverified",
        saleId: "sale-1", cartId: "cart-1",
        transactionId: "transaction-1", paymentId: "payment-1",
      };
    },
    async reconcileBooking(input) {
      calls.reads += 1;
      assert.equal(input.mode, "purchase_pricing_option");
      assert.equal(input.saleId, "sale-1");
      assert.equal(input.cartId, "cart-1");
      assert.equal(input.transactionId, "transaction-1");
      assert.equal(input.paymentId, "payment-1");
      return {
        status: "confirmed", certainty: "provider_confirmed",
        atomicCheckoutConfirmed: true,
        visitId: "visit-1", rosterBookingId: "roster-1",
        clientServiceId: "client-service-1", serviceProductId: "product-1",
        saleId: "sale-1", cartId: "cart-1", transactionId: "transaction-1", paymentId: "payment-1",
      };
    },
  };
  return {
    catalogue: {
      claimCompletion: async () => claim,
      finalizeCompletion: async (facts) => {
        calls.finalizations.push(facts);
        return {
          booking: { id: "booking-a", status: facts.outcome, paymentStatus: facts.outcome === "confirmed" ? "paid" : facts.outcome },
          attempt: { id: "attempt-a", status: facts.outcome },
        };
      },
    },
    createProvider: async () => provider,
    openPaymentAction: async (sealed, context) => {
      assert.deepEqual(sealed, {
        ciphertext: "sealed", nonce: "nonce", keyVersion: "payment-action-v1",
      });
      assert.deepEqual(context, {
        businessId: "business-a", bookingId: "booking-a", attemptId: "attempt-a",
        route: "mindbody_alternative_payment",
      });
      return "opaque-provider-token";
    },
    calls,
  };
}

test("paid completion writes once then confirms only after authoritative purchase and roster reads", async () => {
  const deps = dependencies();
  const result = await completeClassPaidBooking({
    bookingId: "booking-a", customerId: "customer-a",
  }, deps);

  assert.equal(deps.calls.completionWrites, 1);
  assert.equal(deps.calls.reads, 1);
  assert.equal(deps.calls.finalizations.length, 1);
  assert.equal(deps.calls.finalizations[0].outcome, "confirmed");
  assert.equal(deps.calls.finalizations[0].providerReferences.providerSaleId, "sale-1");
  assert.equal(result.booking.status, "confirmed");
  assert.equal(result.booking.paymentStatus, "paid");
});

test("a repeated return never calls Mindbody completion or reconciliation again", async () => {
  const deps = dependencies();
  deps.catalogue.claimCompletion = async () => ({
    shouldComplete: false,
    actionStatus: "completing",
    booking: { id: "booking-a", status: "requires_action", paymentStatus: "requires_action" },
    attempt: { id: "attempt-a", status: "requires_action" },
  });
  const result = await completeClassPaidBooking({
    bookingId: "booking-a", customerId: "customer-a",
  }, deps);
  assert.equal(deps.calls.completionWrites, 0);
  assert.equal(deps.calls.reads, 0);
  assert.equal(deps.calls.finalizations.length, 0);
  assert.equal(result.booking.status, "unknown");
});

test("a callback or completion response alone remains unknown without authoritative combined evidence", async () => {
  const deps = dependencies();
  const provider = await deps.createProvider();
  provider.reconcileBooking = async () => {
    deps.calls.reads += 1;
    return {
      status: "unknown", certainty: "unknown", saleId: "sale-response",
      transactionId: "transaction-response", errorCode: "PAID_PURCHASE_AND_ROSTER_EVIDENCE_INCOMPLETE",
    };
  };
  deps.createProvider = async () => provider;
  const result = await completeClassPaidBooking({
    bookingId: "booking-a", customerId: "customer-a",
  }, deps);
  assert.equal(deps.calls.completionWrites, 1);
  assert.equal(deps.calls.finalizations[0].outcome, "unknown");
  assert.equal(deps.calls.finalizations[0].errorCode, "PAID_PURCHASE_AND_ROSTER_EVIDENCE_INCOMPLETE");
  assert.equal(result.booking.status, "unknown");
});

test("ambiguous provider completion is retained as unknown and cannot be retried", async () => {
  const deps = dependencies();
  const provider = await deps.createProvider();
  provider.completePaidBooking = async () => {
    deps.calls.completionWrites += 1;
    throw new MindbodyClassBookingError(
      "timed out", { errorCode: "TIMEOUT" }, undefined,
      { code: "TIMEOUT", certainty: "unknown" },
    );
  };
  deps.createProvider = async () => provider;
  const result = await completeClassPaidBooking({
    bookingId: "booking-a", customerId: "customer-a",
  }, deps);
  assert.equal(deps.calls.completionWrites, 1);
  assert.equal(deps.calls.reads, 0);
  assert.equal(deps.calls.finalizations[0].outcome, "unknown");
  assert.equal(result.booking.status, "unknown");
});

test("an unproven provider rejection remains unknown because the write may have partially succeeded", async () => {
  const deps = dependencies();
  const provider = await deps.createProvider();
  provider.completePaidBooking = async () => {
    deps.calls.completionWrites += 1;
    throw new MindbodyClassBookingError(
      "declined", { errorCode: "HTTP_400", statusCode: 400 }, undefined,
      { code: "HTTP_400", certainty: "provider_rejected" },
    );
  };
  deps.createProvider = async () => provider;
  const result = await completeClassPaidBooking({
    bookingId: "booking-a", customerId: "customer-a",
  }, deps);
  assert.equal(deps.calls.finalizations[0].outcome, "unknown");
  assert.equal(deps.calls.reads, 0);
  assert.equal(result.booking.status, "unknown");
});

test("a sealed-token failure stops before Mindbody and retains an auditable unknown outcome", async () => {
  const deps = dependencies();
  deps.openPaymentAction = async () => { throw new Error("cannot decrypt"); };
  const result = await completeClassPaidBooking({
    bookingId: "booking-a", customerId: "customer-a",
  }, deps);
  assert.equal(deps.calls.completionWrites, 0);
  assert.equal(deps.calls.finalizations[0].outcome, "unknown");
  assert.equal(deps.calls.finalizations[0].errorCode, "PAYMENT_ACTION_TOKEN_UNAVAILABLE");
  assert.equal(result.booking.status, "unknown");
});

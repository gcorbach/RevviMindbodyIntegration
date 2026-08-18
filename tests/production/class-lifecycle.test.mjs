import assert from "node:assert/strict";
import test from "node:test";

import { cancelClassBooking } from "../../supabase/functions/_shared/class-cancellation.js";
import {
  handleCancelClassBooking,
  handleUpcomingClassBookings,
} from "../../supabase/functions/_shared/class-lifecycle-handler.js";
import { runClassLifecycleWorker } from "../../supabase/functions/_shared/class-lifecycle-worker.js";
import { MindbodyClassBookingError } from "../../supabase/functions/_shared/mindbody-class-booking.js";

const bookingId = "39000000-0000-4000-8000-000000000001";

function claim(overrides = {}) {
  return {
    shouldWrite: true,
    writeToken: "a".repeat(64),
    booking: {
      id: bookingId,
      businessId: "business-39",
      integrationId: "integration-39",
      fulfilmentMode: "existing_entitlement",
      providerClassId: "771",
      providerClientId: "rss-39",
      providerClientUniqueId: "unique-39",
      providerVisitId: "visit-39",
      providerWaitlistEntryId: null,
      providerClientServiceId: "service-39",
      ...overrides,
    },
    attempt: { id: "attempt-39", type: "cancellation", status: "pending" },
  };
}

function cancellationDependencies(provider, claimed = claim()) {
  const finalized = [];
  return {
    finalized,
    dependencies: {
      catalogue: {
        claimCancellation: async () => claimed,
        persistEntitlementRestorationBaseline: async () => {},
        finalizeCancellation: async (facts) => {
          finalized.push(facts);
          return {
            bookingId: facts.bookingId,
            status: facts.outcome === "confirmed" ? "cancelled" : facts.outcome,
            cancelledAt: facts.outcome === "confirmed" ? "2026-08-10T12:00:00Z" : null,
            passRestoration: "unknown",
            refund: "not_requested",
          };
        },
      },
      createProvider: async () => provider,
    },
  };
}

test("cancellation writes once and confirms only after an authoritative provider read", async () => {
  let reads = 0;
  let writes = 0;
  const order = [];
  const provider = {
    reconcileCancellation: async () => (++reads === 1
      ? { status: "active", certainty: "provider_confirmed" }
      : { status: "cancelled", certainty: "provider_confirmed", authoritativeCancelled: true }),
    readEntitlementState: async () => ({
      status: "observed", clientServiceId: "service-39", current: true,
      returned: false, unlimited: false, remaining: 0, observedAt: "2026-08-10T11:59:00Z",
    }),
    reconcileEntitlementRestoration: async () => ({ status: "confirmed", clientServiceId: "service-39" }),
    cancelBooking: async () => { order.push("write"); writes += 1; return { status: "accepted" }; },
  };
  const { dependencies, finalized } = cancellationDependencies(provider);
  dependencies.catalogue.persistEntitlementRestorationBaseline = async (facts) => {
    assert.equal(facts.baseline.observedAt, "2026-08-10T11:59:00Z");
    order.push("persist-baseline");
  };
  const result = await cancelClassBooking({ bookingId, customerId: "customer-39", reason: "Customer requested it" }, dependencies);
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  assert.equal(result.status, "cancelled");
  assert.equal(finalized[0].authoritativeCancelled, true);
  assert.equal(finalized[0].restorationStatus, "confirmed");
  assert.deepEqual(order, ["persist-baseline", "write"]);
});

test("the Site -99 Cash demo records exact ClientService restoration separately from cancellation", async () => {
  const paidClaim = claim({ fulfilmentMode: "purchase_pricing_option" });
  const provider = {
    reconcileCancellation: (() => {
      let reads = 0;
      return async () => (++reads === 1
        ? { status: "active" }
        : { status: "cancelled", authoritativeCancelled: true });
    })(),
    readEntitlementState: async () => ({
      status: "observed", clientServiceId: "service-39", current: false,
      returned: false, unlimited: false, remaining: 0, observedAt: "2026-08-10T11:59:00Z",
    }),
    reconcileEntitlementRestoration: async ({ baseline }) => {
      assert.equal(baseline.remaining, 0);
      return { status: "confirmed", clientServiceId: "service-39" };
    },
    cancelBooking: async () => ({ status: "accepted" }),
  };
  const { dependencies } = cancellationDependencies(provider, paidClaim);
  const calls = [];
  dependencies.requiresEntitlementRestoration = async () => true;
  dependencies.catalogue.persistSandboxDemoRestorationBaseline = async () => calls.push("baseline");
  dependencies.catalogue.recordSandboxDemoRestoration = async (facts) => {
    calls.push(facts.restorationStatus);
    return { ...facts.cancellation, passRestoration: "restored" };
  };
  const result = await cancelClassBooking({ bookingId }, dependencies);
  assert.equal(result.status, "cancelled");
  assert.equal(result.passRestoration, "restored");
  assert.deepEqual(calls, ["baseline", "confirmed"]);
});

test("a baseline persistence failure prevents the provider cancellation write", async () => {
  let writes = 0;
  const provider = {
    reconcileCancellation: async () => ({ status: "active" }),
    readEntitlementState: async () => ({
      status: "observed", clientServiceId: "service-39", current: true,
      returned: false, unlimited: false, remaining: 3, observedAt: "2026-08-10T11:59:00Z",
    }),
    cancelBooking: async () => { writes += 1; },
  };
  const { dependencies } = cancellationDependencies(provider);
  dependencies.catalogue.persistEntitlementRestorationBaseline = async () => {
    throw new Error("database unavailable");
  };
  await assert.rejects(
    cancelClassBooking({ bookingId }, dependencies),
    (error) => error.code === "RESTORATION_BASELINE_PERSISTENCE_FAILED",
  );
  assert.equal(writes, 0);
});

test("provider setup failure after a cancellation claim is finalized unknown and queued", async () => {
  const finalized = [];
  const result = await cancelClassBooking({ bookingId }, {
    catalogue: {
      claimCancellation: async () => claim(),
      finalizeCancellation: async (facts) => {
        finalized.push(facts);
        return { bookingId, status: "unknown", passRestoration: "unknown", refund: "not_requested" };
      },
    },
    createProvider: async () => {
      const error = new Error("staff token missing");
      error.code = "INTEGRATION_UNAVAILABLE";
      throw error;
    },
  });
  assert.equal(result.status, "unknown");
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].outcome, "unknown");
  assert.equal(finalized[0].errorCode, "INTEGRATION_UNAVAILABLE");
});

test("unknown pre-write or write outcomes remain locked and are never replayed", async () => {
  let writes = 0;
  const unknownBefore = cancellationDependencies({
    reconcileCancellation: async () => ({ status: "unknown", errorCode: "READ_FAILED" }),
    cancelBooking: async () => { writes += 1; },
  });
  assert.equal((await cancelClassBooking({ bookingId }, unknownBefore.dependencies)).status, "unknown");
  assert.equal(writes, 0);
  assert.equal(unknownBefore.finalized[0].errorCode, "READ_FAILED");

  const readFailure = cancellationDependencies({
    reconcileCancellation: async () => { throw new Error("provider unavailable"); },
    cancelBooking: async () => { writes += 1; },
  });
  assert.equal((await cancelClassBooking({ bookingId }, readFailure.dependencies)).status, "unknown");
  assert.equal(writes, 0);
  assert.equal(readFailure.finalized[0].errorCode, "CANCELLATION_PREWRITE_STATE_UNKNOWN");

  const timeout = cancellationDependencies({
    reconcileCancellation: async () => ({ status: "active" }),
    cancelBooking: async () => {
      writes += 1;
      throw new MindbodyClassBookingError("timeout", { errorCode: "TIMEOUT" });
    },
  });
  assert.equal((await cancelClassBooking({ bookingId }, timeout.dependencies)).status, "unknown");
  assert.equal(writes, 1);
  assert.equal(timeout.finalized[0].outcome, "unknown");
});

test("an explicit provider rejection fails without claiming refund or pass restoration", async () => {
  const rejected = new MindbodyClassBookingError(
    "rejected",
    { statusCode: 409, errorCode: "HTTP_409" },
  );
  const { dependencies, finalized } = cancellationDependencies({
    reconcileCancellation: async () => ({ status: "active" }),
    cancelBooking: async () => { throw rejected; },
  });
  const result = await cancelClassBooking({ bookingId }, dependencies);
  assert.equal(result.status, "failed");
  assert.equal(result.refund, "not_requested");
  assert.equal(result.passRestoration, "unknown");
  assert.equal(finalized[0].outcome, "failed");
});

function request(path, body, token = "memberstack.jwt.signature") {
  return new Request(`https://api.example.test${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Origin: "https://revvi.example", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function handlerDependencies(overrides = {}) {
  return {
    allowedOrigins: new Set(["https://revvi.example"]),
    authorizeCustomer: async () => ({ customer: { id: "customer-39" } }),
    catalogue: {
      upcomingBookings: async ({ customerId }) => {
        assert.equal(customerId, "customer-39");
        return [{ id: bookingId, status: "confirmed", cancellationState: "requestable" }];
      },
    },
    cancelBooking: async (input) => ({
      bookingId: input.bookingId,
      status: "cancelled",
      cancelledAt: "2026-08-10T12:00:00Z",
      passRestoration: "unknown",
      refund: "not_requested",
    }),
    ...overrides,
  };
}

test("upcoming and cancellation HTTP contracts use only the authenticated Customer", async () => {
  const dependencies = handlerDependencies();
  const upcoming = await handleUpcomingClassBookings(request("/upcoming-bookings", { limit: 20 }), dependencies);
  assert.equal(upcoming.status, 200);
  assert.deepEqual((await upcoming.json()).data.bookings, [
    { id: bookingId, status: "confirmed", cancellationState: "requestable" },
  ]);

  let cancellationInput;
  dependencies.cancelBooking = async (input) => {
    cancellationInput = input;
    return { bookingId, status: "unknown", passRestoration: "unknown", refund: "not_requested" };
  };
  const cancellation = await handleCancelClassBooking(request("/cancel-booking", {
    bookingId,
    reason: "Revvi Customer requested cancellation",
  }), dependencies);
  assert.equal(cancellation.status, 202);
  assert.equal(cancellationInput.customerId, "customer-39");
  assert.equal((await cancellation.json()).data.refund, "not_requested");
});

test("the lifecycle worker processes queued webhooks and converges cancellation through reads only", async () => {
  const calls = [];
  const work = {
    id: "queue-39", businessId: "business-39", bookingId,
    purpose: "cancellation", source: "webhook", attemptCount: 1,
  };
  const context = {
    work,
    booking: {
      id: bookingId, businessId: "business-39", integrationId: "integration-39",
      classId: "771", clientId: "rss-39", visitId: "visit-39",
    },
    attempt: { id: "attempt-39", type: "cancellation" },
  };
  const catalogue = {
    claimWebhookBatch: async () => [{ id: "event-39" }],
    processWebhook: async () => { calls.push("webhook"); return 1; },
    claimLifecycleBatch: async () => [work],
    resolveLifecycleContext: async () => context,
    reconcileCancellationFromRead: async () => calls.push("reconciled"),
    finishLifecycle: async (facts) => calls.push(facts.status),
  };
  const result = await runClassLifecycleWorker({
    catalogue,
    createProvider: async () => ({
      reconcileCancellation: async () => ({ status: "cancelled", authoritativeCancelled: true }),
    }),
  });
  assert.deepEqual(calls, ["webhook", "reconciled", "completed"]);
  assert.equal(result.webhooksProcessed, 1);
  assert.equal(result.webhookBookingsQueued, 1);
});

test("the lifecycle worker re-reads and records the exact entitlement after cancellation", async () => {
  const calls = [];
  const work = {
    id: "queue-restoration-39", businessId: "business-39", bookingId,
    purpose: "cancellation", source: "manual", attemptCount: 1,
  };
  const context = {
    work,
    booking: {
      id: bookingId,
      businessId: "business-39",
      integrationId: "integration-39",
      status: "cancelled",
      cancellationStatus: "confirmed",
      fulfilmentMode: "existing_entitlement",
      classId: "771",
      clientId: "rss-39",
      clientServiceId: "service-39",
      restorationBaseline: {
        status: "observed", clientServiceId: "service-39", current: true,
        returned: false, unlimited: false, remaining: 0,
      },
    },
    attempt: { id: "attempt-39", type: "cancellation" },
  };
  const result = await runClassLifecycleWorker({
    catalogue: {
      claimWebhookBatch: async () => [],
      claimLifecycleBatch: async () => [work],
      resolveLifecycleContext: async () => context,
      recordEntitlementRestoration: async (_context, observation) => calls.push(observation.status),
      finishLifecycle: async (facts) => calls.push(facts.status),
    },
    createProvider: async () => ({
      reconcileEntitlementRestoration: async (input) => {
        assert.equal(input.clientServiceId, "service-39");
        assert.equal(input.baseline.remaining, 0);
        return { status: "confirmed", clientServiceId: input.clientServiceId };
      },
    }),
  });
  assert.deepEqual(calls, ["confirmed", "completed"]);
  assert.equal(result.reconciliations[0].status, "completed");
});

test("the lifecycle worker reconciles Site -99 Cash ClientService restoration without replaying cancellation", async () => {
  const calls = [];
  const work = {
    id: "queue-sandbox-restoration-57", businessId: "business-39", bookingId,
    purpose: "cancellation", source: "manual", attemptCount: 1,
  };
  const context = {
    work,
    booking: {
      id: bookingId, businessId: "business-39", status: "cancelled",
      cancellationStatus: "confirmed", fulfilmentMode: "purchase_pricing_option",
      sandboxDemoRestoration: true, classId: "771", clientId: "rss-39",
      clientServiceId: "service-39",
      restorationBaseline: {
        status: "observed", clientServiceId: "service-39", current: false,
        returned: false, unlimited: false, remaining: 0,
      },
    },
    attempt: { id: "attempt-39", type: "cancellation" },
  };
  const result = await runClassLifecycleWorker({
    catalogue: {
      claimWebhookBatch: async () => [], claimLifecycleBatch: async () => [work],
      resolveLifecycleContext: async () => context,
      recordEntitlementRestoration: async (_context, observation) => calls.push(observation.status),
      finishLifecycle: async (facts) => calls.push(facts.status),
    },
    createProvider: async () => ({
      reconcileEntitlementRestoration: async () => ({ status: "confirmed", clientServiceId: "service-39" }),
    }),
  });
  assert.deepEqual(calls, ["confirmed", "completed"]);
  assert.equal(result.reconciliations[0].status, "completed");
});

test("paid lifecycle reconciliation is pinned to the stored Sale and Transaction", async () => {
  const work = {
    id: "queue-paid-40", businessId: "business-40", bookingId,
    purpose: "booking", source: "poll", attemptCount: 1,
  };
  const context = {
    work,
    booking: {
      id: bookingId, businessId: "business-40", integrationId: "integration-40",
      status: "unknown", fulfilmentMode: "purchase_pricing_option",
      classId: "771", clientId: "rss-40", serviceProductId: "product-40",
      saleId: "sale-40", cartId: "cart-40",
      transactionId: "transaction-40", paymentId: "payment-40",
    },
    attempt: { id: "attempt-40", type: "purchase_booking" },
  };
  const calls = [];
  const result = await runClassLifecycleWorker({
    catalogue: {
      claimWebhookBatch: async () => [],
      claimLifecycleBatch: async () => [work],
      resolveLifecycleContext: async () => context,
      completeBookingReconciliation: async (_context, observation) => calls.push(observation.status),
      finishLifecycle: async (facts) => calls.push(facts.status),
    },
    createProvider: async () => ({
      reconcileBooking: async (input) => {
        assert.equal(input.saleId, "sale-40");
        assert.equal(input.cartId, "cart-40");
        assert.equal(input.transactionId, "transaction-40");
        assert.equal(input.paymentId, "payment-40");
        return {
          status: "confirmed", certainty: "provider_confirmed",
          visitId: "visit-40", clientServiceId: "client-service-40",
          serviceProductId: "product-40", saleId: "sale-40", cartId: "cart-40",
          transactionId: "transaction-40", paymentId: "payment-40",
          atomicCheckoutConfirmed: true,
        };
      },
    }),
  });
  assert.deepEqual(calls, ["confirmed", "completed"]);
  assert.equal(result.reconciliations[0].status, "completed");
});

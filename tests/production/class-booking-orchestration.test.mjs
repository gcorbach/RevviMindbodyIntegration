import assert from "node:assert/strict";
import test from "node:test";

import {
  BookingOrchestrationError,
  createClassBooking,
  reconcileClassBooking,
} from "../../supabase/functions/_shared/class-booking.js";

const quote = Object.freeze({
  id: "quote-a",
  businessId: "business-a",
  offerId: "offer-a",
  mappingId: "mapping-a",
  mappingVersion: 4,
  locationId: "location-a",
  customerId: "customer-a",
  fulfilmentMode: "existing_entitlement",
  classId: "771",
  classScheduleId: "991",
  providerSiteId: "-99",
  providerLocationId: "7",
  providerClientId: "rss-1",
  providerClientUniqueId: "41",
  providerServiceProductId: null,
  providerClientServiceId: "pass-1",
  subtotal: 0,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 0,
  currency: "ZAR",
  quoteFingerprint: "a".repeat(64),
  status: "open",
  expiresAt: "2026-08-10T12:05:00.000Z",
});

const context = Object.freeze({
  business: { id: "business-a" },
  location: {
    id: "location-a",
    displayName: "Rosebank",
    providerLocationId: "7",
    timezone: "Africa/Johannesburg",
  },
  offer: { id: "offer-a", fulfilmentMode: "existing_entitlement" },
  integration: { id: "integration-a", providerSiteId: "-99" },
  mapping: { id: "mapping-a", version: 4, modeEvidenceVerified: true },
  inventoryAllowlist: {
    location: ["7"], program: ["11"], classDescription: ["13"],
    sessionType: ["23"], classSchedule: [],
  },
});

const occurrence = Object.freeze({
  classId: "771",
  classScheduleId: "991",
  classDescriptionId: "13",
  programId: "11",
  sessionTypeId: "23",
  name: "Revvi Yoga",
  staffName: "Maya",
  startAt: "2026-08-11T10:00:00.000Z",
  endAt: "2026-08-11T11:00:00.000Z",
  locationName: "Rosebank",
});

function dependencies(overrides = {}) {
  const calls = { writes: 0, completions: [], queued: [], reconciliations: 0, authorizations: 0 };
  const claimed = {
    shouldWrite: true,
    writeToken: "b".repeat(64),
    booking: { id: "booking-a", status: "pending", priceAmount: 0, currency: "ZAR" },
    attempt: { id: "attempt-a", status: "pending" },
  };
  return {
    now: () => new Date("2026-08-10T12:01:00.000Z"),
    catalogue: {
      findAttempt: async () => null,
      claimAttempt: async () => claimed,
      completeAttempt: async (facts) => {
        calls.completions.push(facts);
        return {
          booking: { ...claimed.booking, status: facts.status, ...facts.providerReferences },
          attempt: { ...claimed.attempt, status: facts.attemptStatus },
        };
      },
      enqueueReconciliation: async (facts) => { calls.queued.push(facts); },
      completeReconciliation: async (facts) => ({
        booking: { id: "booking-a", status: facts.status },
        attempt: { id: "attempt-a", status: "reconciled" },
      }),
    },
    provider: {
      createBooking: async () => {
        calls.writes += 1;
        return {
          status: "confirmed",
          certainty: "provider_confirmed",
          visitId: "visit-1",
          clientServiceId: "pass-1",
        };
      },
      reconcileBooking: async () => {
        calls.reconciliations += 1;
        return { status: "unknown", certainty: "unknown" };
      },
    },
    revalidateQuote: async () => ({ occurrence }),
    authorizeWrite: async () => { calls.authorizations += 1; },
    calls,
    ...overrides,
  };
}

const input = Object.freeze({
  customer: { id: "customer-a" },
  quote,
  context,
  idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
});

test("a confirmed Visit completes one local attempt and one provider write", async () => {
  const deps = dependencies();
  const result = await createClassBooking(input, deps);

  assert.equal(deps.calls.writes, 1);
  assert.equal(deps.calls.authorizations, 1);
  assert.equal(result.booking.status, "confirmed");
  assert.equal(result.booking.providerVisitId, "visit-1");
  assert.equal(deps.calls.completions[0].attemptStatus, "confirmed");
  assert.equal(deps.calls.queued.length, 0);
});

test("the same idempotency key returns its stored attempt without provider reads or writes", async () => {
  const deps = dependencies();
  deps.catalogue.findAttempt = async () => ({
    booking: { id: "booking-existing", status: "unknown" },
    attempt: { id: "attempt-existing", status: "unknown" },
  });
  deps.revalidateQuote = async () => { throw new Error("must not revalidate"); };

  const result = await createClassBooking(input, deps);
  assert.equal(result.booking.id, "booking-existing");
  assert.equal(result.booking.status, "unknown");
  assert.equal(deps.calls.writes, 0);
  assert.equal(deps.calls.authorizations, 0);
});

test("a membership change after provider reads stops before the local claim and Mindbody write", async () => {
  const deps = dependencies();
  let claims = 0;
  deps.catalogue.claimAttempt = async () => { claims += 1; };
  deps.authorizeWrite = async () => {
    throw new BookingOrchestrationError("OFFER_INELIGIBLE", "The current Revvi plan is no longer eligible.", 403);
  };

  await assert.rejects(
    createClassBooking(input, deps),
    (error) => error.code === "OFFER_INELIGIBLE",
  );
  assert.equal(claims, 0);
  assert.equal(deps.calls.writes, 0);
});

test("a concurrent Customer/Class claim never performs a second provider write", async () => {
  const deps = dependencies();
  deps.catalogue.claimAttempt = async () => ({
    shouldWrite: false,
    booking: { id: "booking-in-flight", status: "unknown" },
    attempt: { id: "attempt-in-flight", status: "unknown" },
  });

  const result = await createClassBooking(input, deps);
  assert.equal(result.booking.id, "booking-in-flight");
  assert.equal(deps.calls.writes, 0);
});

test("an explicit provider rejection is failed and never reported as success", async () => {
  const deps = dependencies();
  deps.provider.createBooking = async () => {
    deps.calls.writes += 1;
    return { status: "failed", certainty: "provider_rejected", errorCode: "CLASS_FULL" };
  };

  const result = await createClassBooking(input, deps);
  assert.equal(result.booking.status, "failed");
  assert.equal(deps.calls.completions[0].attemptStatus, "failed");
  assert.equal(deps.calls.completions[0].errorCode, "CLASS_FULL");
});

test("requires-action is normalized without releasing the Customer/Class write lock", async () => {
  const deps = dependencies();
  deps.provider.createBooking = async () => ({
    status: "requires_action",
    certainty: "provider_confirmed",
    requiredAction: { type: "redirect", url: "https://payments.example.test/challenge" },
  });
  const result = await createClassBooking(input, deps);
  assert.equal(result.booking.status, "requires_action");
  assert.equal(deps.calls.completions[0].attemptStatus, "requires_action");
  assert.equal(deps.calls.completions[0].releaseWriteLock, false);
  assert.equal(deps.calls.queued.length, 0);
});

test("a timeout remains unknown, keeps the write blocked and queues reconciliation", async () => {
  const deps = dependencies();
  deps.provider.createBooking = async () => {
    deps.calls.writes += 1;
    throw new BookingOrchestrationError(
      "PROVIDER_OUTCOME_UNKNOWN",
      "Mindbody may have accepted the booking.",
      502,
      { certainty: "unknown" },
    );
  };

  const result = await createClassBooking(input, deps);
  assert.equal(result.booking.status, "unknown");
  assert.equal(deps.calls.completions[0].releaseWriteLock, false);
  assert.equal(deps.calls.queued.length, 1);
  assert.equal(deps.calls.writes, 1);
});

test("unverified and unknown modes fail closed before a local claim or provider write", async () => {
  const deps = dependencies();
  let claims = 0;
  deps.catalogue.claimAttempt = async () => { claims += 1; };
  const unverified = {
    ...input,
    context: { ...context, mapping: { ...context.mapping, modeEvidenceVerified: false } },
  };

  await assert.rejects(
    createClassBooking(unverified, deps),
    (error) => error.code === "FULFILMENT_MODE_NOT_VERIFIED",
  );
  assert.equal(claims, 0);
  assert.equal(deps.calls.writes, 0);
});

test("a claimed confirmation without Visit, roster, waitlist, or atomic checkout evidence becomes unknown", async () => {
  const deps = dependencies();
  deps.provider.createBooking = async () => {
    deps.calls.writes += 1;
    return { status: "confirmed", certainty: "provider_confirmed" };
  };

  const result = await createClassBooking(input, deps);
  assert.equal(result.booking.status, "unknown");
  assert.equal(deps.calls.queued.length, 1);
});

test("Mindbody cannot substitute another entitlement for the one fixed by the quote", async () => {
  const deps = dependencies();
  deps.provider.createBooking = async () => ({
    status: "confirmed", certainty: "provider_confirmed", visitId: "visit-1", clientServiceId: "pass-attacker",
  });
  const result = await createClassBooking(input, deps);
  assert.equal(result.booking.status, "unknown");
  assert.equal(deps.calls.queued.length, 1);
});

test("a Visit without the exact quoted ClientService remains unknown", async () => {
  const deps = dependencies();
  deps.provider.createBooking = async () => ({
    status: "confirmed", certainty: "provider_confirmed", visitId: "visit-1",
  });
  const result = await createClassBooking(input, deps);
  assert.equal(result.booking.status, "unknown");
  assert.equal(deps.calls.queued.length, 1);
});

test("reconciliation can confirm from authoritative Visit evidence and releases the write lock", async () => {
  const deps = dependencies();
  deps.provider.reconcileBooking = async () => ({
    status: "confirmed",
    certainty: "provider_confirmed",
    visitId: "visit-reconciled",
    clientServiceId: "pass-1",
  });
  const result = await reconcileClassBooking({
    booking: { id: "booking-a", status: "unknown" },
    attempt: { id: "attempt-a", status: "unknown" },
    quote,
    writeToken: "b".repeat(64),
  }, deps);

  assert.equal(result.booking.status, "confirmed");
  assert.equal(result.attempt.status, "reconciled");
});

test("inconclusive reconciliation stays unknown and does not permit replay", async () => {
  const deps = dependencies();
  const result = await reconcileClassBooking({
    booking: { id: "booking-a", status: "unknown" },
    attempt: { id: "attempt-a", status: "unknown" },
    quote,
    writeToken: "b".repeat(64),
  }, deps);

  assert.equal(result.booking.status, "unknown");
  assert.equal(deps.calls.completions.length, 0);
});

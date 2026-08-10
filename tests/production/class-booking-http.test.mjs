import assert from "node:assert/strict";
import test from "node:test";

import { handleClassBooking } from "../../supabase/functions/_shared/class-booking-handler.js";

const quoteId = "36000000-0000-4000-8000-000000000061";
const idempotencyKey = "550e8400-e29b-41d4-a716-446655440036";

function request(body = { quoteId, idempotencyKey }, overrides = {}) {
  return new Request("https://example.supabase.co/functions/v1/create-booking", {
    method: "POST",
    headers: {
      Authorization: "Bearer header.payload.signature",
      "Content-Type": "application/json",
      Origin: "https://www.revvi.co.za",
      "X-Request-Id": "request-36",
    },
    body: JSON.stringify(body),
    ...overrides,
  });
}

function dependencies(overrides = {}) {
  const stored = {
    quote: { id: quoteId, customerId: "customer-a", businessId: "business-a" },
    context: { business: { id: "business-a" }, integration: { id: "integration-a" } },
  };
  return {
    allowedOrigins: new Set(["https://www.revvi.co.za"]),
    catalogue: {
      resolveQuoteLocator: async () => ({
        quoteId, customerId: "customer-a", businessId: "business-a",
        locationId: "location-a", offerId: "offer-a",
      }),
      findAttempt: async () => null,
      resolveBookingContext: async () => stored,
    },
    authorizeRequest: async (input) => {
      assert.equal(input.purpose, "provider_write");
      assert.deepEqual(input.selectedContext, {
        businessId: "business-a", locationId: "location-a", offerId: "offer-a",
      });
      return { customer: { id: "customer-a" } };
    },
    executeBooking: async (input, deps) => {
      assert.equal(input.idempotencyKey, idempotencyKey);
      assert.equal(input.quote, stored.quote);
      assert.equal(input.context, stored.context);
      assert.equal(typeof deps.revalidateQuote, "function");
      const provider = deps.createProvider({
        booking: { id: "booking-a" }, attempt: { id: "attempt-a" },
      });
      assert.equal(provider.marker, "write-provider-attempt-a");
      return {
        booking: {
          id: "booking-a", status: "confirmed", className: "Revvi Yoga",
          startAt: "2026-08-11T10:00:00.000Z", locationName: "Rosebank",
          priceAmount: 0, currency: "ZAR", providerVisitId: "visit-1",
        },
        attempt: { id: "attempt-a", status: "confirmed" },
      };
    },
    revalidateQuote: async () => ({ occurrence: {} }),
    createQuoteProvider: () => ({ marker: "quote-provider" }),
    createWriteProvider: (_context, operation) => ({ marker: `write-provider-${operation.attemptId}` }),
    ...overrides,
  };
}

test("create-booking revalidates current eligibility and returns normalized Class references", async () => {
  const deps = dependencies();
  const response = await handleClassBooking(request(), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      booking: {
        id: "booking-a",
        status: "confirmed",
        providerReferences: { visitId: "visit-1" },
        className: "Revvi Yoga",
        startAt: "2026-08-11T10:00:00.000Z",
        locationName: "Rosebank",
        price: { amount: 0, currency: "ZAR" },
      },
    },
    requestId: "request-36",
  });
});

test("a duplicate request returns its stored result without quote revalidation or a provider factory", async () => {
  let contextReads = 0;
  let providerFactories = 0;
  const deps = dependencies();
  deps.catalogue = {
    ...deps.catalogue,
    findAttempt: async () => ({
      booking: { id: "booking-existing", status: "unknown", priceAmount: 0, currency: "ZAR" },
      attempt: { id: "attempt-existing", status: "unknown" },
    }),
    resolveBookingContext: async () => { contextReads += 1; },
  };
  deps.createWriteProvider = () => { providerFactories += 1; };

  const response = await handleClassBooking(request(), deps);
  assert.equal(response.status, 202);
  assert.equal((await response.json()).data.booking.status, "unknown");
  assert.equal(contextReads, 0);
  assert.equal(providerFactories, 0);
});

test("customer substitution and browser-supplied mode, Client, or payment facts fail closed", async () => {
  let writes = 0;
  const wrongCustomer = dependencies({
    authorizeRequest: async () => ({ customer: { id: "attacker-customer" } }),
    executeBooking: async () => { writes += 1; },
  });
  assert.equal((await handleClassBooking(request(), wrongCustomer)).status, 403);

  const injected = await handleClassBooking(request({
    quoteId,
    idempotencyKey,
    fulfilmentMode: "approved_unpaid",
    clientId: "attacker-client",
    cardNumber: "4111111111111111",
  }), dependencies({ executeBooking: async () => { writes += 1; } }));
  assert.equal(injected.status, 400);
  assert.equal(writes, 0);
});

test("unknown outcomes return pending reconciliation and explicit failure is not rewritten as confirmed", async () => {
  const unknown = dependencies({
    executeBooking: async () => ({
      booking: { id: "booking-u", status: "unknown", priceAmount: 0, currency: "ZAR" },
      attempt: { id: "attempt-u", status: "unknown" },
    }),
  });
  const unknownResponse = await handleClassBooking(request(), unknown);
  assert.equal(unknownResponse.status, 202);
  assert.equal((await unknownResponse.json()).data.booking.status, "unknown");

  const failed = dependencies({
    executeBooking: async () => ({
      booking: { id: "booking-f", status: "failed", priceAmount: 0, currency: "ZAR" },
      attempt: { id: "attempt-f", status: "failed" },
    }),
  });
  const failedResponse = await handleClassBooking(request(), failed);
  assert.equal(failedResponse.status, 200);
  assert.equal((await failedResponse.json()).data.booking.status, "failed");
});

test("unapproved origins and missing Memberstack bearer tokens stop before quote lookup", async () => {
  let lookups = 0;
  const deps = dependencies();
  deps.catalogue = { ...deps.catalogue, resolveQuoteLocator: async () => { lookups += 1; } };
  const wrongOrigin = request(undefined, {
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
  });
  assert.equal((await handleClassBooking(wrongOrigin, deps)).status, 403);
  const loggedOut = request(undefined, {
    headers: { "Content-Type": "application/json", Origin: "https://www.revvi.co.za" },
  });
  assert.equal((await handleClassBooking(loggedOut, deps)).status, 401);
  assert.equal(lookups, 0);
});

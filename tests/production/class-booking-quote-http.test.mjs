import assert from "node:assert/strict";
import test from "node:test";

import { handleClassBookingQuote } from "../../supabase/functions/_shared/class-booking-quote-handler.js";

const offerId = "35000000-0000-4000-8000-000000000001";
function request(body = { offerId, sessionId: "771" }, overrides = {}) {
  return new Request("https://example.supabase.co/functions/v1/booking-quote", {
    method: "POST",
    headers: {
      Authorization: "Bearer header.payload.signature",
      "Content-Type": "application/json",
      Origin: "https://www.revvi.co.za",
      "X-Request-Id": "request-35",
    },
    body: JSON.stringify(body),
    ...overrides,
  });
}

function dependencies(overrides = {}) {
  const context = { mapping: { id: "mapping-a" }, integration: { providerSiteId: "-99" } };
  return {
    allowedOrigins: new Set(["https://www.revvi.co.za"]),
    catalogue: {
      resolveOfferLocator: async () => ({ businessId: "business-a", locationId: "location-a", offerId }),
      resolveQuoteContext: async () => context,
    },
    authorizeRequest: async (input) => {
      assert.deepEqual(input.selectedContext, { businessId: "business-a", locationId: "location-a", offerId });
      return { customer: { id: "customer-a", identity: { email: "member@example.com", firstName: "Ava", lastName: "Ndlovu", emailVerified: true } } };
    },
    createProvider: () => ({ marker: "provider" }),
    createQuote: async (input, deps) => {
      assert.equal(input.classId, "771");
      assert.equal(input.context, context);
      assert.equal(deps.provider.marker, "provider");
      return { quoteId: "quote-a", expiresAt: "2026-08-10T12:05:00.000Z", occurrence: { classId: "771" } };
    },
    ...overrides,
  };
}

test("POST booking-quote derives tenant context from Offer and returns a stored quote", async () => {
  const response = await handleClassBookingQuote(request(), dependencies());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { quoteId: "quote-a", expiresAt: "2026-08-10T12:05:00.000Z", session: { classId: "771" } },
    requestId: "request-35",
  });
});

test("booking-quote rejects browser-supplied price, mode, tenant or Client identity", async () => {
  let authorizationReached = false;
  const deps = dependencies({ authorizeRequest: async () => { authorizationReached = true; } });
  const response = await handleClassBookingQuote(request({
    offerId,
    sessionId: "771",
    fulfilmentMode: "approved_unpaid",
    clientId: "attacker-client",
  }), deps);
  assert.equal(response.status, 400);
  assert.equal(authorizationReached, false);
});

test("an unapproved origin or missing bearer token cannot resolve the Offer locator", async () => {
  let locatorReached = false;
  const deps = dependencies();
  deps.catalogue = { ...deps.catalogue, resolveOfferLocator: async () => { locatorReached = true; } };
  const wrongOrigin = request(undefined, { headers: { "Content-Type": "application/json", Origin: "https://attacker.example" } });
  assert.equal((await handleClassBookingQuote(wrongOrigin, deps)).status, 403);
  const loggedOut = request(undefined, { headers: { "Content-Type": "application/json", Origin: "https://www.revvi.co.za" } });
  assert.equal((await handleClassBookingQuote(loggedOut, deps)).status, 401);
  assert.equal(locatorReached, false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { OfferAuthorizationError } from "../../supabase/functions/_shared/class-offer-authorization.js";
import {
  handleOfferClassAvailability,
} from "../../supabase/functions/_shared/class-availability-handler.js";

const requestBody = Object.freeze({
  businessSlug: "pilot-yoga",
  offerId: "33000000-0000-4000-8000-000000000001",
  locationId: "33000000-0000-4000-8000-000000000002",
  startDate: "2026-08-11",
  endDate: "2026-08-24",
});

function request(body = requestBody, overrides = {}) {
  return new Request("https://example.supabase.co/functions/v1/offer-class-availability", {
    method: "POST",
    headers: {
      Authorization: "Bearer header.payload.signature",
      "Content-Type": "application/json",
      Origin: "https://www.revvi.co.za",
      "X-Request-Id": "request-33",
    },
    body: JSON.stringify(body),
    ...overrides,
  });
}

function dependencies(overrides = {}) {
  const configuration = {
    business: { id: "business-a", slug: "pilot-yoga", displayName: "Pilot Yoga" },
    location: {
      id: requestBody.locationId,
      providerLocationId: "7",
      timezone: "Africa/Johannesburg",
    },
    offer: { id: requestBody.offerId, displayName: "Revvi Yoga", fulfilmentMode: "approved_unpaid" },
    integration: { id: "integration-a", providerSiteId: "-99", status: "active" },
    mapping: { id: "mapping-a", status: "active", providerServiceProductId: null },
    customerProviderProfile: null,
    inventoryAllowlist: {
      location: ["7"], program: ["11"], classDescription: ["13"], sessionType: ["23"], classSchedule: [],
    },
  };
  return {
    allowedOrigins: new Set(["https://www.revvi.co.za"]),
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    catalogue: {
      resolveBusinessIdBySlug: async () => "business-a",
      resolveAvailabilityContext: async () => configuration,
      recordProviderDiagnostic: async () => {},
    },
    authorizeRequest: async () => ({
      business: { id: "business-a" },
      location: { id: requestBody.locationId },
      offer: { id: requestBody.offerId },
      customer: { id: "customer-a" },
    }),
    createProvider: () => ({ marker: "provider" }),
    instrumentProvider: (provider) => provider,
    discoverAvailability: async ({ context, startAt, endAt }, { provider }) => {
      assert.equal(context, configuration);
      assert.equal(startAt, "2026-08-10T22:00:00.000Z");
      assert.equal(endAt, "2026-08-24T21:59:59.999Z");
      assert.equal(provider.marker, "provider");
      return {
        business: { id: "business-a", name: "Pilot Yoga", slug: "pilot-yoga" },
        offer: { id: requestBody.offerId, title: "Revvi Yoga" },
        sessions: [],
      };
    },
    ...overrides,
  };
}

test("POST availability authorizes Memberstack context before returning normalized Class inventory", async () => {
  const response = await handleOfferClassAvailability(request(), dependencies());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://www.revvi.co.za");
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      business: { id: "business-a", name: "Pilot Yoga", slug: "pilot-yoga" },
      offer: { id: requestBody.offerId, title: "Revvi Yoga" },
      sessions: [],
    },
    requestId: "request-33",
  });
});

test("failed eligibility prevents configuration and Mindbody reads", async () => {
  let configurationReached = false;
  let providerReached = false;
  const deps = dependencies({
    authorizeRequest: async () => {
      throw new OfferAuthorizationError("OFFER_INELIGIBLE", "This membership cannot use the Offer.", 403);
    },
  });
  deps.catalogue = {
    ...deps.catalogue,
    resolveAvailabilityContext: async () => { configurationReached = true; },
  };
  deps.createProvider = () => { providerReached = true; };

  const response = await handleOfferClassAvailability(request(), deps);
  assert.equal(response.status, 403);
  assert.equal(configurationReached, false);
  assert.equal(providerReached, false);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: "OFFER_INELIGIBLE",
    error: "This membership cannot use the Offer.",
    requestId: "request-33",
  });
});

test("unapproved origins and non-POST methods never reach authorization", async () => {
  let authorizationReached = false;
  const deps = dependencies({ authorizeRequest: async () => { authorizationReached = true; } });
  const wrongOrigin = request(requestBody, {
    headers: {
      Authorization: "Bearer header.payload.signature",
      "Content-Type": "application/json",
      Origin: "https://attacker.example",
    },
  });
  assert.equal((await handleOfferClassAvailability(wrongOrigin, deps)).status, 403);
  assert.equal((await handleOfferClassAvailability(new Request("https://example.test", { method: "GET" }), deps)).status, 405);
  assert.equal(authorizationReached, false);
});

test("logged-out requests fail before resolving a Business slug", async () => {
  let businessReached = false;
  const deps = dependencies();
  deps.catalogue = {
    ...deps.catalogue,
    resolveBusinessIdBySlug: async () => { businessReached = true; },
  };
  const response = await handleOfferClassAvailability(new Request(
    "https://example.supabase.co/functions/v1/offer-class-availability",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "request-33" },
      body: JSON.stringify(requestBody),
    },
  ), deps);
  assert.equal(response.status, 401);
  assert.equal(businessReached, false);
});

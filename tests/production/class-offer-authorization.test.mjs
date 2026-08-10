import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeClassOfferRequest,
  OfferAuthorizationError,
  withAuthorizedClassOfferWrite,
} from "../../supabase/functions/_shared/class-offer-authorization.js";

const selectedContext = Object.freeze({
  businessId: "business-a",
  locationId: "location-a",
  offerId: "offer-a",
});

function eligibleDependencies(overrides = {}) {
  return {
    memberstack: {
      verifyBrowserToken: async () => ({ memberId: "member-a" }),
      getCurrentMember: async () => ({
        memberId: "member-a",
        planConnections: [{
          id: "connection-a",
          planId: "plan-revvi",
          active: true,
          status: "ACTIVE",
        }],
        verifiedAt: "2026-08-10T12:00:00.000Z",
      }),
    },
    catalogue: {
      resolveCustomer: async () => ({
        id: "customer-a",
        memberstackMemberId: "member-a",
        eligibilityOverride: null,
      }),
      recordAuthorizationCheck: async () => {},
      resolveOfferContext: async () => ({
        business: { id: "business-a", status: "active" },
        location: { id: "location-a", businessId: "business-a", enabled: true },
        offer: {
          id: "offer-a",
          businessId: "business-a",
          locationId: "location-a",
          status: "active",
          eligibleMemberstackPlanIds: ["plan-revvi"],
        },
        customerAccess: null,
      }),
    },
    now: () => new Date("2026-08-10T12:00:10.000Z"),
    ...overrides,
  };
}

test("logged-out visitors cannot request live Offer availability", async () => {
  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: null, selectedContext, purpose: "availability" },
      eligibleDependencies(),
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "AUTHENTICATION_REQUIRED"
      && error.status === 401,
  );
});

test("an unverified browser token cannot resolve a Revvi Customer", async () => {
  const dependencies = eligibleDependencies();
  dependencies.memberstack.verifyBrowserToken = async () => null;

  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: "invalid-token", selectedContext, purpose: "availability" },
      dependencies,
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "AUTHENTICATION_INVALID"
      && error.status === 401,
  );
});

test("an eligible Customer receives a server-owned Offer availability context", async () => {
  const context = await authorizeClassOfferRequest(
    { browserToken: "verified-token", selectedContext, purpose: "availability" },
    eligibleDependencies(),
  );

  assert.deepEqual(context, {
    purpose: "availability",
    customer: {
      id: "customer-a",
      memberstackMemberId: "member-a",
      eligibilityOverride: null,
    },
    business: { id: "business-a", status: "active" },
    location: { id: "location-a", businessId: "business-a", enabled: true },
    offer: {
      id: "offer-a",
      businessId: "business-a",
      locationId: "location-a",
      status: "active",
      eligibleMemberstackPlanIds: ["plan-revvi"],
    },
    eligibility: {
      activePlanIds: ["plan-revvi"],
      matchedPlanIds: ["plan-revvi"],
      matchedConnections: [{
        connectionId: "connection-a",
        planId: "plan-revvi",
        status: "ACTIVE",
      }],
      verifiedAt: "2026-08-10T12:00:00.000Z",
    },
  });
});

test("an explicit pilot eligibility block overrides an otherwise eligible plan", async () => {
  const dependencies = eligibleDependencies();
  dependencies.catalogue.resolveCustomer = async () => ({
    id: "customer-a",
    memberstackMemberId: "member-a",
    eligibilityOverride: false,
  });

  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: "verified-token", selectedContext, purpose: "availability" },
      dependencies,
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "ELIGIBILITY_OVERRIDE_BLOCKED"
      && error.status === 403,
  );
});

test("an inactive Memberstack subscription cannot request Offer availability", async () => {
  const dependencies = eligibleDependencies();
  dependencies.memberstack.getCurrentMember = async () => ({
    memberId: "member-a",
    planConnections: [{
      id: "connection-a",
      planId: "plan-revvi",
      active: false,
      status: "CANCELED",
    }],
    verifiedAt: "2026-08-10T12:00:00.000Z",
  });

  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: "verified-token", selectedContext, purpose: "availability" },
      dependencies,
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "SUBSCRIPTION_INACTIVE"
      && error.status === 403,
  );
});

test("a Unicode lookalike Memberstack status cannot become eligible through case folding", async () => {
  const dependencies = eligibleDependencies();
  dependencies.memberstack.getCurrentMember = async () => ({
    memberId: "member-a",
    planConnections: [{
      id: "connection-a",
      planId: "plan-revvi",
      active: true,
      status: "actıve",
    }],
    verifiedAt: "2026-08-10T12:00:00.000Z",
  });

  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: "verified-token", selectedContext, purpose: "availability" },
      dependencies,
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "SUBSCRIPTION_INACTIVE",
  );
});

test("a stale Memberstack member result fails closed before catalogue or provider work", async () => {
  const dependencies = eligibleDependencies();
  let catalogueReached = false;
  dependencies.memberstack.getCurrentMember = async () => ({
    memberId: "member-a",
    planConnections: [{
      id: "connection-a",
      planId: "plan-revvi",
      active: true,
      status: "ACTIVE",
    }],
    verifiedAt: "2026-08-10T11:58:00.000Z",
  });
  dependencies.catalogue.resolveCustomer = async () => {
    catalogueReached = true;
  };

  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: "verified-token", selectedContext, purpose: "availability" },
      dependencies,
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "MEMBERSTACK_STALE"
      && error.status === 503,
  );
  assert.equal(catalogueReached, false);
});

test("exact Memberstack plan IDs are required for Offer eligibility", async () => {
  const dependencies = eligibleDependencies();
  dependencies.memberstack.getCurrentMember = async () => ({
    memberId: "member-a",
    planConnections: [{
      id: "connection-b",
      planId: "plan-revvi-premium-lookalike",
      active: true,
      status: "ACTIVE",
    }],
    verifiedAt: "2026-08-10T12:00:00.000Z",
  });

  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: "verified-token", selectedContext, purpose: "availability" },
      dependencies,
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "OFFER_INELIGIBLE"
      && error.status === 403,
  );
});

test("an Offer resolved from another Business is rejected", async () => {
  const dependencies = eligibleDependencies();
  const resolved = await dependencies.catalogue.resolveOfferContext();
  dependencies.catalogue.resolveOfferContext = async () => ({
    ...resolved,
    business: { id: "business-b", status: "active" },
    offer: { ...resolved.offer, businessId: "business-b" },
  });

  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: "verified-token", selectedContext, purpose: "availability" },
      dependencies,
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "BUSINESS_CONTEXT_MISMATCH"
      && error.status === 403,
  );
});

test("an Offer resolved from another Location is rejected", async () => {
  const dependencies = eligibleDependencies();
  const resolved = await dependencies.catalogue.resolveOfferContext();
  dependencies.catalogue.resolveOfferContext = async () => ({
    ...resolved,
    location: { id: "location-b", businessId: "business-a", enabled: true },
    offer: { ...resolved.offer, locationId: "location-b" },
  });

  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: "verified-token", selectedContext, purpose: "availability" },
      dependencies,
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "LOCATION_CONTEXT_MISMATCH"
      && error.status === 403,
  );
});

test("a different Offer cannot be substituted into the selected context", async () => {
  const dependencies = eligibleDependencies();
  const resolved = await dependencies.catalogue.resolveOfferContext();
  dependencies.catalogue.resolveOfferContext = async () => ({
    ...resolved,
    offer: { ...resolved.offer, id: "offer-b" },
  });

  await assert.rejects(
    authorizeClassOfferRequest(
      { browserToken: "verified-token", selectedContext, purpose: "availability" },
      dependencies,
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "OFFER_CONTEXT_MISMATCH"
      && error.status === 403,
  );
});

test("inactive Business, Location, or Offer configuration fails closed", async (t) => {
  const cases = [
    ["Business", (resolved) => ({ ...resolved, business: { ...resolved.business, status: "disabled" } })],
    ["Location", (resolved) => ({ ...resolved, location: { ...resolved.location, enabled: false } })],
    ["Offer", (resolved) => ({ ...resolved, offer: { ...resolved.offer, status: "inactive" } })],
  ];

  for (const [label, mutate] of cases) {
    await t.test(label, async () => {
      const dependencies = eligibleDependencies();
      const resolved = await dependencies.catalogue.resolveOfferContext();
      dependencies.catalogue.resolveOfferContext = async () => mutate(resolved);
      await assert.rejects(
        authorizeClassOfferRequest(
          { browserToken: "verified-token", selectedContext, purpose: "availability" },
          dependencies,
        ),
        (error) => error instanceof OfferAuthorizationError
          && error.code === "OFFER_UNAVAILABLE"
          && error.status === 409,
      );
    });
  }
});

test("a plan change after availability blocks the Mindbody write", async () => {
  const dependencies = eligibleDependencies();
  let memberReads = 0;
  let providerWriteReached = false;
  dependencies.memberstack.getCurrentMember = async () => {
    memberReads += 1;
    return {
      memberId: "member-a",
      planConnections: [{
        id: "connection-a",
        planId: "plan-revvi",
        active: memberReads === 1,
        status: memberReads === 1 ? "ACTIVE" : "CANCELED",
      }],
      verifiedAt: `2026-08-10T12:00:${memberReads === 1 ? "00" : "05"}.000Z`,
    };
  };

  await authorizeClassOfferRequest(
    { browserToken: "verified-token", selectedContext, purpose: "availability" },
    dependencies,
  );

  await assert.rejects(
    withAuthorizedClassOfferWrite(
      { browserToken: "verified-token", selectedContext },
      dependencies,
      async () => {
        providerWriteReached = true;
      },
    ),
    (error) => error instanceof OfferAuthorizationError
      && error.code === "SUBSCRIPTION_INACTIVE",
  );
  assert.equal(memberReads, 2);
  assert.equal(providerWriteReached, false);
});

import {
  isProvisionableMemberstackPlanConnection,
  MemberstackServiceError,
} from "./memberstack.js";

export class OfferAuthorizationError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "OfferAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export async function authorizeClassOfferRequest(input, dependencies) {
  if (!input.browserToken) {
    throw new OfferAuthorizationError(
      "AUTHENTICATION_REQUIRED",
      "Sign in through Revvi to continue.",
      401,
    );
  }

  let identity;
  try {
    identity = await dependencies.memberstack.verifyBrowserToken(input.browserToken);
  } catch (error) {
    if (error instanceof MemberstackServiceError) throw error;
    identity = null;
  }
  if (!identity?.memberId) {
    throw new OfferAuthorizationError(
      "AUTHENTICATION_INVALID",
      "Revvi identity could not be verified.",
      401,
    );
  }

  const member = await dependencies.memberstack.getCurrentMember(identity.memberId);
  if (!member || member.memberId !== identity.memberId) {
    throw new OfferAuthorizationError(
      "AUTHENTICATION_INVALID",
      "The Revvi Customer's current Memberstack record could not be verified.",
      401,
    );
  }
  const verifiedAt = new Date(member.verifiedAt);
  const checkedAt = dependencies.now?.() ?? new Date();
  const verificationAgeMs = checkedAt.getTime() - verifiedAt.getTime();
  if (Number.isNaN(verifiedAt.getTime())
    || !(checkedAt instanceof Date)
    || Number.isNaN(checkedAt.getTime())
    || verificationAgeMs < 0
    || verificationAgeMs > 60_000) {
    throw new OfferAuthorizationError(
      "MEMBERSTACK_STALE",
      "Current Revvi membership could not be verified immediately before this request.",
      503,
    );
  }
  const planConnections = Array.isArray(member.planConnections) ? member.planConnections : [];
  const provisionableConnections = planConnections.filter(isProvisionableMemberstackPlanConnection);
  if (provisionableConnections.length === 0) {
    throw new OfferAuthorizationError(
      "SUBSCRIPTION_INACTIVE",
      "An active Revvi subscription is required for this Offer.",
      403,
    );
  }
  const customer = await dependencies.catalogue.resolveCustomer(identity.memberId);
  if (!customer || customer.memberstackMemberId !== identity.memberId) {
    throw new OfferAuthorizationError(
      "CUSTOMER_NOT_FOUND",
      "A server-owned Revvi Customer record could not be resolved.",
      403,
    );
  }
  if (customer.eligibilityOverride === false) {
    throw new OfferAuthorizationError(
      "ELIGIBILITY_OVERRIDE_BLOCKED",
      "This Revvi Customer is currently blocked from Offer eligibility.",
      403,
    );
  }
  const offerContext = await dependencies.catalogue.resolveOfferContext({
    customerId: customer?.id,
    ...input.selectedContext,
  });
  if (offerContext.business?.id !== input.selectedContext.businessId
    || offerContext.offer?.businessId !== input.selectedContext.businessId) {
    throw new OfferAuthorizationError(
      "BUSINESS_CONTEXT_MISMATCH",
      "This Offer does not belong to the selected Business.",
      403,
    );
  }
  if (offerContext.location?.id !== input.selectedContext.locationId
    || offerContext.location?.businessId !== input.selectedContext.businessId
    || offerContext.offer?.locationId !== input.selectedContext.locationId) {
    throw new OfferAuthorizationError(
      "LOCATION_CONTEXT_MISMATCH",
      "This Offer does not belong to the selected Location.",
      403,
    );
  }
  if (offerContext.offer?.id !== input.selectedContext.offerId) {
    throw new OfferAuthorizationError(
      "OFFER_CONTEXT_MISMATCH",
      "This Offer does not match the selected Offer.",
      403,
    );
  }
  if (offerContext.business.status !== "active"
    || offerContext.location.enabled !== true
    || offerContext.offer.status !== "active") {
    throw new OfferAuthorizationError(
      "OFFER_UNAVAILABLE",
      "This Revvi Offer is not active at the selected Location.",
      409,
    );
  }
  const activePlanIds = [...new Set(provisionableConnections
    .map((connection) => connection.planId))].sort();
  const eligiblePlanIds = new Set(offerContext.offer.eligibleMemberstackPlanIds);
  const matchedConnections = provisionableConnections
    .filter((connection) => eligiblePlanIds.has(connection.planId))
    .map((connection) => ({
      connectionId: connection.id,
      planId: connection.planId,
      status: String(connection.status).toUpperCase(),
    }));
  const matchedPlanIds = [...new Set(matchedConnections.map((connection) => connection.planId))].sort();
  if (matchedConnections.length === 0) {
    throw new OfferAuthorizationError(
      "OFFER_INELIGIBLE",
      "Your current Revvi plan is not eligible for this Offer.",
      403,
    );
  }

  const context = {
    purpose: input.purpose,
    customer: {
      ...customer,
      ...(member.identity ? { identity: member.identity } : {}),
    },
    business: offerContext.business,
    location: offerContext.location,
    offer: offerContext.offer,
    eligibility: {
      activePlanIds,
      matchedPlanIds,
      matchedConnections,
      verifiedAt: verifiedAt.toISOString(),
    },
  };
  await dependencies.catalogue.recordAuthorizationCheck(context);
  return context;
}

export async function withAuthorizedClassOfferWrite(input, dependencies, providerWrite) {
  const context = await authorizeClassOfferRequest(
    { ...input, purpose: "provider_write" },
    dependencies,
  );
  return providerWrite(context);
}

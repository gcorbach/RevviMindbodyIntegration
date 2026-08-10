import {
  MemberstackAuthenticationError,
  MemberstackServiceError,
} from "./memberstack.js";

export class ClassCustomerAuthorizationError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "ClassCustomerAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export async function authorizeClassCustomerRequest(input, dependencies) {
  if (!input?.browserToken) {
    throw new ClassCustomerAuthorizationError(
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
    if (error instanceof MemberstackAuthenticationError) {
      throw new ClassCustomerAuthorizationError(error.code, error.message, 401);
    }
    identity = null;
  }
  if (!identity?.memberId) {
    throw new ClassCustomerAuthorizationError(
      "AUTHENTICATION_INVALID",
      "Revvi identity could not be verified.",
      401,
    );
  }

  const member = await dependencies.memberstack.getCurrentMember(identity.memberId);
  if (!member || member.memberId !== identity.memberId) {
    throw new ClassCustomerAuthorizationError(
      "AUTHENTICATION_INVALID",
      "The Revvi Customer's current Memberstack record could not be verified.",
      401,
    );
  }
  const verifiedAt = new Date(member.verifiedAt);
  const checkedAt = dependencies.now?.() ?? new Date();
  const age = checkedAt.getTime() - verifiedAt.getTime();
  if (Number.isNaN(verifiedAt.getTime()) || !(checkedAt instanceof Date)
    || Number.isNaN(checkedAt.getTime()) || age < 0 || age > 60_000) {
    throw new ClassCustomerAuthorizationError(
      "MEMBERSTACK_STALE",
      "Current Revvi identity could not be verified immediately before this request.",
      503,
    );
  }

  const customer = await dependencies.catalogue.resolveCustomer(identity.memberId);
  if (!customer || customer.memberstackMemberId !== identity.memberId) {
    throw new ClassCustomerAuthorizationError(
      "CUSTOMER_NOT_FOUND",
      "A server-owned Revvi Customer record could not be resolved.",
      403,
    );
  }
  return Object.freeze({
    customer: { ...customer, ...(member.identity ? { identity: member.identity } : {}) },
    verifiedAt: verifiedAt.toISOString(),
  });
}

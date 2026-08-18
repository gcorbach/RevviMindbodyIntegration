import { createSite99SandboxProvider } from "./mindbody-site-99-hosted.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseMindbodyStaffTokens(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    for (const [integrationId, token] of Object.entries(parsed)) {
      if (!UUID.test(integrationId) || typeof token !== "string" || token.trim().length < 16) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function mindbodyStaffRuntimeConfigured({ staffTokens, sandboxUsername, sandboxPassword }) {
  return Boolean(staffTokens !== null && (
    Object.keys(staffTokens).length > 0
    || (typeof sandboxUsername === "string" && sandboxUsername.trim()
      && typeof sandboxPassword === "string" && sandboxPassword.trim())
  ));
}

export function createMindbodyRuntimeProvider(options) {
  if (options?.context?.mapping?.paidPaymentRoute === "mindbody_sandbox_cash") {
    return createSite99SandboxProvider({
      context: options.context,
      customerId: options.customerId,
      apiKey: options.apiKey,
      username: options.sandboxUsername,
      password: options.sandboxPassword,
      requestTimeoutMs: options.requestTimeoutMs,
      fetchImpl: options.fetchImpl,
      createProvider: options.createProvider,
      withStaffOperationLease: options.withSite99StaffOperationLease,
    });
  }
  const userToken = options?.staffTokens?.[options?.context?.integration?.id];
  if (typeof userToken !== "string" || userToken.trim().length < 16) {
    throw new Error("No staff token is configured for the selected Mindbody integration.");
  }
  return options.createProvider({
    apiKey: options.apiKey,
    siteId: options.context.integration.providerSiteId,
    userToken,
    baseUrl: options.baseUrl ?? "https://api.mindbodyonline.com",
    requestTimeoutMs: options.requestTimeoutMs,
  });
}

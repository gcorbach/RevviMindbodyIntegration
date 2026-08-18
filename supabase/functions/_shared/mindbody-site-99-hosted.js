import { requiredMindbodyText } from "./mindbody-http.js";

const SITE_ID = "-99";
const API_ORIGIN = "https://api.mindbodyonline.com";

export class Site99SandboxConfigurationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "Site99SandboxConfigurationError";
    this.code = code;
    this.certainty = details.certainty ?? "provider_rejected";
    this.providerResult = details.providerResult;
  }
}

function exactSandboxContext(context, customerId) {
  return context?.integration?.environment === "sandbox"
    && context.integration.providerSiteId === SITE_ID
    && context?.location?.providerLocationId === "1"
    && context?.mapping?.paidPaymentRoute === "mindbody_sandbox_cash"
    && context.mapping.sandboxDemoWriteEnabled === true
    && typeof context.mapping.sandboxDemoCustomerId === "string"
    && context.mapping.sandboxDemoCustomerId === customerId;
}

async function json(response, code) {
  if (!response.ok) {
    throw new Site99SandboxConfigurationError(code, "Mindbody sandbox staff authentication failed.");
  }
  try {
    return await response.json();
  } catch {
    throw new Site99SandboxConfigurationError(code, "Mindbody sandbox staff authentication was invalid.");
  }
}

export function createSite99SandboxProvider(options) {
  const context = options?.context;
  const customerId = requiredMindbodyText(options?.customerId, "customerId");
  if (!exactSandboxContext(context, customerId)) {
    throw new Site99SandboxConfigurationError(
      "SITE_99_SANDBOX_CONTEXT_DENIED",
      "The hosted sandbox adapter is not enabled for this exact Customer and Offer.",
    );
  }
  const apiKey = requiredMindbodyText(options?.apiKey, "apiKey");
  const username = requiredMindbodyText(options?.username, "username");
  const password = requiredMindbodyText(options?.password, "password");
  const createProvider = options?.createProvider;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = Number(options?.requestTimeoutMs ?? 10_000);
  if (typeof createProvider !== "function") throw new TypeError("createProvider is required.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("requestTimeoutMs must be between 1 and 60000.");
  }

  async function authenticationRequest(path, init) {
    return fetchImpl(`${API_ORIGIN}/public/v6/${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Api-Key": apiKey,
        SiteId: SITE_ID,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async function withTemporaryToken(operation) {
    const issued = await json(await authenticationRequest("usertoken/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Username: username, Password: password }),
    }), "SITE_99_STAFF_TOKEN_ISSUE_FAILED");
    const token = requiredMindbodyText(issued?.AccessToken, "AccessToken");
    let primaryError;
    let providerResult;
    try {
      providerResult = await operation(token);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await json(await authenticationRequest("usertoken/revoke", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }), "SITE_99_STAFF_TOKEN_REVOKE_FAILED");
      } catch (revokeError) {
        if (!primaryError) {
          throw new Site99SandboxConfigurationError(
            revokeError?.code ?? "SITE_99_STAFF_TOKEN_REVOKE_FAILED",
            "Mindbody sandbox staff-token cleanup could not be confirmed.",
            { certainty: "unknown", providerResult },
          );
        }
      }
    }
    return providerResult;
  }

  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      return (...args) => withTemporaryToken(async (userToken) => {
        const provider = createProvider({
          apiKey,
          siteId: SITE_ID,
          userToken,
          baseUrl: API_ORIGIN,
          requestTimeoutMs: timeoutMs,
          fetchImpl,
          sandboxCashRoute: true,
        });
        if (typeof provider?.[property] !== "function") {
          throw new TypeError(`The Site -99 provider does not support ${property}.`);
        }
        return provider[property](...args);
      });
    },
  });
}

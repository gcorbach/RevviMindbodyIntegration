import { requiredMindbodyText } from "./mindbody-http.js";

const SITE_ID = "-99";
const API_ORIGIN = "https://api.mindbodyonline.com";
const SANDBOX_CLIENT_DEFAULTS = Object.freeze({
  AddressLine1: "123 Sandbox Way",
  BirthDate: "1990-01-01T00:00:00",
});
const SANDBOX_DEFAULTED_CLIENT_FIELDS = new Set([
  ...Object.keys(SANDBOX_CLIENT_DEFAULTS),
  "IsMale",
]);
const MINDBODY_CLIENT_IDENTITY_FIELDS = new Set(["FirstName", "LastName", "Email"]);

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
  const withStaffOperationLease = options?.withStaffOperationLease;
  const timeoutMs = Number(options?.requestTimeoutMs ?? 10_000);
  let operationQueue = Promise.resolve();
  if (typeof createProvider !== "function") throw new TypeError("createProvider is required.");
  if (typeof withStaffOperationLease !== "function") {
    throw new TypeError("withStaffOperationLease is required for Site -99.");
  }
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

  function withSerializedTemporaryToken(operation) {
    const current = operationQueue.then(
      () => withStaffOperationLease(() => withTemporaryToken(operation)),
      () => withStaffOperationLease(() => withTemporaryToken(operation)),
    );
    operationQueue = current.catch(() => undefined);
    return current;
  }

  async function defaultGenderOption(userToken) {
    const genders = await json(await authenticationRequest("site/genders", {
      headers: { Authorization: `Bearer ${userToken}` },
    }), "SITE_99_GENDER_OPTIONS_FAILED");
    const defaults = Array.isArray(genders?.GenderOptions)
      ? genders.GenderOptions.filter((option) => option?.IsActive === true && option?.IsDefault === true)
      : [];
    const optionId = Number(defaults[0]?.Id);
    const optionName = String(defaults[0]?.Name ?? "").trim();
    if (defaults.length !== 1 || !Number.isSafeInteger(optionId) || optionId < 1 || !optionName) {
      throw new Site99SandboxConfigurationError(
        "SITE_99_DEFAULT_GENDER_OPTION_INVALID",
        "Mindbody sandbox Client defaults could not be resolved.",
      );
    }
    return Object.freeze({ id: optionId, name: optionName });
  }

  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (typeof property !== "string") return undefined;
      return (...args) => withSerializedTemporaryToken(async (userToken) => {
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
        if (property === "getRequiredClientFields") {
          const requiredFields = await provider[property](...args);
          if (!Array.isArray(requiredFields)) return requiredFields;
          const allSupported = requiredFields.every((field) => {
            const name = String(field);
            return MINDBODY_CLIENT_IDENTITY_FIELDS.has(name) || SANDBOX_DEFAULTED_CLIENT_FIELDS.has(name);
          });
          return allSupported
            ? requiredFields.filter((field) => !SANDBOX_DEFAULTED_CLIENT_FIELDS.has(String(field)))
            : requiredFields;
        }
        if (property === "addClient") {
          const [input, ...remaining] = args;
          const genderOption = await defaultGenderOption(userToken);
          return provider[property]({
            ...input,
            client: {
              ...input?.client,
              ...SANDBOX_CLIENT_DEFAULTS,
              Gender: genderOption.name,
            },
          }, ...remaining);
        }
        return provider[property](...args);
      });
    },
  });
}

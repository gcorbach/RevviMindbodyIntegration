export function requiredMindbodyText(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} is required.`);
  return value.trim();
}

export function createMindbodyJsonTransport(options) {
  const apiKey = requiredMindbodyText(options?.apiKey, "apiKey");
  const siteId = requiredMindbodyText(options?.siteId, "siteId");
  const userToken = typeof options?.userToken === "string" && options.userToken.trim() ? options.userToken.trim() : null;
  const baseUrl = requiredMindbodyText(options?.baseUrl ?? "https://api.mindbodyonline.com", "baseUrl")
    .replace(/\/+$/, "")
    .replace(/\/public\/v6$/i, "");
  const timeoutMs = Number(options?.requestTimeoutMs ?? 10_000);
  const fetchImpl = options?.fetchImpl ?? fetch;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("requestTimeoutMs must be between 1 and 60000.");
  }
  if (typeof options?.createError !== "function") throw new TypeError("createError is required.");

  return Object.freeze({
    async request(path, { method = "GET", searchParams, body } = {}) {
      const url = new URL(`${baseUrl}/public/v6/${path}`);
      if (searchParams instanceof URLSearchParams) url.search = searchParams.toString();
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: {
            Accept: "application/json",
            "Api-Key": apiKey,
            SiteId: siteId,
            ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw options.createError(options.unavailableMessage, {
          endpointName: path, statusCode: null, providerRequestId: null,
          errorCode: cause?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
        }, cause);
      }
      if (!response.ok) {
        throw options.createError(options.unavailableMessage, {
          endpointName: path,
          statusCode: response.status,
          providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("request-id"),
          errorCode: `HTTP_${response.status}`,
        });
      }
      try {
        return await response.json();
      } catch (cause) {
        throw options.createError(options.invalidMessage, {
          endpointName: path,
          statusCode: response.status,
          providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("request-id"),
          errorCode: "INVALID_JSON",
        }, cause);
      }
    },
  });
}

export function instrumentMindbodyProvider(provider, endpointMap, options) {
  const clock = options?.clock ?? (() => performance.now());
  const instrumented = {};
  for (const [method, endpointName] of Object.entries(endpointMap)) {
    if (typeof provider?.[method] !== "function") continue;
    instrumented[method] = async (...args) => {
      const startedAt = clock();
      try {
        const result = await provider[method](...args);
        await options.recordDiagnostic({
          ...options.context,
          endpointName,
          requestId: options.requestId ?? null,
          providerRequestId: null,
          statusCode: 200,
          durationMs: Math.max(0, Math.round(clock() - startedAt)),
          success: true,
          errorCode: null,
        });
        return result;
      } catch (error) {
        const diagnostic = error?.diagnostic ?? {};
        await options.recordDiagnostic({
          ...options.context,
          endpointName: diagnostic.endpointName ?? endpointName,
          requestId: options.requestId ?? null,
          providerRequestId: diagnostic.providerRequestId ?? null,
          statusCode: diagnostic.statusCode ?? null,
          durationMs: Math.max(0, Math.round(clock() - startedAt)),
          success: false,
          errorCode: diagnostic.errorCode ?? "UNEXPECTED_ERROR",
        });
        throw error;
      }
    };
  }
  return Object.freeze(instrumented);
}

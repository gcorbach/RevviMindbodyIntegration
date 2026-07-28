export class MindbodyApiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "MindbodyApiError";
    this.status = status;
  }
}

function asString(value) {
  return value === null || value === undefined ? null : String(value);
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeSessionTypes(payload) {
  const values = payload?.SessionTypes ?? payload?.sessionTypes ?? payload?.Services ?? payload?.services ?? [];
  if (!Array.isArray(values)) return [];

  return values
    .map((item) => ({
      providerId: asString(item.Id ?? item.ID ?? item.SessionTypeId ?? item.ProductId),
      name: asString(item.Name ?? item.ServiceName ?? item.Title ?? item.Description),
      description: asString(item.Description),
      durationMinutes: asNumber(item.DurationMinutes ?? item.Duration ?? item.SessionLength),
      price: asNumber(item.OnlinePrice ?? item.Price),
    }))
    .filter((item) => item.providerId && item.name);
}

export function normalizeLocations(payload) {
  const values = payload?.Locations ?? payload?.locations ?? [];
  if (!Array.isArray(values)) return [];

  return values
    .map((item) => ({
      providerId: asString(item.Id ?? item.ID ?? item.LocationId),
      name: asString(item.Name ?? item.LocationName),
    }))
    .filter((item) => item.providerId && item.name);
}

export function selectEnabledServices(sessionTypes, configuredServices) {
  const byProviderId = new Map(sessionTypes.map((service) => [service.providerId, service]));

  return configuredServices
    .filter((service) => service.enabled)
    .map((configured) => {
      const live = byProviderId.get(String(configured.mindbody_session_type_id));
      if (!live) return null;

      return {
        id: configured.id,
        name: configured.display_name_override || live.name,
        description: live.description,
        durationMinutes: live.durationMinutes,
        price: live.price,
      };
    })
    .filter(Boolean);
}

export function createMindbodyClient({ apiKey, baseUrl, siteId, fetchImpl = fetch }) {
  if (!apiKey || !baseUrl || !siteId) {
    throw new MindbodyApiError("Mindbody sandbox configuration is incomplete.", 500);
  }

  return {
    async getLocations() {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/site/locations?Limit=100`, {
        headers: {
          Accept: "application/json",
          "Api-Key": apiKey,
          SiteId: siteId,
        },
      });

      if (!response.ok) {
        await response.text();
        throw new MindbodyApiError("Mindbody location lookup failed.", 502);
      }

      return normalizeLocations(await response.json());
    },
    async getSessionTypes() {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/site/sessiontypes?Limit=100`, {
        headers: {
          Accept: "application/json",
          "Api-Key": apiKey,
          SiteId: siteId,
        },
      });

      if (!response.ok) {
        await response.text();
        throw new MindbodyApiError("Mindbody service catalogue lookup failed.", 502);
      }

      return normalizeSessionTypes(await response.json());
    },
  };
}

export function createMindbodyTestDouble({ apiKey, siteId }) {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers);
    if (headers.get("Api-Key") !== apiKey || headers.get("SiteId") !== siteId) {
      return new Response(JSON.stringify({ Error: "Invalid test-double credentials." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const path = new URL(String(input)).pathname;
    if (path.endsWith("/site/locations")) {
      return new Response(JSON.stringify({ Locations: [{ Id: 1, Name: "Clubville" }] }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path.endsWith("/site/sessiontypes")) {
      return new Response(JSON.stringify({
        SessionTypes: [{ Id: 23, Name: "Nutrition Consultation", Description: "Stub live service", Duration: 45, OnlinePrice: 120 }],
      }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ Error: "Unknown test-double endpoint." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

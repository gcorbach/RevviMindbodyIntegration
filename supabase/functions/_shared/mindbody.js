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

function asIsoDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

export function normalizeBookableItems(payload) {
  const values = payload?.Availabilities ?? payload?.availabilities ?? payload?.BookableItems ?? payload?.bookableItems ?? [];
  if (!Array.isArray(values)) return [];

  return values
    .map((item) => {
      const sessionType = item.SessionType ?? item.sessionType ?? {};
      const location = item.Location ?? item.location ?? {};
      return {
        providerId: asString(item.Id ?? item.ID ?? item.AppointmentId ?? item.BookableItemId),
        startTime: asIsoDateTime(item.StartDateTime ?? item.startDateTime ?? item.StartTime),
        endTime: asIsoDateTime(item.EndDateTime ?? item.endDateTime ?? item.EndTime),
        locationProviderId: asString(location.Id ?? location.ID ?? location.LocationId ?? item.LocationId),
        durationMinutes: asNumber(item.DurationMinutes ?? item.Duration ?? sessionType.DurationMinutes ?? sessionType.Duration),
        price: asNumber(item.Price ?? item.OnlinePrice ?? sessionType.OnlinePrice ?? sessionType.Price),
      };
    })
    .filter((item) => item.providerId && item.startTime);
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

  async function getJson(path, errorMessage) {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      headers: {
        Accept: "application/json",
        "Api-Key": apiKey,
        SiteId: siteId,
      },
    });

    if (!response.ok) {
      await response.text();
      throw new MindbodyApiError(errorMessage, 502);
    }

    return response.json();
  }

  return {
    async getLocations() {
      return normalizeLocations(await getJson("/site/locations?Limit=100", "Mindbody location lookup failed."));
    },
    async getSessionTypes() {
      return normalizeSessionTypes(await getJson("/site/sessiontypes?Limit=100", "Mindbody service catalogue lookup failed."));
    },
    async getBookableItems({ sessionTypeId, locationId, startDate, endDate }) {
      const query = new URLSearchParams({
        SessionTypeIds: String(sessionTypeId),
        LocationIds: String(locationId),
        StartDate: startDate,
        EndDate: endDate,
      });
      return normalizeBookableItems(await getJson(`/appointment/bookableitems?${query}`, "Mindbody availability lookup failed."));
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

    if (path.endsWith("/appointment/bookableitems")) {
      const url = new URL(String(input));
      const startDate = url.searchParams.get("StartDate")?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
      const locationId = url.searchParams.get("LocationIds") ?? "1";
      const sessionTypeId = url.searchParams.get("SessionTypeIds") ?? "23";
      const emptyDate = Deno.env.get("MINDBODY_TEST_DOUBLE_EMPTY_DATE");
      const candidateDate = startDate === emptyDate
        ? new Date(new Date(`${startDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : startDate;
      const start = new Date(`${candidateDate}T16:00:00.000Z`);
      const items = sessionTypeId === "23"
        ? [{
            Id: `sandbox-slot-${candidateDate}`,
            StartDateTime: start.toISOString(),
            EndDateTime: new Date(start.getTime() + 45 * 60 * 1000).toISOString(),
            Location: { Id: locationId, Name: "Clubville" },
            SessionType: { Id: 23, Duration: 45, OnlinePrice: 120 },
            Price: 120,
          }]
        : [];
      return new Response(JSON.stringify({ Availabilities: items }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ Error: "Unknown test-double endpoint." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

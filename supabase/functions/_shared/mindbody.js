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

function normalizeClient(item) {
  return {
    providerId: asString(item?.Id ?? item?.ID ?? item?.ClientId),
    uniqueId: asString(item?.UniqueId ?? item?.UniqueID ?? item?.ClientUniqueId),
    email: asString(item?.Email ?? item?.EmailAddress),
  };
}

function normalizeCreatedClient(payload, fallbackEmail = null) {
  const client = normalizeClient(payload?.Client ?? payload?.client ?? payload);
  return { ...client, email: client.email ?? fallbackEmail };
}

function normalizeAppointment(payload) {
  const item = payload?.Appointment ?? payload?.appointment ?? payload;
  return {
    providerId: asString(item?.Id ?? item?.ID ?? item?.AppointmentId ?? payload?.AppointmentId),
    uniqueId: asString(item?.UniqueId ?? item?.UniqueID ?? item?.AppointmentUniqueId ?? payload?.AppointmentUniqueId),
    paymentNeedsAttention: item?.PaymentNeedsAttention === true,
  };
}

function normalizeAppointments(payload) {
  const values = payload?.Appointments ?? payload?.appointments;
  if (!Array.isArray(values)) throw new MindbodyApiError("Mindbody appointment reconciliation returned an invalid response.");
  return values.map((item) => ({
    providerId: asString(item?.Id ?? item?.ID ?? item?.AppointmentId),
    uniqueId: asString(item?.UniqueId ?? item?.UniqueID ?? item?.AppointmentUniqueId),
    clientId: asString(item?.ClientId ?? item?.Client?.Id),
    locationId: asString(item?.LocationId ?? item?.Location?.Id),
    sessionTypeId: asString(item?.SessionTypeId ?? item?.SessionType?.Id),
    startDateTime: asIsoDateTime(item?.StartDateTime ?? item?.StartDate),
  })).filter((item) => item.providerId && item.clientId && item.startDateTime);
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
      const staffProviderId = asString((item.Staff ?? item.staff)?.Id ?? (item.Staff ?? item.staff)?.ID ?? item.StaffId);
      return {
        providerId: asString(item.Id ?? item.ID ?? item.AppointmentId ?? item.BookableItemId),
        startTime: asIsoDateTime(item.StartDateTime ?? item.startDateTime ?? item.StartTime),
        endTime: asIsoDateTime(item.EndDateTime ?? item.endDateTime ?? item.EndTime),
        locationProviderId: asString(location.Id ?? location.ID ?? location.LocationId ?? item.LocationId),
        ...(staffProviderId ? { staffProviderId } : {}),
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

export function createMindbodyClient({ apiKey, baseUrl, siteId, fetchImpl = fetch, requestTimeoutMs = 10_000 }) {
  if (!apiKey || !baseUrl || !siteId) {
    throw new MindbodyApiError("Mindbody sandbox configuration is incomplete.", 500);
  }

  async function requestJson(path, errorMessage, method = "GET", body = undefined) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Api-Key": apiKey,
          SiteId: siteId,
        },
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new MindbodyApiError(errorMessage, 504);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      await response.text();
      throw new MindbodyApiError(errorMessage, method === "GET" ? 502 : response.status >= 400 && response.status < 600 ? response.status : 502);
    }

    return response.json();
  }

  return {
    async getLocations() {
      return normalizeLocations(await requestJson("/site/locations?Limit=100", "Mindbody location lookup failed."));
    },
    async getSessionTypes() {
      return normalizeSessionTypes(await requestJson("/site/sessiontypes?Limit=100", "Mindbody service catalogue lookup failed."));
    },
    async findClientsByEmail(email) {
      const payload = await requestJson(`/client/clients?Email=${encodeURIComponent(email)}&Limit=10`, "Mindbody Client lookup failed.");
      const values = payload?.Clients ?? payload?.clients ?? [];
      return Array.isArray(values) ? values.map(normalizeClient).filter((client) => client.providerId && client.email) : [];
    },
    async createClient({ firstName, lastName, email }) {
      return normalizeCreatedClient(await requestJson("/client/addclient", "Mindbody Client creation failed.", "POST", {
        FirstName: firstName,
        LastName: lastName,
        Email: email,
      }), email);
    },
    async getBookableItems({ sessionTypeId, locationId, startDate, endDate }) {
      const query = new URLSearchParams({
        SessionTypeIds: String(sessionTypeId),
        LocationIds: String(locationId),
        StartDate: startDate,
        EndDate: endDate,
      });
      return normalizeBookableItems(await requestJson(`/appointment/bookableitems?${query}`, "Mindbody availability lookup failed."));
    },
    async addAppointment({ clientId, locationId, staffId, sessionTypeId, startDateTime }) {
      return normalizeAppointment(await requestJson("/appointment/addappointment", "Mindbody appointment creation failed.", "POST", {
        ClientId: clientId,
        LocationId: locationId,
        StaffId: staffId,
        SessionTypeId: sessionTypeId,
        StartDateTime: startDateTime,
        ApplyPayment: false,
        IgnoreDefaultSessionLength: false,
        // Confirmation state is based on the authoritative appointment result;
        // provider notification delivery is deliberately outside this write.
        SendEmail: false,
      }));
    },
    async findAppointments({ clientId, startDate, endDate }) {
      const query = new URLSearchParams({
        ClientId: String(clientId),
        StartDate: startDate,
        EndDate: endDate,
      });
      return normalizeAppointments(await requestJson(`/appointment/appointments?${query}`, "Mindbody appointment reconciliation failed."));
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

    if (path.endsWith("/client/clients")) {
      const email = new URL(String(input)).searchParams.get("Email") ?? "customer@example.test";
      const mode = Deno.env.get("MINDBODY_TEST_DOUBLE_CLIENT_MODE") ?? "existing";
      const clientId = `sandbox-client-${email.replace(/[^a-z0-9]/gi, "-")}`;
      const clients = mode === "none" ? [] : [
        { Id: clientId, UniqueId: `${clientId}-unique`, Email: email },
        ...(mode === "ambiguous" ? [{ Id: "sandbox-client-101", UniqueId: "sandbox-client-unique-101", Email: email }] : []),
      ];
      return new Response(JSON.stringify({ Clients: clients }), { headers: { "Content-Type": "application/json" } });
    }

    if (path.endsWith("/client/addclient")) {
      if (Deno.env.get("MINDBODY_TEST_DOUBLE_CLIENT_CREATE_FAILURE") === "true") {
        return new Response(JSON.stringify({ Error: "Client creation unavailable." }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      const delay = Number(Deno.env.get("MINDBODY_TEST_DOUBLE_CLIENT_CREATE_DELAY_MS") ?? 0);
      if (Number.isFinite(delay) && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const body = await new Response(init.body).json();
      const identifier = String(body.Email).replace(/[^a-z0-9]/gi, "-");
      return new Response(JSON.stringify({ Client: { Id: `sandbox-client-created-${identifier}`, UniqueId: `sandbox-client-created-unique-${identifier}`, Email: body.Email } }), { headers: { "Content-Type": "application/json" } });
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
      const staleOnDateRange = Deno.env.get("MINDBODY_TEST_DOUBLE_STALE_ON_DATE_RANGE") === "true" && url.searchParams.get("StartDate")?.endsWith("T00:00:00.000Z");
      const configuredStart = Deno.env.get("MINDBODY_TEST_DOUBLE_SLOT_START_TIME");
      const start = configuredStart ? new Date(configuredStart) : new Date(`${candidateDate}T${staleOnDateRange ? "17:00" : "16:00"}:00.000Z`);
      const items = sessionTypeId === "23"
        ? [{
            Id: `sandbox-slot-${candidateDate}`,
            StartDateTime: start.toISOString(),
            EndDateTime: new Date(start.getTime() + 45 * 60 * 1000).toISOString(),
            Location: { Id: locationId, Name: "Clubville" },
            Staff: { Id: 10 },
            SessionType: { Id: 23, Duration: 45, OnlinePrice: 120 },
            Price: 120,
          }]
        : [];
      return new Response(JSON.stringify({ Availabilities: items }), { headers: { "Content-Type": "application/json" } });
    }

    if (path.endsWith("/appointment/addappointment")) {
      const delay = Number(Deno.env.get("MINDBODY_TEST_DOUBLE_APPOINTMENT_CREATE_DELAY_MS") ?? 0);
      if (Number.isFinite(delay) && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (Deno.env.get("MINDBODY_TEST_DOUBLE_APPOINTMENT_CREATE_FAILURE") === "true") {
        return new Response(JSON.stringify({ Error: "Appointment creation unavailable." }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      const body = await new Response(init.body).json();
      if (Deno.env.get("MINDBODY_TEST_DOUBLE_APPOINTMENT_PAYMENT_NEEDS_ATTENTION") === "true") {
        return new Response(JSON.stringify({ Appointment: { Id: "sandbox-appointment-payment-attention", UniqueId: "sandbox-appointment-payment-attention-unique", ClientId: body.ClientId, PaymentNeedsAttention: true } }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ Appointment: { Id: "sandbox-appointment-100", UniqueId: "sandbox-appointment-unique-100", ClientId: body.ClientId } }), { headers: { "Content-Type": "application/json" } });
    }

    if (path.endsWith("/appointment/appointments")) {
      const outcome = Deno.env.get("MINDBODY_TEST_DOUBLE_RECONCILIATION_OUTCOME") ?? "unknown";
      if (outcome === "unknown") {
        return new Response(JSON.stringify({ Error: "Appointment reconciliation unavailable." }), { status: 503, headers: { "Content-Type": "application/json" } });
      }
      if (outcome === "malformed") return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
      if (outcome === "absence") return new Response(JSON.stringify({ Appointments: [] }), { headers: { "Content-Type": "application/json" } });
      const url = new URL(String(input));
      const startDate = url.searchParams.get("StartDate");
      return new Response(JSON.stringify({
        Appointments: [{
          Id: `sandbox-reconciled-appointment-${url.searchParams.get("ClientId")}`,
          UniqueId: `sandbox-reconciled-appointment-unique-${url.searchParams.get("ClientId")}`,
          ClientId: url.searchParams.get("ClientId"),
          LocationId: "1",
          SessionTypeId: "23",
          StartDateTime: startDate,
        }],
      }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ Error: "Unknown test-double endpoint." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

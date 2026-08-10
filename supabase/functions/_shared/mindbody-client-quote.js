import { normalizeMindbodyDateTime } from "./class-availability-request.js";
import {
  createMindbodyJsonTransport,
  instrumentMindbodyProvider,
  requiredMindbodyText,
} from "./mindbody-http.js";

export class MindbodyClientQuoteError extends Error {
  constructor(message, diagnostic, cause) {
    super(message, { cause });
    this.name = "MindbodyClientQuoteError";
    this.diagnostic = Object.freeze({ ...diagnostic });
  }
}

const CLIENT_QUOTE_ENDPOINTS = Object.freeze({
  getSiteCurrency: "site/sites",
  searchClients: "client/clients",
  getClientDuplicates: "client/clientduplicates",
  getRequiredClientFields: "client/requiredclientfields",
  addClient: "client/addclient",
  getClassForClient: "class/classes",
  getClientServices: "client/clientservices",
  testCheckout: "sale/checkoutshoppingcart",
});

function queryParameters(query) {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((item) => parameters.append(name, String(item)));
    else parameters.set(name, String(value));
  }
  return parameters;
}

function clientFact(client) {
  return {
    id: String(client?.Id ?? "").trim(),
    uniqueId: client?.UniqueId == null ? null : String(client.UniqueId).trim(),
    email: String(client?.Email ?? "").trim().toLowerCase(),
    firstName: String(client?.FirstName ?? "").trim(),
    lastName: String(client?.LastName ?? "").trim(),
  };
}

function entitlementFact(service) {
  return {
    id: String(service?.Id ?? "").trim(),
    productId: service?.ProductId == null ? null : String(service.ProductId).trim(),
    current: service?.Current === true,
    remaining: service?.Remaining == null ? null : Number(service.Remaining),
    unlimited: service?.Unlimited === true,
    returned: service?.Returned === true,
    activeAt: service?.ActiveDate ? new Date(service.ActiveDate).toISOString() : null,
    expiresAt: service?.ExpirationDate ? new Date(service.ExpirationDate).toISOString() : null,
  };
}

export function createMindbodyClientQuoteClient(options) {
  const siteId = requiredMindbodyText(options?.siteId, "siteId");
  requiredMindbodyText(options?.userToken, "userToken");
  const transport = createMindbodyJsonTransport({
    ...options,
    unavailableMessage: "Mindbody client-aware pricing is temporarily unavailable.",
    invalidMessage: "Mindbody returned an invalid client-aware pricing response.",
    createError: (message, diagnostic, cause) => new MindbodyClientQuoteError(message, diagnostic, cause),
  });

  async function request(path, { method = "GET", query = {}, body, collection } = {}) {
    const envelope = await transport.request(path, { method, searchParams: queryParameters(query), body });
    if (collection) {
      const items = envelope?.[collection];
      if (!Array.isArray(items)) {
        throw new MindbodyClientQuoteError("Mindbody returned an invalid client-aware pricing response.", {
          endpointName: path, statusCode: 200, errorCode: "INVALID_COLLECTION",
        });
      }
      return items;
    }
    return envelope;
  }

  async function getAll(path, query, collection) {
    const items = [];
    for (let page = 0; page < 10; page += 1) {
      const offset = page * 100;
      const envelope = await request(path, { query: { ...query, Limit: 100, Offset: offset } });
      const pageItems = envelope?.[collection];
      if (!Array.isArray(pageItems)) {
        throw new MindbodyClientQuoteError("Mindbody returned an invalid client-aware pricing response.", {
          endpointName: path, statusCode: 200, errorCode: "INVALID_COLLECTION",
        });
      }
      items.push(...pageItems);
      const total = Number(envelope?.PaginationResponse?.TotalResults);
      if ((Number.isSafeInteger(total) && items.length >= total) || pageItems.length < 100) return items;
    }
    throw new MindbodyClientQuoteError("Mindbody client results exceeded the safe paging limit.", {
      endpointName: path, statusCode: 200, errorCode: "PAGE_LIMIT_EXCEEDED",
    });
  }

  return Object.freeze({
    getSiteCurrency: async () => {
      const sites = await request("site/sites", { collection: "Sites" });
      const selected = sites.find((site) => String(site?.Id) === siteId) ?? (sites.length === 1 ? sites[0] : null);
      const currency = String(selected?.CurrencyCode ?? selected?.Currency?.Code ?? "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        throw new MindbodyClientQuoteError("Mindbody returned an invalid Site currency.", {
          endpointName: "site/sites", statusCode: 200, errorCode: "INVALID_CURRENCY",
        });
      }
      return currency;
    },
    searchClients: async ({ email }) => (await getAll(
      "client/clients",
      { SearchText: requiredMindbodyText(email, "email") },
      "Clients",
    )).map(clientFact),
    getClientDuplicates: async ({ firstName, lastName, email }) => (await getAll(
      "client/clientduplicates",
      {
        FirstName: requiredMindbodyText(firstName, "firstName"),
        LastName: requiredMindbodyText(lastName, "lastName"),
        Email: requiredMindbodyText(email, "email"),
      },
      "Clients",
    )).map(clientFact),
    getRequiredClientFields: async () => {
      const envelope = await request("client/requiredclientfields");
      const fields = envelope?.RequiredClientFields ?? envelope?.RequiredFields;
      if (!Array.isArray(fields)) {
        throw new MindbodyClientQuoteError("Mindbody returned invalid required Client fields.", {
          endpointName: "client/requiredclientfields", statusCode: 200, errorCode: "INVALID_REQUIRED_FIELDS",
        });
      }
      return fields.map((field) => String(field?.FieldName ?? field));
    },
    addClient: async ({ client, test }) => {
      const envelope = await request("client/addclient", {
        method: "POST",
        body: { Client: client, Test: test === true },
      });
      if (test === true) return null;
      return clientFact(envelope?.Client ?? envelope?.Clients?.[0]);
    },
    getClassForClient: async ({ classId, clientId, uniqueClientId, timezone }) => {
      const classes = await request("class/classes", {
        query: {
          ClassIds: [requiredMindbodyText(classId, "classId")],
          ClientId: requiredMindbodyText(clientId, "clientId"),
          UniqueClientId: uniqueClientId == null ? undefined : requiredMindbodyText(String(uniqueClientId), "uniqueClientId"),
        },
        collection: "Classes",
      });
      if (classes.length !== 1) {
        throw new MindbodyClientQuoteError("The selected Class occurrence could not be verified.", {
          endpointName: "class/classes", statusCode: 200, errorCode: "CLASS_NOT_UNIQUE",
        });
      }
      const occurrence = classes[0];
      const startAt = normalizeMindbodyDateTime(occurrence?.StartDateTime, requiredMindbodyText(timezone, "timezone"));
      if (!startAt) {
        throw new MindbodyClientQuoteError("Mindbody returned an invalid Class time.", {
          endpointName: "class/classes", statusCode: 200, errorCode: "INVALID_CLASS_TIME",
        });
      }
      return {
        id: String(occurrence.Id),
        classScheduleId: occurrence.ClassScheduleId == null ? null : String(occurrence.ClassScheduleId),
        classDescriptionId: String(occurrence.ClassDescription?.Id ?? ""),
        programId: String(occurrence.ClassDescription?.Program?.Id ?? ""),
        sessionTypeId: String(occurrence.ClassDescription?.SessionType?.Id ?? ""),
        name: String(occurrence.ClassDescription?.Name ?? "Class"),
        ...(occurrence.Staff?.Name == null ? {} : { staffName: String(occurrence.Staff.Name) }),
        startAt,
        ...(occurrence?.EndDateTime == null ? {} : {
          endAt: normalizeMindbodyDateTime(occurrence.EndDateTime, requiredMindbodyText(timezone, "timezone")),
        }),
        locationId: String(occurrence.Location?.Id ?? ""),
        locationName: String(occurrence.Location?.Name ?? ""),
        isAvailable: occurrence.IsAvailable === true,
        isCanceled: occurrence.IsCanceled === true,
      };
    },
    getClientServices: async ({ classId, clientId }) => (await getAll(
      "client/clientservices",
      { ClientId: requiredMindbodyText(clientId, "clientId"), ClassId: requiredMindbodyText(classId, "classId") },
      "ClientServices",
    )).map(entitlementFact),
    testCheckout: async ({ classId, clientId, locationId, productId }) => {
      const envelope = await request("sale/checkoutshoppingcart", {
        method: "POST",
        body: {
          ClientId: requiredMindbodyText(clientId, "clientId"),
          LocationId: requiredMindbodyText(locationId, "locationId"),
          Test: true,
          CartItems: [{ Item: { Type: "Service", Metadata: { Id: requiredMindbodyText(productId, "productId") } }, Quantity: 1 }],
          ClassIds: [requiredMindbodyText(classId, "classId")],
        },
      });
      const cart = envelope?.ShoppingCart;
      const totals = {
        subtotal: Number(cart?.SubTotal),
        discountTotal: Number(cart?.DiscountTotal),
        taxTotal: Number(cart?.TaxTotal),
        grandTotal: Number(cart?.GrandTotal),
      };
      if (Object.values(totals).some((value) => !Number.isFinite(value) || value < 0)
        || Math.abs(totals.subtotal - totals.discountTotal + totals.taxTotal - totals.grandTotal) > 0.005) {
        throw new MindbodyClientQuoteError("Mindbody returned invalid quote totals.", {
          endpointName: "sale/checkoutshoppingcart", statusCode: 200, errorCode: "INVALID_TOTALS",
        });
      }
      return totals;
    },
  });
}

export function instrumentClientQuoteProvider(provider, options) {
  return instrumentMindbodyProvider(provider, CLIENT_QUOTE_ENDPOINTS, options);
}

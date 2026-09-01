import {
  normalizeMindbodyDateTime,
  resolveClassAvailabilityDateRange,
} from "./class-availability-request.js";
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
  getServices: "sale/services",
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

function requiredMindbodyInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive Mindbody integer ID.`);
  }
  return number;
}

export function createMindbodyClientQuoteClient(options) {
  const siteId = requiredMindbodyText(options?.siteId, "siteId");
  requiredMindbodyText(options?.userToken, "userToken");
  const now = typeof options?.now === "function" ? options.now : () => new Date();
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

  async function quotePaymentAmount({ classId, checkoutLocationId, classLocationId, productId }) {
    const services = await getAll("sale/services", {
      ClassId: classId,
      LocationId: checkoutLocationId,
      SellOnline: true,
      HideRelatedPrograms: false,
      IncludeDiscontinued: false,
    }, "Services");
    const matchingPricingOptions = services.filter((service) => String(service?.ProductId ?? "").trim() === productId
      && service?.SellOnline !== false
      && service?.Discontinued !== true);
    if (matchingPricingOptions.length !== 1) {
      throw new MindbodyClientQuoteError("The configured Mindbody pricing option could not be quoted uniquely.", {
        endpointName: "sale/services", statusCode: 200,
        errorCode: matchingPricingOptions.length === 0 ? "SERVICE_NOT_FOUND" : "SERVICE_NOT_UNIQUE",
      });
    }
    const pricingOption = matchingPricingOptions[0];
    const includesLocation = (ids, selectedLocationId) => Array.isArray(ids)
      && ids.map(String).includes(String(selectedLocationId));
    if (!includesLocation(pricingOption.SellAtLocationIds, checkoutLocationId)
      || !includesLocation(pricingOption.UseAtLocationIds, classLocationId)) {
      throw new MindbodyClientQuoteError("The configured Mindbody pricing option is not valid at the required sale and use Locations.", {
        endpointName: "sale/services", statusCode: 200, errorCode: "SERVICE_LOCATION_NOT_APPROVED",
      });
    }
    const onlinePrice = Number(pricingOption.OnlinePrice);
    const taxRate = Number(pricingOption.TaxRate ?? 0);
    const taxIncluded = pricingOption.TaxIncluded === true || pricingOption.TaxIncluded === 1;
    if (!Number.isFinite(onlinePrice) || onlinePrice < 0
      || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
      throw new MindbodyClientQuoteError("Mindbody returned invalid pricing-option seed totals.", {
        endpointName: "sale/services", statusCode: 200, errorCode: "INVALID_SERVICE_PRICE",
      });
    }
    return Number((taxIncluded ? onlinePrice : onlinePrice * (1 + taxRate)).toFixed(2));
  }

  return Object.freeze({
    getSiteCurrency: async () => {
      const sites = await request("site/sites", { collection: "Sites" });
      const selected = sites.find((site) => String(site?.Id) === siteId) ?? (sites.length === 1 ? sites[0] : null);
      const currency = String(
        selected?.CurrencyIsoCode ?? selected?.CurrencyCode ?? selected?.Currency?.Code ?? "",
      ).trim().toUpperCase();
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
      "ClientDuplicates",
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
        body: { ...client, Test: test === true },
      });
      if (test === true) return null;
      return clientFact(envelope?.Client ?? envelope?.Clients?.[0]);
    },
    getClassForClient: async ({ classId, clientId, uniqueClientId, timezone }) => {
      const locationTimezone = requiredMindbodyText(timezone, "timezone");
      const dateRange = resolveClassAvailabilityDateRange({
        timezone: locationTimezone,
        now: now(),
      });
      const classes = await request("class/classes", {
        query: {
          ClassIds: [requiredMindbodyText(classId, "classId")],
          StartDateTime: dateRange.startAt,
          EndDateTime: dateRange.endAt,
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
      const startAt = normalizeMindbodyDateTime(occurrence?.StartDateTime, locationTimezone);
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
          endAt: normalizeMindbodyDateTime(occurrence.EndDateTime, locationTimezone),
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
    getServices: async ({ classId, locationId, sellOnline = true, includeDiscontinued = false }) => getAll(
      "sale/services",
      {
        ClassId: requiredMindbodyInteger(classId, "classId"),
        LocationId: requiredMindbodyInteger(locationId, "locationId"),
        SellOnline: sellOnline,
        HideRelatedPrograms: false,
        IncludeDiscontinued: includeDiscontinued,
      },
      "Services",
    ),
    testCheckout: async ({
      siteId: operationSiteId,
      classId,
      clientId,
      checkoutLocationId,
      classLocationId,
      productId,
    }) => {
      const selectedSiteId = requiredMindbodyText(operationSiteId, "siteId");
      if (selectedSiteId !== siteId) {
        throw new MindbodyClientQuoteError("The quote Site does not match the configured Mindbody client.", {
          endpointName: "sale/checkoutshoppingcart", statusCode: null, errorCode: "SITE_CONTEXT_MISMATCH",
        });
      }
      const selectedClassId = requiredMindbodyInteger(classId, "classId");
      const selectedCheckoutLocationId = requiredMindbodyInteger(checkoutLocationId, "checkoutLocationId");
      const selectedClassLocationId = requiredMindbodyInteger(classLocationId, "classLocationId");
      const selectedProductId = requiredMindbodyText(productId, "productId");
      const paymentAmount = await quotePaymentAmount({
        classId: selectedClassId,
        checkoutLocationId: selectedCheckoutLocationId,
        classLocationId: selectedClassLocationId,
        productId: selectedProductId,
      });
      const envelope = await request("sale/checkoutshoppingcart", {
        method: "POST",
        body: {
          ClientId: requiredMindbodyText(clientId, "clientId"),
          LocationId: selectedCheckoutLocationId,
          Test: true,
          InStore: false,
          CalculateTax: true,
          SendEmail: false,
          EnforceLocationRestrictions: true,
          Items: [{
            Item: { Type: "Service", Metadata: { Id: selectedProductId } },
            Quantity: 1,
            ClassIds: [selectedClassId],
          }],
          Payments: [{
            Type: "Cash",
            MetaData: { Amount: paymentAmount, Notes: "Revvi Test quote" },
          }],
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

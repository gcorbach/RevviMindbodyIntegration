import { createMindbodyJsonTransport, instrumentMindbodyProvider } from "./mindbody-http.js";

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 50;

const RESOURCES = Object.freeze({
  sites: { path: "site/sites", collection: "Sites" },
  locations: { path: "site/locations", collection: "Locations" },
  programs: { path: "site/programs", collection: "Programs" },
  sessionTypes: { path: "site/sessiontypes", collection: "SessionTypes" },
  classDescriptions: { path: "class/classdescriptions", collection: "ClassDescriptions" },
  classSchedules: { path: "class/classschedules", collection: "ClassSchedules" },
  classes: { path: "class/classes", collection: "Classes" },
  services: { path: "sale/services", collection: "Services" },
});

const PROVIDER_METHOD_ENDPOINTS = Object.freeze({
  getSites: "site/sites",
  getLocations: "site/locations",
  getPrograms: "site/programs",
  getSessionTypes: "site/sessiontypes",
  getClassDescriptions: "class/classdescriptions",
  getClassSchedules: "class/classschedules",
  getClasses: "class/classes",
  getServices: "sale/services",
});

const QUERY_NAMES = Object.freeze({
  siteIds: "SiteIds",
  includeLeadChannels: "IncludeLeadChannels",
  includePerStaffPricing: "IncludePerStaffPricing",
  onlineOnly: "OnlineOnly",
  programIds: "ProgramIds",
  scheduleType: "ScheduleType",
  classDescriptionId: "ClassDescriptionId",
  locationId: "LocationId",
  staffId: "StaffId",
  startClassDateTime: "StartClassDateTime",
  endClassDateTime: "EndClassDateTime",
  includeInactive: "IncludeInactive",
  classScheduleIds: "ClassScheduleIds",
  startDate: "StartDate",
  endDate: "EndDate",
  locationIds: "LocationIds",
  sessionTypeIds: "SessionTypeIds",
  staffIds: "StaffIds",
  classIds: "ClassIds",
  classDescriptionIds: "ClassDescriptionIds",
  startDateTime: "StartDateTime",
  endDateTime: "EndDateTime",
  clientId: "ClientId",
  uniqueClientId: "UniqueClientId",
  hideCanceledClasses: "HideCanceledClasses",
  schedulingWindow: "SchedulingWindow",
  lastModifiedDate: "LastModifiedDate",
  classId: "ClassId",
  classScheduleId: "ClassScheduleId",
  serviceIds: "ServiceIds",
  sellOnline: "SellOnline",
  hideRelatedPrograms: "HideRelatedPrograms",
  includeDiscontinued: "IncludeDiscontinued",
  includeSaleInContractOnly: "IncludeSaleInContractOnly",
});

export class MindbodyClassReadError extends Error {
  constructor(message, diagnostic, cause) {
    super(message, { cause });
    this.name = "MindbodyClassReadError";
    this.diagnostic = Object.freeze({ ...diagnostic });
  }

  toJSON() {
    return { name: this.name, diagnostic: this.diagnostic };
  }
}

function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be a positive integer no greater than ${maximum}.`);
  }
  return value;
}

function appendQuery(searchParams, input) {
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    const queryName = QUERY_NAMES[key];
    if (!queryName) throw new TypeError(`Unsupported Mindbody query field: ${key}.`);
    if (Array.isArray(value)) {
      for (const item of value) searchParams.append(queryName, String(item));
    } else {
      searchParams.set(queryName, String(value));
    }
  }
}

function paginationFacts(body, fallbackOffset, pageLength) {
  const pagination = body?.PaginationResponse ?? body?.Pagination ?? {};
  const total = Number(pagination.TotalResults);
  const offset = Number(pagination.RequestedOffset);
  const pageSize = Number(pagination.PageSize);
  return {
    total: Number.isSafeInteger(total) && total >= 0 ? total : null,
    offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : fallbackOffset,
    pageSize: Number.isSafeInteger(pageSize) && pageSize >= 0 ? pageSize : pageLength,
  };
}

export function createMindbodyClassReadClient(options) {
  const pageLimit = positiveInteger(options?.pageLimit ?? DEFAULT_PAGE_LIMIT, "pageLimit", 200);
  const maxPages = positiveInteger(options?.maxPages ?? DEFAULT_MAX_PAGES, "maxPages", 100);
  const transport = createMindbodyJsonTransport({
    ...options,
    unavailableMessage: "Mindbody class inventory is temporarily unavailable.",
    invalidMessage: "Mindbody returned an invalid class inventory response.",
    createError: (message, diagnostic, cause) => new MindbodyClassReadError(message, diagnostic, cause),
  });

  async function getAll(resource, query = {}) {
    const definition = RESOURCES[resource];
    let offset = 0;
    const results = [];

    for (let page = 0; page < maxPages; page += 1) {
      const searchParams = new URLSearchParams();
      appendQuery(searchParams, query);
      searchParams.set("Limit", String(pageLimit));
      searchParams.set("Offset", String(offset));
      const body = await transport.request(definition.path, { searchParams });
      const pageItems = body?.[definition.collection];
      if (!Array.isArray(pageItems)) {
        throw new MindbodyClassReadError("Mindbody returned an invalid class inventory response.", {
          endpointName: definition.path,
          statusCode: 200,
          providerRequestId: null,
          errorCode: "INVALID_COLLECTION",
        });
      }
      results.push(...pageItems);
      const pagination = paginationFacts(body, offset, pageItems.length);
      if (pagination.total !== null && results.length >= pagination.total) return results;
      if (pageItems.length === 0 || pagination.pageSize === 0) return results;
      offset = pagination.offset + pagination.pageSize;
    }

    throw new MindbodyClassReadError("Mindbody class inventory exceeded the paging limit.", {
      endpointName: definition.path,
      statusCode: null,
      providerRequestId: null,
      errorCode: "PAGE_LIMIT_EXCEEDED",
    });
  }

  return Object.freeze({
    getSites: (query) => getAll("sites", query),
    getLocations: (query) => getAll("locations", query),
    getPrograms: (query) => getAll("programs", query),
    getSessionTypes: (query) => getAll("sessionTypes", query),
    getClassDescriptions: (query) => getAll("classDescriptions", query),
    getClassSchedules: (query) => getAll("classSchedules", query),
    getClasses: (query) => getAll("classes", query),
    getServices: (query) => getAll("services", query),
  });
}

export function instrumentClassReadProvider(provider, options) {
  return instrumentMindbodyProvider(provider, PROVIDER_METHOD_ENDPOINTS, options);
}

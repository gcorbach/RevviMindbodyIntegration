import {
  localTimeSecondsAt,
  normalizeMindbodyDateTime,
} from "./class-availability-request.js";

const REQUIRED_ALLOWLIST_KINDS = Object.freeze([
  "location",
  "program",
  "classDescription",
  "sessionType",
]);

export class ClassAvailabilityError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "ClassAvailabilityError";
    this.code = code;
    this.status = status;
  }
}

function id(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function finiteCapacity(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function exactEntity(items, expectedId) {
  return items.find((item) => id(item?.Id) === expectedId) ?? null;
}

function normalizedAllowlist(value) {
  const normalized = {};
  for (const [kind, values] of Object.entries(value ?? {})) {
    normalized[kind] = [...new Set((values ?? []).map(id).filter(Boolean))];
  }
  return normalized;
}

function selectedClassFamily(context, classFamilyId) {
  if (!Array.isArray(context?.classFamilies)) return null;
  if (classFamilyId === undefined || classFamilyId === null || classFamilyId === "") return null;
  const family = context.classFamilies.find((candidate) => id(candidate?.id) === id(classFamilyId));
  if (!family || family.status === "inactive" || family.status === "disabled") {
    throw new ClassAvailabilityError("CLASS_FAMILY_NOT_FOUND", "This Class family is not available.", 404);
  }
  const mappings = (family.providerMappings ?? []).filter((mapping) => mapping?.status !== "inactive"
    && mapping?.status !== "disabled");
  if (!mappings.length) {
    throw new ClassAvailabilityError("CLASS_FAMILY_UNAVAILABLE", "This Class family has no active provider mapping.");
  }
  return { ...family, providerMappings: mappings };
}

function familyAllowlist(family, fallback) {
  if (!family) return fallback;
  return familiesAllowlist([family], fallback);
}

function familiesAllowlist(families, fallback) {
  if (!Array.isArray(families) || families.length === 0) return fallback;
  const values = (field) => [...new Set(families.flatMap((family) => family.providerMappings ?? [])
    .map((mapping) => id(mapping[field]))
    .filter(Boolean))];
  return {
    location: values("providerLocationId"),
    program: values("providerProgramId"),
    classDescription: values("providerClassDescriptionId"),
    sessionType: values("providerSessionTypeId"),
    classSchedule: values("providerClassScheduleId"),
  };
}

function familyMappingMatches(family, locationId, taxonomy, classScheduleId) {
  if (!family) return true;
  return family.providerMappings.some((mapping) => id(mapping.providerLocationId) === locationId
    && id(mapping.providerClassDescriptionId) === taxonomy.classDescriptionId
    && id(mapping.providerProgramId) === taxonomy.programId
    && id(mapping.providerSessionTypeId) === taxonomy.sessionTypeId
    && (!mapping.providerClassScheduleId || id(mapping.providerClassScheduleId) === id(classScheduleId)));
}

function matchingClassFamily(families, locationId, taxonomy, classScheduleId) {
  if (!Array.isArray(families) || families.length === 0) return null;
  return families.find((family) => family.status !== "inactive" && family.status !== "disabled"
    && family.providerMappings?.some((mapping) => id(mapping.providerLocationId) === locationId
      && id(mapping.providerClassDescriptionId) === taxonomy.classDescriptionId
      && id(mapping.providerProgramId) === taxonomy.programId
      && id(mapping.providerSessionTypeId) === taxonomy.sessionTypeId
      && (!mapping.providerClassScheduleId
        || id(mapping.providerClassScheduleId) === id(classScheduleId)))) ?? null;
}

function requireConfiguredContext(context) {
  if (context?.integration?.status !== "active" || context?.mapping?.status !== "active") {
    throw new ClassAvailabilityError("OFFER_MAPPING_INACTIVE", "This Revvi Offer is not available.");
  }
  const allowlist = normalizedAllowlist(context.inventoryAllowlist);
  if (REQUIRED_ALLOWLIST_KINDS.some((kind) => !allowlist[kind]?.length)) {
    throw new ClassAvailabilityError(
      "INVENTORY_ALLOWLIST_INCOMPLETE",
      "This Revvi Offer has no complete approved Class inventory.",
    );
  }
  if (!allowlist.location.includes(id(context.location.providerLocationId))) {
    throw new ClassAvailabilityError("LOCATION_NOT_APPROVED", "This Location is not approved for the Revvi Offer.");
  }
  return allowlist;
}

function isAllowed(values, candidateId) {
  return values.includes(id(candidateId));
}

function occurrenceTaxonomy(item, description) {
  const embedded = item?.ClassDescription ?? {};
  return {
    classDescriptionId: id(embedded.Id ?? description?.Id),
    programId: id(embedded.Program?.Id ?? description?.Program?.Id),
    sessionTypeId: id(embedded.SessionType?.Id ?? description?.SessionType?.Id),
  };
}

function normalizeInstant(value, timezone = "UTC") {
  return normalizeMindbodyDateTime(value, timezone);
}

function capacityFacts(item) {
  const maxCapacity = finiteCapacity(item?.MaxCapacity);
  const webCapacity = finiteCapacity(item?.WebCapacity);
  const totalBooked = finiteCapacity(item?.TotalBooked);
  const webBooked = finiteCapacity(item?.WebBooked ?? item?.TotalWebBooked);
  const complete = [maxCapacity, webCapacity, totalBooked, webBooked].every((value) => value !== null);
  const contradictory = (maxCapacity !== null && totalBooked !== null && totalBooked > maxCapacity)
    || (webCapacity !== null && webBooked !== null && webBooked > webCapacity);
  return {
    maxCapacity,
    webCapacity,
    totalBooked,
    webBooked,
    estimatedAvailableSlots: complete && !contradictory
      ? Math.min(maxCapacity - totalBooked, webCapacity - webBooked)
      : null,
    contradictory,
  };
}

function timeOfDaySeconds(value) {
  if (typeof value !== "string") return null;
  const match = /(?:^|T)(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return (hour * 60 * 60) + (minute * 60) + second;
}

function outsideDailyBookingWindow(window, now, timezone) {
  const dailyOpensAt = timeOfDaySeconds(
    window?.DailyStartTime ?? window?.DailyOpenTime ?? window?.DailyOpensAt,
  );
  const dailyClosesAt = timeOfDaySeconds(
    window?.DailyEndTime ?? window?.DailyCloseTime ?? window?.DailyClosesAt,
  );
  if (dailyOpensAt === null && dailyClosesAt === null) return false;
  const current = localTimeSecondsAt(now, timezone);
  if (dailyOpensAt !== null && dailyClosesAt !== null) {
    return dailyOpensAt <= dailyClosesAt
      ? current < dailyOpensAt || current > dailyClosesAt
      : current > dailyClosesAt && current < dailyOpensAt;
  }
  return dailyOpensAt !== null ? current < dailyOpensAt : current > dailyClosesAt;
}

function bookingWindowState(item, now, timezone) {
  const window = item?.BookingWindow;
  const opensAt = normalizeInstant(
    window?.StartDateTime
      ?? window?.OpenDateTime
      ?? window?.OpensAt
      ?? window?.Start,
    timezone,
  );
  const closesAt = normalizeInstant(
    window?.EndDateTime
      ?? window?.CloseDateTime
      ?? window?.ClosesAt
      ?? window?.End,
    timezone,
  );
  if ((opensAt && now < new Date(opensAt))
    || (closesAt && now > new Date(closesAt))
    || outsideDailyBookingWindow(window, now, timezone)) {
    return { state: "outside_booking_window", reasons: ["outside_booking_window"] };
  }
  return null;
}

function availabilityFacts(item, capacity, now, timezone, clientAware) {
  const outsideWindow = bookingWindowState(item, now, timezone);
  if (outsideWindow) return outsideWindow;
  if (capacity.contradictory) {
    return { state: "unknown", reasons: ["capacity_contradictory"] };
  }
  if (item?.IsAvailable === true) {
    if (capacity.estimatedAvailableSlots === 0) {
      return { state: "unknown", reasons: ["availability_capacity_contradiction"] };
    }
    return { state: "available", reasons: [] };
  }
  if (item?.IsWaitlistAvailable === true) {
    return { state: "waitlist_available", reasons: ["regular_booking_unavailable"] };
  }
  if (capacity.estimatedAvailableSlots === 0) return { state: "full", reasons: ["capacity_full"] };
  if (item?.IsAvailable === false && clientAware) {
    return { state: "client_ineligible", reasons: ["provider_client_unavailable"] };
  }
  if (item?.IsAvailable === false) {
    return { state: "unknown", reasons: ["anonymous_availability_not_client_specific"] };
  }
  return { state: "unknown", reasons: ["provider_availability_unknown"] };
}

function locationListIncludes(values, locationId) {
  return Array.isArray(values) && values.map((value) => id(value?.Id ?? value)).includes(locationId);
}

function mappedProductIds(mapping) {
  const configured = Array.isArray(mapping?.providerServiceProductIds)
    ? mapping.providerServiceProductIds
    : [mapping?.providerServiceProductId];
  return [...new Set(configured.map(id).filter(Boolean))];
}

function normalizedServiceName(value) {
  return id(value)?.normalize("NFKC").replace(/\s+/g, " ").toLowerCase() ?? null;
}

export function selectMappedService(services, productIds, locationId, productName = null) {
  const allowedProductIds = new Set((Array.isArray(productIds) ? productIds : [productIds]).map(id).filter(Boolean));
  const candidates = services.filter((service) => productName
    ? normalizedServiceName(service?.Name) === normalizedServiceName(productName)
    : allowedProductIds.has(id(service?.ProductId)));
  const namedMatches = productName
    ? new Map(candidates.map((service) => [id(service?.ProductId), service]))
    : null;
  if (productName ? namedMatches.size !== 1 || namedMatches.has(null) : candidates.length !== 1) return null;
  const service = productName ? [...namedMatches.values()][0] : candidates[0];
  if (service.SellOnline !== true || service.Discontinued === true) return null;
  if (!locationListIncludes(service.SellAtLocationIds, locationId)
    || !locationListIncludes(service.UseAtLocationIds, locationId)) return null;
  const amount = Number(service.OnlinePrice);
  return Number.isFinite(amount) && amount >= 0 ? { service, amount } : null;
}

export async function discoverOfferClassAvailability(input, dependencies) {
  const context = input?.context;
  const allowlist = requireConfiguredContext(context);
  const family = selectedClassFamily(context, input?.classFamilyId);
  const queryAllowlist = family
    ? familyAllowlist(family, allowlist)
    : familiesAllowlist(context.classFamilies, allowlist);
  const provider = dependencies?.provider;
  const now = dependencies?.now?.() ?? new Date();
  const siteId = id(context.integration.providerSiteId);
  const locationId = id(context.location.providerLocationId);
  const timezone = context.location.timezone;
  const startAt = normalizeInstant(input.startAt);
  const endAt = normalizeInstant(input.endAt);
  if (!startAt || !endAt || startAt >= endAt) {
    throw new ClassAvailabilityError("INVALID_DATE_RANGE", "A valid Class availability date range is required.", 400);
  }

  const [sites, locations, programs, descriptions, schedules] = await Promise.all([
    provider.getSites({ siteIds: [siteId], includePerStaffPricing: true }),
    provider.getLocations(),
    provider.getPrograms({ programIds: queryAllowlist.program, scheduleType: "Class" }),
    provider.getClassDescriptions({
      programIds: queryAllowlist.program,
      locationId,
      startClassDateTime: startAt,
      endClassDateTime: endAt,
      includeInactive: context.allowInactiveClassDescriptions === true,
    }),
    queryAllowlist.classSchedule?.length
      ? provider.getClassSchedules({
        classScheduleIds: queryAllowlist.classSchedule,
        locationIds: [locationId],
        programIds: queryAllowlist.program,
        sessionTypeIds: queryAllowlist.sessionType,
      })
      : Promise.resolve([]),
  ]);
  const site = exactEntity(sites, siteId);
  const location = exactEntity(locations, locationId);
  if (!site || !location || location.HasClasses !== true) {
    throw new ClassAvailabilityError("PROVIDER_CONTEXT_MISMATCH", "The configured Mindbody Class context is unavailable.");
  }
  const approvedProgramIds = new Set(programs
    .filter((program) => program.ScheduleType === "Class")
    .map((program) => id(program.Id))
    .filter((programId) => isAllowed(queryAllowlist.program, programId)));
  const approvedDescriptions = new Map(descriptions
    .filter((description) => context.allowInactiveClassDescriptions === true || description.Active === true)
    .filter((description) => isAllowed(queryAllowlist.classDescription, description.Id))
    .filter((description) => approvedProgramIds.has(id(description.Program?.Id)))
    .filter((description) => isAllowed(queryAllowlist.sessionType, description.SessionType?.Id))
    .map((description) => [id(description.Id), description]));
  const approvedScheduleIds = new Set(schedules.map((schedule) => id(schedule.Id)));

  const classes = await provider.getClasses({
    locationIds: [locationId],
    programIds: queryAllowlist.program,
    classDescriptionIds: queryAllowlist.classDescription,
    sessionTypeIds: queryAllowlist.sessionType,
    ...(queryAllowlist.classSchedule?.length ? { classScheduleIds: queryAllowlist.classSchedule } : {}),
    startDateTime: startAt,
    endDateTime: endAt,
    ...(context.customerProviderProfile?.providerClientId
      ? { clientId: context.customerProviderProfile.providerClientId }
      : {}),
    hideCanceledClasses: false,
    schedulingWindow: true,
  });

  if (classes.length > 200) {
    throw new ClassAvailabilityError(
      "CLASS_RESULT_LIMIT_EXCEEDED",
      "The approved Class inventory is too broad for one availability request.",
      409,
    );
  }

  const candidates = classes.filter((item) => {
    const descriptionId = id(item?.ClassDescription?.Id);
    const description = approvedDescriptions.get(descriptionId);
    const taxonomy = occurrenceTaxonomy(item, description);
    const occurrenceStart = normalizeInstant(item?.StartDateTime, timezone);
    const occurrenceEnd = normalizeInstant(item?.EndDateTime, timezone);
    const matchedFamily = matchingClassFamily(context.classFamilies, locationId, taxonomy, item?.ClassScheduleId);
    return Boolean(
      id(item?.Id)
      && occurrenceStart && occurrenceStart >= startAt && occurrenceStart <= endAt
      && occurrenceStart > now.toISOString()
      && (!occurrenceEnd || occurrenceEnd > occurrenceStart)
      && id(item?.Location?.Id) === locationId
      && item?.Active === true
      && item?.IsCanceled !== true
      && description
      && isAllowed(queryAllowlist.classDescription, taxonomy.classDescriptionId)
      && approvedProgramIds.has(taxonomy.programId)
      && isAllowed(queryAllowlist.sessionType, taxonomy.sessionTypeId)
      && familyMappingMatches(family, locationId, taxonomy, item?.ClassScheduleId)
      && (!Array.isArray(context.classFamilies) || context.classFamilies.length === 0 || matchedFamily)
      && (!queryAllowlist.classSchedule?.length
        || (isAllowed(queryAllowlist.classSchedule, item?.ClassScheduleId)
          && approvedScheduleIds.has(id(item?.ClassScheduleId))))
    );
  });

  const sessions = [];
  for (const item of candidates) {
    const description = approvedDescriptions.get(id(item.ClassDescription?.Id));
    const taxonomy = occurrenceTaxonomy(item, description);
    const matchedFamily = family ?? matchingClassFamily(
      context.classFamilies,
      locationId,
      taxonomy,
      item?.ClassScheduleId,
    );
    let provisionalPrice;
    if (context.offer.fulfilmentMode === "purchase_pricing_option") {
      const services = await provider.getServices({
        classId: id(item.Id),
        locationId,
        ...(id(item.Staff?.Id) ? { staffId: id(item.Staff.Id) } : {}),
        sellOnline: true,
        includeDiscontinued: false,
      });
      const mappedService = selectMappedService(
        services,
        mappedProductIds(context.mapping),
        locationId,
        matchedFamily?.providerServiceProductName ?? null,
      );
      if (!mappedService) continue;
      provisionalPrice = {
        amount: mappedService.amount,
        currency: id(site.CurrencyIsoCode),
        serviceProductId: id(mappedService.service.ProductId),
      };
      if (!provisionalPrice.currency) continue;
    }
    const capacity = capacityFacts(item);
    const availability = availabilityFacts(
      item,
      capacity,
      now,
      timezone,
      Boolean(context.customerProviderProfile?.providerClientId),
    );
    sessions.push({
      sessionId: id(item.Id),
      classId: id(item.Id),
      ...(id(item.ClassScheduleId) ? { classScheduleId: id(item.ClassScheduleId) } : {}),
      classDescriptionId: taxonomy.classDescriptionId,
      programId: taxonomy.programId,
      sessionTypeId: taxonomy.sessionTypeId,
      ...(matchedFamily ? { classFamilyId: id(matchedFamily.id) } : {}),
      name: String(item.ClassDescription?.Name ?? description?.Name ?? "Class"),
      ...(item.ClassDescription?.Description ?? description?.Description
        ? { description: String(item.ClassDescription?.Description ?? description?.Description) }
        : {}),
      ...(id(item.Staff?.Id) ? { staffId: id(item.Staff.Id) } : {}),
      ...(item.Staff?.DisplayName ?? item.Staff?.Name
        ? { staffName: String(item.Staff.DisplayName ?? item.Staff.Name) }
        : {}),
      startAt: normalizeInstant(item.StartDateTime, timezone),
      ...(normalizeInstant(item.EndDateTime, timezone) ? { endAt: normalizeInstant(item.EndDateTime, timezone) } : {}),
      timezone,
      maxCapacity: capacity.maxCapacity,
      webCapacity: capacity.webCapacity,
      totalBooked: capacity.totalBooked,
      webBooked: capacity.webBooked,
      estimatedAvailableSlots: capacity.estimatedAvailableSlots,
      availabilityState: availability.state,
      availabilityReasons: availability.reasons,
      ...(provisionalPrice ? { provisionalPrice } : {}),
    });
  }

  sessions.sort((left, right) => left.startAt.localeCompare(right.startAt) || left.classId.localeCompare(right.classId));
  return {
    business: {
      id: context.business.id,
      name: context.business.displayName,
      slug: context.business.slug,
    },
    offer: { id: context.offer.id, title: context.offer.displayName },
    ...(Array.isArray(context.classFamilies) && !family ? {
      classFamilies: context.classFamilies
        .filter((candidate) => candidate.status !== "inactive" && candidate.status !== "disabled")
        .map((candidate) => ({
          id: id(candidate.id),
          name: String(candidate.displayName ?? candidate.name ?? "Class family"),
          ...(candidate.description ? { description: String(candidate.description) } : {}),
          available: sessions.some((session) => session.classFamilyId === id(candidate.id)),
        })),
    } : {}),
    ...(family ? {
      classFamily: {
        id: id(family.id),
        name: String(family.displayName ?? family.name ?? "Class family"),
      },
    } : {}),
    sessions,
  };
}

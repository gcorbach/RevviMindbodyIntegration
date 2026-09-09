import { selectMappedService } from "./class-availability.js";

export class BookingQuoteError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "BookingQuoteError";
    this.code = code;
    this.status = status;
  }
}

function requiredIdentity(identity) {
  const normalized = {
    email: typeof identity?.email === "string" ? identity.email.trim().toLowerCase() : "",
    firstName: typeof identity?.firstName === "string" ? identity.firstName.trim() : "",
    lastName: typeof identity?.lastName === "string" ? identity.lastName.trim() : "",
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)
    || !normalized.firstName || !normalized.lastName) {
    throw new BookingQuoteError("CLIENT_IDENTITY_INCOMPLETE", "Your verified Revvi profile needs an email and full name before booking.", 422);
  }
  return normalized;
}

function normalizedClient(client) {
  return {
    id: String(client?.id ?? "").trim(),
    uniqueId: client?.uniqueId == null ? null : String(client.uniqueId).trim(),
    email: String(client?.email ?? "").trim().toLowerCase(),
    firstName: String(client?.firstName ?? "").trim().toLowerCase(),
    lastName: String(client?.lastName ?? "").trim().toLowerCase(),
  };
}

function exactClientMatches(clients, identity) {
  return clients.map(normalizedClient).filter((client) => client.id
    && client.email === identity.email
    && client.firstName === identity.firstName.toLowerCase()
    && client.lastName === identity.lastName.toLowerCase());
}

function providerClientFromAdd(providerClient) {
  const client = normalizedClient(providerClient);
  if (!client.id || !client.uniqueId) {
    throw new BookingQuoteError("CLIENT_CREATION_UNCONFIRMED", "Mindbody did not confirm the new Client identity.", 502);
  }
  return client;
}

async function resolveProviderProfile(input, dependencies) {
  const identity = requiredIdentity(input.identity);
  const [searchResults, duplicateResults] = await Promise.all([
    dependencies.provider.searchClients({ email: identity.email }),
    dependencies.provider.getClientDuplicates(identity),
  ]);
  const exactSearch = exactClientMatches(searchResults, identity);
  const duplicateCandidates = duplicateResults.map(normalizedClient).filter((client) => client.id);
  const candidates = new Map(exactSearch.map((client) => [client.id, client]));
  for (const candidate of duplicateCandidates) {
    if (!candidates.has(candidate.id)) candidates.set(candidate.id, candidate);
  }
  if (candidates.size > 1) {
    await dependencies.catalogue.recordAmbiguity({
      businessId: input.context.business.id,
      integrationId: input.context.integration.id,
      customerId: input.customer.id,
      candidateCount: candidates.size,
      reasonCode: "MULTIPLE_EXACT_CLIENTS",
    });
    throw new BookingQuoteError("CLIENT_AMBIGUOUS", "More than one Mindbody Client may match this Revvi Customer. Support must resolve it before booking.");
  }
  let client = [...candidates.values()][0] ?? null;
  const storedProfile = input.context.customerProviderProfile;
  if (storedProfile && (!client || client.id !== storedProfile.providerClientId)) {
    await dependencies.catalogue.recordAmbiguity({
      businessId: input.context.business.id,
      integrationId: input.context.integration.id,
      customerId: input.customer.id,
      candidateCount: client ? 2 : 1,
      reasonCode: client ? "STORED_CLIENT_MISMATCH" : "STORED_CLIENT_NOT_FOUND",
    });
    throw new BookingQuoteError(
      client ? "CLIENT_AMBIGUOUS" : "CLIENT_PROFILE_STALE",
      "The stored Mindbody Client identity could not be verified against the current Revvi profile.",
      409,
    );
  }
  if (!client) {
    if (input.context.integration.allowClientCreation !== true) {
      throw new BookingQuoteError("CLIENT_NOT_FOUND", "No Mindbody Client matched and Client creation is not approved for this Business.", 409);
    }
    const fields = await dependencies.provider.getRequiredClientFields();
    const supported = new Set(["FirstName", "LastName", "Email"]);
    if (!Array.isArray(fields) || fields.some((field) => !supported.has(String(field)))) {
      throw new BookingQuoteError("CLIENT_REQUIRED_FIELDS_UNSUPPORTED", "This Business requires additional consented Client information before booking.", 422);
    }
    const payload = { FirstName: identity.firstName, LastName: identity.lastName, Email: identity.email };
    client = providerClientFromAdd(await dependencies.provider.addClient({ client: payload, test: false }));
  }
  return dependencies.catalogue.persistProviderProfile({
    businessId: input.context.business.id,
    customerId: input.customer.id,
    integrationId: input.context.integration.id,
    providerSiteId: input.context.integration.providerSiteId,
    providerClientId: client.id,
    providerClientUniqueId: client.uniqueId,
  });
}

function classOccurrenceFacts(occurrence, input) {
  const classId = String(occurrence?.id ?? "");
  const providerLocationId = String(occurrence?.locationId ?? "");
  if (classId !== input.classId || providerLocationId !== input.context.location.providerLocationId) {
    throw new BookingQuoteError("CLASS_CONTEXT_MISMATCH", "The selected Class does not belong to this Offer Location.", 409);
  }
  if (occurrence.isAvailable !== true || occurrence.isCanceled === true) {
    throw new BookingQuoteError("CLASS_UNAVAILABLE", "This Class is no longer available to this Customer.", 409);
  }
  const allowlist = input.context.inventoryAllowlist ?? {};
  const approved = (kind, value) => Array.isArray(allowlist[kind])
    && allowlist[kind].map(String).includes(String(value ?? ""));
  if (!approved("location", providerLocationId)
    || !approved("program", occurrence.programId)
    || !approved("classDescription", occurrence.classDescriptionId)
    || !approved("sessionType", occurrence.sessionTypeId)
    || (Array.isArray(allowlist.classSchedule) && allowlist.classSchedule.length > 0
      && !approved("classSchedule", occurrence.classScheduleId))) {
    throw new BookingQuoteError("CLASS_NOT_APPROVED", "This Class is not approved for the selected Revvi Offer.", 409);
  }
  const families = input.context.classFamilies;
  if (Array.isArray(families) && families.length > 0) {
    const family = families.find((candidate) => String(candidate.id) === String(input.classFamilyId ?? "")
      && candidate.status !== "inactive"
      && candidate.status !== "disabled"
      && candidate.providerMappings?.some((mapping) => String(mapping.providerLocationId) === providerLocationId
        && String(mapping.providerClassDescriptionId) === String(occurrence.classDescriptionId ?? "")
        && String(mapping.providerProgramId) === String(occurrence.programId ?? "")
        && String(mapping.providerSessionTypeId) === String(occurrence.sessionTypeId ?? "")
        && (!mapping.providerClassScheduleId
          || String(mapping.providerClassScheduleId) === String(occurrence.classScheduleId ?? ""))));
    if (!family) {
      throw new BookingQuoteError("CLASS_FAMILY_NOT_APPROVED", "This Class is not approved for the selected Class family.", 409);
    }
  }
  const startAt = new Date(occurrence.startAt);
  if (Number.isNaN(startAt.getTime())) throw new BookingQuoteError("CLASS_CONTRACT_INVALID", "Mindbody returned an invalid Class time.", 502);
  return {
    classId,
    classScheduleId: occurrence.classScheduleId == null ? null : String(occurrence.classScheduleId),
    classDescriptionId: occurrence.classDescriptionId == null ? null : String(occurrence.classDescriptionId),
    programId: occurrence.programId == null ? null : String(occurrence.programId),
    sessionTypeId: occurrence.sessionTypeId == null ? null : String(occurrence.sessionTypeId),
    name: String(occurrence.name ?? "Class"),
    staffName: occurrence.staffName == null ? null : String(occurrence.staffName),
    startAt: startAt.toISOString(),
    endAt: occurrence.endAt == null ? null : new Date(occurrence.endAt).toISOString(),
    locationName: String(occurrence.locationName ?? input.context.location.displayName),
    ...(input.classFamilyId ? { classFamilyId: String(input.classFamilyId) } : {}),
  };
}

function eligibleEntitlement(service, now) {
  if (!service?.id || service.current !== true || service.returned === true) return false;
  const activeAt = service.activeAt ? new Date(service.activeAt) : null;
  const expiresAt = service.expiresAt ? new Date(service.expiresAt) : null;
  if ((activeAt && (Number.isNaN(activeAt.getTime()) || activeAt > now))
    || (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt < now))) return false;
  return service.unlimited === true
    || (Number.isFinite(Number(service.remaining)) && Number(service.remaining) > 0);
}

function mappedProductIds(mapping) {
  const configured = Array.isArray(mapping?.providerServiceProductIds)
    ? mapping.providerServiceProductIds
    : [mapping?.providerServiceProductId];
  return [...new Set(configured.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function mappedProductName(context, classFamilyId) {
  if (!Array.isArray(context?.classFamilies)) return null;
  const family = context.classFamilies.find((candidate) => String(candidate?.id ?? "") === String(classFamilyId ?? ""));
  const name = String(family?.providerServiceProductName ?? "").trim();
  return name || null;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new BookingQuoteError("QUOTE_TOTALS_INVALID", "The quote totals are invalid.", 502);
  return Number(amount.toFixed(2));
}

export async function createClassBookingQuote(input, dependencies) {
  if (!input?.customer?.id || !input?.classId || !input?.context?.mapping?.id) {
    throw new BookingQuoteError("QUOTE_CONTEXT_INVALID", "The booking quote context is incomplete.", 500);
  }
  const profile = await resolveProviderProfile(input, dependencies);
  const occurrence = await dependencies.provider.getClassForClient({
    classId: input.classId,
    clientId: profile.providerClientId,
    uniqueClientId: profile.providerClientUniqueId,
    timezone: input.context.location.timezone,
  });
  const classOccurrence = classOccurrenceFacts(occurrence, input);
  const mode = input.context.offer.fulfilmentMode;
  if (input.context.mapping.modeEvidenceVerified !== true) {
    throw new BookingQuoteError("FULFILMENT_MODE_NOT_VERIFIED", "This Offer mode has not passed its controlled Mindbody verification.", 503);
  }
  let fulfilment;
  if (mode === "purchase_pricing_option") {
    const configuredProductIds = mappedProductIds(input.context.mapping);
    const providerServiceProductName = mappedProductName(input.context, input.classFamilyId);
    if ((!providerServiceProductName && configuredProductIds.length === 0)
      || !Number.isSafeInteger(input.context.mapping.paidCheckoutLocationId)) {
      throw new BookingQuoteError(
        "PAID_ROUTE_NOT_CONFIGURED",
        "This paid Offer has no approved Mindbody Product and checkout route.",
        503,
      );
    }
    let providerServiceProductId = configuredProductIds[0] ?? null;
    if (providerServiceProductName || configuredProductIds.length > 1) {
      if (typeof dependencies.provider.getServices !== "function") {
        throw new BookingQuoteError(
          "PRODUCT_MAPPING_AMBIGUOUS",
          "This paid Offer has more than one approved Mindbody Product and the selected Class cannot be priced safely.",
          409,
        );
      }
      const services = await dependencies.provider.getServices({
        classId: input.classId,
        locationId: input.context.location.providerLocationId,
        sellOnline: true,
        includeDiscontinued: false,
      });
      const mappedService = selectMappedService(
        services,
        configuredProductIds,
        input.context.location.providerLocationId,
        providerServiceProductName,
      );
      if (!mappedService) {
        throw new BookingQuoteError(
          "PRODUCT_NOT_APPLICABLE",
          "No single approved Mindbody Product applies to the selected Class.",
          409,
        );
      }
      providerServiceProductId = String(mappedService.service.ProductId);
    }
    const calculation = await dependencies.provider.testCheckout({
      siteId: input.context.integration.providerSiteId,
      classId: input.classId,
      clientId: profile.providerClientId,
      checkoutLocationId: input.context.mapping.paidCheckoutLocationId,
      classLocationId: input.context.location.providerLocationId,
      productId: providerServiceProductId,
    });
    fulfilment = {
      ...calculation,
      providerServiceProductId,
      providerClientServiceId: null,
      providerCalculation: "checkout_test_cart",
      publicProviderCalculation: "mindbody_test_cart",
    };
  } else if (mode === "existing_entitlement") {
    const services = (await dependencies.provider.getClientServices({
      classId: input.classId,
      clientId: profile.providerClientId,
    })).filter((service) => eligibleEntitlement(service, dependencies.now()));
    if (services.length !== 1) {
      throw new BookingQuoteError(services.length === 0 ? "ENTITLEMENT_NOT_FOUND" : "ENTITLEMENT_AMBIGUOUS", services.length === 0
        ? "No exact current Mindbody entitlement can be used for this Class."
        : "More than one Mindbody entitlement can be used; automatic selection is prohibited.", 409);
    }
    fulfilment = {
      subtotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 0,
      providerServiceProductId: null,
      providerClientServiceId: String(services[0].id),
      providerCalculation: "entitlement_balance",
      publicProviderCalculation: "not_required",
    };
  } else if (mode === "approved_unpaid") {
    fulfilment = {
      subtotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 0,
      providerServiceProductId: null,
      providerClientServiceId: null,
      providerCalculation: "approved_unpaid",
      publicProviderCalculation: "not_required",
    };
  } else {
    throw new BookingQuoteError("FULFILMENT_MODE_UNSUPPORTED", "This Offer has an unsupported fulfilment mode.", 503);
  }
  const quotedAt = dependencies.now();
  const expiresAt = new Date(quotedAt.getTime() + dependencies.quoteLifetimeMs);
  const currency = await dependencies.provider.getSiteCurrency();
  const fingerprintInput = {
    customerId: input.customer.id,
    businessId: input.context.business.id,
    locationId: input.context.location.id,
    offerId: input.context.offer.id,
    mappingId: input.context.mapping.id,
    mappingVersion: input.context.mapping.version,
    classFamilyId: input.classFamilyId ?? null,
    classId: input.classId,
    fulfilmentMode: mode,
    providerSiteId: input.context.integration.providerSiteId,
    providerClientId: profile.providerClientId,
    providerClientUniqueId: profile.providerClientUniqueId ?? null,
    providerServiceProductId: fulfilment.providerServiceProductId,
    providerClientServiceId: fulfilment.providerClientServiceId,
    subtotal: money(fulfilment.subtotal),
    discountTotal: money(fulfilment.discountTotal),
    taxTotal: money(fulfilment.taxTotal),
    grandTotal: money(fulfilment.grandTotal),
    currency,
    expiresAt: expiresAt.toISOString(),
  };
  const quoteFingerprint = await sha256(JSON.stringify(fingerprintInput));
  const stored = await dependencies.catalogue.persistQuote({
    ...fingerprintInput,
    sandboxPricingOptionDiscovered: input.context.integration.environment === "sandbox"
      && input.context.integration.providerSiteId === "-99"
      && input.context.mapping.paidPaymentRoute === "mindbody_sandbox_cash"
      && Boolean(mappedProductName(input.context, input.classFamilyId)),
    integrationId: input.context.integration.id,
    customerProviderProfileId: profile.id,
    providerLocationId: input.context.location.providerLocationId,
    providerClassScheduleId: classOccurrence.classScheduleId,
    classFamilyId: input.classFamilyId ?? null,
    providerCalculation: fulfilment.providerCalculation,
    quoteFingerprint,
    quotedAt: quotedAt.toISOString(),
    status: "open",
  });
  return {
    quoteId: stored.id,
    expiresAt: expiresAt.toISOString(),
    quoteFingerprint,
    fulfilmentMode: mode,
    occurrence: classOccurrence,
    price: {
      subtotal: fingerprintInput.subtotal,
      discountTotal: fingerprintInput.discountTotal,
      taxTotal: fingerprintInput.taxTotal,
      grandTotal: fingerprintInput.grandTotal,
      currency,
      ...(fingerprintInput.providerServiceProductId ? { serviceProductId: fingerprintInput.providerServiceProductId } : {}),
      ...(fulfilment.providerClientServiceId ? { clientServiceId: fulfilment.providerClientServiceId } : {}),
      providerCalculation: fulfilment.publicProviderCalculation,
    },
    cancellationPolicy: {
      displayText: input.context.offer.cancellationPolicyText,
      certainty: input.context.offer.cancellationPolicyCertainty,
    },
  };
}

export function quoteTotalsChanged(storedQuote, recalculatedQuote) {
  const fields = ["subtotal", "discountTotal", "taxTotal", "grandTotal"];
  if (String(storedQuote?.currency ?? "") !== String(recalculatedQuote?.currency ?? "")) return true;
  return fields.some((field) => {
    const stored = Number(storedQuote?.[field]);
    const recalculated = Number(recalculatedQuote?.[field]);
    return !Number.isFinite(stored) || !Number.isFinite(recalculated)
      || Math.round(stored * 100) !== Math.round(recalculated * 100);
  });
}

export async function revalidateClassBookingQuoteBeforeWrite(input, dependencies) {
  const quote = input?.quote;
  const context = input?.context;
  if (!quote || !context
    || quote.offerId !== context.offer.id
    || quote.mappingId !== context.mapping.id
    || quote.mappingVersion !== context.mapping.version
    || quote.locationId !== context.location.id
    || quote.fulfilmentMode !== context.offer.fulfilmentMode) {
    throw new BookingQuoteError("QUOTE_BINDING_CHANGED", "The Revvi Offer configuration changed; request a new quote.", 409);
  }
  const occurrence = await dependencies.provider.getClassForClient({
    classId: quote.classId,
    clientId: quote.providerClientId,
    uniqueClientId: quote.providerClientUniqueId,
    timezone: context.location.timezone,
  });
  const classOccurrence = classOccurrenceFacts(occurrence, {
    classId: quote.classId,
    classFamilyId: quote.classFamilyId,
    context,
  });
  if (quote.fulfilmentMode === "existing_entitlement") {
    const services = await dependencies.provider.getClientServices({
      classId: quote.classId,
      clientId: quote.providerClientId,
    });
    const exact = services.filter((service) => String(service?.id ?? "") === String(quote.providerClientServiceId ?? "")
      && eligibleEntitlement(service, dependencies.now()));
    if (exact.length !== 1) {
      throw new BookingQuoteError(
        "ENTITLEMENT_NO_LONGER_USABLE",
        "The quoted Mindbody entitlement is no longer usable for this Class. Request a new quote.",
        409,
      );
    }
    return { changed: false, occurrence: classOccurrence };
  }
  if (quote.fulfilmentMode !== "purchase_pricing_option") return { changed: false, occurrence: classOccurrence };
  const configuredProductIds = mappedProductIds(context.mapping);
  const providerServiceProductName = mappedProductName(context, quote.classFamilyId);
  if (!providerServiceProductName
    && !configuredProductIds.includes(String(quote.providerServiceProductId ?? ""))) {
    throw new BookingQuoteError(
      "QUOTE_BINDING_CHANGED",
      "The quoted Mindbody Product is no longer approved for this Offer; request a new quote.",
      409,
    );
  }
  if (!Number.isSafeInteger(context.mapping.paidCheckoutLocationId)) {
    throw new BookingQuoteError(
      "PAID_ROUTE_NOT_CONFIGURED",
      "The paid Mindbody checkout route is no longer configured.",
      503,
    );
  }
  if (providerServiceProductName) {
    if (typeof dependencies.provider.getServices !== "function") {
      throw new BookingQuoteError(
        "PRODUCT_MAPPING_AMBIGUOUS",
        "The current Site -99 pricing option cannot be rediscovered safely.",
        503,
      );
    }
    const services = await dependencies.provider.getServices({
      classId: quote.classId,
      locationId: context.location.providerLocationId,
      sellOnline: true,
      includeDiscontinued: false,
    });
    const mappedService = selectMappedService(
      services,
      configuredProductIds,
      context.location.providerLocationId,
      providerServiceProductName,
    );
    if (!mappedService
      || String(mappedService.service.ProductId) !== String(quote.providerServiceProductId ?? "")) {
      throw new BookingQuoteError(
        "QUOTE_BINDING_CHANGED",
        "The Site -99 pricing option changed after this quote; request a new quote.",
        409,
      );
    }
  }
  const [totals, currency] = await Promise.all([
    dependencies.provider.testCheckout({
      siteId: context.integration.providerSiteId,
      classId: quote.classId,
      clientId: quote.providerClientId,
      checkoutLocationId: context.mapping.paidCheckoutLocationId,
      classLocationId: context.location.providerLocationId,
      productId: quote.providerServiceProductId,
    }),
    dependencies.provider.getSiteCurrency(),
  ]);
  if (quoteTotalsChanged(quote, { ...totals, currency })) {
    throw new BookingQuoteError(
      "QUOTE_RECONFIRMATION_REQUIRED",
      "Mindbody recalculated a different total. Review and confirm a new quote before booking.",
      409,
    );
  }
  return { changed: false, occurrence: classOccurrence };
}

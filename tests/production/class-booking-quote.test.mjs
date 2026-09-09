import assert from "node:assert/strict";
import test from "node:test";

import {
  BookingQuoteError,
  createClassBookingQuote,
  quoteTotalsChanged,
  revalidateClassBookingQuoteBeforeWrite,
} from "../../supabase/functions/_shared/class-booking-quote.js";

const now = () => new Date("2026-08-10T12:00:00.000Z");
const identity = Object.freeze({ email: "member@example.com", firstName: "Ava", lastName: "Ndlovu" });

function context(mode = "purchase_pricing_option") {
  return {
    business: { id: "business-a" },
    location: { id: "location-a", displayName: "Rosebank", providerLocationId: "7", timezone: "Africa/Johannesburg" },
    offer: { id: "offer-a", displayName: "Revvi Yoga", fulfilmentMode: mode, cancellationPolicyText: "Cancel with the studio.", cancellationPolicyCertainty: "studio_reported" },
    integration: { id: "integration-a", providerSiteId: "-99", environment: "sandbox", allowClientCreation: false },
    mapping: {
      id: "mapping-a",
      version: 4,
      providerServiceProductId: mode === "purchase_pricing_option" ? "product-a" : null,
      paidCheckoutLocationId: mode === "purchase_pricing_option" ? 98 : null,
      modeEvidenceVerified: true,
    },
    customerProviderProfile: null,
    inventoryAllowlist: { location: ["7"], program: ["11"], classDescription: ["13"], sessionType: ["23"], classSchedule: [] },
  };
}

function dependencies(overrides = {}) {
  const saved = [];
  return {
    now,
    quoteLifetimeMs: 5 * 60_000,
    catalogue: {
      recordAmbiguity: async () => {},
      persistProviderProfile: async (profile) => ({ id: "profile-a", ...profile }),
      persistQuote: async (quote) => { saved.push(quote); return { id: "quote-a", ...quote }; },
    },
    provider: {
      searchClients: async () => [{ id: "rss-1", uniqueId: "41", email: "member@example.com", firstName: "Ava", lastName: "Ndlovu" }],
      getClientDuplicates: async () => [{ id: "rss-1", uniqueId: "41" }],
      getClassForClient: async () => ({ id: "771", classScheduleId: "991", classDescriptionId: "13", programId: "11", sessionTypeId: "23", name: "Revvi Yoga", startAt: "2026-08-11T10:00:00.000Z", locationId: "7", locationName: "Rosebank", isAvailable: true, isCanceled: false }),
      testCheckout: async () => ({ subtotal: 120, discountTotal: 20, taxTotal: 15, grandTotal: 115 }),
      getClientServices: async () => [],
      getSiteCurrency: async () => "ZAR",
    },
    saved,
    ...overrides,
  };
}

test("an exact resolved client receives a short-lived provider-calculated paid quote", async () => {
  const deps = dependencies();
  let checkoutFacts;
  deps.provider.testCheckout = async (facts) => {
    checkoutFacts = facts;
    return { subtotal: 120, discountTotal: 20, taxTotal: 15, grandTotal: 115 };
  };
  const result = await createClassBookingQuote({ customer: { id: "customer-a" }, identity, classId: "771", context: context() }, deps);

  assert.equal(result.quoteId, "quote-a");
  assert.equal(result.fulfilmentMode, "purchase_pricing_option");
  assert.equal(result.price.providerCalculation, "mindbody_test_cart");
  assert.equal(result.price.grandTotal, 115);
  assert.equal(result.occurrence.classId, "771");
  assert.equal(result.expiresAt, "2026-08-10T12:05:00.000Z");
  assert.match(result.quoteFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(deps.saved[0].mappingVersion, 4);
  assert.equal(deps.saved[0].providerClientUniqueId, "41");
  assert.equal(deps.saved[0].status, "open");
  assert.equal(checkoutFacts.siteId, "-99");
  assert.equal(checkoutFacts.checkoutLocationId, 98);
  assert.equal(checkoutFacts.classLocationId, "7");
});

test("a paid quote selects the one applicable Product from an approved Product set", async () => {
  const deps = dependencies();
  const selected = {
    ...context(),
    mapping: {
      ...context().mapping,
      providerServiceProductIds: ["product-shared", "product-strength"],
    },
  };
  let checkoutProduct;
  deps.provider.getServices = async () => [{
    ProductId: "product-strength",
    OnlinePrice: 44,
    SellOnline: true,
    Discontinued: false,
    SellAtLocationIds: [7],
    UseAtLocationIds: [7],
  }];
  deps.provider.testCheckout = async (facts) => {
    checkoutProduct = facts.productId;
    return { subtotal: 44, discountTotal: 0, taxTotal: 0, grandTotal: 44 };
  };
  const result = await createClassBookingQuote({
    customer: { id: "customer-a" },
    identity,
    classId: "771",
    context: selected,
  }, deps);
  assert.equal(checkoutProduct, "product-strength");
  assert.equal(result.price.serviceProductId, "product-strength");
});

test("a Site -99 quote replaces the stale database Product ID from the family pricing-option name", async () => {
  const deps = dependencies();
  const resetSafeContext = context();
  resetSafeContext.mapping.providerServiceProductId = "yesterday-product";
  resetSafeContext.mapping.paidPaymentRoute = "mindbody_sandbox_cash";
  resetSafeContext.classFamilies = [{
    id: "family-yoga",
    status: "active",
    providerServiceProductName: "5 Class Card",
    providerMappings: [{
      providerLocationId: "7",
      providerClassDescriptionId: "13",
      providerProgramId: "11",
      providerSessionTypeId: "23",
    }],
  }];
  let checkoutProduct;
  deps.provider.getServices = async () => [{
    ProductId: "today-product",
    Name: "5 Class Card",
    OnlinePrice: 55,
    SellOnline: true,
    Discontinued: false,
    SellAtLocationIds: [7],
    UseAtLocationIds: [7],
  }];
  deps.provider.testCheckout = async (facts) => {
    checkoutProduct = facts.productId;
    return { subtotal: 55, discountTotal: 0, taxTotal: 0, grandTotal: 55 };
  };

  const result = await createClassBookingQuote({
    customer: { id: "customer-a" },
    identity,
    classId: "771",
    classFamilyId: "family-yoga",
    context: resetSafeContext,
  }, deps);

  assert.equal(deps.saved[0].sandboxPricingOptionDiscovered, true);
  assert.equal(checkoutProduct, "today-product");
  assert.equal(result.price.serviceProductId, "today-product");
});

test("a quote revalidates the selected Class family tuple", async () => {
  const deps = dependencies();
  const familyContext = context();
  familyContext.classFamilies = [{
    id: "family-hot",
    status: "active",
    providerMappings: [{
      providerLocationId: "7",
      providerClassDescriptionId: "13",
      providerProgramId: "11",
      providerSessionTypeId: "23",
    }],
  }];
  const result = await createClassBookingQuote({
    customer: { id: "customer-a" },
    identity,
    classId: "771",
    classFamilyId: "family-hot",
    context: familyContext,
  }, deps);
  assert.equal(result.occurrence.classFamilyId, "family-hot");
  assert.equal(deps.saved[0].classFamilyId, "family-hot");

  await assert.rejects(
    createClassBookingQuote({
      customer: { id: "customer-a" }, identity, classId: "771", classFamilyId: "family-other", context: familyContext,
    }, dependencies()),
    (error) => error.code === "CLASS_FAMILY_NOT_APPROVED",
  );
});

test("ambiguous exact identities create support work and stop before Class or cart operations", async () => {
  let supportFacts;
  let classReads = 0;
  const deps = dependencies();
  deps.catalogue = { ...deps.catalogue, recordAmbiguity: async (facts) => { supportFacts = facts; } };
  deps.provider = {
    ...deps.provider,
    searchClients: async () => [
      { id: "rss-1", email: "member@example.com", firstName: "Ava", lastName: "Ndlovu" },
      { id: "rss-2", email: "member@example.com", firstName: "Ava", lastName: "Ndlovu" },
    ],
    getClientDuplicates: async () => [],
    getClassForClient: async () => { classReads += 1; },
  };

  await assert.rejects(
    createClassBookingQuote({ customer: { id: "customer-a" }, identity, classId: "771", context: context() }, deps),
    (error) => error instanceof BookingQuoteError && error.code === "CLIENT_AMBIGUOUS" && error.status === 409,
  );
  assert.equal(supportFacts.customerId, "customer-a");
  assert.equal(supportFacts.candidateCount, 2);
  assert.equal(classReads, 0);
  assert.equal(deps.saved.length, 0);
});

test("existing entitlement requires one exact current ClientService for the selected Class", async () => {
  const deps = dependencies();
  deps.provider.getClientServices = async () => [{ id: "pass-1", productId: "entitlement-a", current: true, remaining: 4, unlimited: false, returned: false, activeAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-09-01T00:00:00.000Z" }];
  const result = await createClassBookingQuote({ customer: { id: "customer-a" }, identity, classId: "771", context: context("existing_entitlement") }, deps);
  assert.equal(result.price.clientServiceId, "pass-1");
  assert.equal(result.price.providerCalculation, "not_required");
  assert.equal(result.price.grandTotal, 0);

  deps.provider.getClientServices = async () => [
    { id: "pass-1", current: true, remaining: 1, unlimited: false, returned: false },
    { id: "pass-2", current: true, remaining: 1, unlimited: false, returned: false },
  ];
  await assert.rejects(
    createClassBookingQuote({ customer: { id: "customer-a" }, identity, classId: "771", context: context("existing_entitlement") }, deps),
    (error) => error.code === "ENTITLEMENT_AMBIGUOUS",
  );
});

test("an unrelated same-Location Class cannot use the Offer terms", async () => {
  const deps = dependencies();
  deps.provider.getClassForClient = async () => ({
    id: "771", classDescriptionId: "attacker-description", programId: "11", sessionTypeId: "23",
    name: "Unrelated Class", startAt: "2026-08-11T10:00:00.000Z", locationId: "7", locationName: "Rosebank",
    isAvailable: true, isCanceled: false,
  });
  await assert.rejects(
    createClassBookingQuote({ customer: { id: "customer-a" }, identity, classId: "771", context: context() }, deps),
    (error) => error.code === "CLASS_NOT_APPROVED",
  );
  assert.equal(deps.saved.length, 0);
});

test("expired, future, returned and exhausted entitlements fail closed", async () => {
  const invalidServices = [
    { id: "expired", current: true, remaining: 1, returned: false, expiresAt: "2026-08-09T00:00:00.000Z" },
    { id: "future", current: true, remaining: 1, returned: false, activeAt: "2026-08-11T00:00:00.000Z" },
    { id: "returned", current: true, remaining: 1, returned: true },
    { id: "exhausted", current: true, remaining: 0, unlimited: false, returned: false },
  ];
  for (const service of invalidServices) {
    const deps = dependencies();
    deps.provider.getClientServices = async () => [service];
    await assert.rejects(
      createClassBookingQuote({ customer: { id: "customer-a" }, identity, classId: "771", context: context("existing_entitlement") }, deps),
      (error) => error.code === "ENTITLEMENT_NOT_FOUND",
    );
  }
});

test("unknown or unevidenced fulfilment modes fail closed before quote persistence", async () => {
  const deps = dependencies();
  const unevidenced = context("approved_unpaid");
  unevidenced.mapping.modeEvidenceVerified = false;
  await assert.rejects(
    createClassBookingQuote({ customer: { id: "customer-a" }, identity, classId: "771", context: unevidenced }, deps),
    (error) => error.code === "FULFILMENT_MODE_NOT_VERIFIED",
  );
  assert.equal(deps.saved.length, 0);
});

test("a stored Site profile is reverified and cannot silently change Client RSSID", async () => {
  let supportFacts;
  const deps = dependencies();
  deps.catalogue = { ...deps.catalogue, recordAmbiguity: async (facts) => { supportFacts = facts; } };
  const stored = context();
  stored.customerProviderProfile = { id: "profile-a", providerClientId: "rss-stored", providerClientUniqueId: "41" };
  await assert.rejects(
    createClassBookingQuote({ customer: { id: "customer-a" }, identity, classId: "771", context: stored }, deps),
    (error) => error.code === "CLIENT_AMBIGUOUS",
  );
  assert.equal(supportFacts.reasonCode, "STORED_CLIENT_MISMATCH");
  assert.equal(deps.saved.length, 0);
});

test("a re-quote changing any monetary cent or currency requires Customer reconfirmation", () => {
  const original = { subtotal: 120, discountTotal: 20, taxTotal: 15, grandTotal: 115, currency: "ZAR" };
  assert.equal(quoteTotalsChanged(original, { ...original }), false);
  assert.equal(quoteTotalsChanged(original, { ...original, grandTotal: 115.01 }), true);
  assert.equal(quoteTotalsChanged(original, { ...original, currency: "USD" }), true);
});

test("the pre-write seam re-reads the Class, reruns Test checkout and blocks a changed paid total", async () => {
  const deps = dependencies();
  let testCheckouts = 0;
  deps.provider.testCheckout = async () => {
    testCheckouts += 1;
    return { subtotal: 120, discountTotal: 20, taxTotal: 15, grandTotal: 115.01 };
  };
  const quote = {
    offerId: "offer-a", mappingId: "mapping-a", mappingVersion: 4, locationId: "location-a",
    fulfilmentMode: "purchase_pricing_option", classId: "771", providerClientId: "rss-1",
    providerClientUniqueId: "41", providerServiceProductId: "product-a",
    subtotal: 120, discountTotal: 20, taxTotal: 15, grandTotal: 115, currency: "ZAR",
  };
  await assert.rejects(
    revalidateClassBookingQuoteBeforeWrite({ quote, context: context() }, deps),
    (error) => error.code === "QUOTE_RECONFIRMATION_REQUIRED",
  );
  assert.equal(testCheckouts, 1);
});

test("the pre-write seam revalidates the quote's exact entitlement", async () => {
  const deps = dependencies();
  deps.provider.getClientServices = async () => [{
    id: "different-pass", current: true, remaining: 1, unlimited: false, returned: false,
  }];
  const quote = {
    offerId: "offer-a", mappingId: "mapping-a", mappingVersion: 4, locationId: "location-a",
    fulfilmentMode: "existing_entitlement", classId: "771", providerClientId: "rss-1",
    providerClientUniqueId: "41", providerClientServiceId: "pass-1",
    subtotal: 0, discountTotal: 0, taxTotal: 0, grandTotal: 0, currency: "ZAR",
  };
  await assert.rejects(
    revalidateClassBookingQuoteBeforeWrite({ quote, context: context("existing_entitlement") }, deps),
    (error) => error.code === "ENTITLEMENT_NO_LONGER_USABLE",
  );
});

test("a missing stored Client stays blocked until an operator retires its sandbox profile", async () => {
  const deps = dependencies();
  const stored = context();
  stored.integration.allowClientCreation = true;
  stored.customerProviderProfile = { id: "old-profile", providerClientId: "missing", providerClientUniqueId: "missing" };
  deps.provider.searchClients = async () => [];
  deps.provider.getClientDuplicates = async () => [];
  let creates = 0;
  deps.provider.addClient = async () => { creates++; return { id: "fresh", uniqueId: "fresh" }; };
  await assert.rejects(createClassBookingQuote({ customer: { id: "customer-a" }, identity, classId: "771", context: stored }, deps),
    error => error.code === "CLIENT_PROFILE_STALE");
  assert.equal(creates, 0);
  assert.equal(deps.saved.length, 0);
});

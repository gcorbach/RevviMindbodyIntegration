import assert from "node:assert/strict";
import test from "node:test";

import {
  createClassAvailabilityCatalogue,
} from "../../supabase/functions/_shared/class-availability-catalogue.js";

function fakeSupabase({ business, contextRow, familyRows = [], pricingRows = [], rpcError = null, insertError = null }) {
  const calls = [];
  return {
    calls,
    from(table) {
      if (table === "class_businesses") {
        const filters = {};
        return {
          select(columns) { calls.push(["select", table, columns]); return this; },
          eq(column, value) { filters[column] = value; return this; },
          async maybeSingle() { calls.push(["businessFilters", filters]); return { data: business, error: null }; },
        };
      }
      if (table === "class_availability_provider_diagnostics") {
        return {
          async insert(value) { calls.push(["diagnostic", value]); return { error: insertError }; },
        };
      }
      if (table === "class_offer_pricing_options") {
        return {
          select(columns) { calls.push(["select", table, columns]); return this; },
          eq(column, value) { calls.push(["pricingFilter", column, value]); return this; },
          then(resolve) { return resolve({ data: pricingRows, error: null }); },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      return {
        data: name === "resolve_class_availability_families" ? familyRows : contextRow ? [contextRow] : [],
        error: rpcError,
      };
    },
  };
}

const row = Object.freeze({
  business_id: "business-a",
  business_slug: "pilot-yoga",
  business_name: "Pilot Yoga",
  location_id: "location-a",
  location_name: "Rosebank",
  location_timezone: "Africa/Johannesburg",
  provider_location_id: "7",
  offer_id: "offer-a",
  offer_name: "Revvi Yoga",
  fulfilment_mode: "purchase_pricing_option",
  integration_id: "integration-a",
  provider_site_id: "-99",
  mapping_id: "mapping-a",
  provider_service_product_id: "product-revvi",
  customer_provider_profile_id: "profile-a",
  provider_client_id: "client-a",
  provider_client_unique_id: "unique-a",
  inventory_allowlist: {
    location: ["7"],
    program: ["11"],
    classDescription: ["13"],
    sessionType: ["23"],
    classSchedule: [],
  },
});

test("the catalogue resolves one server-owned tenant-scoped Class availability context", async () => {
  const supabase = fakeSupabase({ business: { id: "business-a" }, contextRow: row });
  const catalogue = createClassAvailabilityCatalogue(supabase);

  assert.equal(await catalogue.resolveBusinessIdBySlug("pilot-yoga"), "business-a");
  assert.deepEqual(await catalogue.resolveAvailabilityContext({
    businessSlug: "pilot-yoga",
    locationId: "location-a",
    offerId: "offer-a",
    customerId: "customer-a",
  }), {
    business: { id: "business-a", slug: "pilot-yoga", displayName: "Pilot Yoga" },
    location: {
      id: "location-a",
      displayName: "Rosebank",
      timezone: "Africa/Johannesburg",
      providerLocationId: "7",
    },
    offer: {
      id: "offer-a",
      displayName: "Revvi Yoga",
      fulfilmentMode: "purchase_pricing_option",
    },
    integration: { id: "integration-a", providerSiteId: "-99", status: "active" },
    mapping: {
      id: "mapping-a",
      status: "active",
      providerServiceProductId: "product-revvi",
    },
    customerProviderProfile: {
      id: "profile-a",
      providerClientId: "client-a",
      providerClientUniqueId: "unique-a",
    },
    inventoryAllowlist: row.inventory_allowlist,
  });
  assert.deepEqual(supabase.calls.find((call) => call[0] === "businessFilters"), [
    "businessFilters",
    { slug: "pilot-yoga", status: "active" },
  ]);
  assert.deepEqual(supabase.calls.find((call) => call[0] === "rpc"), [
    "rpc",
    "resolve_class_availability_context",
    {
      candidate_business_slug: "pilot-yoga",
      candidate_location_id: "location-a",
      candidate_offer_id: "offer-a",
      candidate_customer_id: "customer-a",
    },
  ]);
});

test("diagnostics persist only allowlisted operational facts", async () => {
  const supabase = fakeSupabase({ business: null, contextRow: null });
  const catalogue = createClassAvailabilityCatalogue(supabase);
  await catalogue.recordProviderDiagnostic({
    businessId: "business-a",
    offerId: "offer-a",
    locationId: "location-a",
    mappingId: "mapping-a",
    endpointName: "class/classes",
    requestId: "request-a",
    providerRequestId: "provider-request-a",
    statusCode: 429,
    durationMs: 25,
    success: false,
    errorCode: "HTTP_429",
    rawRequest: { Authorization: "must-not-persist" },
    rawResponse: { Client: "must-not-persist" },
  });
  assert.deepEqual(supabase.calls.at(-1), ["diagnostic", {
    business_id: "business-a",
    offer_id: "offer-a",
    location_id: "location-a",
    mapping_id: "mapping-a",
    endpoint_name: "class/classes",
    request_id: "request-a",
    provider_request_id: "provider-request-a",
    status_code: 429,
    duration_ms: 25,
    success: false,
    error_code: "HTTP_429",
  }]);
});

test("the catalogue resolves active customer-facing Class families with correlated provider mappings", async () => {
  const supabase = fakeSupabase({
    business: { id: "business-a" },
    contextRow: row,
    familyRows: [{
      family_id: "family-a",
      family_slug: "hot-yoga",
      family_name: "Hot Yoga",
      family_description: "Heated flow classes.",
      family_display_order: 2,
      provider_mappings: [{
        id: "family-mapping-a",
        providerLocationId: "7",
        providerClassDescriptionId: "13",
        providerProgramId: "11",
        providerSessionTypeId: "23",
      }],
    }],
  });
  const catalogue = createClassAvailabilityCatalogue(supabase);
  const context = await catalogue.resolveAvailabilityContext({
    businessSlug: "pilot-yoga",
    locationId: "location-a",
    offerId: "offer-a",
    customerId: "customer-a",
  });
  assert.deepEqual(context.classFamilies, [{
    id: "family-a",
    slug: "hot-yoga",
    displayName: "Hot Yoga",
    description: "Heated flow classes.",
    displayOrder: 2,
    providerMappings: [{
      id: "family-mapping-a",
      providerLocationId: "7",
      providerClassDescriptionId: "13",
      providerProgramId: "11",
      providerSessionTypeId: "23",
    }],
  }]);
});

test("the catalogue exposes the active Product set while retaining the legacy scalar projection", async () => {
  const supabase = fakeSupabase({
    business: { id: "business-a" },
    contextRow: row,
    pricingRows: [
      { provider_service_product_id: "product-shared" },
      { provider_service_product_id: "product-format-b" },
    ],
  });
  const catalogue = createClassAvailabilityCatalogue(supabase);
  const context = await catalogue.resolveAvailabilityContext({
    businessSlug: "pilot-yoga",
    locationId: "location-a",
    offerId: "offer-a",
    customerId: "customer-a",
  });
  assert.deepEqual(context.mapping, {
    id: "mapping-a",
    status: "active",
    providerServiceProductId: "product-revvi",
    providerServiceProductIds: ["product-shared", "product-format-b"],
  });
});

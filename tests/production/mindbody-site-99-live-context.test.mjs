import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSite99ClassFamilyManifest,
  refreshSite99LiveContext,
  Site99LiveContextError,
} from "../../supabase/functions/_shared/mindbody-site-99-live-context.js";

const familyId = "00000000-0000-4000-8000-000000000101";
const manifest = JSON.stringify([{
  id: familyId,
  name: "Daily Work Out",
  pricingOptionName: "5 Class Card",
  selectors: [{
    locationName: "Clubville",
    programName: "Classes",
    classDescriptionName: "Daily Work Out",
    sessionTypeName: "Work out of the day",
  }],
}]);

function context(siteId = "-99") {
  return {
    integration: { providerSiteId: siteId, environment: "sandbox" },
    location: { providerLocationId: "stale-location" },
    mapping: { providerServiceProductId: "stale-product" },
    inventoryAllowlist: {
      location: ["stale-location"],
      program: ["stale-program"],
      classDescription: ["stale-description"],
      sessionType: ["stale-session"],
    },
    classFamilies: [{
      id: familyId,
      displayName: "Daily Work Out",
      status: "active",
      providerMappings: [{
        providerLocationId: "stale-location",
        providerProgramId: "stale-program",
        providerClassDescriptionId: "stale-description",
        providerSessionTypeId: "stale-session",
      }],
    }],
  };
}

function provider() {
  return {
    getLocations: async () => [{ Id: 1, Name: "  Clubville ", Active: true }],
    getPrograms: async () => [{ Id: 26, Name: "Classes", ScheduleType: "Class", Active: true }],
    getClassDescriptions: async () => [
      { Id: 198, Name: "Daily Work Out", Program: { Id: 26 }, Active: false },
      { Id: 301, Name: "Daily Work Out", Program: { Id: 26 }, Active: true },
    ],
    getSessionTypes: async () => [{
      Id: 251, Name: "Work out of the day", Program: { Id: 26 }, Active: true,
    }],
  };
}

test("Site -99 refresh replaces resettable database IDs from stable names", async () => {
  const refreshed = await refreshSite99LiveContext(context(), { provider: provider(), manifest });

  assert.equal(refreshed.location.providerLocationId, "1");
  assert.equal(refreshed.allowInactiveClassDescriptions, true);
  assert.deepEqual(refreshed.inventoryAllowlist, {
    location: ["1"],
    program: ["26"],
    classDescription: ["301"],
    sessionType: ["251"],
    classSchedule: [],
  });
  assert.equal(refreshed.classFamilies[0].providerServiceProductName, "5 Class Card");
  assert.deepEqual(refreshed.classFamilies[0].providerMappings, [{
    providerLocationId: "1",
    providerClassDescriptionId: "301",
    providerProgramId: "26",
    providerSessionTypeId: "251",
  }]);
});

test("non-Site -99 contexts remain database-backed and perform no discovery", async () => {
  const original = context("123");
  const refreshed = await refreshSite99LiveContext(original, {
    manifest: "not-json",
    provider: new Proxy({}, { get: () => { throw new Error("provider must not be read"); } }),
  });
  assert.equal(refreshed, original);
});

test("Site -99 refresh fails closed when the manifest and approved families diverge", async () => {
  const parsed = parseSite99ClassFamilyManifest(manifest);
  assert.equal(parsed[0].id, familyId);
  const mismatched = context();
  mismatched.classFamilies[0].id = "00000000-0000-4000-8000-000000000999";
  await assert.rejects(
    refreshSite99LiveContext(mismatched, { provider: provider(), manifest }),
    (error) => error instanceof Site99LiveContextError
      && error.code === "SITE_99_CLASS_FAMILY_MANIFEST_MISMATCH"
      && error.status === 503,
  );
});

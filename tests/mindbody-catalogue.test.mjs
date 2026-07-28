import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMindbodyClient, normalizeLocations, normalizeSessionTypes, selectEnabledServices } from "../supabase/functions/_shared/mindbody.js";

test("normalizes the Mindbody session catalogue into safe service fields", () => {
  const result = normalizeSessionTypes({
    SessionTypes: [{ Id: 23, Name: "Nutrition Consultation", Description: "A useful consultation.", Duration: 45, OnlinePrice: 120 }],
  });

  assert.deepEqual(result, [{
    providerId: "23",
    name: "Nutrition Consultation",
    description: "A useful consultation.",
    durationMinutes: 45,
    price: 120,
  }]);
});

test("returns only configured services that are present in the live catalogue", () => {
  const result = selectEnabledServices(
    [
      { providerId: "23", name: "Nutrition Consultation", description: "Live", durationMinutes: 45, price: 120 },
      { providerId: "99", name: "Not enabled", description: null, durationMinutes: null, price: null },
    ],
    [
      { id: "revvi-service-23", mindbody_session_type_id: "23", display_name_override: "Revvi consultation", enabled: true },
      { id: "revvi-service-99", mindbody_session_type_id: "99", display_name_override: null, enabled: false },
      { id: "revvi-service-missing", mindbody_session_type_id: "404", display_name_override: null, enabled: true },
    ],
  );

  assert.deepEqual(result, [{ id: "revvi-service-23", name: "Revvi consultation", description: "Live", durationMinutes: 45, price: 120 }]);
});

test("normalizes provider Locations so tenant context can be checked against the Site", () => {
  assert.deepEqual(normalizeLocations({ Locations: [{ Id: 1, Name: "Clubville" }] }), [{ providerId: "1", name: "Clubville" }]);
});

test("sends the configured sandbox Site ID server-side", async () => {
  let request;
  const client = createMindbodyClient({
    apiKey: "sandbox-api-key",
    baseUrl: "https://sandbox.example.test/public/v6/",
    siteId: "sandbox-site-id",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ SessionTypes: [] }), { status: 200 });
    },
  });

  await client.getSessionTypes();

  assert.equal(request.url, "https://sandbox.example.test/public/v6/site/sessiontypes?Limit=100");
  assert.equal(request.options.headers.SiteId, "sandbox-site-id");
  assert.equal(request.options.headers["Api-Key"], "sandbox-api-key");
});

test("the browser page sends only Revvi context and a bearer token", async () => {
  const page = await readFile(new URL("../docs/catalogue/catalogue.html", import.meta.url), "utf8");

  assert.match(page, /data-testid="service-catalogue"/);
  assert.match(page, /Authorization: `Bearer \$\{token\}`/);
  assert.match(page, /business: params\.get\("business"\)/);
  assert.match(page, /location: params\.get\("location"\)/);
  assert.doesNotMatch(page, /Api-Key|SiteId|mindbody_site_id/);
});

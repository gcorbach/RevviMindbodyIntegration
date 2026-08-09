import assert from "node:assert/strict";
import test from "node:test";
import { createMindbodyClient, normalizeBookableItems } from "../supabase/functions/_prototype/appointment/mindbody.js";

test("normalizes Mindbody availability into stable Revvi slot fields", () => {
  const result = normalizeBookableItems({
    Availabilities: [{
      Id: 901,
      StartDateTime: "2026-07-28T16:00:00Z",
      EndDateTime: "2026-07-28T16:45:00Z",
      Location: { Id: 1, Name: "Clubville" },
      SessionType: { Id: 23, Name: "Nutrition Consultation", Duration: 45 },
      Price: 120,
    }],
  });

  assert.deepEqual(result, [{
    providerId: "901",
    startTime: "2026-07-28T16:00:00.000Z",
    endTime: "2026-07-28T16:45:00.000Z",
    locationProviderId: "1",
    durationMinutes: 45,
    price: 120,
  }]);
});

test("requests live bookable items for one configured service and Location", async () => {
  let request;
  const client = createMindbodyClient({
    apiKey: "sandbox-api-key",
    baseUrl: "https://sandbox.example.test/public/v6/",
    siteId: "sandbox-site-id",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ Availabilities: [] }), { status: 200 });
    },
  });

  await client.getBookableItems({
    sessionTypeId: "23",
    locationId: "1",
    startDate: "2026-07-28T00:00:00.000Z",
    endDate: "2026-08-12T00:00:00.000Z",
  });

  assert.equal(
    request.url,
    "https://sandbox.example.test/public/v6/appointment/bookableitems?SessionTypeIds=23&LocationIds=1&StartDate=2026-07-28T00%3A00%3A00.000Z&EndDate=2026-08-12T00%3A00%3A00.000Z",
  );
  assert.equal(request.options.headers.SiteId, "sandbox-site-id");
});

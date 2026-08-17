import assert from "node:assert/strict";
import test from "node:test";

import {
  createMindbodyClassReadClient,
  instrumentClassReadProvider,
  MindbodyClassReadError,
} from "../../supabase/functions/_shared/mindbody-class-read.js";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("the class read client uses every required Public API resource and paginates without appointment calls", async () => {
  const requests = [];
  const pages = new Map([
    ["/public/v6/site/sites", { Sites: [{ Id: -99, Name: "Pilot", CurrencyIsoCode: "ZAR" }] }],
    ["/public/v6/site/locations", { Locations: [{ Id: 7, Name: "Rosebank", HasClasses: true }] }],
    ["/public/v6/site/programs", { Programs: [{ Id: 11, Name: "Yoga", ScheduleType: "Class" }] }],
    ["/public/v6/class/classdescriptions", { ClassDescriptions: [{ Id: 13, Name: "Yoga Flow", Active: true }] }],
    ["/public/v6/class/classschedules", { ClassSchedules: [{ Id: 17 }] }],
    ["/public/v6/class/classes", { Classes: [{ Id: 19 }, { Id: 20 }] }],
    ["/public/v6/sale/services", { Services: [{ ProductId: "product-revvi" }] }],
  ]);
  const client = createMindbodyClassReadClient({
    apiKey: "api-secret",
    siteId: "-99",
    baseUrl: "https://api.mindbodyonline.com",
    pageLimit: 2,
    fetchImpl: async (url, options) => {
      const requestUrl = new URL(url);
      requests.push({ requestUrl, options });
      const body = pages.get(requestUrl.pathname);
      assert.ok(body, `unexpected endpoint ${requestUrl.pathname}`);
      const collectionName = Object.keys(body)[0];
      const pageItems = requestUrl.searchParams.get("Offset") === "2" ? [{ Id: 21 }] : body[collectionName];
      return jsonResponse({
        [collectionName]: pageItems,
        PaginationResponse: {
          RequestedLimit: 2,
          RequestedOffset: Number(requestUrl.searchParams.get("Offset")),
          PageSize: pageItems.length,
          TotalResults: collectionName === "Classes" ? 3 : pageItems.length,
        },
      });
    },
  });

  const results = await Promise.all([
    client.getSites({ siteIds: ["-99"] }),
    client.getLocations(),
    client.getPrograms({ scheduleType: "Class" }),
    client.getClassDescriptions({ programIds: ["11"] }),
    client.getClassSchedules({ classScheduleIds: ["17"] }),
    client.getClasses({
      locationIds: ["7"],
      startDateTime: "2026-08-11T00:00:00.000Z",
      endDateTime: "2026-08-25T00:00:00.000Z",
      clientId: "client-1",
      schedulingWindow: true,
    }),
    client.getServices({ classId: "19", locationId: "7", sellOnline: true }),
  ]);

  assert.deepEqual(results.map((items) => items.length), [1, 1, 1, 1, 1, 3, 1]);
  assert.equal(requests.length, 8);
  for (const { requestUrl, options } of requests) {
    assert.equal(options.method, "GET");
    assert.equal(options.headers["Api-Key"], "api-secret");
    assert.equal(options.headers.SiteId, "-99");
    assert.equal(requestUrl.searchParams.get("Limit"), "2");
    assert.doesNotMatch(requestUrl.pathname, /appointment/i);
  }
  const classRequests = requests.filter(({ requestUrl }) => requestUrl.pathname.endsWith("/class/classes"));
  assert.equal(classRequests.length, 2);
  assert.deepEqual(classRequests[0].requestUrl.searchParams.getAll("LocationIds"), ["7"]);
  assert.equal(classRequests[0].requestUrl.searchParams.get("ClientId"), "client-1");
  assert.equal(classRequests[0].requestUrl.searchParams.get("SchedulingWindow"), "true");
  assert.equal(classRequests[1].requestUrl.searchParams.get("Offset"), "2");
});

test("provider failures expose only an allowlisted diagnostic summary", async () => {
  const client = createMindbodyClassReadClient({
    apiKey: "must-never-leak",
    siteId: "-99",
    baseUrl: "https://api.mindbodyonline.com",
    fetchImpl: async () => jsonResponse({ Error: { Message: "raw provider secret details" } }, 429, {
      "apim-request-id": "provider-request-33",
    }),
  });

  await assert.rejects(
    client.getClasses({ locationIds: ["7"] }),
    (error) => {
      assert.equal(error.name, "MindbodyClassReadError");
      assert.deepEqual(error.diagnostic, {
        endpointName: "class/classes",
        statusCode: 429,
        providerRequestId: "provider-request-33",
        errorCode: "HTTP_429",
      });
      assert.doesNotMatch(JSON.stringify(error), /must-never-leak|raw provider secret details/);
      return true;
    },
  );
});

test("every provider resource read records bounded success or failure diagnostics", async () => {
  const diagnostics = [];
  let clock = 100;
  const provider = instrumentClassReadProvider({
    getSites: async () => [{ Id: -99 }],
    getLocations: async () => {
      throw new MindbodyClassReadError("unavailable", {
        endpointName: "site/locations",
        statusCode: 503,
        providerRequestId: "provider-33",
        errorCode: "HTTP_503",
      });
    },
  }, {
    context: {
      businessId: "business-a",
      offerId: "offer-a",
      locationId: "location-a",
      mappingId: "mapping-a",
    },
    requestId: "request-33",
    clock: () => {
      clock += 5;
      return clock;
    },
    recordDiagnostic: async (facts) => diagnostics.push(facts),
  });

  assert.deepEqual(await provider.getSites(), [{ Id: -99 }]);
  await assert.rejects(provider.getLocations(), (error) => error.diagnostic.errorCode === "HTTP_503");
  assert.deepEqual(diagnostics, [
    {
      businessId: "business-a",
      offerId: "offer-a",
      locationId: "location-a",
      mappingId: "mapping-a",
      endpointName: "site/sites",
      requestId: "request-33",
      providerRequestId: null,
      statusCode: 200,
      durationMs: 5,
      success: true,
      errorCode: null,
    },
    {
      businessId: "business-a",
      offerId: "offer-a",
      locationId: "location-a",
      mappingId: "mapping-a",
      endpointName: "site/locations",
      requestId: "request-33",
      providerRequestId: "provider-33",
      statusCode: 503,
      durationMs: 5,
      success: false,
      errorCode: "HTTP_503",
    },
  ]);
});

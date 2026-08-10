import assert from "node:assert/strict";
import test from "node:test";

import {
  createMindbodyClientQuoteClient,
  instrumentClientQuoteProvider,
} from "../../supabase/functions/_shared/mindbody-client-quote.js";

function response(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

test("Mindbody client lookup uses exact documented client and duplicate boundaries", async () => {
  const requests = [];
  const client = createMindbodyClientQuoteClient({
    apiKey: "api-key",
    siteId: "-99",
    userToken: "staff-token",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return requests.length === 1
        ? response({ Clients: [{ Id: "rss-1", UniqueId: 41, Email: " Member@Example.com ", FirstName: "Ava", LastName: "Ndlovu" }], PaginationResponse: { TotalResults: 1, PageSize: 100, RequestedOffset: 0 } })
        : response({ Clients: [{ Id: "rss-1", UniqueId: 41 }], PaginationResponse: { TotalResults: 1, PageSize: 100, RequestedOffset: 0 } });
    },
  });

  const matches = await client.searchClients({ email: "member@example.com" });
  const duplicates = await client.getClientDuplicates({ firstName: "Ava", lastName: "Ndlovu", email: "member@example.com" });

  assert.deepEqual(matches[0], { id: "rss-1", uniqueId: "41", email: "member@example.com", firstName: "Ava", lastName: "Ndlovu" });
  assert.equal(duplicates.length, 1);
  assert.match(requests[0].url, /client\/clients\?SearchText=member%40example\.com/);
  assert.match(requests[1].url, /client\/clientduplicates\?FirstName=Ava&LastName=Ndlovu&Email=member%40example\.com/);
  assert.equal(requests[0].init.headers.Authorization, "Bearer staff-token");
});

test("client-aware Class re-read and paid quote send Class, Client, Product, Location and Test=true", async () => {
  const requests = [];
  const client = createMindbodyClientQuoteClient({
    apiKey: "api-key",
    siteId: "-99",
    userToken: "staff-token",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return requests.length === 1
        ? response({ Classes: [{ Id: 771, ClassScheduleId: 991, ClassDescription: { Id: 13, Name: "Revvi Yoga", Program: { Id: 11 }, SessionType: { Id: 23 } }, StartDateTime: "2026-08-11T10:00:00", Location: { Id: 7, Name: "Rosebank" }, IsAvailable: true, IsCanceled: false }] })
        : response({ ShoppingCart: { SubTotal: 120, DiscountTotal: 20, TaxTotal: 15, GrandTotal: 115 } });
    },
  });

  const occurrence = await client.getClassForClient({ classId: "771", clientId: "rss-1", uniqueClientId: "41", timezone: "Africa/Johannesburg" });
  const quote = await client.testCheckout({ classId: "771", clientId: "rss-1", locationId: "7", productId: "product-revvi" });

  assert.deepEqual(occurrence, {
    id: "771", classScheduleId: "991", classDescriptionId: "13", programId: "11", sessionTypeId: "23",
    name: "Revvi Yoga", startAt: "2026-08-11T08:00:00.000Z", locationId: "7", locationName: "Rosebank",
    isAvailable: true, isCanceled: false,
  });
  assert.match(requests[0].url, /class\/classes\?ClassIds=771&ClientId=rss-1&UniqueClientId=41/);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    ClientId: "rss-1",
    LocationId: "7",
    Test: true,
    CartItems: [{ Item: { Type: "Service", Metadata: { Id: "product-revvi" } }, Quantity: 1 }],
    ClassIds: ["771"],
  });
  assert.deepEqual(quote, { subtotal: 120, discountTotal: 20, taxTotal: 15, grandTotal: 115 });
});

test("the quote adapter never exposes a live checkout operation", () => {
  const client = createMindbodyClientQuoteClient({ apiKey: "api-key", siteId: "-99", userToken: "staff-token" });
  assert.equal("checkout" in client, false);
  assert.equal("addClientToClass" in client, false);
});

test("quote currency is read from the configured Mindbody Site", async () => {
  const client = createMindbodyClientQuoteClient({
    apiKey: "api-key",
    siteId: "-99",
    userToken: "staff-token",
    fetchImpl: async () => response({ Sites: [{ Id: -99, CurrencyCode: "ZAR" }] }),
  });
  assert.equal(await client.getSiteCurrency(), "ZAR");
});

test("every client and quote operation records only bounded provider diagnostics", async () => {
  const diagnostics = [];
  const provider = instrumentClientQuoteProvider({ searchClients: async () => [] }, {
    context: { businessId: "business-a", offerId: "offer-a", customerId: "customer-a" },
    requestId: "request-35",
    clock: (() => { let value = 10; return () => value += 5; })(),
    recordDiagnostic: async (facts) => diagnostics.push(facts),
  });
  await provider.searchClients({ email: "member@example.com" });
  assert.deepEqual(diagnostics, [{
    businessId: "business-a", offerId: "offer-a", customerId: "customer-a",
    endpointName: "client/clients", requestId: "request-35", providerRequestId: null,
    statusCode: 200, durationMs: 5, success: true, errorCode: null,
  }]);
});

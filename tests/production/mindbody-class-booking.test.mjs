import assert from "node:assert/strict";
import test from "node:test";

import {
  createMindbodyClassBookingClient,
  MindbodyClassBookingError,
} from "../../supabase/functions/_shared/mindbody-class-booking.js";

function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function options(fetchImpl) {
  return {
    apiKey: "api-key",
    siteId: "-99",
    userToken: "staff-token-long-enough",
    baseUrl: "https://api.example.test",
    requestTimeoutMs: 1_000,
    fetchImpl,
  };
}

test("existing entitlement booking sends the exact ClientService and confirms only from Visit evidence", async () => {
  let request;
  const client = createMindbodyClassBookingClient(options(async (url, init) => {
    request = { url: String(url), init };
    return response({ Visit: { Id: 901, ClassId: 771, ClientId: "rss-1", ServiceId: 611 } });
  }));

  const result = await client.createBooking({
    mode: "existing_entitlement",
    classId: "771",
    clientId: "rss-1",
    uniqueClientId: "41",
    clientServiceId: "611",
  });

  assert.match(request.url, /\/public\/v6\/class\/addclienttoclass$/);
  assert.equal(request.init.method, "POST");
  assert.deepEqual(JSON.parse(request.init.body), {
    ClientId: "rss-1",
    ClassId: "771",
    ClientServiceId: "611",
    RequirePayment: true,
    SendEmail: false,
    Waitlist: false,
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.certainty, "provider_confirmed");
  assert.equal(result.visitId, "901");
  assert.equal(result.clientServiceId, "611");
});

test("provider email stays off unless both the flag and controlled evidence are configured", async () => {
  const bodies = [];
  for (const runtimeOptions of [
    { sendProviderEmail: true },
    { sendProviderEmail: true, notificationEvidenceVerified: true },
  ]) {
    const client = createMindbodyClassBookingClient({
      ...options(async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return response({ Visit: { Id: "visit-1", ClassId: "771", ClientId: "rss-1" } });
      }),
      ...runtimeOptions,
    });
    await client.createBooking({ mode: "approved_unpaid", classId: "771", clientId: "rss-1" });
  }
  assert.equal(bodies[0].SendEmail, false);
  assert.equal(bodies[1].SendEmail, true);
});

test("approved unpaid booking explicitly sets RequirePayment false", async () => {
  let body;
  const client = createMindbodyClassBookingClient(options(async (_url, init) => {
    body = JSON.parse(init.body);
    return response({ Visit: { Id: "visit-free", ClassId: "771", ClientId: "rss-1" } });
  }));

  const result = await client.createBooking({
    mode: "approved_unpaid", classId: "771", clientId: "rss-1", uniqueClientId: "41",
  });
  assert.equal(body.RequirePayment, false);
  assert.equal(Object.hasOwn(body, "ClientServiceId"), false);
  assert.equal(result.status, "confirmed");
});

test("paid purchase stays fail-closed without an approved no-card provider route", async () => {
  let requests = 0;
  const client = createMindbodyClassBookingClient(options(async () => {
    requests += 1;
    return response({});
  }));

  await assert.rejects(
    client.createBooking({
      mode: "purchase_pricing_option", classId: "771", clientId: "rss-1", serviceProductId: "product-1",
    }),
    (error) => error instanceof MindbodyClassBookingError
      && error.code === "PAID_ROUTE_NOT_APPROVED"
      && error.certainty === "provider_rejected",
  );
  assert.equal(requests, 0);
});

test("provider 4xx rejection is explicit while timeout and 5xx remain unknown", async () => {
  for (const [fetchImpl, certainty] of [
    [async () => response({ Error: { Code: "ClassFull" } }, 400), "provider_rejected"],
    [async () => response({ Error: { Code: "Failure" } }, 503), "unknown"],
    [async () => { throw new DOMException("timed out", "TimeoutError"); }, "unknown"],
  ]) {
    const client = createMindbodyClassBookingClient(options(fetchImpl));
    await assert.rejects(
      client.createBooking({
        mode: "approved_unpaid", classId: "771", clientId: "rss-1",
      }),
      (error) => error.certainty === certainty,
    );
  }
});

test("a nominal AddClient response without Visit, roster, or waitlist evidence is unknown", async () => {
  const client = createMindbodyClassBookingClient(options(async () => response({ Message: "Accepted" })));
  const result = await client.createBooking({
    mode: "approved_unpaid", classId: "771", clientId: "rss-1",
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.certainty, "unknown");
});

test("AddClient evidence for another Client or Class cannot confirm this Booking", async () => {
  const client = createMindbodyClassBookingClient(options(async () => response({
    Visit: { Id: "visit-wrong", ClassId: "772", ClientId: "rss-attacker" },
  })));
  const result = await client.createBooking({
    mode: "approved_unpaid", classId: "771", clientId: "rss-1",
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.certainty, "unknown");
});

test("reconciliation confirms only an exact Client/Class Visit and recognizes waitlist evidence", async () => {
  const calls = [];
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("/client/clientvisits")) {
      return response({ Visits: [{ Id: "visit-wrong", ClassId: 772, ClientId: "rss-1" }] });
    }
    if (path.endsWith("/class/classvisits")) {
      return response({ Visits: [{ Id: "visit-exact", ClassId: 771, ClientId: "rss-1", ServiceId: 611 }] });
    }
    return response(path.endsWith("/class/waitlistentries") ? { WaitlistEntries: [] } : {});
  }));

  const result = await client.reconcileBooking({
    classId: "771", clientId: "rss-1", clientServiceId: "611",
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.visitId, "visit-exact");
  assert.ok(calls.some((path) => path.endsWith("/client/clientschedule")));
  assert.ok(calls.some((path) => path.endsWith("/client/clientvisits")));
  assert.ok(calls.some((path) => path.endsWith("/class/classvisits")));
  assert.ok(calls.some((path) => path.endsWith("/class/waitlistentries")));
  assert.ok(calls.some((path) => path.endsWith("/sale/sales")));
  assert.ok(calls.some((path) => path.endsWith("/sale/transactions")));
});

test("inconclusive reconciliation remains unknown and never treats absence as rejection", async () => {
  const client = createMindbodyClassBookingClient(options(async () => response({})));
  const result = await client.reconcileBooking({ classId: "771", clientId: "rss-1" });
  assert.equal(result.status, "unknown");
  assert.equal(result.certainty, "unknown");
});

test("reconciliation accepts exact atomic Sale/Transaction evidence and verified webhook roster evidence", async () => {
  const financialClient = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/sale/sales")) return response({ Sales: [{
      Id: "sale-1", ClientId: "rss-1", ClassIds: ["771"],
      Items: [{ ProductId: "product-1" }],
    }] });
    if (path.endsWith("/sale/transactions")) return response({ Transactions: [{
      Id: "txn-1", SaleId: "sale-1", Status: "Approved",
    }] });
    return response({});
  }));
  const financial = await financialClient.reconcileBooking({
    classId: "771", clientId: "rss-1", serviceProductId: "product-1",
  });
  assert.equal(financial.status, "confirmed");
  assert.equal(financial.atomicCheckoutConfirmed, true);
  assert.equal(financial.saleId, "sale-1");
  assert.equal(financial.transactionId, "txn-1");

  const webhookClient = createMindbodyClassBookingClient(options(async () => response({})));
  const webhook = await webhookClient.reconcileBooking({
    classId: "771",
    clientId: "rss-1",
    webhookEvidence: [{
      verified: true, type: "class_roster", classId: "771", clientId: "rss-1",
      rosterBookingId: "roster-1",
    }],
  });
  assert.equal(webhook.status, "confirmed");
  assert.equal(webhook.rosterBookingId, "roster-1");
});

test("reconciliation rejects unverified, mismatched, and incomplete evidence", async () => {
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/sale/sales")) return response({ Sales: [{
      Id: "sale-1", ClientId: "rss-attacker", ClassIds: ["771"],
      Items: [{ ProductId: "product-1" }],
    }] });
    if (path.endsWith("/sale/transactions")) return response({ Transactions: [{
      Id: "txn-1", SaleId: "sale-1", Status: "Approved",
    }] });
    return response({});
  }));
  const result = await client.reconcileBooking({
    classId: "771",
    clientId: "rss-1",
    serviceProductId: "product-1",
    webhookEvidence: [{
      verified: false, type: "class_roster", classId: "771", clientId: "rss-1",
      rosterBookingId: "roster-unverified",
    }],
  });
  assert.equal(result.status, "unknown");
});

test("reconciliation propagates provider failure when every evidence read fails", async () => {
  const client = createMindbodyClassBookingClient(options(async () => {
    throw new Error("provider unavailable");
  }));
  await assert.rejects(
    client.reconcileBooking({ classId: "771", clientId: "rss-1" }),
    /temporarily unavailable|provider unavailable/i,
  );
});

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

test("booking reconciliation uses Mindbody's nested ClientSchedule and ClassVisits query contracts", async () => {
  const urls = [];
  const client = createMindbodyClassBookingClient(options(async (url) => {
    urls.push(String(url));
    return response({
      Classes: [], Visits: [], WaitlistEntries: [], Sales: [], Transactions: [],
      PaginationResponse: { TotalResults: 0 },
    });
  }));

  await client.reconcileBooking({
    mode: "approved_unpaid", classId: "771", clientId: "rss-1", serviceProductId: "1431",
  });

  const scheduleUrl = urls.find((url) => url.includes("/client/clientschedule"));
  const scheduleQuery = new URL(scheduleUrl).searchParams;
  assert.equal(scheduleQuery.get("request.clientId"), "rss-1");
  assert.match(scheduleQuery.get("request.startDate"), /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  assert.match(scheduleQuery.get("request.endDate"), /^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/);
  assert.equal(scheduleQuery.get("request.limit"), "200");
  assert.doesNotMatch(scheduleUrl, /ClientIds=/);
  const classVisitsUrl = urls.find((url) => url.includes("/class/classvisits"));
  assert.match(classVisitsUrl, /request\.classID=771/);
  assert.doesNotMatch(classVisitsUrl, /[?&]ClassId=/);
});

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

test("an evidenced alternative-payment route initiates one atomic Class checkout without card fields", async () => {
  let request;
  const client = createMindbodyClassBookingClient({
    ...options(async (url, init) => {
      request = { url: String(url), init };
      return response({
        AccessToken: "opaque-provider-access-token",
        RedirectUrl: "https://payments.example.test/continue",
      });
    }),
    paidRoute: {
      type: "mindbody_alternative_payment",
      paymentMethodId: 801,
      checkoutLocationId: 98,
      callbackUrl: "https://api.revvi.example/functions/v1/complete-paid-booking",
    },
  });

  const result = await client.createBooking({
    mode: "purchase_pricing_option",
    classId: "771",
    clientId: "rss-1",
    serviceProductId: "product-1",
    priceAmount: 115,
    currency: "ZAR",
  });

  assert.match(request.url, /\/public\/v6\/sale\/initiatecheckoutshoppingcart$/);
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body, {
    ClientId: "rss-1",
    Test: false,
    InStore: false,
    CalculateTax: true,
    SendEmail: false,
    LocationId: 98,
    PaymentAuthenticationCallbackUrl: "https://api.revvi.example/functions/v1/complete-paid-booking",
    EnforceLocationRestrictions: true,
    Items: [{
      Item: { Type: "Service", Metadata: { Id: "product-1" } },
      Quantity: 1,
      ClassIds: [771],
    }],
    Payments: [{ PaymentMethodId: 801, Amount: 115 }],
  });
  assert.doesNotMatch(JSON.stringify(body), /card|pan|cvv|expiry/i);
  assert.equal(result.status, "requires_action");
  assert.equal(result.certainty, "provider_confirmed");
  assert.deepEqual(result.requiredAction, {
    type: "redirect",
    url: "https://payments.example.test/continue",
  });
  assert.equal(result.providerAccessToken, "opaque-provider-access-token");
  assert.equal(result.serviceProductId, "product-1");
});

test("the hard-locked Site -99 Cash route confirms only from exact live purchase, Visit, roster and ClientService evidence", async () => {
  let checkoutBody;
  let scheduleUrl;
  let clientVisitReads = 0;
  let clientServiceReads = 0;
  const visit = { Id: 901, ClassId: 771, ClientId: "rss-1", ServiceId: 611 };
  const client = createMindbodyClassBookingClient({
    ...options(async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/sale/checkoutshoppingcart")) {
        checkoutBody = JSON.parse(init.body);
        return response({ ShoppingCart: { Id: "cart-1", SaleId: 501 } });
      }
      if (path.endsWith("/client/clientschedule")) {
        scheduleUrl = new URL(url);
        return response({ Classes: [] });
      }
      if (path.endsWith("/client/clientvisits")) {
        clientVisitReads += 1;
        return response({ Visits: clientVisitReads === 1 ? [] : [visit] });
      }
      if (path.endsWith("/class/classvisits")) return response({ Class: { Id: 771, Visits: [visit] } });
      if (path.endsWith("/sale/sales")) return response({ Sales: [{
        Id: 501,
        ClientId: "rss-1",
        ShoppingCartId: "cart-1",
        Returned: false,
        PurchasedItems: [{ Id: 1431, Returned: false }],
        Payments: [{ Id: 701, Type: "Alex Bank Visa Ballet", Amount: 13 }],
      }] });
      if (path.endsWith("/sale/transactions")) return response({ Transactions: [] });
      if (path.endsWith("/client/clientservices")) {
        clientServiceReads += 1;
        return response({ ClientServices: clientServiceReads === 1 ? [] : [{
          Id: 611, ProductId: 1431, Current: false, Returned: false, Remaining: 0,
        }] });
      }
      throw new Error(`Unexpected endpoint ${path}`);
    }),
    sandboxCashRoute: true,
    reconciliationAttempts: 1,
    reconciliationDelayMs: 0,
  });

  const result = await client.createBooking({
    mode: "purchase_pricing_option",
    locationId: "1",
    classId: "771",
    clientId: "rss-1",
    serviceProductId: "1431",
    priceAmount: 13,
    currency: "USD",
  });

  assert.deepEqual(checkoutBody, {
    ClientId: "rss-1",
    LocationId: 1,
    Test: false,
    InStore: false,
    CalculateTax: true,
    SendEmail: false,
    EnforceLocationRestrictions: true,
    Items: [{
      Item: { Type: "Service", Metadata: { Id: "1431" } },
      Quantity: 1,
      ClassIds: [771],
    }],
    Payments: [{ Type: "Cash", MetaData: { Amount: 13, Notes: "Revvi hosted Site -99 demo" } }],
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.atomicCheckoutConfirmed, true);
  assert.equal(result.paymentType, "Cash");
  assert.equal(result.providerPaymentType, "Alex Bank Visa Ballet");
  assert.equal(result.transactionId, null);
  assert.equal(result.visitId, "901");
  assert.equal(result.clientServiceId, "611");
  assert.equal(scheduleUrl.searchParams.get("request.clientId"), "rss-1");
  assert.match(scheduleUrl.searchParams.get("request.startDate"), /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  assert.match(scheduleUrl.searchParams.get("request.endDate"), /^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/);
  assert.equal(scheduleUrl.searchParams.get("request.limit"), "200");
});

test("the Site -99 Cash route stays unknown without the exact Class roster Visit", async () => {
  let clientVisitReads = 0;
  let clientServiceReads = 0;
  const visit = { Id: 901, ClassId: 771, ClientId: "rss-1", ServiceId: 611 };
  const client = createMindbodyClassBookingClient({
    ...options(async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/sale/checkoutshoppingcart")) {
        return response({ ShoppingCart: { Id: "cart-1", SaleId: 501 } });
      }
      if (path.endsWith("/client/clientschedule")) return response({ Classes: [] });
      if (path.endsWith("/client/clientvisits")) {
        clientVisitReads += 1;
        return response({ Visits: clientVisitReads === 1 ? [] : [visit] });
      }
      if (path.endsWith("/class/classvisits")) return response({ Class: { Id: 771, Visits: [] } });
      if (path.endsWith("/sale/sales")) return response({ Sales: [{
        Id: 501,
        ClientId: "rss-1",
        Returned: false,
        PurchasedItems: [{ Id: 1431, Returned: false }],
        Payments: [{ Id: 701, Type: "Cash", Amount: 13 }],
      }] });
      if (path.endsWith("/sale/transactions")) return response({ Transactions: [] });
      if (path.endsWith("/client/clientservices")) {
        clientServiceReads += 1;
        return response({ ClientServices: clientServiceReads === 1 ? [] : [{
          Id: 611, ProductId: 1431, Current: false, Returned: false, Remaining: 0,
        }] });
      }
      throw new Error(`Unexpected endpoint ${path}`);
    }),
    sandboxCashRoute: true,
    reconciliationAttempts: 1,
    reconciliationDelayMs: 0,
  });

  const result = await client.createBooking({
    mode: "purchase_pricing_option",
    locationId: "1",
    classId: "771",
    clientId: "rss-1",
    serviceProductId: "1431",
    priceAmount: 13,
    currency: "USD",
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.errorCode, "SANDBOX_CASH_EVIDENCE_INCOMPLETE");
  assert.equal(result.saleId, "501");
  assert.equal(result.cartId, "cart-1");
});

test("the Site -99 Cash route cannot join a new Sale to pre-existing Visit and ClientService evidence", async () => {
  const visit = { Id: 901, ClassId: 771, ClientId: "rss-1", ServiceId: 611 };
  const service = { Id: 611, ProductId: 1431, Current: true, Returned: false, Remaining: 8 };
  const client = createMindbodyClassBookingClient({
    ...options(async (url) => {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname;
      const offset = Number(parsedUrl.searchParams.get("Offset") ?? 0);
      if (path.endsWith("/sale/checkoutshoppingcart")) {
        return response({ ShoppingCart: { Id: "cart-new", SaleId: 502 } });
      }
      if (path.endsWith("/client/clientschedule")) return response({ Classes: [] });
      if (path.endsWith("/client/clientvisits")) return offset === 0
        ? response({
          Visits: Array.from({ length: 100 }, (_, index) => ({
            Id: `unrelated-visit-${index}`, ClassId: 999, ClientId: "rss-1",
          })),
          PaginationResponse: { TotalResults: 101 },
        })
        : response({ Visits: [visit], PaginationResponse: { TotalResults: 101 } });
      if (path.endsWith("/class/classvisits")) return response({ Class: { Id: 771, Visits: [visit] } });
      if (path.endsWith("/sale/sales")) return response({ Sales: [{
        Id: 502,
        ClientId: "rss-1",
        Returned: false,
        PurchasedItems: [{ Id: 1431, Returned: false }],
        Payments: [{ Id: 702, Type: "Cash", Amount: 13 }],
      }] });
      if (path.endsWith("/sale/transactions")) return response({ Transactions: [] });
      if (path.endsWith("/client/clientservices")) return offset === 0
        ? response({
          ClientServices: Array.from({ length: 100 }, (_, index) => ({
            Id: `unrelated-service-${index}`, ProductId: 999,
          })),
          PaginationResponse: { TotalResults: 101 },
        })
        : response({ ClientServices: [service], PaginationResponse: { TotalResults: 101 } });
      throw new Error(`Unexpected endpoint ${path}`);
    }),
    sandboxCashRoute: true,
    reconciliationAttempts: 1,
    reconciliationDelayMs: 0,
  });

  const result = await client.createBooking({
    mode: "purchase_pricing_option",
    locationId: "1",
    classId: "771",
    clientId: "rss-1",
    serviceProductId: "1431",
    priceAmount: 13,
    currency: "USD",
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.errorCode, "SANDBOX_CASH_EVIDENCE_INCOMPLETE");
});

test("paid return completes the exact initiated cart but never treats the callback response as success", async () => {
  let request;
  const client = createMindbodyClassBookingClient({
    ...options(async (url, init) => {
      request = { url: String(url), init };
      return response({
        Sale: { Id: "sale-unverified" },
        Cart: { Id: "cart-unverified" },
        Transaction: { Id: "transaction-unverified", Status: "Approved" },
        Payment: { Id: "payment-unverified" },
      });
    }),
    paidRoute: {
      type: "mindbody_alternative_payment",
      paymentMethodId: 801,
      checkoutLocationId: 98,
      callbackUrl: "https://www.revvi.example/payment-return",
    },
  });

  const result = await client.completePaidBooking({
    paymentRoute: "mindbody_alternative_payment",
    providerAccessToken: "opaque-provider-access-token",
    clientId: "rss-1",
  });

  assert.match(request.url, /\/public\/v6\/sale\/completecheckoutshoppingcart$/);
  assert.deepEqual(JSON.parse(request.init.body), {
    AccessToken: "opaque-provider-access-token",
    ClientId: "rss-1",
    Test: false,
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.certainty, "unverified");
  assert.equal(result.saleId, "sale-unverified");
  assert.equal(result.cartId, "cart-unverified");
  assert.equal(result.transactionId, "transaction-unverified");
  assert.equal(result.paymentId, "payment-unverified");
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

test("approved unpaid reconciliation confirms only roster evidence with no matching financial state", async () => {
  const calls = [];
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path.endsWith("/class/classvisits")) {
      return response({ Visits: [{ Id: "visit-unpaid", ClassId: 771, ClientId: "rss-1" }] });
    }
    return response({});
  }));
  const result = await client.reconcileBooking({
    mode: "approved_unpaid", classId: "771", clientId: "rss-1",
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.visitId, "visit-unpaid");
  assert.equal(calls.some((path) => path.endsWith("/sale/sales")), true);
  assert.equal(calls.some((path) => path.endsWith("/sale/transactions")), true);
});

test("approved unpaid reconciliation keeps any matching Sale state unknown", async () => {
  for (const transaction of [
    null,
    { Id: "transaction-failed", SaleId: "sale-unexpected", Status: "Failed" },
    { Id: "transaction-approved", SaleId: "sale-unexpected", Status: "Approved" },
  ]) {
    const client = createMindbodyClassBookingClient(options(async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/class/classvisits")) {
        return response({ Visits: [{ Id: "visit-contaminated", ClassId: 771, ClientId: "rss-1" }] });
      }
      if (path.endsWith("/sale/sales")) {
        return response({ Sales: [{ Id: "sale-unexpected", ClientId: "rss-1", ClassIds: ["771"] }] });
      }
      if (path.endsWith("/sale/transactions")) {
        return response({ Transactions: transaction ? [transaction] : [] });
      }
      return response({});
    }));
    const result = await client.reconcileBooking({
      mode: "approved_unpaid", classId: "771", clientId: "rss-1",
    });
    assert.equal(result.status, "unknown");
    assert.equal(result.errorCode, "APPROVED_UNPAID_FINANCIAL_EVIDENCE");
    assert.equal(result.saleId, "sale-unexpected");
    assert.equal(result.transactionId, transaction?.Id ?? null);
  }
});

test("approved unpaid reconciliation stays unknown when financial state cannot be read", async () => {
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/class/classvisits")) {
      return response({ Visits: [{ Id: "visit-unverified", ClassId: 771, ClientId: "rss-1" }] });
    }
    if (path.endsWith("/sale/sales")) throw new DOMException("timed out", "TimeoutError");
    return response({});
  }));
  const result = await client.reconcileBooking({
    mode: "approved_unpaid", classId: "771", clientId: "rss-1",
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.errorCode, "APPROVED_UNPAID_FINANCIAL_STATE_UNVERIFIED");
});

test("approved unpaid reconciliation preserves a matching Sale when Transaction reads fail", async () => {
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/class/classvisits")) {
      return response({ Visits: [{ Id: "visit-contaminated", ClassId: 771, ClientId: "rss-1" }] });
    }
    if (path.endsWith("/sale/sales")) {
      return response({ Sales: [{ Id: "sale-known", ClientId: "rss-1", ClassIds: ["771"] }] });
    }
    if (path.endsWith("/sale/transactions")) throw new DOMException("timed out", "TimeoutError");
    return response({});
  }));
  const result = await client.reconcileBooking({
    mode: "approved_unpaid", classId: "771", clientId: "rss-1",
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.errorCode, "APPROVED_UNPAID_FINANCIAL_EVIDENCE");
  assert.equal(result.saleId, "sale-known");
  assert.equal(result.transactionId, null);
});

test("paid reconciliation requires exact roster and Sale/Transaction evidence together", async () => {
  const financialClient = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/class/classvisits")) return response({ Visits: [{
      Id: "visit-1", ClassId: 771, ClientId: "rss-1", ServiceId: "client-service-1",
    }] });
    if (path.endsWith("/client/clientservices")) return response({ ClientServices: [{
      Id: "client-service-1", ProductId: "product-1", Current: true,
    }] });
    if (path.endsWith("/sale/sales")) return response({ Sales: [{
      Id: "sale-1", ClientId: "rss-1", ClassIds: ["771"],
      CartId: "cart-1", PaymentId: "payment-1", Items: [{ ProductId: "product-1" }],
    }] });
    if (path.endsWith("/sale/transactions")) return response({ Transactions: [{
      Id: "txn-1", SaleId: "sale-1", CartId: "cart-1", PaymentId: "payment-1", Status: "Approved",
    }] });
    return response({});
  }));
  const financial = await financialClient.reconcileBooking({
    mode: "purchase_pricing_option",
    classId: "771", clientId: "rss-1", serviceProductId: "product-1",
    saleId: "sale-1", cartId: "cart-1", transactionId: "txn-1", paymentId: "payment-1",
  });
  assert.equal(financial.status, "confirmed");
  assert.equal(financial.atomicCheckoutConfirmed, true);
  assert.equal(financial.visitId, "visit-1");
  assert.equal(financial.clientServiceId, "client-service-1");
  assert.equal(financial.saleId, "sale-1");
  assert.equal(financial.cartId, "cart-1");
  assert.equal(financial.transactionId, "txn-1");
  assert.equal(financial.paymentId, "payment-1");

  for (const evidenceToOmit of ["roster", "financial", "cart", "payment"]) {
    const incompleteClient = createMindbodyClassBookingClient(options(async (url) => {
      const path = new URL(url).pathname;
      if (evidenceToOmit !== "roster" && path.endsWith("/class/classvisits")) {
        return response({ Visits: [{
          Id: "visit-1", ClassId: 771, ClientId: "rss-1", ServiceId: "client-service-1",
        }] });
      }
      if (evidenceToOmit !== "roster" && path.endsWith("/client/clientservices")) {
        return response({ ClientServices: [{
          Id: "client-service-1", ProductId: "product-1", Current: true,
        }] });
      }
      if (evidenceToOmit !== "financial" && path.endsWith("/sale/sales")) {
        return response({ Sales: [{
          Id: "sale-1", ClientId: "rss-1", ClassIds: ["771"],
          ...(evidenceToOmit === "cart" ? {} : { CartId: "cart-1" }),
          ...(evidenceToOmit === "payment" ? {} : { PaymentId: "payment-1" }),
          Items: [{ ProductId: "product-1" }],
        }] });
      }
      if (evidenceToOmit !== "financial" && path.endsWith("/sale/transactions")) {
        return response({ Transactions: [{
          Id: "txn-1", SaleId: "sale-1",
          ...(evidenceToOmit === "cart" ? {} : { CartId: "cart-1" }),
          ...(evidenceToOmit === "payment" ? {} : { PaymentId: "payment-1" }),
          Status: "Approved",
        }] });
      }
      return response({});
    }));
    const incomplete = await incompleteClient.reconcileBooking({
      mode: "purchase_pricing_option",
      classId: "771", clientId: "rss-1", serviceProductId: "product-1",
      saleId: "sale-1", cartId: "cart-1", transactionId: "txn-1", paymentId: "payment-1",
    });
    assert.equal(incomplete.status, "unknown", `${evidenceToOmit} evidence must be required`);
  }
});

test("paid reconciliation accepts the Site -99 Class.Visits and PurchasedItems response shapes", async () => {
  const requests = [];
  const client = createMindbodyClassBookingClient({
    ...options(async (url) => {
      const parsed = new URL(url);
      requests.push(parsed);
      const path = parsed.pathname;
      if (path.endsWith("/class/classvisits")) return response({
        Class: {
          Id: 771,
          Visits: [{
            Id: "visit-live",
            ClassId: 771,
            ClientId: "rss-1",
            ServiceId: "client-service-1",
          }],
        },
      });
      if (path.endsWith("/client/clientservices")) return response({ ClientServices: [{
        Id: "client-service-1", ProductId: "product-1", Current: true, Returned: false,
      }] });
      if (path.endsWith("/sale/sales")) return response({ Sales: [{
        Id: "sale-live",
        ClientId: "rss-1",
        PurchasedItems: [{ Id: "product-1", SaleDetailId: "detail-live", Returned: false }],
        Payments: [{ Id: "payment-live", Amount: 13, Type: "Apple Pay" }],
      }] });
      if (path.endsWith("/sale/transactions")) return response({ Transactions: [{
        Id: "transaction-live",
        SaleId: "sale-live",
        PaymentId: "payment-live",
        CartId: "cart-live",
        Status: "Approved",
      }] });
      return response({});
    }),
    now: () => new Date("2026-08-17T12:00:00Z"),
  });

  const result = await client.reconcileBooking({
    mode: "purchase_pricing_option",
    classId: "771",
    clientId: "rss-1",
    serviceProductId: "product-1",
    saleId: "sale-live",
    cartId: "cart-live",
    transactionId: "transaction-live",
    paymentId: "payment-live",
  });

  assert.equal(result.status, "confirmed");
  assert.equal(result.visitId, "visit-live");
  assert.equal(result.saleId, "sale-live");
  assert.equal(result.paymentId, "payment-live");
  const clientVisitRequest = requests.find((request) => request.pathname.endsWith("/client/clientvisits"));
  assert.equal(clientVisitRequest.searchParams.get("StartDate"), "2026-08-10");
  assert.equal(clientVisitRequest.searchParams.get("EndDate"), "2026-09-17");
  const classVisitRequest = requests.find((request) => request.pathname.endsWith("/class/classvisits"));
  assert.equal(classVisitRequest.searchParams.get("request.classID"), "771");
});

test("Site -99 Cash reconciliation confirms without a fabricated Transaction", async () => {
  const client = createMindbodyClassBookingClient({
    ...options(async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/class/classvisits")) return response({ Class: { Visits: [{
        Id: "visit-cash", ClassId: 771, ClientId: "rss-1", ServiceId: "client-service-cash",
      }] } });
      if (path.endsWith("/client/clientservices")) return response({ ClientServices: [{
        Id: "client-service-cash", ProductId: "1431", Current: false, Returned: false, Remaining: 0,
      }] });
      if (path.endsWith("/sale/sales")) return response({ Sales: [{
        Id: "sale-cash", ClientId: "rss-1", ClassIds: ["771"],
        PurchasedItems: [{ Id: "1431", Returned: false }],
        Payments: [{ Id: "payment-cash", Amount: 13, Type: "Alex Bank Visa Ballet" }],
      }] });
      if (path.endsWith("/sale/transactions")) return response({ Transactions: [] });
      return response({});
    }),
    siteId: "-99",
    sandboxCashRoute: true,
  });
  const result = await client.reconcileBooking({
    mode: "purchase_pricing_option",
    classId: "771",
    clientId: "rss-1",
    serviceProductId: "1431",
    priceAmount: 13,
    saleId: "sale-cash",
    cartId: "cart-cash",
    transactionId: null,
    paymentId: "payment-cash",
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.paymentType, "Cash");
  assert.equal(result.providerPaymentType, "Alex Bank Visa Ballet");
  assert.equal(result.transactionId, null);
  assert.equal(result.clientServiceId, "client-service-cash");
});

test("paid reconciliation never confirms a cancelled Visit", async () => {
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/class/classvisits")) return response({ Visits: [{
      Id: "visit-cancelled", ClassId: 771, ClientId: "rss-1",
      ServiceId: "client-service-1", Cancelled: true,
    }] });
    if (path.endsWith("/client/clientservices")) return response({ ClientServices: [{
      Id: "client-service-1", ProductId: "product-1", Current: true,
    }] });
    if (path.endsWith("/sale/sales")) return response({ Sales: [{
      Id: "sale-1", ClientId: "rss-1", ClassIds: ["771"],
      CartId: "cart-1", PaymentId: "payment-1", Items: [{ ProductId: "product-1" }],
    }] });
    if (path.endsWith("/sale/transactions")) return response({ Transactions: [{
      Id: "txn-1", SaleId: "sale-1", CartId: "cart-1",
      PaymentId: "payment-1", Status: "Approved",
    }] });
    return response({});
  }));
  const result = await client.reconcileBooking({
    mode: "purchase_pricing_option",
    classId: "771", clientId: "rss-1", serviceProductId: "product-1",
    saleId: "sale-1", cartId: "cart-1", transactionId: "txn-1", paymentId: "payment-1",
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.visitId, undefined);
});

test("paid reconciliation accepts verified webhook roster evidence only with matching financial evidence", async () => {
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/sale/sales")) return response({ Sales: [{
      Id: "sale-1", ClientId: "rss-1", ClassIds: ["771"],
      CartId: "cart-1", PaymentId: "payment-1", Items: [{ ProductId: "product-1" }],
    }] });
    if (path.endsWith("/sale/transactions")) return response({ Transactions: [{
      Id: "txn-1", SaleId: "sale-1", CartId: "cart-1", PaymentId: "payment-1", Status: "Approved",
    }] });
    if (path.endsWith("/client/clientservices")) return response({ ClientServices: [{
      Id: "client-service-1", ProductId: "product-1", Current: true,
    }] });
    return response({});
  }));
  const result = await client.reconcileBooking({
    mode: "purchase_pricing_option",
    classId: "771",
    clientId: "rss-1",
    serviceProductId: "product-1",
    saleId: "sale-1",
    cartId: "cart-1",
    transactionId: "txn-1",
    paymentId: "payment-1",
    webhookEvidence: [{
      verified: true, type: "class_roster", classId: "771", clientId: "rss-1",
      rosterBookingId: "roster-1", clientServiceId: "client-service-1",
    }],
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.rosterBookingId, "roster-1");
  assert.equal(result.clientServiceId, "client-service-1");
  assert.equal(result.saleId, "sale-1");
  assert.equal(result.cartId, "cart-1");
  assert.equal(result.transactionId, "txn-1");
  assert.equal(result.paymentId, "payment-1");
});

test("paid reconciliation rejects a roster Visit backed by another ClientService Product", async () => {
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/class/classvisits")) return response({ Visits: [{
      Id: "visit-1", ClassId: 771, ClientId: "rss-1", ServiceId: "client-service-1",
    }] });
    if (path.endsWith("/client/clientservices")) return response({ ClientServices: [{
      Id: "client-service-1", ProductId: "product-attacker", Current: true,
    }] });
    if (path.endsWith("/sale/sales")) return response({ Sales: [{
      Id: "sale-1", ClientId: "rss-1", ClassIds: ["771"], Items: [{ ProductId: "product-1" }],
    }] });
    if (path.endsWith("/sale/transactions")) return response({ Transactions: [{
      Id: "txn-1", SaleId: "sale-1", Status: "Approved",
    }] });
    return response({});
  }));
  const result = await client.reconcileBooking({
    mode: "purchase_pricing_option",
    classId: "771", clientId: "rss-1", serviceProductId: "product-1",
    saleId: "sale-1", transactionId: "txn-1",
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.errorCode, "PAID_PURCHASE_AND_ROSTER_EVIDENCE_INCOMPLETE");
});

test("paid reconciliation cannot substitute an older Sale or Transaction", async () => {
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/class/classvisits")) return response({ Visits: [{
      Id: "visit-1", ClassId: 771, ClientId: "rss-1", ServiceId: "client-service-1",
    }] });
    if (path.endsWith("/client/clientservices")) return response({ ClientServices: [{
      Id: "client-service-1", ProductId: "product-1", Current: true,
    }] });
    if (path.endsWith("/sale/sales")) return response({ Sales: [{
      Id: "sale-old", ClientId: "rss-1", ClassIds: ["771"], Items: [{ ProductId: "product-1" }],
    }] });
    if (path.endsWith("/sale/transactions")) return response({ Transactions: [{
      Id: "txn-old", SaleId: "sale-old", Status: "Approved",
    }] });
    return response({});
  }));
  const result = await client.reconcileBooking({
    mode: "purchase_pricing_option",
    classId: "771", clientId: "rss-1", serviceProductId: "product-1",
    saleId: "sale-new", transactionId: "txn-new",
  });
  assert.equal(result.status, "unknown");
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

test("Class cancellation uses the exact Visit and waitlist entry without enabling provider email", async () => {
  const calls = [];
  const client = createMindbodyClassBookingClient(options(async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    return response({});
  }));
  await client.cancelBooking({
    removalType: "roster", classId: "771", clientId: "rss-1", visitId: "visit-1",
  });
  await client.cancelBooking({
    removalType: "waitlist", classId: "771", clientId: "rss-1", waitlistEntryId: "wait-1",
  });
  assert.deepEqual(calls, [
    {
      path: "/public/v6/class/removeclientfromclass",
      body: { ClientId: "rss-1", ClassId: "771", VisitId: "visit-1", SendEmail: false },
    },
    { path: "/public/v6/class/removefromwaitlist", body: { Id: "wait-1" } },
  ]);
});

test("cancellation reconciliation requires complete authoritative reads before claiming absence", async () => {
  let active = true;
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/client/clientvisits")) {
      return response(active ? { Visits: [{ Id: "visit-1", ClassId: 771, ClientId: "rss-1" }] } : {});
    }
    return response({});
  }));
  const input = { removalType: "roster", classId: "771", clientId: "rss-1", visitId: "visit-1" };
  const present = await client.reconcileCancellation(input);
  assert.equal(present.status, "active");
  active = false;
  const absent = await client.reconcileCancellation(input);
  assert.equal(absent.status, "cancelled");
  assert.equal(absent.authoritativeCancelled, true);

  const partial = createMindbodyClassBookingClient(options(async (url) => {
    if (new URL(url).pathname.endsWith("/class/classvisits")) {
      throw new DOMException("timed out", "TimeoutError");
    }
    return response({});
  }));
  const unknown = await partial.reconcileCancellation(input);
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.errorCode, "CANCELLATION_RECONCILIATION_UNAVAILABLE");
});

test("cancellation reconciliation follows pagination before treating an exact Visit as absent", async () => {
  const offsets = [];
  const client = createMindbodyClassBookingClient(options(async (url) => {
    const requestUrl = new URL(url);
    const path = requestUrl.pathname;
    const offset = Number(requestUrl.searchParams.get("Offset"));
    if (path.endsWith("/client/clientvisits")) {
      offsets.push(offset);
      if (offset === 0) {
        return response({
          Visits: Array.from({ length: 100 }, (_, index) => ({
            Id: `other-${index}`, ClassId: 771, ClientId: "rss-1",
          })),
          PaginationResponse: { TotalResults: 101 },
        });
      }
      return response({
        Visits: [{ Id: "visit-1", ClassId: 771, ClientId: "rss-1" }],
        PaginationResponse: { TotalResults: 101 },
      });
    }
    if (path.endsWith("/client/clientschedule")) {
      return response({ Classes: [], PaginationResponse: { TotalResults: 0 } });
    }
    return response({ Visits: [], PaginationResponse: { TotalResults: 0 } });
  }));
  const result = await client.reconcileCancellation({
    removalType: "roster", classId: "771", clientId: "rss-1", visitId: "visit-1",
  });
  assert.equal(result.status, "active");
  assert.deepEqual(offsets, [0, 100]);
});

test("entitlement restoration re-reads only the exact ClientService", async () => {
  let remaining = 8;
  const client = createMindbodyClassBookingClient(options(async () => response({
    ClientServices: [
      { Id: "other", Current: true, Remaining: 10 },
      { Id: "service-1", Current: true, Remaining: remaining, Returned: false, Unlimited: false },
    ],
    PaginationResponse: { TotalResults: 2 },
  })));
  const input = { classId: "771", clientId: "rss-1", clientServiceId: "service-1" };
  const baseline = await client.readEntitlementState(input);
  assert.equal(baseline.status, "observed");
  assert.equal(baseline.remaining, 8);

  const unchanged = await client.reconcileEntitlementRestoration({ ...input, baseline });
  assert.equal(unchanged.status, "unknown");
  assert.equal(unchanged.errorCode, "ENTITLEMENT_RESTORATION_NOT_PROVEN");

  remaining = 9;
  const restored = await client.reconcileEntitlementRestoration({ ...input, baseline });
  assert.equal(restored.status, "confirmed");
  assert.equal(restored.remainingBefore, 8);
  assert.equal(restored.remainingAfter, 9);

  const missingBaseline = await client.reconcileEntitlementRestoration(input);
  assert.equal(missingBaseline.status, "unknown");
});

test("Site -99 Cash restoration confirms activation and a finite balance increase on the purchased ClientService", async () => {
  let service = {
    Id: "service-cash",
    ProductId: 1431,
    Current: false,
    Returned: false,
    Unlimited: false,
    Remaining: 0,
  };
  const client = createMindbodyClassBookingClient({
    ...options(async () => response({
      ClientServices: [service],
      PaginationResponse: { TotalResults: 1 },
    })),
    sandboxCashRoute: true,
  });
  const input = { classId: "771", clientId: "rss-1", clientServiceId: "service-cash" };
  const baseline = await client.readEntitlementState(input);
  assert.equal(baseline.current, false);
  assert.equal(baseline.remaining, 0);

  service = { ...service, Current: true, Remaining: 1 };
  const restored = await client.reconcileEntitlementRestoration({ ...input, baseline });
  assert.equal(restored.status, "confirmed");
  assert.equal(restored.remainingBefore, 0);
  assert.equal(restored.remainingAfter, 1);
});

test("waitlist reconciliation confirms removal only after the exact entry disappears", async () => {
  let present = true;
  const client = createMindbodyClassBookingClient(options(async () => response({
    WaitlistEntries: present ? [{ Id: "wait-1", ClassId: 771, ClientId: "rss-1" }] : [],
  })));
  const input = {
    removalType: "waitlist", classId: "771", clientId: "rss-1", waitlistEntryId: "wait-1",
  };
  assert.equal((await client.reconcileCancellation(input)).status, "active");
  present = false;
  const removed = await client.reconcileCancellation(input);
  assert.equal(removed.status, "cancelled");
  assert.equal(removed.authoritativeCancelled, true);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createSite99Runner, Site99RunError } from "../../tools/mindbody-site-99-e2e.mjs";

const environment = Object.freeze({
  MINDBODY_API_KEY: "sandbox-app-key",
  MINDBODY_SANDBOX_USERNAME: "sandbox-staff",
  MINDBODY_SANDBOX_PASSWORD: "sandbox-password",
  MINDBODY_SANDBOX_SITE_ID: "-99",
  MINDBODY_SANDBOX_CLIENT_ID: "client-shared",
  MINDBODY_SANDBOX_PRODUCT_ID: "1424",
  MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([{
    id: "00000000-0000-4000-8000-000000000101",
    name: "Yoga",
    mappings: [{
      providerLocationId: "1",
      providerClassDescriptionId: "223",
      providerProgramId: "27",
      providerSessionTypeId: "250",
    }],
  }]),
});

test("the Site -99 runner requires an explicit current sandbox Product mapping", () => {
  assert.throws(
    () => createSite99Runner({
      environment: { ...environment, MINDBODY_SANDBOX_PRODUCT_ID: undefined },
    }),
    (error) => error instanceof Site99RunError
      && error.code === "MISSING_ENVIRONMENT"
      && error.detail === "MINDBODY_SANDBOX_PRODUCT_ID",
  );
});

test("the Site -99 runner requires an explicit Class-family manifest", () => {
  assert.throws(
    () => createSite99Runner({
      environment: { ...environment, MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: undefined },
    }),
    (error) => error instanceof Site99RunError
      && error.code === "MISSING_ENVIRONMENT"
      && error.detail === "MINDBODY_SANDBOX_CLASS_FAMILIES_JSON",
  );
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "provider-request-test" },
  });
}

function sandboxProvider({
  omitSale = false,
  ambiguousCheckout = false,
  delayedVisitReads = 0,
  revokeFails = false,
  ambiguousCancellation = false,
  cancellationLagReads = 0,
  multiFamily = false,
} = {}) {
  const requests = [];
  let clientId = "client-shared";
  let visitActive = false;
  let saleCreated = false;
  let hiddenVisitReads = 0;
  let remainingCancellationLagReads = 0;
  const fetchImpl = async (urlValue, init) => {
    const url = new URL(urlValue);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, init, body });
    const path = url.pathname.replace("/public/v6/", "");
    if (path === "site/sites") return json({ Sites: [{ Id: -99, Name: "LastSpot", CurrencyCode: "USD" }] });
    if (path === "site/locations") return json({ Locations: [{ Id: 1, Name: "Clubville" }] });
    if (path === "site/programs") return json({ Programs: [{ Id: 27, Name: "Yoga", ScheduleType: "Class" }] });
    if (path === "class/classdescriptions") {
      return json({ ClassDescriptions: multiFamily
        ? [{ Id: 223, Name: "Yoga", Active: true }, { Id: 224, Name: "Strength Yoga", Active: true }]
        : [{ Id: 223, Name: "Yoga", Active: true }] });
    }
    if (path === "usertoken/issue") {
      return json({ AccessToken: "temporary-staff-token", Expires: "2026-08-18T00:00:00Z" });
    }
    if (path === "usertoken/revoke") {
      return revokeFails ? json({ Error: { Code: "TokenRevokeFailed" } }, 503) : json({});
    }
    if (path === "client/clients") return json({ Clients: [{ Id: clientId }] });
    if (path === "client/addclient") {
      if (body.Test === false) clientId = "client-unique";
      return json(body.Test ? {} : { Client: { Id: clientId } });
    }
    if (path === "client/requiredclientfields") {
      return json({ RequiredClientFields: ["AddressLine1", "BirthDate", "Email", "IsMale"] });
    }
    if (path === "site/genders") {
      return json({ GenderOptions: [{ Id: 1, Name: "None", IsActive: true, IsDefault: true }] });
    }
    if (path === "class/classes") {
      return json({
        Classes: [
          {
            Id: 19364,
            StartDateTime: "2026-08-18T10:00:00",
            IsCanceled: false,
            IsAvailable: true,
            IsEnrolled: false,
            ClassScheduleId: 2152,
            Location: { Id: 1, Name: "Clubville" },
            Staff: { Id: 9, Name: "Sandbox Staff" },
            ClassDescription: {
              Id: 223, Name: "Yoga", Program: { Id: 27 }, SessionType: { Id: 250 },
            },
          },
          ...(multiFamily ? [{
            Id: 19365,
            StartDateTime: "2026-08-18T11:00:00",
            IsCanceled: false,
            IsAvailable: true,
            IsEnrolled: false,
            ClassScheduleId: 2153,
            Location: { Id: 1, Name: "Clubville" },
            Staff: { Id: 9, Name: "Sandbox Staff" },
            ClassDescription: {
              Id: 224, Name: "Strength Yoga", Program: { Id: 27 }, SessionType: { Id: 251 },
            },
          }] : []),
        ],
      });
    }
    if (path === "sale/services") {
      return json({
        Services: [{
          ProductId: 1424,
          SellOnline: true,
          Discontinued: false,
          OnlinePrice: 13,
          TaxRate: 0,
          TaxIncluded: false,
          SellAtLocationIds: [1],
          UseAtLocationIds: [1],
        }],
      });
    }
    const visit = { Id: 100343801, ClassId: 19364, ClientId: clientId, ServiceId: 7001 };
    const visitVisible = () => {
      if (!visitActive && remainingCancellationLagReads > 0) {
        remainingCancellationLagReads -= 1;
        return true;
      }
      if (!visitActive) return false;
      if (hiddenVisitReads > 0) {
        hiddenVisitReads -= 1;
        return false;
      }
      return true;
    };
    if (path === "client/clientvisits") return json({ Visits: visitVisible() ? [visit] : [] });
    if (path === "class/classvisits") {
      return json({ Class: { Id: 19364, Clients: visitVisible() ? [{ Id: clientId, VisitId: 100343801 }] : [] } });
    }
    if (path === "client/clientschedule") {
      return json({ Classes: visitVisible() ? [{ Id: 19364, Clients: [{ Id: clientId, VisitId: 100343801 }] }] : [] });
    }
    if (path === "sale/sales") {
      return json({
        Sales: saleCreated && !omitSale
          ? [{
            Id: 100170553,
            ClientId: clientId,
            ShoppingCartId: "cart-1",
            PurchasedItems: [{ Id: 1424, SaleDetailId: 188790, Returned: false }],
            Payments: [{ Id: 168194, Type: "Cash", Amount: 13, TransactionId: null }],
          }]
          : [],
      });
    }
    if (path === "sale/transactions") return json({ Transactions: [] });
    if (path === "client/clientservices") {
      return json({
        ClientServices: saleCreated
          ? [{ Id: 7001, ProductId: 1424, Current: true, Returned: false, Remaining: 0 }]
          : [],
      });
    }
    if (path === "sale/checkoutshoppingcart") {
      if (body.Test === false) {
        visitActive = true;
        saleCreated = true;
        hiddenVisitReads = delayedVisitReads;
        if (ambiguousCheckout) throw new TypeError("connection reset after acceptance");
      }
      return json({
        ShoppingCart: {
          Id: "cart-1", SubTotal: 13, DiscountTotal: 0, TaxTotal: 0, GrandTotal: 13,
          ...(body.Test === false ? { SaleId: 100170553 } : {}),
        },
      });
    }
    if (path === "class/removeclientfromclass") {
      if (body.Test === false) {
        visitActive = false;
        remainingCancellationLagReads = cancellationLagReads;
        if (ambiguousCancellation) throw new TypeError("connection reset after cancellation acceptance");
      }
      return json({});
    }
    return json({ Error: { Code: "UnexpectedEndpoint" } }, 404);
  };
  return { fetchImpl, requests, state: () => ({ clientId, visitActive, saleCreated }) };
}

function runner(provider, overrides = {}) {
  return createSite99Runner({
    environment,
    fetchImpl: provider.fetchImpl,
    clock: () => new Date("2026-08-17T00:00:00Z"),
    uniqueId: () => "run-123",
    pollOptions: { attempts: 1, intervalMs: 0 },
    ...overrides,
  });
}

test("the Site -99 runner rejects every other provider Site and origin", () => {
  assert.throws(
    () => createSite99Runner({ environment: { ...environment, MINDBODY_SANDBOX_SITE_ID: "123" } }),
    (error) => error instanceof Site99RunError && error.code === "SITE_NOT_ALLOWED",
  );
  assert.throws(
    () => createSite99Runner({ environment: { ...environment, MINDBODY_BASE_URL: "https://example.test" } }),
    (error) => error instanceof Site99RunError && error.code === "ORIGIN_NOT_ALLOWED",
  );
});

test("quote mode proves key-only catalogue reads and two Test=true quotes create no provider state", async () => {
  const provider = sandboxProvider();
  const result = await runner(provider).run("quote");

  assert.equal(result.result, "passed");
  assert.match(result.quote.requestDigest, /^[a-f0-9]{64}$/);
  assert.match(result.quote.immediateRequote.requestDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual({
    ...result.quote,
    requestDigest: "<digest>",
    immediateRequote: { ...result.quote.immediateRequote, requestDigest: "<digest>" },
  }, {
    subtotal: 13,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: 13,
    requestDigest: "<digest>",
    providerRequestId: "provider-request-test",
    testCreatedProviderState: false,
    immediateRequote: {
      subtotal: 13,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 13,
      requestDigest: "<digest>",
      providerRequestId: "provider-request-test",
    },
    totalsUnchanged: true,
  });
  assert.deepEqual(provider.state(), { clientId: "client-shared", visitActive: false, saleCreated: false });
  const checkouts = provider.requests.filter((request) => request.url.pathname.endsWith("checkoutshoppingcart"));
  assert.deepEqual(checkouts.map((request) => request.body.Test), [true, true]);
  assert.ok(checkouts.every((request) => request.body.SendEmail === false));
  const publicClassRead = provider.requests.find((request) => request.url.pathname.endsWith("class/classes"));
  assert.equal(publicClassRead.init.headers.Authorization, undefined);
  assert.deepEqual(result.auth.endpointAuthMatrix.apiKeyOnly, {
    sites: "accepted",
    locations: "accepted",
    programs: "accepted",
    classDescriptions: "accepted",
    classes: "accepted",
    services: "accepted",
  });
  assert.equal(result.auth.staffTokenRevoked, true);
  assert.doesNotMatch(JSON.stringify(result), /sandbox-app-key|sandbox-password|temporary-staff-token/);
});

test("probe mode exposes live occurrences grouped by configured Class family", async () => {
  const provider = sandboxProvider({ multiFamily: true });
  const environmentWithFamilies = {
    ...environment,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000101",
        name: "Yoga",
        mappings: [{
          providerLocationId: "1",
          providerClassDescriptionId: "223",
          providerProgramId: "27",
          providerSessionTypeId: "250",
        }],
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        name: "Strength Yoga",
        mappings: [{
          providerLocationId: "1",
          providerClassDescriptionId: "224",
          providerProgramId: "27",
          providerSessionTypeId: "251",
        }],
      },
    ]),
  };
  const result = await runner(provider, { environment: environmentWithFamilies }).run("probe");

  assert.deepEqual(result.families, [
    { id: "00000000-0000-4000-8000-000000000101", name: "Yoga", available: true },
    { id: "00000000-0000-4000-8000-000000000102", name: "Strength Yoga", available: true },
  ]);
  assert.deepEqual(result.fixtures.map((fixture) => [fixture.classFamilyId, fixture.classId]), [
    ["00000000-0000-4000-8000-000000000101", "19364"],
    ["00000000-0000-4000-8000-000000000102", "19365"],
  ]);
  const selected = await runner(provider, { environment: environmentWithFamilies })
    .run("probe", { classFamilyId: "00000000-0000-4000-8000-000000000102" });
  assert.deepEqual(selected.fixtures.map((fixture) => fixture.classId), ["19365"]);
});

test("committed mode waits for every evidence surface, proves exact facts, and always removes the Visit", async () => {
  const provider = sandboxProvider({ delayedVisitReads: 6 });
  const result = await runner(provider, {
    environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    pollOptions: { attempts: 3, intervalMs: 0 },
  }).run("book-and-cancel");

  assert.equal(result.result, "passed");
  assert.deepEqual(result.syntheticClient, {
    syntheticClientCreated: true,
    addClientTestMode: "unsupported-by-site-99",
  });
  assert.match(result.booking.checkoutRequestDigest, /^[a-f0-9]{64}$/);
  assert.match(result.booking.cancellationRequestDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual({
    ...result.booking,
    checkoutRequestDigest: "<digest>",
    cancellationRequestDigest: "<digest>",
  }, {
    cartId: "cart-1",
    checkoutRequestDigest: "<digest>",
    checkoutProviderRequestId: "provider-request-test",
    saleId: "100170553",
    paymentId: "168194",
    paymentType: "Cash",
    paymentAmount: 13,
    transactionId: null,
    transactionEvidence: "not-returned-for-cash",
    visitId: "100343801",
    clientServiceId: "7001",
    clientServiceCurrent: true,
    clientServiceRemaining: 0,
    clientVisitConfirmed: true,
    rosterConfirmed: true,
    clientScheduleConfirmed: true,
    checkoutReplayAttempted: false,
    testCancellationPreservedVisit: true,
    cancellationConfirmed: true,
    cancellationRequestDigest: "<digest>",
    cancellationProviderRequestIds: {
      test: "provider-request-test",
      committed: "provider-request-test",
    },
    postCancellation: {
      saleReturned: false,
      paymentStillRecorded: true,
      refundEvidence: "none-observed",
      clientServiceCurrent: true,
      clientServiceRemaining: 0,
      entitlementRestorationObserved: false,
    },
  });
  assert.deepEqual(provider.state(), { clientId: "client-unique", visitActive: false, saleCreated: true });
  const addClientBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("client/addclient"))
    .map((request) => request.body);
  assert.deepEqual(addClientBodies.map((body) => body.Test), [false]);
  assert.match(addClientBodies[0].Email, /^revvi-sandbox-/);
  assert.equal(addClientBodies[0].Gender, "None");
  assert.equal("GenderOptionId" in addClientBodies[0], false);
  assert.equal("IsMale" in addClientBodies[0], false);
  const checkoutBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("checkoutshoppingcart"))
    .map((request) => request.body);
  assert.deepEqual(checkoutBodies.map((body) => body.Test), [true, true, false]);
  assert.ok(checkoutBodies.every((body) => body.ClientId === "client-unique"));
  const cancellationBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("removeclientfromclass"))
    .map((request) => request.body);
  assert.deepEqual(cancellationBodies.map((body) => body.Test), [true, false]);
});

test("inspection mode leaves the exact evidenced Visit active until cleanup", async () => {
  const provider = sandboxProvider({ delayedVisitReads: 6 });
  const result = await runner(provider, {
    environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    pollOptions: { attempts: 3, intervalMs: 0 },
  }).run("book-for-inspection");

  assert.equal(result.result, "passed");
  assert.equal(result.booking.inspectionStatus, "active");
  assert.equal(result.booking.visitId, "100343801");
  assert.equal(provider.state().visitActive, true);
  assert.equal(provider.requests.some((request) => request.url.pathname.endsWith("removeclientfromclass")), false);
});

test("inspection cleanup removes the exact pending Visit and proves the result", async () => {
  const provider = sandboxProvider({ delayedVisitReads: 6 });
  const site99 = runner(provider, {
    environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    pollOptions: { attempts: 3, intervalMs: 0 },
  });
  const active = await site99.run("book-for-inspection");

  const cleaned = await site99.run("cleanup-inspection");

  assert.equal(active.booking.visitId, "100343801");
  assert.equal(cleaned.booking.visitId, active.booking.visitId);
  assert.equal(cleaned.booking.inspectionStatus, "cleaned");
  assert.equal(cleaned.booking.cancellationConfirmed, true);
  assert.equal(provider.state().visitActive, false);
  const cancellationBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("removeclientfromclass"))
    .map((request) => request.body);
  assert.deepEqual(cancellationBodies.map((body) => body.Test), [true, false]);
});

test("ambiguous inspection cancellation is reconciled through reads without replaying the write", async () => {
  const provider = sandboxProvider({ ambiguousCancellation: true, cancellationLagReads: 5 });
  const site99 = runner(provider, {
    environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    pollOptions: { attempts: 3, intervalMs: 0 },
  });
  await site99.run("book-for-inspection");
  await assert.rejects(
    () => site99.run("cleanup-inspection"),
    (error) => error instanceof Site99RunError && error.code === "NETWORK_ERROR",
  );

  const reconciled = await site99.run("cleanup-inspection");

  assert.equal(reconciled.booking.cancellationConfirmed, true);
  const committedCancellations = provider.requests.filter((request) => request.url.pathname.endsWith("removeclientfromclass")
    && request.body.Test === false);
  assert.equal(committedCancellations.length, 1);
});

test("a missing post-checkout Sale is unknown but still triggers targeted cleanup", async () => {
  const provider = sandboxProvider({ omitSale: true });
  await assert.rejects(
    () => runner(provider, {
      environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    }).run("book-and-cancel"),
    (error) => error instanceof Site99RunError && error.code === "EVIDENCE_NOT_CONVERGED",
  );
  assert.equal(provider.state().visitActive, false);
  const cancellationBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("removeclientfromclass"))
    .map((request) => request.body);
  assert.deepEqual(cancellationBodies.map((body) => body.Test), [true, false]);
});

test("an ambiguous checkout response polls delayed evidence and removes the accepted Visit", async () => {
  const provider = sandboxProvider({ ambiguousCheckout: true, delayedVisitReads: 6 });
  await assert.rejects(
    () => runner(provider, {
      environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
      pollOptions: { attempts: 3, intervalMs: 0 },
    }).run("book-and-cancel"),
    (error) => error instanceof Site99RunError && error.code === "NETWORK_ERROR",
  );
  assert.equal(provider.state().visitActive, false);
  const cancellationBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("removeclientfromclass"))
    .map((request) => request.body);
  assert.deepEqual(cancellationBodies.map((body) => body.Test), [true, false]);
});

test("committed mode cannot write without the exact Site -99 confirmation phrase", async () => {
  const provider = sandboxProvider();
  await assert.rejects(
    () => runner(provider).run("book-and-cancel"),
    (error) => error instanceof Site99RunError && error.code === "WRITE_NOT_CONFIRMED",
  );
  assert.deepEqual(provider.state(), { clientId: "client-shared", visitActive: false, saleCreated: false });
  assert.equal(provider.requests.some((request) => request.init.method === "POST"
    && !request.url.pathname.endsWith("usertoken/issue")), false);
});

test("a staff-token revocation failure prevents a passed result", async () => {
  const provider = sandboxProvider({ revokeFails: true });
  await assert.rejects(
    () => runner(provider).run("quote"),
    (error) => error instanceof Site99RunError && error.code === "TokenRevokeFailed",
  );
});

test("a token-revocation failure after inspection Booking cannot orphan the active Visit", async () => {
  const provider = sandboxProvider({ revokeFails: true });

  await assert.rejects(
    () => runner(provider, {
      environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    }).run("book-for-inspection"),
    (error) => error instanceof Site99RunError && error.code === "TokenRevokeFailed",
  );

  assert.equal(provider.state().visitActive, false);
  const committedCancellations = provider.requests.filter((request) => request.url.pathname.endsWith("removeclientfromclass")
    && request.body.Test === false);
  assert.equal(committedCancellations.length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  createSite99WebflowDemoHandler,
  renderSite99WebflowDemoPage,
  SITE_99_DEMO_CONTEXT,
  createSite99WebflowDemoServer,
} from "../../tools/serve-site-99-webflow-demo.mjs";
import { Site99RunError } from "../../tools/mindbody-site-99-e2e.mjs";
import { bookingConfirmationText } from "../../webflow/src/ui.js";

const DEMO_TOKEN = "demo-header.demo-payload.demo-signature";

function request(path, body, token = DEMO_TOKEN) {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:3000",
    },
    body: JSON.stringify(body),
  });
}

test("the local Webflow demo shows the live Site -99 catalogue through the widget contract", async () => {
  const runner = {
    async run(mode) {
      assert.equal(mode, "catalogue");
      return {
        result: "passed",
        auth: { siteName: "LastSpot" },
        fixtures: [],
        families: [{
          id: "00000000-0000-4000-8000-000000000101",
          name: "Yoga",
          available: true,
          availabilityState: "available",
        }],
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({ runner, demoBearerToken: DEMO_TOKEN });

  const response = await handler(request("/offer-class-availability", {
    businessSlug: SITE_99_DEMO_CONTEXT.businessSlug,
    locationId: SITE_99_DEMO_CONTEXT.locationId,
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    startDate: "2026-08-17",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      business: { slug: "mindbody-sandbox", name: "LastSpot" },
      offer: { id: SITE_99_DEMO_CONTEXT.offerId, name: "Revvi Sandbox Class Access" },
      classFamilies: [{
        id: "00000000-0000-4000-8000-000000000101",
        name: "Yoga",
        available: true,
        availabilityState: "available",
      }],
      sessions: [],
    },
  });
});

test("the local Webflow demo logs safe selector diagnostics", async () => {
  const logs = [];
  const server = createSite99WebflowDemoServer({
    demoBearerToken: DEMO_TOKEN,
    logger: { error: (message, facts) => logs.push({ message, facts }) },
    handler: async () => {
      throw new Site99RunError(
        "sessionTypeName",
        "SELECTOR_NO_MATCH",
        null,
        "00000000-0000-4000-8000-000000000101:Yoga sessionTypeName=Yoga; candidates=250:Hatha Yoga",
      );
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/offer-class-availability`, {
      method: "POST",
      headers: { Authorization: `Bearer ${DEMO_TOKEN}`, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 502);
    assert.deepEqual(logs, [{
      message: "Site -99 Webflow demo request failed.",
      facts: {
        name: "Site99RunError",
        stage: "sessionTypeName",
        code: "SELECTOR_NO_MATCH",
        status: null,
        detail: "00000000-0000-4000-8000-000000000101:Yoga sessionTypeName=Yoga; candidates=250:Hatha Yoga",
      },
    }]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("the local Webflow demo exposes and filters live Class families", async () => {
  const familyYoga = "00000000-0000-4000-8000-000000000101";
  const familyStrength = "00000000-0000-4000-8000-000000000102";
  const calls = [];
  const runner = {
    async run(mode, options = {}) {
      calls.push({ mode, options });
      const fixtures = mode === "catalogue"
        ? []
        : options.classFamilyId === familyStrength
        ? [{ classId: "19365", classFamilyId: familyStrength, classFamilyName: "Strength Yoga", classStart: "2026-08-18T11:00:00", className: "Strength Yoga", paymentSeed: 13 }]
        : [
          { classId: "19364", classFamilyId: familyYoga, classFamilyName: "Yoga", classStart: "2026-08-18T10:00:00", className: "Yoga", paymentSeed: 13 },
          { classId: "19365", classFamilyId: familyStrength, classFamilyName: "Strength Yoga", classStart: "2026-08-18T11:00:00", className: "Strength Yoga", paymentSeed: 13 },
        ];
      return {
        result: "passed",
        fixtures,
        families: [
          {
            id: familyYoga,
            name: "Yoga",
            available: true,
            availabilityState: "available",
            ...(mode === "catalogue" ? {
              nextOccurrence: {
                classId: "19364",
                classStart: "2026-08-18T10:00:00",
                classEnd: "2026-08-18T11:00:00",
                className: "Yoga",
                staffName: "Site -99 Teacher",
              },
              provisionalPrice: { amount: 13, currency: "USD" },
            } : {}),
          },
          { id: familyStrength, name: "Strength Yoga", available: true, availabilityState: "available" },
        ],
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({ runner, demoBearerToken: DEMO_TOKEN });
  const body = {
    businessSlug: SITE_99_DEMO_CONTEXT.businessSlug,
    locationId: SITE_99_DEMO_CONTEXT.locationId,
    offerId: SITE_99_DEMO_CONTEXT.offerId,
  };

  const allResponse = await handler(request("/offer-class-availability", body));
  const all = await allResponse.json();
  assert.equal(allResponse.status, 200);
  assert.deepEqual(all.data.classFamilies, [
    {
      id: familyYoga,
      name: "Yoga",
      available: true,
      availabilityState: "available",
      nextOccurrence: {
        classId: "19364",
        name: "Yoga",
        startAt: "2026-08-18T10:00:00+02:00",
        endAt: "2026-08-18T11:00:00+02:00",
        timezone: "Africa/Johannesburg",
        staffName: "Site -99 Teacher",
      },
      provisionalPrice: { amount: 13, currency: "USD" },
    },
    { id: familyStrength, name: "Strength Yoga", available: true, availabilityState: "available" },
  ]);
  assert.equal(all.data.families, undefined);
  assert.deepEqual(all.data.sessions, []);

  const selectedResponse = await handler(request("/offer-class-availability", {
    ...body,
    classFamilyId: familyStrength,
  }));
  const selected = await selectedResponse.json();
  assert.equal(selectedResponse.status, 200);
  assert.deepEqual(selected.data.sessions.map((session) => session.classId), ["19365"]);
  assert.deepEqual(calls, [
    { mode: "catalogue", options: {} },
    { mode: "availability", options: { classFamilyId: familyStrength } },
  ]);
});

test("the local Webflow demo carries the selected family through quote and Booking", async () => {
  const familyId = "00000000-0000-4000-8000-000000000101";
  const calls = [];
  const fixture = {
    classId: "19364",
    classFamilyId: familyId,
    classFamilyName: "Yoga",
    classStart: "2026-08-18T10:00:00",
    className: "Yoga",
  };
  const runner = {
    async run(mode, options) {
      calls.push({ mode, options });
      if (mode === "quote") {
        return {
          result: "passed",
          fixture,
          quote: {
            subtotal: 13,
            discountTotal: 0,
            taxTotal: 0,
            grandTotal: 13,
            totalsUnchanged: true,
            testCreatedProviderState: false,
          },
        };
      }
      return {
        result: "passed",
        fixture,
        syntheticClient: {
          syntheticClientCreated: true,
          reference: {
            clientId: "100200001",
            displayName: "Revvi Sandbox A1B2C3D4",
            email: "revvi-sandbox-a1b2c3d4@example.test",
          },
        },
        booking: {
          saleId: "100170591",
          paymentId: "168233",
          paymentType: "Cash",
          clientServiceId: "100257607",
          visitId: "100343812",
          clientVisitConfirmed: true,
          rosterConfirmed: true,
          clientScheduleConfirmed: true,
          inspectionStatus: "active",
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    now: () => new Date("2026-08-17T12:00:00Z"),
    randomUuid: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000058",
        "00000000-0000-4000-8000-000000000060",
      ];
      return () => values.shift();
    })(),
  });
  const quoteResponse = await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: fixture.classId,
    classFamilyId: familyId,
  }));
  const quote = (await quoteResponse.json()).data;
  assert.equal(quoteResponse.status, 200);
  assert.equal(quote.session.classFamilyId, familyId);

  const bookingResponse = await handler(request("/create-booking", {
    quoteId: quote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000059",
  }));
  assert.equal(bookingResponse.status, 200);
  assert.equal((await bookingResponse.json()).data.booking.classFamilyId, familyId);
  assert.deepEqual(calls.map(({ mode, options }) => [mode, options]), [
    ["quote", { classFamilyId: familyId, classId: fixture.classId }],
    ["book-for-inspection", { classFamilyId: familyId, classId: fixture.classId }],
  ]);
});

test("the local Webflow demo returns a client-aware Site -99 quote", async () => {
  const runner = {
    async run(mode) {
      assert.equal(mode, "quote");
      return {
        result: "passed",
        fixture: {
          classId: "19364",
          classStart: "2026-08-18T10:00:00",
          className: "Yoga",
        },
        quote: {
          subtotal: 13,
          discountTotal: 0,
          taxTotal: 0,
          grandTotal: 13,
          totalsUnchanged: true,
          testCreatedProviderState: false,
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    now: () => new Date("2026-08-17T12:00:00Z"),
    randomUuid: () => "00000000-0000-4000-8000-000000000058",
  });

  const response = await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      quoteId: "00000000-0000-4000-8000-000000000058",
      expiresAt: "2026-08-17T12:10:00.000Z",
      session: {
        classId: "19364",
        name: "Yoga",
        startAt: "2026-08-18T10:00:00+02:00",
        locationName: "Mindbody public sandbox",
      },
      price: {
        subtotal: 13,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: 13,
        currency: "USD",
      },
      cancellationPolicy: {
        displayText: "Sandbox demo only: confirming creates a fictitious Cash Booking that stays active for inspection for up to ten minutes.",
        certainty: "sandbox_demo",
      },
    },
  });
});

test("the local Webflow demo leaves a fully evidenced Booking active for Business inspection", async () => {
  const modes = [];
  const runner = {
    async run(mode) {
      modes.push(mode);
      if (mode === "quote") {
        return {
          result: "passed",
          fixture: { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" },
          quote: {
            subtotal: 13,
            discountTotal: 0,
            taxTotal: 0,
            grandTotal: 13,
            totalsUnchanged: true,
            testCreatedProviderState: false,
          },
        };
      }
      assert.equal(mode, "book-for-inspection");
      return {
        result: "passed",
        fixture: { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" },
        syntheticClient: {
          syntheticClientCreated: true,
          reference: {
            clientId: "100200001",
            displayName: "Revvi Sandbox A1B2C3D4",
            email: "revvi-sandbox-a1b2c3d4@example.test",
          },
        },
        booking: {
          saleId: "100170591",
          paymentId: "168233",
          paymentType: "Cash",
          providerPaymentType: "Sandbox configured label",
          paymentAmount: 13,
          clientServiceId: "100257607",
          visitId: "100343812",
          clientVisitConfirmed: true,
          rosterConfirmed: true,
          clientScheduleConfirmed: true,
          inspectionStatus: "active",
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    now: () => new Date("2026-08-17T12:00:00Z"),
    randomUuid: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000058",
        "00000000-0000-4000-8000-000000000060",
      ];
      return () => values.shift();
    })(),
  });
  const quoteResponse = await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }));
  const quote = (await quoteResponse.json()).data;

  const response = await handler(request("/create-booking", {
    quoteId: quote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000059",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(modes, ["quote", "book-for-inspection"]);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      booking: {
        status: "confirmed",
        classId: "19364",
        className: "Yoga",
        startAt: "2026-08-18T10:00:00+02:00",
        locationName: "Mindbody public sandbox",
        sandboxDemo: {
          paymentType: "Fictitious Cash",
          providerPaymentType: "Sandbox configured label",
          providerEvidenceConfirmed: true,
          demoBookingId: "00000000-0000-4000-8000-000000000060",
          cleanupStatus: "pending",
          autoCleanupAt: "2026-08-17T12:10:00.000Z",
          references: {
            clientId: "100200001",
            clientName: "Revvi Sandbox A1B2C3D4",
            clientEmail: "revvi-sandbox-a1b2c3d4@example.test",
            saleId: "100170591",
            paymentId: "168233",
            visitId: "100343812",
          },
        },
      },
    },
  });
});

test("post-write evidence validation failure cleans the active sandbox Visit before returning", async () => {
  const modes = [];
  const fixture = { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" };
  const runner = {
    async run(mode) {
      modes.push(mode);
      if (mode === "quote") {
        return {
          result: "passed",
          fixture,
          quote: {
            subtotal: 13, discountTotal: 0, taxTotal: 0, grandTotal: 13,
            totalsUnchanged: true, testCreatedProviderState: false,
          },
        };
      }
      if (mode === "book-for-inspection") {
        return {
          result: "passed",
          fixture,
          syntheticClient: { syntheticClientCreated: true },
          booking: {
            visitId: "100343812",
            inspectionStatus: "active",
            clientVisitConfirmed: true,
            rosterConfirmed: true,
            clientScheduleConfirmed: true,
          },
        };
      }
      return {
        result: "passed",
        fixture,
        booking: {
          visitId: "100343812",
          inspectionStatus: "cleaned",
          cancellationConfirmed: true,
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    randomUuid: () => "00000000-0000-4000-8000-000000000058",
  });
  const quote = (await (await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }))).json()).data;

  const response = await handler(request("/create-booking", {
    quoteId: quote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000059",
  }));

  assert.equal(response.status, 202);
  assert.deepEqual(modes, ["quote", "book-for-inspection", "cleanup-inspection"]);
});

test("an exceptional post-write result still transfers cleanup to the demo handler", async () => {
  const modes = [];
  const fixture = { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" };
  const runner = {
    async run(mode) {
      modes.push(mode);
      if (mode === "quote") {
        return {
          result: "passed",
          fixture,
          quote: {
            subtotal: 13, discountTotal: 0, taxTotal: 0, grandTotal: 13,
            totalsUnchanged: true, testCreatedProviderState: false,
          },
        };
      }
      if (mode === "book-for-inspection") {
        const error = new Error("post-write token revocation failed");
        error.code = "TOKEN_REVOCATION_FAILED";
        throw error;
      }
      return {
        result: "passed",
        fixture,
        booking: {
          visitId: "100343812",
          inspectionStatus: "cleaned",
          cancellationConfirmed: true,
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    randomUuid: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000058",
        "00000000-0000-4000-8000-000000000060",
      ];
      return () => values.shift();
    })(),
    setTimeoutImpl: () => 1,
  });
  const quote = (await (await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }))).json()).data;

  await assert.rejects(
    () => handler(request("/create-booking", {
      quoteId: quote.quoteId,
      idempotencyKey: "00000000-0000-4000-8000-000000000059",
    })),
    /post-write token revocation failed/,
  );

  assert.deepEqual(modes, ["quote", "book-for-inspection", "cleanup-inspection"]);
});

test("the local Webflow demo cleans up the exact inspected Booking on request", async () => {
  const modes = [];
  const fixture = { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" };
  const booking = {
    saleId: "100170591",
    paymentId: "168233",
    paymentType: "Cash",
    clientServiceId: "100257607",
    visitId: "100343812",
    clientVisitConfirmed: true,
    rosterConfirmed: true,
    clientScheduleConfirmed: true,
    inspectionStatus: "active",
  };
  const runner = {
    async run(mode) {
      modes.push(mode);
      if (mode === "quote") {
        return {
          result: "passed",
          fixture,
          quote: {
            subtotal: 13,
            discountTotal: 0,
            taxTotal: 0,
            grandTotal: 13,
            totalsUnchanged: true,
            testCreatedProviderState: false,
          },
        };
      }
      if (mode === "book-for-inspection") {
        return {
          result: "passed",
          fixture,
          syntheticClient: {
            syntheticClientCreated: true,
            reference: {
              clientId: "100200001",
              displayName: "Revvi Sandbox A1B2C3D4",
              email: "revvi-sandbox-a1b2c3d4@example.test",
            },
          },
          booking,
        };
      }
      assert.equal(mode, "cleanup-inspection");
      return {
        result: "passed",
        fixture,
        booking: {
          ...booking,
          inspectionStatus: "cleaned",
          cancellationConfirmed: true,
          postCancellation: { entitlementRestorationObserved: null },
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    now: () => new Date("2026-08-17T12:00:00Z"),
    randomUuid: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000058",
        "00000000-0000-4000-8000-000000000060",
      ];
      return () => values.shift();
    })(),
  });
  const quote = (await (await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }))).json()).data;
  const created = await (await handler(request("/create-booking", {
    quoteId: quote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000059",
  }))).json();

  const response = await handler(request("/cleanup-demo-booking", {
    bookingId: created.data.booking.sandboxDemo.demoBookingId,
    reason: "Revvi hosted sandbox demonstration cleanup",
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(modes, ["quote", "book-for-inspection", "cleanup-inspection"]);
  assert.deepEqual((await response.json()).data, {
    bookingId: "00000000-0000-4000-8000-000000000060",
    status: "cancelled",
    passRestoration: "unknown",
  });
});

test("the local Webflow demo automatically cleans an inspected Booking after ten minutes", async () => {
  const scheduledCleanups = [];
  let releaseProbe;
  let holdProbe = false;
  const blockedProbe = new Promise((resolve) => { releaseProbe = resolve; });
  const modes = [];
  const fixture = { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" };
  const runner = {
    async run(mode) {
      modes.push(mode);
      if (mode === "catalogue") {
        if (holdProbe) await blockedProbe;
        return { result: "passed", fixtures: [], families: [] };
      }
      if (mode === "quote") {
        return {
          result: "passed",
          fixture,
          quote: {
            subtotal: 13,
            discountTotal: 0,
            taxTotal: 0,
            grandTotal: 13,
            totalsUnchanged: true,
            testCreatedProviderState: false,
          },
        };
      }
      if (mode === "book-for-inspection") {
        return {
          result: "passed",
          fixture,
          syntheticClient: {
            syntheticClientCreated: true,
            reference: {
              clientId: "100200001",
              displayName: "Revvi Sandbox A1B2C3D4",
              email: "revvi-sandbox-a1b2c3d4@example.test",
            },
          },
          booking: {
            saleId: "100170591",
            paymentId: "168233",
            paymentType: "Cash",
            clientServiceId: "100257607",
            visitId: "100343812",
            clientVisitConfirmed: true,
            rosterConfirmed: true,
            clientScheduleConfirmed: true,
            inspectionStatus: "active",
          },
        };
      }
      return {
        result: "passed",
        fixture,
        booking: {
          visitId: "100343812",
          inspectionStatus: "cleaned",
          cancellationConfirmed: true,
          postCancellation: { entitlementRestorationObserved: false },
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    now: () => new Date("2026-08-17T12:00:00Z"),
    randomUuid: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000058",
        "00000000-0000-4000-8000-000000000060",
      ];
      return () => values.shift();
    })(),
    setTimeoutImpl(callback, delay) {
      scheduledCleanups.push({ callback, delay });
      return scheduledCleanups.length;
    },
  });
  const quote = (await (await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }))).json()).data;
  const created = await (await handler(request("/create-booking", {
    quoteId: quote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000059",
  }))).json();

  holdProbe = true;
  const concurrentProbe = handler(request("/offer-class-availability", {
    businessSlug: SITE_99_DEMO_CONTEXT.businessSlug,
    locationId: SITE_99_DEMO_CONTEXT.locationId,
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    startDate: "2026-08-17",
  }));
  await new Promise((resolve) => setImmediate(resolve));
  await scheduledCleanups[0].callback();
  assert.deepEqual(scheduledCleanups.map(({ delay }) => delay), [10 * 60 * 1000, 1_000]);
  releaseProbe();
  await concurrentProbe;
  await scheduledCleanups[1].callback();
  const inspected = await handler(request("/cleanup-demo-booking", {
    bookingId: created.data.booking.sandboxDemo.demoBookingId,
    reason: "Revvi hosted sandbox demonstration cleanup",
  }));

  assert.deepEqual(modes, ["quote", "book-for-inspection", "catalogue", "cleanup-inspection"]);
  assert.deepEqual((await inspected.json()).data, {
    bookingId: "00000000-0000-4000-8000-000000000060",
    status: "cancelled",
    passRestoration: "not_restored",
  });
});

test("the local Webflow demo cleans every pending Booking before shutdown", async () => {
  const modes = [];
  const fixture = { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" };
  const runner = {
    async run(mode) {
      modes.push(mode);
      if (mode === "quote") {
        return {
          result: "passed",
          fixture,
          quote: {
            subtotal: 13,
            discountTotal: 0,
            taxTotal: 0,
            grandTotal: 13,
            totalsUnchanged: true,
            testCreatedProviderState: false,
          },
        };
      }
      if (mode === "book-for-inspection") {
        return {
          result: "passed",
          fixture,
          syntheticClient: {
            syntheticClientCreated: true,
            reference: {
              clientId: "100200001",
              displayName: "Revvi Sandbox A1B2C3D4",
              email: "revvi-sandbox-a1b2c3d4@example.test",
            },
          },
          booking: {
            saleId: "100170591",
            paymentId: "168233",
            paymentType: "Cash",
            clientServiceId: "100257607",
            visitId: "100343812",
            clientVisitConfirmed: true,
            rosterConfirmed: true,
            clientScheduleConfirmed: true,
            inspectionStatus: "active",
          },
        };
      }
      return {
        result: "passed",
        fixture,
        booking: {
          visitId: "100343812",
          inspectionStatus: "cleaned",
          cancellationConfirmed: true,
          postCancellation: { entitlementRestorationObserved: false },
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    randomUuid: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000058",
        "00000000-0000-4000-8000-000000000060",
      ];
      return () => values.shift();
    })(),
    setTimeoutImpl: () => 1,
  });
  const quote = (await (await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }))).json()).data;
  await handler(request("/create-booking", {
    quoteId: quote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000059",
  }));

  const result = await handler.cleanupPending();

  assert.deepEqual(result, { attempted: 1, confirmed: 1 });
  assert.deepEqual(modes, ["quote", "book-for-inspection", "cleanup-inspection"]);
});

test("shutdown waits for an in-flight Booking before cleaning it", async () => {
  let releaseBooking;
  const bookingBlocked = new Promise((resolve) => { releaseBooking = resolve; });
  const modes = [];
  const fixture = { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" };
  const runner = {
    async run(mode) {
      modes.push(mode);
      if (mode === "quote") {
        return {
          result: "passed",
          fixture,
          quote: {
            subtotal: 13, discountTotal: 0, taxTotal: 0, grandTotal: 13,
            totalsUnchanged: true, testCreatedProviderState: false,
          },
        };
      }
      if (mode === "book-for-inspection") {
        await bookingBlocked;
        return {
          result: "passed",
          fixture,
          syntheticClient: {
            syntheticClientCreated: true,
            reference: {
              clientId: "100200001",
              displayName: "Revvi Sandbox A1B2C3D4",
              email: "revvi-sandbox-a1b2c3d4@example.test",
            },
          },
          booking: {
            saleId: "100170591",
            paymentId: "168233",
            paymentType: "Cash",
            clientServiceId: "100257607",
            visitId: "100343812",
            clientVisitConfirmed: true,
            rosterConfirmed: true,
            clientScheduleConfirmed: true,
            inspectionStatus: "active",
          },
        };
      }
      return {
        result: "passed",
        fixture,
        booking: {
          visitId: "100343812",
          inspectionStatus: "cleaned",
          cancellationConfirmed: true,
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    randomUuid: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000058",
        "00000000-0000-4000-8000-000000000060",
      ];
      return () => values.shift();
    })(),
    setTimeoutImpl: () => 1,
  });
  const quote = (await (await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }))).json()).data;
  const bookingRequest = handler(request("/create-booking", {
    quoteId: quote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000059",
  }));
  await new Promise((resolve) => setImmediate(resolve));

  const shutdown = handler.beginShutdown();
  releaseBooking();
  await bookingRequest;
  const result = await shutdown;

  assert.deepEqual(result, { attempted: 1, confirmed: 1 });
  assert.deepEqual(modes, ["quote", "book-for-inspection", "cleanup-inspection"]);
});

test("the physical preview is the Webflow widget and labels its sandbox and auth boundaries", () => {
  const page = renderSite99WebflowDemoPage({ demoBearerToken: DEMO_TOKEN });

  assert.match(page, /data-revvi-booking/);
  assert.match(page, /data-business-slug="mindbody-sandbox"/);
  assert.match(page, /data-location-id="00000000-0000-4000-8000-000000000099"/);
  assert.match(page, /data-offer-id="00000000-0000-4000-8000-000000000057"/);
  assert.match(page, /Local provider demo/);
  assert.match(page, /does not prove Memberstack/);
  assert.match(page, /fictitious sandbox Cash/);
  assert.match(page, /stays active for inspection for up to ten minutes/);
  assert.match(page, /data-site99-live-inventory/);
  assert.match(page, /revvi:availability-loaded/);
  assert.match(page, /Live Mindbody inventory evidence/);
  assert.match(page, /Mindbody Class/);
  assert.match(page, /data-booking-demo-cleanup/);
  assert.match(page, /data-demo-cleanup-endpoint="\/cleanup-demo-booking"/);
  assert.match(page, /\/assets\/revvi-booking-rail\.png/);
  assert.match(page, /\/assets\/revvi-booking\.js/);
  assert.doesNotMatch(page, /SUPABASE_FUNCTIONS_URL/);
  assert.doesNotMatch(page, /MINDBODY_API_KEY|MINDBODY_SANDBOX_PASSWORD/);
});

test("live browser automation is explicit and drives only the production widget controls", () => {
  const ordinaryPage = renderSite99WebflowDemoPage({ demoBearerToken: DEMO_TOKEN });
  const automatedPage = renderSite99WebflowDemoPage({ demoBearerToken: DEMO_TOKEN, automateBooking: true });

  assert.doesNotMatch(ordinaryPage, /data-live-browser-e2e/);
  assert.match(automatedPage, /data-live-browser-e2e/);
  assert.match(automatedPage, /family:00000000-0000-4000-8000-000000000102/);
  assert.match(automatedPage, /data-class-select/);
  assert.match(automatedPage, /data-booking-class-continue/);
  assert.match(automatedPage, /data-time-select/);
  assert.match(automatedPage, /data-booking-continue/);
  assert.match(automatedPage, /data-quote-confirm/);
  assert.match(automatedPage, /data-booking-demo-cleanup/);
  assert.doesNotMatch(automatedPage, /MINDBODY_API_KEY|MINDBODY_SANDBOX_PASSWORD/);
});

test("the demo confirmation explains how to inspect the active Mindbody Booking", () => {
  const message = bookingConfirmationText({
    status: "confirmed",
    className: "Yoga",
    startAt: "2026-08-18T10:00:00+02:00",
    timezone: "Africa/Johannesburg",
    locationName: "Mindbody public sandbox",
    sandboxDemo: {
      cleanupStatus: "pending",
      autoCleanupAt: "2026-08-17T12:10:00.000Z",
      references: {
        clientId: "100200001",
        clientName: "Revvi Sandbox A1B2C3D4",
        clientEmail: "revvi-sandbox-a1b2c3d4@example.test",
        saleId: "100170591",
        paymentId: "168233",
        visitId: "100343812",
      },
    },
  }, "Mindbody public sandbox");

  assert.match(message, /Sandbox Booking is active for inspection/);
  assert.match(message, /Revvi Sandbox A1B2C3D4/);
  assert.match(message, /100200001/);
  assert.match(message, /100170591/);
  assert.match(message, /100343812/);
  assert.match(message, /automatically cleaned/);
});

test("the demo confirmation gives the operator searchable Mindbody references", () => {
  const message = bookingConfirmationText({
    status: "confirmed",
    className: "Yoga",
    startAt: "2026-08-18T10:00:00+02:00",
    timezone: "Africa/Johannesburg",
    locationName: "Mindbody public sandbox",
    sandboxDemo: {
      cleanupStatus: "confirmed",
      entitlementRestorationObserved: false,
      references: {
        clientId: "100200001",
        clientName: "Revvi Sandbox A1B2C3D4",
        clientEmail: "revvi-sandbox-a1b2c3d4@example.test",
        saleId: "100170591",
        paymentId: "168233",
        visitId: "100343812",
      },
    },
  }, "Mindbody public sandbox");

  assert.match(message, /Sandbox Booking verified and removed safely/);
  assert.match(message, /Revvi Sandbox A1B2C3D4/);
  assert.match(message, /100200001/);
  assert.match(message, /100170591/);
  assert.match(message, /100343812/);
  assert.match(message, /Entitlement restoration was not observed/);
});

test("repeating the same demo idempotency key never creates a second sandbox Booking", async () => {
  const modes = [];
  const runner = {
    async run(mode) {
      modes.push(mode);
      if (mode === "quote") {
        return {
          result: "passed",
          fixture: { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" },
          quote: {
            subtotal: 13,
            discountTotal: 0,
            taxTotal: 0,
            grandTotal: 13,
            totalsUnchanged: true,
            testCreatedProviderState: false,
          },
        };
      }
      return {
        result: "passed",
        fixture: { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" },
        syntheticClient: { syntheticClientCreated: true },
        booking: {
          saleId: "100170591",
          paymentId: "168233",
          paymentType: "Cash",
          clientServiceId: "100257607",
          visitId: "100343812",
          clientVisitConfirmed: true,
          rosterConfirmed: true,
          clientScheduleConfirmed: true,
          cancellationConfirmed: true,
          postCancellation: { entitlementRestorationObserved: true },
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    randomUuid: () => "00000000-0000-4000-8000-000000000058",
  });
  const quote = (await (await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }))).json()).data;
  const body = {
    quoteId: quote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000059",
  };

  const first = await (await handler(request("/create-booking", body))).json();
  const repeated = await (await handler(request("/create-booking", body))).json();

  assert.deepEqual(repeated, first);
  assert.deepEqual(modes, ["quote", "book-for-inspection"]);
});

test("a pending inspection Booking blocks every new sandbox Booking attempt", async () => {
  const modes = [];
  const fixture = { classId: "19364", classStart: "2026-08-18T10:00:00", className: "Yoga" };
  const runner = {
    async run(mode) {
      modes.push(mode);
      if (mode === "quote") {
        return {
          result: "passed",
          fixture,
          quote: {
            subtotal: 13, discountTotal: 0, taxTotal: 0, grandTotal: 13,
            totalsUnchanged: true, testCreatedProviderState: false,
          },
        };
      }
      assert.equal(mode, "book-for-inspection");
      return {
        result: "passed",
        fixture,
        syntheticClient: {
          syntheticClientCreated: true,
          reference: {
            clientId: "100200001",
            displayName: "Revvi Sandbox A1B2C3D4",
            email: "revvi-sandbox-a1b2c3d4@example.test",
          },
        },
        booking: {
          saleId: "100170591",
          paymentId: "168233",
          paymentType: "Cash",
          clientServiceId: "100257607",
          visitId: "100343812",
          clientVisitConfirmed: true,
          rosterConfirmed: true,
          clientScheduleConfirmed: true,
          inspectionStatus: "active",
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({
    runner,
    demoBearerToken: DEMO_TOKEN,
    randomUuid: (() => {
      const values = [
        "00000000-0000-4000-8000-000000000058",
        "00000000-0000-4000-8000-000000000060",
        "00000000-0000-4000-8000-000000000061",
      ];
      return () => values.shift();
    })(),
    setTimeoutImpl: () => 1,
  });
  const firstQuote = (await (await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }))).json()).data;
  await handler(request("/create-booking", {
    quoteId: firstQuote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000059",
  }));
  const secondQuote = (await (await handler(request("/booking-quote", {
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    sessionId: "19364",
  }))).json()).data;

  const response = await handler(request("/create-booking", {
    quoteId: secondQuote.quoteId,
    idempotencyKey: "00000000-0000-4000-8000-000000000062",
  }));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "DEMO_INSPECTION_ACTIVE", message: "Clean up the current sandbox Booking before creating another." },
  });
  assert.deepEqual(modes, ["quote", "book-for-inspection", "quote"]);
});

test("a second browser cannot overlap a Site -99 demo provider operation", async () => {
  let release;
  let calls = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  const runner = {
    async run() {
      calls += 1;
      if (calls === 1) await blocked;
      return {
        result: "passed",
        fixture: {
          classId: "19364",
          classStart: "2026-08-18T10:00:00",
          className: "Yoga",
          locationId: "1",
          paymentSeed: 13,
        },
      };
    },
  };
  const handler = createSite99WebflowDemoHandler({ runner, demoBearerToken: DEMO_TOKEN });
  const body = {
    businessSlug: SITE_99_DEMO_CONTEXT.businessSlug,
    locationId: SITE_99_DEMO_CONTEXT.locationId,
    offerId: SITE_99_DEMO_CONTEXT.offerId,
    startDate: "2026-08-17",
  };
  const first = handler(request("/offer-class-availability", body));
  await new Promise((resolve) => setImmediate(resolve));

  const overlapping = await handler(request("/offer-class-availability", body));
  release();
  await first;

  assert.equal(overlapping.status, 429);
  assert.deepEqual(await overlapping.json(), {
    ok: false,
    error: { code: "DEMO_BUSY", message: "Another Site -99 demo operation is still running." },
  });
  assert.equal(calls, 1);
});

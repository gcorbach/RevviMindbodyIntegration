import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const chromePath = process.env.CHROME_PATH || [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((path) => existsSync(path));

const businessSlug = "pilot-yoga";
const locationId = "11111111-1111-4111-8111-111111111111";
const offerId = "22222222-2222-4222-8222-222222222222";
const localToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const canonicalEmbed = readFileSync(new URL("../../webflow/embed.html", import.meta.url), "utf8");
const canonicalHistoryEmbed = readFileSync(new URL("../../webflow/history.html", import.meta.url), "utf8");
const canonicalWidgetMarkup = canonicalEmbed.match(/<div[\s\S]*<\/div>/)?.[0];
assert.ok(canonicalWidgetMarkup, "The canonical Webflow embed must contain the widget root.");
const canonicalHistoryMarkup = canonicalHistoryEmbed.match(/<section[\s\S]*<\/section>/)?.[0];
assert.ok(canonicalHistoryMarkup, "The canonical Webflow history embed must contain the component root.");

function widgetMarkup(scenario = "available") {
  const scenarioQuery = `?scenario=${encodeURIComponent(scenario)}`;
  return canonicalWidgetMarkup
    .replace("WEBFLOW_BUSINESS_SLUG", businessSlug)
    .replace("SUPABASE_BUSINESS_LOCATION_UUID", locationId)
    .replace("SUPABASE_OFFER_UUID", offerId)
    .replace("WEBFLOW_LOCATION_NAME", "Rosebank Studio")
    .replace("IANA_LOCATION_TIMEZONE", "Africa/Johannesburg")
    .replace("WEBFLOW_OFFER_NAME", "Revvi Yoga Access")
    .replace("SUPABASE_FUNCTIONS_URL/offer-class-availability", `/functions/v1/offer-class-availability${scenarioQuery}`)
    .replace("SUPABASE_FUNCTIONS_URL/booking-quote", `/functions/v1/booking-quote${scenarioQuery}`)
    .replace("SUPABASE_FUNCTIONS_URL/create-booking", `/functions/v1/create-booking${scenarioQuery}`)
    .replace("SUPABASE_FUNCTIONS_URL/complete-paid-booking", "/functions/v1/complete-paid-booking")
    .replace("SUPABASE_FUNCTIONS_URL/cancel-booking", `/functions/v1/cancel-booking${scenarioQuery}`);
}

function availabilityBody() {
  return {
    ok: true,
    data: {
      business: { id: "business-a", name: "Pilot Yoga", slug: businessSlug },
      offer: { id: offerId, title: "Revvi Yoga Access" },
      sessions: [
        {
          sessionId: "501",
          classId: "501",
          name: "Yoga Flow",
          staffName: "Amina",
          startAt: "2026-08-12T16:00:00.000Z",
          endAt: "2026-08-12T17:00:00.000Z",
          timezone: "Africa/Johannesburg",
          estimatedAvailableSlots: 3,
          availabilityState: "available",
          availabilityReasons: [],
          provisionalPrice: { amount: 32, currency: "ZAR", serviceProductId: "revvi-yoga" },
        },
        {
          sessionId: "502",
          classId: "502",
          name: "Yoga Flow",
          startAt: "2026-08-13T16:00:00.000Z",
          timezone: "Africa/Johannesburg",
          estimatedAvailableSlots: 0,
          availabilityState: "full",
          availabilityReasons: ["capacity_full"],
        },
        {
          sessionId: "503",
          classId: "503",
          name: "Yoga Flow",
          startAt: "2026-08-14T16:00:00.000Z",
          timezone: "Africa/Johannesburg",
          estimatedAvailableSlots: null,
          availabilityState: "unknown",
          availabilityReasons: ["provider_availability_unknown"],
        },
        {
          sessionId: "504",
          classId: "504",
          name: "Yoga Flow",
          staffName: "Amina",
          startAt: "2026-08-15T08:00:00.000Z",
          endAt: "2026-08-15T09:00:00.000Z",
          timezone: "Africa/Johannesburg",
          estimatedAvailableSlots: 2,
          availabilityState: "available",
          availabilityReasons: [],
          provisionalPrice: { amount: 32, currency: "ZAR", serviceProductId: "revvi-yoga" },
        },
        {
          sessionId: "505",
          classId: "505",
          name: "Yoga Flow",
          staffName: "Amina",
          startAt: "2026-08-16T08:00:00.000Z",
          endAt: "2026-08-16T09:00:00.000Z",
          timezone: "Africa/Johannesburg",
          estimatedAvailableSlots: 4,
          availabilityState: "available",
          availabilityReasons: [],
          provisionalPrice: { amount: 32, currency: "ZAR", serviceProductId: "revvi-yoga" },
        },
        {
          sessionId: "506",
          classId: "506",
          name: "Yoga Flow",
          staffName: "Amina",
          startAt: "2026-08-17T08:00:00.000Z",
          endAt: "2026-08-17T09:00:00.000Z",
          timezone: "Africa/Johannesburg",
          estimatedAvailableSlots: 3,
          availabilityState: "available",
          availabilityReasons: [],
          provisionalPrice: { amount: 32, currency: "ZAR", serviceProductId: "revvi-yoga" },
        },
        {
          sessionId: "507",
          classId: "507",
          name: "Yoga Flow",
          staffName: "Amina",
          startAt: "2026-08-18T08:00:00.000Z",
          endAt: "2026-08-18T09:00:00.000Z",
          timezone: "Africa/Johannesburg",
          estimatedAvailableSlots: 1,
          availabilityState: "available",
          availabilityReasons: [],
          provisionalPrice: { amount: 32, currency: "ZAR", serviceProductId: "revvi-yoga" },
        },
      ],
    },
    requestId: "request-a",
  };
}

function page({
  loggedOut = false, automateBooking = false, automateDemoCleanup = false,
  inspectDesignerJourney = false, scenario = "available",
} = {}) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/revvi-booking.css"></head><body>
    ${widgetMarkup(scenario)}
    <script>
      window.$memberstackDom = {
        getCurrentMember: async () => ({ data: ${loggedOut ? "null" : "{ id: 'member-a' }"} }),
        getMemberCookie: async () => "memberstack.jwt.signature"
      };
      const root = document.querySelector("[data-revvi-booking]");
      const states = [];
      new MutationObserver(() => {
        if (root.dataset.bookingState && states.at(-1) !== root.dataset.bookingState) states.push(root.dataset.bookingState);
        root.dataset.observedStates = states.join(",");
      }).observe(root, { attributes: true, attributeFilter: ["data-booking-state"] });
      ${automateBooking ? `
        const automation = setInterval(() => {
          if (root.dataset.demoCleanupStatus === "confirmed") { clearInterval(automation); return; }
          if (root.dataset.bookingState === "success") {
            ${automateDemoCleanup ? `
              const cleanup = root.querySelector("[data-booking-demo-cleanup]:not([hidden]):not([disabled])");
              if (cleanup) { cleanup.click(); cleanup.click(); }
              return;` : "clearInterval(automation); return;"}
          }
          if (["stale", "requires-payment-action", "pending-reconciliation", "error"].includes(root.dataset.bookingState)) { clearInterval(automation); return; }
          const confirm = root.querySelector("[data-quote-confirm]:not([data-booking-continue])");
          if (confirm && !confirm.closest("[hidden]") && !confirm.disabled) {
            confirm.click();
            confirm.click();
            return;
          }
          const chooseClass = !root.dataset.selectedClassKey
            && root.querySelector("[data-class-select]:not([disabled])");
          if (chooseClass && !chooseClass.closest("[hidden]")) { chooseClass.click(); return; }
          const classContinue = root.querySelector("[data-booking-class-continue]:not([disabled])");
          if (classContinue && !classContinue.closest("[hidden]")) { classContinue.click(); return; }
          const chooseTime = !root.dataset.selectedClassId
            && root.querySelector("[data-time-select]:not([disabled])");
          if (chooseTime && !chooseTime.closest("[hidden]")) { chooseTime.click(); return; }
          const continueButton = root.querySelector("[data-booking-continue]:not([disabled])");
          if (continueButton && !continueButton.closest("[hidden]")) { continueButton.click(); return; }
        }, 20);` : ""}
      ${inspectDesignerJourney ? `
        const designerInspection = setInterval(() => {
          if (root.dataset.bookingState !== "showing-classes") return;
          clearInterval(designerInspection);
          root.querySelector("[data-class-select]:not([disabled])")?.click();
          setTimeout(() => {
            root.dataset.stateAfterClassSelect = root.dataset.bookingState;
            const classContinue = root.querySelector("[data-booking-class-continue]");
            root.dataset.classContinueAvailable = String(Boolean(classContinue && !classContinue.disabled));
            classContinue?.click();
            setTimeout(() => {
              root.dataset.quickDateCount = String(root.querySelectorAll("[data-booking-date-option]").length);
              const calendarToggle = root.querySelector("[data-booking-calendar-toggle]");
              root.dataset.calendarAvailable = String(Boolean(calendarToggle && !calendarToggle.hidden));
              calendarToggle?.click();
              root.dataset.calendarOpen = String(Boolean(root.querySelector("[data-booking-calendar]:not([hidden])")));
              const cardStyle = getComputedStyle(root);
              const rail = root.querySelector("[data-booking-brand-panel]");
              const heading = root.querySelector('[data-booking-step-panel="2"] h1');
              root.dataset.designerCardWidth = String(Math.round(root.getBoundingClientRect().width));
              root.dataset.designerCardHeight = String(Math.round(root.getBoundingClientRect().height));
              root.dataset.designerRailWidth = String(Math.round(rail.getBoundingClientRect().width));
              root.dataset.designerRadius = cardStyle.borderRadius;
              root.dataset.designerHeadingFont = getComputedStyle(heading).fontFamily;
            }, 80);
          }, 80);
        }, 20);` : ""}
      setTimeout(() => {
        root.dataset.viewportWidth = String(window.innerWidth);
        root.dataset.documentWidth = String(document.documentElement.scrollWidth);
        root.dataset.viewportFits = String(document.documentElement.scrollWidth <= window.innerWidth);
      }, 900);
    </script>
    <script src="/revvi-booking.js"></script>
  </body></html>`;
}

test("the designer journey selects a Class in place and puts later available dates in a calendar", { skip: !chromePath }, async () => {
  const widget = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../../webflow/dist/revvi-booking.css", import.meta.url), "utf8");
  const server = createServer((request, response) => {
    if (request.url === "/revvi-booking.js") {
      response.writeHead(200, { "content-type": "text/javascript" }); response.end(widget); return;
    }
    if (request.url === "/revvi-booking.css") {
      response.writeHead(200, { "content-type": "text/css" }); response.end(stylesheet); return;
    }
    if (request.url?.startsWith("/functions/v1/offer-class-availability")) {
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(availabilityBody())); return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page({ inspectDesignerJourney: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await launchChrome(`http://127.0.0.1:${server.address().port}/designer-journey`, "1440,900");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /data-state-after-class-select="showing-classes"/);
    assert.match(result.stdout, /data-class-continue-available="true"/);
    assert.match(result.stdout, /data-quick-date-count="3"/);
    assert.match(result.stdout, /data-calendar-available="true"/);
    assert.match(result.stdout, /data-calendar-open="true"/);
    assert.match(result.stdout, /data-designer-card-width="960"/);
    assert.match(result.stdout, /data-designer-card-height="620"/);
    assert.match(result.stdout, /data-designer-rail-width="312"/);
    assert.match(result.stdout, /data-designer-radius="24px"/);
    assert.match(result.stdout, /data-designer-heading-font="[^\"]*Cormorant Garamond/);
    assert.match(result.stdout, /Revvi partner/);
    assert.match(result.stdout, /Change studio/);
  } finally {
    server.closeAllConnections(); server.close();
  }
});

async function launchChrome(url, size = "390,844") {
  const windowsChromeFromWsl = process.platform !== "win32" && chromePath?.toLowerCase().endsWith(".exe");
  const profile = windowsChromeFromWsl
    ? mkdtempSync("/mnt/c/Windows/Temp/revvi-class-widget-")
    : mkdtempSync(join(tmpdir(), "revvi-class-widget-"));
  const chromeProfile = windowsChromeFromWsl
    ? execFileSync("wslpath", ["-w", profile], { encoding: "utf8" }).trim()
    : profile;
  try {
    return await new Promise((resolve) => {
      const child = spawn(chromePath, [
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        `--window-size=${size}`,
        "--dump-dom",
        "--virtual-time-budget=4000",
        `--user-data-dir=${chromeProfile}`,
        url,
      ], { windowsHide: true });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", (error) => resolve({ error, stdout, stderr, status: null }));
      child.once("close", (status) => resolve({ stdout, stderr, status }));
    });
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function historyPage() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/revvi-booking.css"></head><body>
    ${canonicalHistoryMarkup
      .replace("SUPABASE_FUNCTIONS_URL/upcoming-bookings", "/functions/v1/upcoming-bookings")
      .replace("SUPABASE_FUNCTIONS_URL/cancel-booking", "/functions/v1/cancel-booking")}
    <script>
      window.confirm = () => true;
      window.$memberstackDom = {
        getCurrentMember: async () => ({ data: { id: 'member-a' } }),
        getMemberCookie: async () => "memberstack.jwt.signature"
      };
      const automation = setInterval(() => {
        const button = document.querySelector("[data-history-cancel]:not([disabled])");
        if (button) { button.click(); clearInterval(automation); }
      }, 20);
    </script>
    <script src="/revvi-booking.js"></script>
  </body></html>`;
}

test("the Webflow widget shows approved Class times responsively and suppresses double submit", { skip: !chromePath }, async () => {
  const widget = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../../webflow/dist/revvi-booking.css", import.meta.url), "utf8");
  let availabilityCalls = 0;
  const availabilityBodies = [];
  const quoteBodies = [];
  const bookingBodies = [];
  const authorizationHeaders = [];
  let bookingCalls = 0;
  const server = createServer(async (request, response) => {
    if (request.url === "/revvi-booking.js") {
      response.writeHead(200, { "content-type": "text/javascript" }); response.end(widget); return;
    }
    if (request.url === "/revvi-booking.css") {
      response.writeHead(200, { "content-type": "text/css" }); response.end(stylesheet); return;
    }
    if (request.url?.startsWith("/functions/v1/offer-class-availability")) {
      availabilityCalls += 1;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      availabilityBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      authorizationHeaders.push(request.headers.authorization);
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(availabilityBody())); return;
    }
    if (request.url?.startsWith("/functions/v1/booking-quote")) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      quoteBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      authorizationHeaders.push(request.headers.authorization);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { quoteId: "quote-a", expiresAt: "2026-08-12T15:55:00.000Z", session: { classId: "501", name: "Yoga Flow", startAt: "2026-08-12T16:00:00.000Z", locationName: "Rosebank Studio" }, price: { grandTotal: 32, currency: "ZAR" }, cancellationPolicy: { displayText: "Cancel with the studio before the cutoff." } } })); return;
    }
    if (request.url?.startsWith("/functions/v1/create-booking")) {
      bookingCalls += 1;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      bookingBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      authorizationHeaders.push(request.headers.authorization);
      await new Promise((resolve) => setTimeout(resolve, 100));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { booking: { id: "booking-a", status: "confirmed", className: "Yoga Flow", startAt: "2026-08-12T16:00:00.000Z", locationName: "Rosebank Studio" } } })); return;
    }
    response.writeHead(200, { "content-type": "text/html" }); response.end(page({ automateBooking: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const mobile = await launchChrome(`http://127.0.0.1:${port}/mobile`);
    const desktop = await launchChrome(`http://127.0.0.1:${port}/desktop`, "1440,900");
    for (const result of [mobile, desktop]) {
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /data-viewport-fits="true"/);
      assert.match(result.stdout, /Rosebank Studio/);
      assert.match(result.stdout, /Revvi Yoga Access/);
      assert.match(result.stdout, /Amina/);
      assert.doesNotMatch(result.stdout, /null spots/);
      assert.match(result.stdout, /data-booking-state="success"/);
      assert.match(result.stdout, /loading-eligibility,loading-availability,showing-classes,showing-times,loading-quote,confirming,submitting,success/);
      assert.match(result.stdout, /Booking confirmed/);
      assert.match(result.stdout, /Cancel with the studio before the cutoff/);
      assert.match(result.stdout, /data-availability-stale="false"/);
      assert.match(result.stdout, /Class times refreshed after this Booking attempt/);
    }
    assert.equal(availabilityCalls, 4);
    assert.equal(availabilityBodies.length, 4);
    for (const body of availabilityBodies) {
      assert.deepEqual(body, { businessSlug, locationId, offerId, startDate: localToday });
    }
    assert.equal(bookingCalls, 2);
    assert.deepEqual(quoteBodies, [
      { offerId, sessionId: "501" },
      { offerId, sessionId: "501" },
    ]);
    assert.equal(bookingBodies.length, 2);
    assert.deepEqual(bookingBodies.map(({ quoteId }) => quoteId), ["quote-a", "quote-a"]);
    assert.match(bookingBodies[0].idempotencyKey, /^[0-9a-f-]{36}$/i);
    assert.match(bookingBodies[1].idempotencyKey, /^[0-9a-f-]{36}$/i);
    assert.notEqual(bookingBodies[0].idempotencyKey, bookingBodies[1].idempotencyKey);
    assert.deepEqual([...new Set(authorizationHeaders)], ["Bearer memberstack.jwt.signature"]);
  } finally {
    server.closeAllConnections(); server.close();
  }
});

test("the Site -99 demo lets the operator clean the visible sandbox Booking exactly once", { skip: !chromePath }, async () => {
  const widget = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../../webflow/dist/revvi-booking.css", import.meta.url), "utf8");
  let cleanupCalls = 0;
  const server = createServer(async (request, response) => {
    if (request.url === "/revvi-booking.js") {
      response.writeHead(200, { "content-type": "text/javascript" }); response.end(widget); return;
    }
    if (request.url === "/revvi-booking.css") {
      response.writeHead(200, { "content-type": "text/css" }); response.end(stylesheet); return;
    }
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/functions/v1/offer-class-availability") {
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(availabilityBody())); return;
    }
    if (url.pathname === "/functions/v1/booking-quote") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: {
        quoteId: "quote-site-99",
        expiresAt: "2026-08-12T15:55:00.000Z",
        session: {
          classId: "501", name: "Yoga Flow", startAt: "2026-08-12T16:00:00.000Z",
          locationName: "Rosebank Studio",
        },
        price: { grandTotal: 13, currency: "USD" },
      } }));
      return;
    }
    if (url.pathname === "/functions/v1/create-booking") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { booking: {
        status: "confirmed",
        className: "Yoga Flow",
        startAt: "2026-08-12T16:00:00.000Z",
        locationName: "Rosebank Studio",
        sandboxDemo: {
          demoBookingId: "40000000-0000-4000-8000-000000000060",
          cleanupStatus: "pending",
          autoCleanupAt: "2026-08-12T16:10:00.000Z",
          references: {
            clientId: "100200001",
            clientName: "Revvi Sandbox A1B2C3D4",
            clientEmail: "revvi-sandbox-a1b2c3d4@example.test",
            saleId: "100170591",
            paymentId: "168233",
            visitId: "100343812",
          },
        },
      } } }));
      return;
    }
    if (url.pathname === "/functions/v1/cancel-booking") {
      cleanupCalls += 1;
      assert.equal(request.headers.authorization, "Bearer memberstack.jwt.signature");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), {
        bookingId: "40000000-0000-4000-8000-000000000060",
        reason: "Revvi hosted sandbox demonstration cleanup",
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: {
        bookingId: "40000000-0000-4000-8000-000000000060",
        status: "cancelled",
        passRestoration: "not_required",
      } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page({ automateBooking: true, automateDemoCleanup: true, scenario: "demo-inspection" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await launchChrome(`http://127.0.0.1:${server.address().port}/demo-inspection`);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(cleanupCalls, 1);
    assert.match(result.stdout, /data-demo-cleanup-status="confirmed"/);
    assert.match(result.stdout, /Sandbox Booking verified and removed safely/);
    assert.match(result.stdout, /100170591/);
    assert.match(result.stdout, /100343812/);
  } finally {
    server.closeAllConnections(); server.close();
  }
});

test("a Mindbody payment return completes once through the authenticated Revvi endpoint", { skip: !chromePath }, async () => {
  const widget = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../../webflow/dist/revvi-booking.css", import.meta.url), "utf8");
  const returnedBookingId = "40000000-0000-4000-8000-000000000071";
  let completionCalls = 0;
  let availabilityCalls = 0;
  const server = createServer(async (request, response) => {
    if (request.url === "/revvi-booking.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(widget); return; }
    if (request.url === "/revvi-booking.css") { response.writeHead(200, { "content-type": "text/css" }); response.end(stylesheet); return; }
    if (request.url === "/functions/v1/complete-paid-booking") {
      completionCalls += 1;
      assert.equal(request.headers.authorization, "Bearer memberstack.jwt.signature");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), { bookingId: returnedBookingId });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { booking: {
        id: returnedBookingId, status: "confirmed", paymentStatus: "paid",
        className: "Yoga Flow", startAt: "2026-08-12T16:00:00.000Z", locationName: "Rosebank Studio",
      } } }));
      return;
    }
    if (request.url?.startsWith("/functions/v1/offer-class-availability")) {
      availabilityCalls += 1;
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(availabilityBody())); return;
    }
    response.writeHead(200, { "content-type": "text/html" }); response.end(page());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await launchChrome(
      `http://127.0.0.1:${server.address().port}/payment-return?booking=${returnedBookingId}`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /data-booking-state="success"/);
    assert.match(result.stdout, /Booking confirmed: Yoga Flow/);
    assert.equal(completionCalls, 1);
    assert.equal(availabilityCalls, 0);
  } finally {
    server.closeAllConnections(); server.close();
  }
});

test("logged-out visitors see no live bookable Class inventory", { skip: !chromePath }, async () => {
  const widget = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../../webflow/dist/revvi-booking.css", import.meta.url), "utf8");
  let availabilityCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === "/revvi-booking.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(widget); return; }
    if (request.url === "/revvi-booking.css") { response.writeHead(200, { "content-type": "text/css" }); response.end(stylesheet); return; }
    if (request.url?.startsWith("/functions/v1/offer-class-availability")) { availabilityCalls += 1; response.writeHead(500); response.end(); return; }
    response.writeHead(200, { "content-type": "text/html" }); response.end(page({ loggedOut: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await launchChrome(`http://127.0.0.1:${server.address().port}/logged-out`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /data-booking-state="ineligible"/);
    assert.match(result.stdout, /Sign in to Revvi/);
    assert.doesNotMatch(result.stdout, /data-class-id="501"/);
    assert.equal(availabilityCalls, 0);
  } finally {
    server.closeAllConnections(); server.close();
  }
});

test("upcoming Class history cancels once and keeps refund and pass restoration explicitly unconfirmed", { skip: !chromePath }, async () => {
  const widget = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../../webflow/dist/revvi-booking.css", import.meta.url), "utf8");
  let cancellationCalls = 0;
  const authorizationHeaders = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/revvi-booking.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(widget); return; }
    if (request.url === "/revvi-booking.css") { response.writeHead(200, { "content-type": "text/css" }); response.end(stylesheet); return; }
    if (request.url === "/functions/v1/upcoming-bookings") {
      authorizationHeaders.push(request.headers.authorization);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { bookings: [{
        id: "39000000-0000-4000-8000-000000000001",
        status: cancellationCalls ? "unknown" : "confirmed",
        businessName: "Rosebank Yoga", className: "Yoga Flow",
        startAt: "2026-08-12T16:00:00.000Z", timezone: "Africa/Johannesburg",
        locationName: "Rosebank Studio",
        cancellationState: cancellationCalls ? "pending" : "requestable",
      }] } }));
      return;
    }
    if (request.url === "/functions/v1/cancel-booking") {
      cancellationCalls += 1;
      authorizationHeaders.push(request.headers.authorization);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(body.bookingId, "39000000-0000-4000-8000-000000000001");
      assert.equal(body.reason, "Revvi Customer requested cancellation");
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: {
        bookingId: body.bookingId, status: "unknown",
        passRestoration: "unknown", refund: "not_requested",
      } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }); response.end(historyPage());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await launchChrome(`http://127.0.0.1:${server.address().port}/history`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Your upcoming Classes/);
    assert.match(result.stdout, /Yoga Flow/);
    assert.match(result.stdout, /Cancellation is being reconciled/);
    assert.match(result.stdout, /data-history-result="unknown"/);
    assert.match(result.stdout, /Do not submit it again/);
    assert.match(result.stdout, /Refund and pass restoration remain unconfirmed/);
    assert.equal(cancellationCalls, 1);
    assert.deepEqual([...new Set(authorizationHeaders)], ["Bearer memberstack.jwt.signature"]);
  } finally {
    server.closeAllConnections(); server.close();
  }
});

test("the browser renders ineligible, empty, stale, reconciliation, and safe failure states", { skip: !chromePath }, async () => {
  const widget = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");
  const stylesheet = readFileSync(new URL("../../webflow/dist/revvi-booking.css", import.meta.url), "utf8");
  const server = createServer(async (request, response) => {
    if (request.url === "/revvi-booking.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(widget); return; }
    if (request.url === "/revvi-booking.css") { response.writeHead(200, { "content-type": "text/css" }); response.end(stylesheet); return; }
    const url = new URL(request.url, "http://localhost");
    const scenario = url.searchParams.get("scenario") ?? "available";
    if (url.pathname === "/functions/v1/offer-class-availability") {
      if (scenario === "ineligible") {
        response.writeHead(403, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, code: "OFFER_INELIGIBLE", error: "raw subscription record must not render" }));
        return;
      }
      const body = availabilityBody();
      if (scenario === "empty") body.data.sessions = [];
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(body)); return;
    }
    if (url.pathname === "/functions/v1/booking-quote") {
      if (scenario === "stale") {
        response.writeHead(409, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, code: "QUOTE_EXPIRED", error: "raw Mindbody response must not render" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: { quoteId: `quote-${scenario}`, expiresAt: "2026-08-12T15:55:00.000Z", session: { classId: "501", name: "Yoga Flow", startAt: "2026-08-12T16:00:00.000Z", timezone: "Africa/Johannesburg", locationName: "Rosebank Studio" }, price: { grandTotal: 32, currency: "ZAR" } } }));
      return;
    }
    if (url.pathname === "/functions/v1/create-booking") {
      if (scenario === "payment") {
        response.writeHead(202, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, data: { booking: { id: "booking-action", status: "requires_action", redirectUrl: "https://payments.example.test/challenge" } } }));
        return;
      }
      if (scenario === "reconciliation") {
        response.writeHead(202, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, data: { booking: { id: "booking-unknown", status: "unknown" } } }));
        return;
      }
      response.writeHead(409, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, code: "BOOKING_REJECTED", error: "raw provider rejection must not render" }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page({ scenario: url.pathname.slice(1), automateBooking: !["ineligible", "empty"].includes(url.pathname.slice(1)) }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const ineligible = await launchChrome(`${base}/ineligible`);
    const empty = await launchChrome(`${base}/empty`);
    const stale = await launchChrome(`${base}/stale`);
    const payment = await launchChrome(`${base}/payment`);
    const reconciliation = await launchChrome(`${base}/reconciliation`);
    const failure = await launchChrome(`${base}/failure`);
    for (const result of [ineligible, empty, stale, payment, reconciliation, failure]) {
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, /raw subscription record|raw Mindbody response|raw provider rejection/);
    }
    assert.match(ineligible.stdout, /data-booking-state="ineligible"/);
    assert.match(ineligible.stdout, /current Revvi subscription does not include this Offer/);
    assert.doesNotMatch(ineligible.stdout, /data-class-id="501"/);
    assert.match(empty.stdout, /data-booking-state="empty"/);
    assert.match(empty.stdout, /No upcoming Class times are available/);
    assert.match(stale.stdout, /data-booking-state="stale"/);
    assert.match(stale.stdout, /data-selected-class-id="501"/);
    assert.match(stale.stdout, /data-selected-class-time="2026-08-12T16:00:00.000Z"/);
    assert.match(stale.stdout, /Rosebank Studio/);
    assert.match(stale.stdout, /<span data-booking-selection="">Yoga Flow —/);
    assert.match(payment.stdout, /data-booking-state="requires-payment-action"/);
    assert.match(payment.stdout, /href="https:\/\/payments.example.test\/challenge"/);
    assert.match(payment.stdout, /Class times refreshed after this Booking attempt/);
    assert.match(reconciliation.stdout, /data-booking-state="pending-reconciliation"/);
    assert.match(reconciliation.stdout, /Do not submit it again/);
    assert.match(reconciliation.stdout, /loading-quote,confirming,submitting,pending-reconciliation/);
    assert.match(reconciliation.stdout, /<span data-booking-selection="">Yoga Flow —/);
    assert.match(failure.stdout, /data-booking-state="error"/);
    assert.match(failure.stdout, /Mindbody did not confirm this Booking/);
    assert.match(failure.stdout, /<span data-booking-selection="">Yoga Flow —/);
  } finally {
    server.closeAllConnections(); server.close();
  }
});

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { createSite99Runner } from "./mindbody-site-99-e2e.mjs";

export const SITE_99_DEMO_CONTEXT = Object.freeze({
  businessSlug: "mindbody-sandbox",
  locationId: "00000000-0000-4000-8000-000000000099",
  offerId: "00000000-0000-4000-8000-000000000057",
  offerName: "Revvi Sandbox Yoga",
  locationName: "Mindbody public sandbox",
  locationTimezone: "Africa/Johannesburg",
});

const WEBFLOW_EMBED = readFileSync(new URL("../webflow/embed.html", import.meta.url), "utf8");
const WEBFLOW_SCRIPT = readFileSync(new URL("../webflow/dist/revvi-booking.js", import.meta.url));
const WEBFLOW_STYLES = readFileSync(new URL("../webflow/dist/revvi-booking.css", import.meta.url));

export function renderSite99WebflowDemoPage({ demoBearerToken }) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(demoBearerToken ?? "")) {
    throw new Error("The local demo token must use a JWT-shaped value.");
  }
  const widget = WEBFLOW_EMBED
    .replace("WEBFLOW_BUSINESS_SLUG", SITE_99_DEMO_CONTEXT.businessSlug)
    .replace("SUPABASE_BUSINESS_LOCATION_UUID", SITE_99_DEMO_CONTEXT.locationId)
    .replace("SUPABASE_OFFER_UUID", SITE_99_DEMO_CONTEXT.offerId)
    .replace("WEBFLOW_LOCATION_NAME", SITE_99_DEMO_CONTEXT.locationName)
    .replace("IANA_LOCATION_TIMEZONE", SITE_99_DEMO_CONTEXT.locationTimezone)
    .replace("WEBFLOW_OFFER_NAME", SITE_99_DEMO_CONTEXT.offerName)
    .replace("SUPABASE_FUNCTIONS_URL/offer-class-availability", "/offer-class-availability")
    .replace("SUPABASE_FUNCTIONS_URL/booking-quote", "/booking-quote")
    .replace("SUPABASE_FUNCTIONS_URL/create-booking", "/create-booking")
    .replace("SUPABASE_FUNCTIONS_URL/complete-paid-booking", "/complete-paid-booking")
    .replace("SUPABASE_FUNCTIONS_URL/cleanup-demo-booking", "/cleanup-demo-booking");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Revvi Site -99 Booking Demo</title></head>
<body>
  <aside style="padding:1rem;border:2px solid #7c3aed;background:#f5f3ff;margin-bottom:1rem">
    <strong>Local provider demo</strong>
    <p>This uses live Mindbody Site -99 data and fictitious sandbox Cash. It does not prove Memberstack authentication or production payment.</p>
    <p>Confirming creates and verifies one sandbox Booking. It stays active for inspection for up to ten minutes; use the cleanup button when you are finished.</p>
  </aside>
  <script>
    window.$memberstackDom = {
      getCurrentMember: async () => ({ data: { id: "local-site-99-demo-customer" } }),
      getMemberCookie: async () => ${JSON.stringify(demoBearerToken)}
    };
  </script>
  ${widget}
</body>
</html>`;
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function site99DateTime(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("Site -99 returned no Class time.");
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}+02:00`;
}

function exactContext(body) {
  return body?.businessSlug === SITE_99_DEMO_CONTEXT.businessSlug
    && body?.locationId === SITE_99_DEMO_CONTEXT.locationId
    && body?.offerId === SITE_99_DEMO_CONTEXT.offerId;
}

function numericId(value) {
  return typeof value === "string" && /^\d{1,32}$/.test(value);
}

export function createSite99WebflowDemoHandler({
  runner,
  demoBearerToken,
  now = () => new Date(),
  randomUuid = () => crypto.randomUUID(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  if (!runner || typeof runner.run !== "function") throw new Error("A Site -99 runner is required.");
  if (typeof demoBearerToken !== "string" || demoBearerToken.length < 16) {
    throw new Error("A local demo bearer token is required.");
  }
  const quotes = new Map();
  const attempts = new Map();
  const demoBookings = new Map();
  let providerActive = false;
  let shuttingDown = false;
  let providerIdleWaiters = [];

  async function runProvider(mode) {
    if (providerActive) return null;
    providerActive = true;
    try {
      return await runner.run(mode);
    } finally {
      providerActive = false;
      const waiters = providerIdleWaiters;
      providerIdleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }

  async function waitForProviderIdle() {
    if (!providerActive) return;
    await new Promise((resolve) => providerIdleWaiters.push(resolve));
  }

  function busy() {
    return json(429, {
      ok: false,
      error: { code: "DEMO_BUSY", message: "Another Site -99 demo operation is still running." },
    });
  }

  async function cleanupDemoBooking(demoBookingId) {
    const demo = demoBookings.get(demoBookingId);
    if (!demo) return { status: 404, payload: { ok: false, error: { code: "DEMO_BOOKING_NOT_FOUND" } } };
    if (demo.cleanupStatus === "confirmed") return { status: 200, payload: demo.payload };
    const result = await runProvider("cleanup-inspection");
    if (!result) {
      return {
        status: 429,
        payload: {
          ok: false,
          error: { code: "DEMO_BUSY", message: "Another Site -99 demo operation is still running." },
        },
      };
    }
    const cleanup = result?.booking;
    if (result?.result !== "passed"
      || cleanup?.inspectionStatus !== "cleaned"
      || cleanup?.cancellationConfirmed !== true
      || (demo.visitId !== null && String(cleanup?.visitId) !== demo.visitId)) {
      return {
        status: 202,
        payload: { ok: true, data: { booking: { status: "reconciliation" } } },
      };
    }
    if (demo.cleanupTimer !== undefined) clearTimeoutImpl(demo.cleanupTimer);
    const sandboxDemo = {
      ...demo.payload.data.booking.sandboxDemo,
      cleanupStatus: "confirmed",
      entitlementRestorationObserved: typeof cleanup?.postCancellation?.entitlementRestorationObserved === "boolean"
        ? cleanup.postCancellation.entitlementRestorationObserved
        : null,
    };
    const payload = {
      ok: true,
      data: {
        booking: {
          ...demo.payload.data.booking,
          sandboxDemo,
        },
      },
    };
    demoBookings.set(demoBookingId, {
      ...demo,
      cleanupStatus: "confirmed",
      payload,
    });
    return { status: 200, payload };
  }

  function scheduleDemoCleanup(demoBookingId, delay) {
    const cleanupTimer = setTimeoutImpl(async () => {
      try {
        const result = await cleanupDemoBooking(demoBookingId);
        if (result.status !== 200 && demoBookings.get(demoBookingId)?.cleanupStatus === "pending") {
          scheduleDemoCleanup(demoBookingId, 1_000);
        }
      } catch {
        if (demoBookings.get(demoBookingId)?.cleanupStatus === "pending") {
          scheduleDemoCleanup(demoBookingId, 1_000);
        }
      }
    }, delay);
    cleanupTimer?.unref?.();
    const demo = demoBookings.get(demoBookingId);
    if (demo) demoBookings.set(demoBookingId, { ...demo, cleanupTimer });
  }

  function registerEmergencyCleanup(visitId = null) {
    const demoBookingId = randomUuid();
    demoBookings.set(demoBookingId, {
      cleanupStatus: "pending",
      visitId: visitId === null ? null : String(visitId),
      payload: {
        ok: true,
        data: {
          booking: {
            status: "reconciliation",
            sandboxDemo: { demoBookingId, cleanupStatus: "pending" },
          },
        },
      },
    });
    return demoBookingId;
  }

  async function attemptEmergencyCleanup(demoBookingId) {
    try {
      const cleanup = await cleanupDemoBooking(demoBookingId);
      if (cleanup.status !== 200) scheduleDemoCleanup(demoBookingId, 1_000);
    } catch (error) {
      if (error?.code === "NO_PENDING_INSPECTION") demoBookings.delete(demoBookingId);
      else scheduleDemoCleanup(demoBookingId, 1_000);
    }
  }

  const handle = async function handle(request) {
    if (request.method !== "POST") return json(405, { ok: false, error: { code: "METHOD_NOT_ALLOWED" } });
    if (request.headers.get("Origin") !== "http://127.0.0.1:3000") {
      return json(403, { ok: false, error: { code: "ORIGIN_NOT_ALLOWED" } });
    }
    if (request.headers.get("Authorization") !== `Bearer ${demoBearerToken}`) {
      return json(401, { ok: false, error: { code: "AUTHENTICATION_REQUIRED" } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: { code: "INVALID_REQUEST" } });
    }
    const pathname = new URL(request.url).pathname;
    if (shuttingDown && pathname !== "/cleanup-demo-booking") {
      return json(503, {
        ok: false,
        error: { code: "DEMO_SHUTTING_DOWN", message: "The Site -99 demo is cleaning up before shutdown." },
      });
    }
    if (pathname === "/offer-class-availability") {
      if (!exactContext(body)) {
        return json(403, { ok: false, error: { code: "OFFER_CONTEXT_MISMATCH" } });
      }
      const result = await runProvider("probe");
      if (!result) return busy();
      const fixture = result?.fixture;
      return json(200, {
        ok: true,
        data: {
          business: { slug: SITE_99_DEMO_CONTEXT.businessSlug },
          offer: { id: SITE_99_DEMO_CONTEXT.offerId, name: SITE_99_DEMO_CONTEXT.offerName },
          sessions: [{
            classId: String(fixture.classId),
            name: fixture.className,
            startAt: site99DateTime(fixture.classStart),
            timezone: SITE_99_DEMO_CONTEXT.locationTimezone,
            staffName: "Mindbody sandbox instructor",
            availabilityState: "available",
            estimatedAvailableSlots: null,
            provisionalPrice: { amount: fixture.paymentSeed, currency: "USD" },
          }],
        },
      });
    }
    if (pathname === "/booking-quote") {
      if (body?.offerId !== SITE_99_DEMO_CONTEXT.offerId || !body?.sessionId) {
        return json(403, { ok: false, error: { code: "OFFER_CONTEXT_MISMATCH" } });
      }
      const result = await runProvider("quote");
      if (!result) return busy();
      const fixture = result?.fixture;
      const quote = result?.quote;
      if (String(fixture?.classId) !== String(body.sessionId)
        || quote?.totalsUnchanged !== true
        || quote?.testCreatedProviderState !== false) {
        return json(409, { ok: false, error: { code: "QUOTE_CHANGED" } });
      }
      const quoteId = randomUuid();
      const expiresAt = new Date(now().getTime() + 10 * 60 * 1000);
      quotes.set(quoteId, { fixture, expiresAt });
      return json(200, {
        ok: true,
        data: {
          quoteId,
          expiresAt: expiresAt.toISOString(),
          session: {
            classId: String(fixture.classId),
            name: fixture.className,
            startAt: site99DateTime(fixture.classStart),
            locationName: SITE_99_DEMO_CONTEXT.locationName,
          },
          price: {
            subtotal: quote.subtotal,
            discountTotal: quote.discountTotal,
            taxTotal: quote.taxTotal,
            grandTotal: quote.grandTotal,
            currency: "USD",
          },
          cancellationPolicy: {
            displayText: "Sandbox demo only: confirming creates a fictitious Cash Booking that stays active for inspection for up to ten minutes.",
            certainty: "sandbox_demo",
          },
        },
      });
    }
    if (pathname === "/cleanup-demo-booking") {
      const cleaned = await cleanupDemoBooking(body?.demoBookingId);
      return json(cleaned.status, cleaned.payload);
    }
    if (pathname === "/create-booking") {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(body?.idempotencyKey ?? "")) {
        return json(422, { ok: false, error: { code: "INVALID_IDEMPOTENCY_KEY" } });
      }
      const repeated = attempts.get(body.idempotencyKey);
      if (repeated) {
        if (repeated.quoteId !== body.quoteId) {
          return json(409, { ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
        }
        return json(repeated.status, repeated.payload);
      }
      if ([...demoBookings.values()].some((demo) => demo.cleanupStatus === "pending")) {
        return json(409, {
          ok: false,
          error: {
            code: "DEMO_INSPECTION_ACTIVE",
            message: "Clean up the current sandbox Booking before creating another.",
          },
        });
      }
      const storedQuote = quotes.get(body?.quoteId);
      if (!storedQuote || storedQuote.expiresAt.getTime() <= now().getTime()) {
        return json(409, { ok: false, error: { code: "QUOTE_EXPIRED" } });
      }
      let result;
      try {
        result = await runProvider("book-for-inspection");
      } catch (error) {
        const emergencyCleanupId = registerEmergencyCleanup();
        await attemptEmergencyCleanup(emergencyCleanupId);
        throw error;
      }
      if (!result) return busy();
      quotes.delete(body.quoteId);
      const fixture = result?.fixture;
      const booking = result?.booking;
      const syntheticReference = result?.syntheticClient?.reference;
      const referencesSafe = numericId(syntheticReference?.clientId)
        && /^Revvi Sandbox [A-Za-z0-9]{1,8}$/.test(syntheticReference?.displayName ?? "")
        && /^revvi-sandbox-[A-Za-z0-9]{1,24}@example\.test$/.test(syntheticReference?.email ?? "")
        && numericId(booking?.saleId)
        && numericId(booking?.paymentId)
        && numericId(booking?.visitId);
      const providerEvidenceConfirmed = result?.result === "passed"
        && result?.syntheticClient?.syntheticClientCreated === true
        && referencesSafe
        && String(fixture?.classId) === String(storedQuote.fixture?.classId)
        && typeof booking?.saleId === "string"
        && typeof booking?.paymentId === "string"
        && booking?.paymentType === "Cash"
        && typeof booking?.clientServiceId === "string"
        && typeof booking?.visitId === "string"
        && booking?.clientVisitConfirmed === true
        && booking?.rosterConfirmed === true
        && booking?.clientScheduleConfirmed === true;
      const inspectionActive = booking?.inspectionStatus === "active";
      if (!providerEvidenceConfirmed || !inspectionActive) {
        const payload = {
          ok: true,
          data: { booking: { status: "reconciliation" } },
        };
        if (inspectionActive && numericId(booking?.visitId)) {
          const emergencyCleanupId = registerEmergencyCleanup(booking.visitId);
          await attemptEmergencyCleanup(emergencyCleanupId);
        }
        attempts.set(body.idempotencyKey, { quoteId: body.quoteId, status: 202, payload });
        return json(202, payload);
      }
      const demoBookingId = randomUuid();
      const autoCleanupAt = new Date(now().getTime() + 10 * 60 * 1000);
      const payload = {
        ok: true,
        data: {
          booking: {
            status: "confirmed",
            className: fixture.className,
            startAt: site99DateTime(fixture.classStart),
            locationName: SITE_99_DEMO_CONTEXT.locationName,
            sandboxDemo: {
              paymentType: "Fictitious Cash",
              providerEvidenceConfirmed: true,
              demoBookingId,
              cleanupStatus: "pending",
              autoCleanupAt: autoCleanupAt.toISOString(),
              references: {
                clientId: syntheticReference.clientId,
                clientName: syntheticReference.displayName,
                clientEmail: syntheticReference.email,
                saleId: booking.saleId,
                paymentId: booking.paymentId,
                visitId: booking.visitId,
              },
            },
          },
        },
      };
      demoBookings.set(demoBookingId, {
        cleanupStatus: "pending",
        visitId: String(booking.visitId),
        payload,
      });
      scheduleDemoCleanup(demoBookingId, 10 * 60 * 1000);
      attempts.set(body.idempotencyKey, { quoteId: body.quoteId, status: 200, payload });
      return json(200, payload);
    }
    return json(404, { ok: false, error: { code: "NOT_FOUND" } });
  };
  async function cleanupPending() {
    const pendingIds = [...demoBookings.entries()]
      .filter(([, demo]) => demo.cleanupStatus === "pending")
      .map(([demoBookingId]) => demoBookingId);
    let confirmed = 0;
    for (const demoBookingId of pendingIds) {
      const result = await cleanupDemoBooking(demoBookingId);
      if (result.status === 200) confirmed += 1;
    }
    return { attempted: pendingIds.length, confirmed };
  }
  handle.cleanupPending = cleanupPending;
  handle.beginShutdown = async () => {
    shuttingDown = true;
    await waitForProviderIdle();
    return cleanupPending();
  };
  return handle;
}

function writeNodeResponse(response, webResponse) {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, name) => response.setHeader(name, value));
  return webResponse.arrayBuffer().then((body) => response.end(Buffer.from(body)));
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_768) throw new Error("request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createSite99WebflowDemoServer({ handler, demoBearerToken, logger = console }) {
  if (typeof handler !== "function") throw new Error("A demo HTTP handler is required.");
  const page = renderSite99WebflowDemoPage({ demoBearerToken });
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1:3000");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(page);
        return;
      }
      if (request.method === "GET" && url.pathname === "/assets/revvi-booking.js") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        response.end(WEBFLOW_SCRIPT);
        return;
      }
      if (request.method === "GET" && url.pathname === "/assets/revvi-booking.css") {
        response.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
        response.end(WEBFLOW_STYLES);
        return;
      }
      const body = request.method === "POST" ? await requestBody(request) : undefined;
      const webRequest = new Request(url, {
        method: request.method,
        headers: request.headers,
        ...(body === undefined ? {} : { body }),
      });
      await writeNodeResponse(response, await handler(webRequest));
    } catch (error) {
      logger.error?.("Site -99 Webflow demo request failed.", {
        name: error?.name ?? "Error",
        stage: error?.stage ?? null,
        code: error?.code ?? "UNEXPECTED_ERROR",
        status: error?.status ?? null,
      });
      response.writeHead(502, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({
        ok: false,
        error: { code: "SANDBOX_PROVIDER_UNAVAILABLE", message: "The Site -99 demo could not complete safely." },
      }));
    }
  });
}

async function main() {
  if (process.env.MINDBODY_SANDBOX_WRITE_CONFIRM !== "BOOK_AND_CANCEL_SITE_-99") {
    throw new Error("Set the exact Site -99 write confirmation before starting the physical demo.");
  }
  const demoBearerToken = [0, 1, 2].map(() => randomBytes(18).toString("base64url")).join(".");
  const runner = createSite99Runner({ exposeSyntheticClientReference: true });
  const handler = createSite99WebflowDemoHandler({ runner, demoBearerToken });
  const server = createSite99WebflowDemoServer({ handler, demoBearerToken });
  server.listen(3000, "127.0.0.1", () => {
    process.stdout.write("Revvi Site -99 Webflow demo: http://127.0.0.1:3000\n");
    process.stdout.write("This local preview uses a demo identity and leaves one Booking active for up to ten minutes.\n");
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      const cleanup = await handler.beginShutdown();
      if (cleanup.confirmed !== cleanup.attempted) {
        process.stderr.write("Pending sandbox Booking cleanup is not confirmed; the demo remains running so cleanup can be retried.\n");
        stopping = false;
        return;
      }
      server.close(() => process.exit(0));
    } catch {
      process.stderr.write("Pending sandbox Booking cleanup failed; the demo remains running so cleanup can be retried.\n");
      stopping = false;
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

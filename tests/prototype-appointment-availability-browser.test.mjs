import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const chromePath = process.env.CHROME_PATH || [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((path) => existsSync(path));

test("availability page covers live times, empty dates, and review responsively", { skip: !chromePath || process.env.RUN_BROWSER_TESTS !== "1" }, async (testContext) => {
  const source = readFileSync(new URL("../docs/catalogue/availability.html", import.meta.url), "utf8");
  const submitBooking = 'const testClick = setInterval(() => { const button = document.querySelector("#continue-booking"); if (button && !button.disabled && !button.closest("[hidden]")) { clearInterval(testClick); button.click(); } }, 25);';
  function bookingPage(query = "", interaction = submitBooking) {
  return source.replace("<script>", `<script>window.REVVI_CUSTOMER_TOKEN = "test-token"; window.REVVI_CATALOGUE_API_URL = "/functions/v1/prototype-appointment-availability"; window.REVVI_BOOKING_API_URL = "/functions/v1/prototype-appointment-attempt${query}"; window.REVVI_TEST_RESPONSIVE = true;\n`).replace("</body>", `<script>${interaction}</script></body>`);
  }
  const html = bookingPage();
  const createdClientHtml = bookingPage("?client-created=true");
  const ambiguousHtml = bookingPage("?ambiguous=true");
  const resolvingHtml = bookingPage("?state=unknown");
  const paymentAttentionHtml = bookingPage("?state=payment_needs_attention");
  const failedHtml = bookingPage("?state=failed");
  const expiredHtml = bookingPage("?state=expired");
  const staleHtml = bookingPage("?stale=true", 'let recovered = false; let initialSubmitted = false; const testClick = setInterval(() => { const slot = document.querySelector("#slots button"); if (!recovered && slot && !slot.closest("[hidden]")) { recovered = true; slot.click(); return; } const button = document.querySelector("#continue-booking"); if (button && !button.disabled && !button.closest("[hidden]")) { if (!initialSubmitted) { initialSubmitted = true; button.click(); return; } clearInterval(testClick); button.click(); } }, 25);');
  const scaHtml = bookingPage("?sca=true", submitBooking);
  const server = createServer((request, response) => {
      if (request.url?.startsWith("/functions/v1/prototype-appointment-attempt")) {
      const ambiguous = new URL(request.url, "http://localhost").searchParams.get("ambiguous") === "true";
      const clientCreated = new URL(request.url, "http://localhost").searchParams.get("client-created") === "true";
      const stale = new URL(request.url, "http://localhost").searchParams.get("stale") === "true";
      const sca = new URL(request.url, "http://localhost").searchParams.get("sca") === "true";
      const bookingState = new URL(request.url, "http://localhost").searchParams.get("state");
      const staleBody = { code: "SLOT_UNAVAILABLE", error: "That time was taken before the Booking was written. Choose a new live time.", staleSelection: { startTime: "2026-07-28T16:00:00.000Z" }, business: { displayName: "Revvi Sandbox Wellness", locationBrowserPath: "/locations" }, location: { displayName: "Sandbox Location", timezone: "America/Los_Angeles" }, service: { name: "Nutrition Consultation", durationMinutes: 45, price: 120 }, availability: { state: "available", selectedDate: "2026-07-28", slots: [{ startTime: "2026-07-28T17:00:00.000Z", endTime: "2026-07-28T17:45:00.000Z", durationMinutes: 45, price: 120 }], earliestNextAvailability: null } };
      if (ambiguous) { response.writeHead(409, { "content-type": "application/json" }); response.end(JSON.stringify({ code: "CLIENT_MATCH_AMBIGUOUS", supportRequired: true, error: "More than one verified-email Mindbody Client matched.", bookingAttempt: { state: "failed" } })); return; }
      if (bookingState) { response.writeHead(["unknown", "payment_needs_attention"].includes(bookingState) ? 202 : 409, { "content-type": "application/json" }); response.end(JSON.stringify({ code: bookingState === "unknown" ? "BOOKING_RESOLVING" : bookingState === "payment_needs_attention" ? "PAYMENT_NEEDS_ATTENTION" : bookingState === "expired" ? "BOOKING_ATTEMPT_EXPIRED" : "BOOKING_NOT_COMPLETED", error: "Booking attempt status test response.", bookingAttempt: { state: bookingState } })); return; }
      if (sca && !server.scaChallengeUsed) { server.scaChallengeUsed = true; response.writeHead(202, { "content-type": "application/json" }); response.end(JSON.stringify({ code: "PAYMENT_NEEDS_ATTENTION", bookingAttempt: { state: "payment_needs_attention" }, scaChallenge: { url: "/sca-challenge" } })); return; }
      if (stale && !server.staleResponseUsed) { server.staleResponseUsed = true; response.writeHead(409, { "content-type": "application/json" }); response.end(JSON.stringify(staleBody)); return; }
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ clientCreated, bookingAttempt: { state: "confirmed", service: "Nutrition Consultation", startTime: "2026-07-28T17:00:00.000Z", locationTimezone: "America/Los_Angeles" } })); return;
    }
      if (request.url?.startsWith("/functions/v1/prototype-appointment-availability")) {
      const query = new URL(request.url, "http://localhost").searchParams;
      const empty = query.get("date") === "2026-07-29";
      const slot = { startTime: "2026-07-28T16:00:00.000Z", endTime: "2026-07-28T16:45:00.000Z", durationMinutes: 45, price: 120 };
      const body = {
        business: { displayName: "Revvi Sandbox Wellness", locationBrowserPath: "/locations" },
        location: { displayName: "Sandbox Location", timezone: "America/Los_Angeles" },
        service: { name: "Nutrition Consultation", durationMinutes: 45, price: 120 },
        availability: { state: empty ? "empty" : "available", selectedDate: query.get("date"), slots: empty ? [] : [slot], earliestNextAvailability: empty ? { date: "2026-07-30", startTime: "2026-07-30T16:00:00.000Z" } : null },
      };
      if (query.get("start")) { const selected = query.get("start"); body.review = { business: { displayName: "Revvi Sandbox Wellness" }, location: { displayName: "Sandbox Location" }, service: { name: "Nutrition Consultation", durationMinutes: 45, price: 120 }, startTime: selected, endTime: new Date(new Date(selected).getTime() + 45 * 60 * 1000).toISOString() }; }
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(body)); return;
    }
    if (request.url?.startsWith("/sca-challenge")) { response.writeHead(302, { location: "/sca-return-page?business=sandbox-wellness&location=sandbox-location&service=service-23&date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z&sca=returned" }); response.end(); return; }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(request.url?.includes("sca-return-page") ? scaHtml : request.url?.includes("resolving-page") ? resolvingHtml : request.url?.includes("payment-attention-page") ? paymentAttentionHtml : request.url?.includes("failed-page") ? failedHtml : request.url?.includes("expired-page") ? expiredHtml : request.url?.includes("ambiguous-page") ? ambiguousHtml : request.url?.includes("created-client-page") ? createdClientHtml : request.url?.includes("stale-page") ? staleHtml : html);
  });
  server.staleResponseUsed = false;
  server.scaChallengeUsed = false;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const launch = async (query, size = "390,844", budget = 1500) => {
    const profile = mkdtempSync(join(tmpdir(), "revvi-chrome-"));
    try {
      return await new Promise((resolve) => {
        const child = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--window-size=${size}`, "--dump-dom", `--virtual-time-budget=${budget}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/?business=sandbox-wellness&location=sandbox-location&service=service-23&${query}`], { windowsHide: true });
        let stdout = "";
        let stderr = "";
        let settled = false;
        let terminalError;
        let shutdownFallback;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          clearTimeout(shutdownFallback);
          resolve({ ...result, stdout, stderr });
        };
        const timeout = setTimeout(() => {
          terminalError = new Error("Chrome did not exit within 15000ms.");
          terminalError.code = "ETIMEDOUT";
          if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
          else child.kill("SIGKILL");
          shutdownFallback = setTimeout(() => finish({ error: terminalError, status: null }), 5_000);
        }, 15000);
        child.stdout?.on("data", (chunk) => { stdout += chunk; });
        child.stderr?.on("data", (chunk) => { stderr += chunk; });
        child.once("error", (error) => finish({ error, status: null }));
        child.once("close", (status) => finish({ error: terminalError, status: terminalError ? null : status }));
      });
    } finally {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  };
  try {
    const available = await launch("date=2026-07-28");
    const desktop = await launch("date=2026-07-28", "1440,900");
    const empty = await launch("date=2026-07-29");
    const review = await launch("date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z");
    const createdClient = await launch("created-client-page&date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z");
    const ambiguous = await launch("ambiguous-page&date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z");
    const resolving = await launch("resolving-page&date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z");
    const paymentAttention = await launch("payment-attention-page&date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z");
    const failed = await launch("failed-page&date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z");
    const expired = await launch("expired-page&date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z");
    const stale = await launch("stale-page&date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z", "390,844", 3000);
    const sca = await launch("sca-return-page&date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z&sca=returned", "390,844", 3000);
    for (const result of [available, desktop, empty, review, createdClient, ambiguous, resolving, paymentAttention, failed, expired, stale, sca]) {
      if (result.error && ["ETIMEDOUT", "ENOENT"].includes(result.error.code)) { testContext.skip(`Chrome could not launch in this environment (${result.error.code}).`); return; }
      assert.equal(result.error, undefined, result.error?.message); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /data-responsive="true"/);
    }
    assert.match(available.stdout, /16:00|4:00/);
    assert.match(desktop.stdout, /Choose a time/); assert.match(desktop.stdout, /date-picker/);
    assert.match(empty.stdout, /No times are available on this date/); assert.match(empty.stdout, /Earliest next availability/); assert.match(empty.stdout, /2026-07-30/);
    assert.match(review.stdout, /Booking confirmed/); assert.match(review.stdout, /Your Booking is confirmed/); assert.match(review.stdout, /Nutrition Consultation/);
    assert.match(createdClient.stdout, /Booking confirmed/); assert.match(createdClient.stdout, /data-client-created="true"/);
    assert.match(ambiguous.stdout, /Please contact Revvi support/); assert.doesNotMatch(ambiguous.stdout, /sandbox-client-10[01]/);
    assert.match(resolving.stdout, /Resolving your Booking attempt/); assert.match(resolving.stdout, /Do not submit it again/);
    assert.match(paymentAttention.stdout, /Complete payment to continue/); assert.match(paymentAttention.stdout, /Your Booking will be confirmed only after Mindbody checkout succeeds/);
    assert.match(failed.stdout, /Booking not completed/);
    assert.match(expired.stdout, /Booking not completed/);
    assert.match(stale.stdout, /Choose a new live time/); assert.match(stale.stdout, /Booking confirmed/); assert.match(stale.stdout, /17:00|5:00/); assert.match(stale.stdout, /data-review-start="2026-07-28T17:00:00.000Z"/);
    assert.match(sca.stdout, /Booking confirmed/); assert.match(sca.stdout, /Your Booking is confirmed/);
  } finally { server.closeAllConnections(); server.close(); }
});

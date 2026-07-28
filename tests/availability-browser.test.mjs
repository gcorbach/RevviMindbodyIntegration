import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";

const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

test("availability page covers live times, empty dates, and review responsively", { skip: !existsSync(edgePath) || process.env.RUN_BROWSER_TESTS !== "1" }, async (testContext) => {
  const source = readFileSync(new URL("../docs/catalogue/availability.html", import.meta.url), "utf8");
  const html = source.replace(
    "<script>",
    '<script>window.REVVI_CUSTOMER_TOKEN = "test-token"; window.REVVI_CATALOGUE_API_URL = "/functions/v1/booking-availability"; window.REVVI_TEST_RESPONSIVE = true;\n',
  );
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/functions/v1/booking-availability")) {
      const query = new URL(request.url, "http://localhost").searchParams;
      const empty = query.get("date") === "2026-07-29";
      const slot = { startTime: "2026-07-28T16:00:00.000Z", endTime: "2026-07-28T16:45:00.000Z", durationMinutes: 45, price: 120 };
      const body = {
        business: { displayName: "Revvi Sandbox Wellness", locationBrowserPath: "/locations" },
        location: { displayName: "Sandbox Location", timezone: "America/Los_Angeles" },
        service: { name: "Nutrition Consultation", durationMinutes: 45, price: 120 },
        availability: { state: empty ? "empty" : "available", selectedDate: query.get("date"), slots: empty ? [] : [slot], earliestNextAvailability: empty ? { date: "2026-07-30", startTime: "2026-07-30T16:00:00.000Z" } : null },
      };
      if (query.get("start")) body.review = { business: { displayName: "Revvi Sandbox Wellness" }, location: { displayName: "Sandbox Location" }, service: { name: "Nutrition Consultation", durationMinutes: 45, price: 120 }, startTime: slot.startTime, endTime: slot.endTime };
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(body)); return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const profile = mkdtempSync(join(tmpdir(), "revvi-edge-"));
  const launch = (query, size = "390,844") => spawnSync(edgePath, ["--headless=new", "--disable-gpu", `--window-size=${size}`, "--dump-dom", "--virtual-time-budget=1500", `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/?business=sandbox-wellness&location=sandbox-location&service=service-23&${query}`], { encoding: "utf8", timeout: 15000, windowsHide: true });
  try {
    const available = launch("date=2026-07-28");
    const desktop = launch("date=2026-07-28", "1440,900");
    const empty = launch("date=2026-07-29");
    const review = launch("date=2026-07-28&start=2026-07-28T16%3A00%3A00.000Z");
    for (const result of [available, desktop, empty, review]) {
      if (result.error && ["ETIMEDOUT", "ENOENT"].includes(result.error.code)) { testContext.skip(`Edge could not launch in this environment (${result.error.code}).`); return; }
      assert.equal(result.error, undefined, result.error?.message); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /data-responsive="true"/);
    }
    assert.match(available.stdout, /16:00|4:00/);
    assert.match(desktop.stdout, /Choose a time/); assert.match(desktop.stdout, /date-picker/);
    assert.match(empty.stdout, /No times are available on this date/); assert.match(empty.stdout, /Earliest next availability/); assert.match(empty.stdout, /2026-07-30/);
    assert.match(review.stdout, /Review your Booking details/); assert.match(review.stdout, /Nutrition Consultation/); assert.match(review.stdout, /45 minutes/); assert.match(review.stdout, /120/);
  } finally { server.closeAllConnections(); server.close(); rmSync(profile, { recursive: true, force: true }); }
});

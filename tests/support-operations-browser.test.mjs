import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const chromePath = process.env.CHROME_PATH || [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((path) => existsSync(path));

test("staff operations page covers queue, detail, and recorded resolution", { skip: !chromePath || process.env.RUN_BROWSER_TESTS !== "1" }, async (testContext) => {
  const source = readFileSync(new URL("../docs/support/operations.html", import.meta.url), "utf8");
  const interaction = `
    const choose = setInterval(() => {
      const button = document.querySelector('[data-support-item="ambiguous-item"]');
      if (!button) return;
      clearInterval(choose);
      button.click();
      const resolve = setInterval(() => {
        const form = document.querySelector('#resolution-form');
        if (!form || form.hidden) return;
        clearInterval(resolve);
        document.querySelector('#resolution').value = 'Reviewed duplicate Clients and recorded the canonical mapping.';
        form.requestSubmit();
      }, 25);
    }, 25);
  `;
  const html = source
    .replace("<script>", '<script>window.REVVI_STAFF_TOKEN = "test-staff-token"; window.REVVI_SUPPORT_API_URL = "/functions/v1/support-operations"; window.REVVI_TEST_RESPONSIVE = true;\n')
    .replace("</body>", `<script>${interaction}</script></body>`);

  const ambiguous = {
    id: "ambiguous-item",
    exceptionCategory: "ambiguous_client",
    supportStatus: "open",
    reason: "CLIENT_MATCH_AMBIGUOUS",
    createdAt: "2026-08-06T08:00:00.000Z",
    business: { id: "business-a", slug: "sandbox-wellness", displayName: "Revvi Sandbox Wellness" },
    bookingAttempt: { id: "attempt-a", correlationId: "18000000-0000-4100-8000-000000000001", locationName: "Sandbox Location", serviceName: "Nutrition Consultation", selectedStartTime: "2026-08-07T09:00:00.000Z", state: "failed", reconciliationAttempts: 0 },
    providerOperation: { category: "client_lookup", latencyMs: 87 },
    redactedErrorCategory: "CLIENT_MATCH_AMBIGUOUS",
    providerReferencePresence: { client: false, appointment: true, checkoutSale: false, checkoutTransactions: false },
    reconciliationHistory: [{ eventType: "reconciliation_uncertain", operation: "appointment_reconciliation", providerStatus: 503, errorCategory: "authoritative_read_unavailable", latencyMs: 502, createdAt: "2026-08-06T08:30:00.000Z" }],
    evidence: [{ eventType: "attempt_failed", operation: "client_lookup", errorCategory: "CLIENT_MATCH_AMBIGUOUS", latencyMs: 87, createdAt: "2026-08-06T08:00:00.000Z" }],
    alert: null,
  };
  const reconciliation = {
    ...ambiguous,
    id: "reconciliation-item",
    exceptionCategory: "reconciliation_failure",
    reason: "RECONCILIATION_EXHAUSTED",
    bookingAttempt: { ...ambiguous.bookingAttempt, id: "attempt-b", state: "unknown", reconciliationAttempts: 3 },
    providerOperation: { category: "appointment_reconciliation", latencyMs: 502 },
    redactedErrorCategory: "authoritative_read_unavailable",
  };
  const unknown = {
    ...reconciliation,
    id: "unknown-item",
    exceptionCategory: "unknown_outcome",
    reason: "provider_unknown",
    alert: { status: "open", createdAt: "2026-08-06T08:01:00.000Z" },
  };

  const server = createServer(async (request, response) => {
    if (request.url?.startsWith("/functions/v1/support-operations")) {
      response.setHeader("content-type", "application/json");
      if (request.method === "POST") {
        for await (const _chunk of request) { /* consume request body */ }
        response.end(JSON.stringify({ item: { ...ambiguous, supportStatus: "resolved", resolvedAt: "2026-08-06T09:00:00.000Z", resolutionSummary: "Reviewed duplicate Clients and recorded the canonical mapping." } }));
        return;
      }
      const itemId = new URL(request.url, "http://localhost").searchParams.get("item");
      response.end(JSON.stringify(itemId ? { item: ambiguous } : { items: [ambiguous, reconciliation, unknown] }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const profile = mkdtempSync(join(tmpdir(), "revvi-support-chrome-"));
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(chromePath, [
        "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
        "--window-size=390,844", "--dump-dom", "--virtual-time-budget=2500", `--user-data-dir=${profile}`,
        `http://127.0.0.1:${port}/?status=open`,
      ], { windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (value) => { if (settled) return; settled = true; clearTimeout(timeout); resolve({ ...value, stdout, stderr }); };
      const timeout = setTimeout(() => { child.kill(); const error = new Error("Chrome did not exit within 15000ms."); error.code = "ETIMEDOUT"; finish({ error, status: null }); }, 15_000);
      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      child.once("error", (error) => finish({ error, status: null }));
      child.once("close", (status) => finish({ error: undefined, status }));
    });
    if (result.error && ["ETIMEDOUT", "ENOENT"].includes(result.error.code)) { testContext.skip(`Chrome could not launch in this environment (${result.error.code}).`); return; }
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Booking support/);
    assert.match(result.stdout, /Ambiguous Client/);
    assert.match(result.stdout, /Repeated reconciliation failure/);
    assert.match(result.stdout, /Prompt unknown alert/);
    assert.match(result.stdout, /Nutrition Consultation/);
    assert.match(result.stdout, /client_lookup/);
    assert.match(result.stdout, /Reconciliation history/);
    assert.match(result.stdout, /authoritative_read_unavailable/);
    assert.match(result.stdout, /appointment/);
    assert.match(result.stdout, /Resolution recorded/);
    assert.match(result.stdout, /Reviewed duplicate Clients and recorded the canonical mapping/);
    assert.match(result.stdout, /data-responsive="true"/);
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

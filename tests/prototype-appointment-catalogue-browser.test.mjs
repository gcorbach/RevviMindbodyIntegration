import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import test from "node:test";

const chromePath = process.env.CHROME_PATH || [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((path) => existsSync(path));

test("customer catalogue page renders the live service journey in a browser", { skip: !chromePath || process.env.RUN_BROWSER_TESTS !== "1" }, async (testContext) => {
  const source = readFileSync(new URL("../docs/catalogue/catalogue.html", import.meta.url), "utf8");
  const html = source.replace(
    "<script>",
    '<script>window.REVVI_CUSTOMER_TOKEN = "test-token"; window.REVVI_CATALOGUE_API_URL = "/functions/v1/prototype-appointment-catalogue"; window.REVVI_TEST_RESPONSIVE = true;\n',
  );
  const server = createServer((request, response) => {
      if (request.url?.startsWith("/functions/v1/prototype-appointment-catalogue")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        business: { displayName: "Revvi Sandbox Wellness", locationBrowserPath: "/locations" },
        location: { displayName: "Sandbox Location" },
        services: [{ id: "service-23", name: "Nutrition Consultation", description: "A live service", durationMinutes: 45, price: null }],
      }));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const profile = mkdtempSync(join(tmpdir(), "revvi-chrome-"));
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(chromePath, [
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=390,844",
        "--dump-dom",
        "--virtual-time-budget=1500",
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${port}/?business=sandbox-wellness&location=sandbox-location`,
      ], { windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ...result, stdout, stderr });
      };
      const timeout = setTimeout(() => {
        child.kill();
        const error = new Error("Chrome did not exit within 15000ms.");
        error.code = "ETIMEDOUT";
        finish({ error, status: null });
      }, 15000);
      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      child.once("error", (error) => finish({ error, status: null }));
      child.once("close", (status) => finish({ error: undefined, status }));
    });

    if (result.error && ["ETIMEDOUT", "ENOENT"].includes(result.error.code)) {
      testContext.skip(`Chrome could not launch in this environment (${result.error.code}).`);
      return;
    }
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Revvi Sandbox Wellness/);
    assert.match(result.stdout, /Sandbox Location/);
    assert.match(result.stdout, /Nutrition Consultation/);
    assert.match(result.stdout, /Choose a time/);
    assert.match(result.stdout, /data-responsive="true"/);
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";

const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

test("customer catalogue page renders the live service journey in a browser", { skip: !existsSync(edgePath) || process.env.RUN_BROWSER_TESTS !== "1" }, async (testContext) => {
  const source = readFileSync(new URL("../docs/catalogue/catalogue.html", import.meta.url), "utf8");
  const html = source.replace(
    "<script>",
    '<script>window.REVVI_CUSTOMER_TOKEN = "test-token"; window.REVVI_CATALOGUE_API_URL = "/functions/v1/business-catalogue"; window.REVVI_TEST_RESPONSIVE = true;\n',
  );
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/functions/v1/business-catalogue")) {
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
  const profile = mkdtempSync(join(tmpdir(), "revvi-edge-"));
  try {
    const result = spawnSync(edgePath, [
      "--headless=new",
      "--disable-gpu",
      "--window-size=390,844",
      "--dump-dom",
      "--virtual-time-budget=1500",
      `--user-data-dir=${profile}`,
      `http://127.0.0.1:${port}/?business=sandbox-wellness&location=sandbox-location`,
    ], { encoding: "utf8", timeout: 15000, windowsHide: true });

    if (result.error && ["ETIMEDOUT", "ENOENT"].includes(result.error.code)) {
      testContext.skip(`Edge could not launch in this environment (${result.error.code}).`);
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

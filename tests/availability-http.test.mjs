import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runHttpTests = process.env.RUN_HTTP_TESTS === "1";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const supabaseCommand = process.env.SUPABASE_CLI_PATH || join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "supabase.cmd" : "supabase");
const localSupabase = {
  API_URL: process.env.SUPABASE_URL || "http://127.0.0.1:54321",
  ANON_KEY: process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

async function waitForFunction(url, functionProcess, diagnostics) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (functionProcess.exitCode !== null) throw new Error(`booking-availability function exited with ${functionProcess.exitCode}: ${diagnostics.join("")}`);
    try { const response = await fetch(url); if (response.status === 400 || response.status === 401) return; } catch { /* runtime is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("booking-availability function did not start");
}

test("HTTP availability and review use tenant policy and a controllable Mindbody double", { skip: !runHttpTests }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "revvi-availability-http-"));
  const envFile = join(temp, "functions.env");
  if (!localSupabase.SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the HTTP acceptance test.");
  writeFileSync(envFile, [
    "MINDBODY_API_KEY=stub-key", "MINDBODY_SANDBOX_SITE_ID=stub-site", "MINDBODY_BASE_URL=http://test-double.invalid/public/v6", "MINDBODY_ENVIRONMENT=sandbox", "MINDBODY_ALLOW_TEST_DOUBLE=true", "MINDBODY_TEST_DOUBLE_EMPTY_DATE=2026-07-29",
  ].join("\n"));
  const invocation = process.platform === "win32"
    ? { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", `& '${supabaseCommand}' functions serve booking-availability --env-file '${envFile}' --no-verify-jwt`] }
    : { command: supabaseCommand, args: ["functions", "serve", "booking-availability", "--env-file", envFile, "--no-verify-jwt"] };
  const functionProcess = spawn(invocation.command, invocation.args, { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const diagnostics = []; functionProcess.stdout.on("data", (chunk) => diagnostics.push(chunk.toString())); functionProcess.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));
  try {
    const functionUrl = `${localSupabase.API_URL}/functions/v1/booking-availability`;
    await waitForFunction(functionUrl, functionProcess, diagnostics);
    const unauthenticated = await fetch(`${functionUrl}?business=sandbox-wellness&location=sandbox-location&service=00000000-0000-0000-0000-000000000031&date=2026-07-28`);
    assert.equal(unauthenticated.status, 401);
    const email = `issue-12-http-${Date.now()}@example.test`; const password = "LocalSandbox123!";
    const serviceHeaders = { apikey: localSupabase.SERVICE_ROLE_KEY, Authorization: `Bearer ${localSupabase.SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
    const created = await fetch(`${localSupabase.API_URL}/auth/v1/admin/users`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { identity_provider: "memberstack", memberstack_id: "local-sandbox-member", memberstack_verified: true } }) });
    assert.equal(created.status, 200);
    const session = await fetch(`${localSupabase.API_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: localSupabase.ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(session.status, 200); const { access_token: accessToken } = await session.json();
    const headers = { Authorization: `Bearer ${accessToken}` };
    const available = await fetch(`${functionUrl}?business=sandbox-wellness&location=sandbox-location&service=00000000-0000-0000-0000-000000000031&date=2026-07-28`, { headers });
    const availableBody = await available.json();
    assert.equal(available.status, 200, JSON.stringify(availableBody)); assert.equal(availableBody.availability.state, "available"); assert.equal(availableBody.availability.slots.length, 1); assert.equal(availableBody.availability.slots[0].durationMinutes, 45); assert.equal(availableBody.availability.slots[0].price, 120); assert.doesNotMatch(JSON.stringify(availableBody), /mindbody_site_id|mindbody_session_type_id|Availabilities|Api-Key/);
    const unavailableLocation = await fetch(`${functionUrl}?business=sandbox-wellness&location=secondary-location&service=00000000-0000-0000-0000-000000000031&date=2026-07-28`, { headers });
    assert.equal(unavailableLocation.status, 404); assert.equal((await unavailableLocation.json()).code, "LOCATION_UNAVAILABLE");
    const unavailableService = await fetch(`${functionUrl}?business=sandbox-wellness&location=sandbox-location&service=00000000-0000-0000-0000-000000000099&date=2026-07-28`, { headers });
    assert.equal(unavailableService.status, 404); assert.equal((await unavailableService.json()).code, "SERVICE_UNAVAILABLE");
    const staleProviderContext = await fetch(`${functionUrl}?business=sandbox-wellness&location=secondary-location&service=00000000-0000-0000-0000-000000000031&date=2026-07-28`, { headers });
    assert.equal(staleProviderContext.status, 404); assert.equal((await staleProviderContext.json()).code, "LOCATION_UNAVAILABLE");
    const start = encodeURIComponent(availableBody.availability.slots[0].startTime);
    const review = await fetch(`${functionUrl}?business=sandbox-wellness&location=sandbox-location&service=00000000-0000-0000-0000-000000000031&date=2026-07-28&start=${start}`, { headers });
    const reviewBody = await review.json();
    assert.equal(review.status, 200); assert.deepEqual(reviewBody.review, { business: { displayName: "Revvi Sandbox Wellness" }, location: { displayName: "Sandbox Location" }, service: { name: "Nutrition Consultation", durationMinutes: 45, price: 120 }, startTime: "2026-07-28T16:00:00.000Z", endTime: "2026-07-28T16:45:00.000Z" });
    const empty = await fetch(`${functionUrl}?business=sandbox-wellness&location=sandbox-location&service=00000000-0000-0000-0000-000000000031&date=2026-07-29`, { headers });
    const emptyBody = await empty.json(); assert.equal(empty.status, 200); assert.equal(emptyBody.availability.selectedDate, "2026-07-29"); assert.equal(emptyBody.availability.state, "empty"); assert.equal(emptyBody.availability.earliestNextAvailability.date, "2026-07-30");
    const crossBusiness = await fetch(`${functionUrl}?business=sandbox-secondary&location=secondary-location&service=00000000-0000-0000-0000-000000000031&date=2026-07-28`, { headers });
    assert.equal(crossBusiness.status, 409); assert.equal((await crossBusiness.json()).code, "BUSINESS_UNAVAILABLE");
  } finally {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(functionProcess.pid), "/t", "/f"], { stdio: "ignore" }); else functionProcess.kill();
    spawnSync("docker", ["rm", "-f", "supabase_edge_runtime_revvi-booking"], { stdio: "ignore" });
    rmSync(temp, { recursive: true, force: true });
  }
});

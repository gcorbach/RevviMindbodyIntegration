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
const apiUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I4";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function nextTestDoubleSlot() {
  const start = new Date();
  start.setUTCHours(16, 0, 0, 0);
  if (start.getTime() <= Date.now() + 60 * 1000) start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString();
}

async function waitForFunction(url, process, diagnostics) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`booking-attempt function exited with ${process.exitCode}: ${diagnostics.join("")}`);
    try { const response = await fetch(url); if ([400, 401, 405].includes(response.status)) return; } catch { /* runtime is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`booking-attempt function did not start: ${diagnostics.join("")}`);
}

async function startBookingScenario({ memberstackId, clientMode = "existing", extraEnvironment = [], functionName = "booking-attempt" }) {
  const temp = mkdtempSync(join(tmpdir(), "revvi-booking-attempt-scenario-"));
  const envFile = join(temp, "functions.env");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the HTTP acceptance test.");
  const functionEnvironmentEntries = [
    "MINDBODY_API_KEY=stub-key", "MINDBODY_SANDBOX_SITE_ID=stub-site", "MINDBODY_BASE_URL=http://test-double.invalid/public/v6", "MINDBODY_ENVIRONMENT=sandbox", "MINDBODY_ALLOW_TEST_DOUBLE=true", `MINDBODY_TEST_DOUBLE_CLIENT_MODE=${clientMode}`, "MINDBODY_TEST_DOUBLE_EMPTY_DATE=2026-07-29", ...extraEnvironment,
  ];
  writeFileSync(envFile, functionEnvironmentEntries.join("\n"));
  const invocation = process.platform === "win32"
    ? { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", `& '${supabaseCommand}' functions serve ${functionName} --env-file '${envFile}' --no-verify-jwt`] }
    : { command: supabaseCommand, args: ["functions", "serve", functionName, "--env-file", envFile, "--no-verify-jwt"] };
  const functionEnvironment = Object.fromEntries(functionEnvironmentEntries.map((entry) => {
    const [name, ...value] = entry.split("=");
    return [name, value.join("=")];
  }));
  const functionProcess = spawn(invocation.command, invocation.args, { cwd: projectRoot, env: { ...process.env, ...functionEnvironment }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const diagnostics = []; functionProcess.stdout.on("data", (chunk) => diagnostics.push(chunk.toString())); functionProcess.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));
  const functionUrl = `${apiUrl}/functions/v1/${functionName}`;
  await waitForFunction(functionUrl, functionProcess, diagnostics);
  const runId = Date.now(); const email = `issue-14-${memberstackId}-${runId}@example.test`; const password = "LocalSandbox123!";
  const adminHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  const created = await fetch(`${apiUrl}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { first_name: "Issue", last_name: "Fourteen" }, app_metadata: { identity_provider: "memberstack", memberstack_id: memberstackId, memberstack_verified: true } }) });
  assert.equal(created.status, 200);
  const session = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(session.status, 200); const { access_token: accessToken } = await session.json();
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const request = { business: "sandbox-wellness", location: "sandbox-location", service: "00000000-0000-0000-0000-000000000031", startTime: nextTestDoubleSlot(), idempotencyKey: `issue-14-${memberstackId}-${runId}` };
  return {
    functionUrl, headers, request, adminHeaders, email,
    async stop() {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(functionProcess.pid), "/t", "/f"], { stdio: "ignore" });
      else if (functionProcess.exitCode === null) {
        functionProcess.kill();
        await new Promise((resolve) => functionProcess.once("exit", resolve));
      }
      spawnSync("docker", ["rm", "-f", "supabase_edge_runtime_revvi-booking"], { stdio: "ignore" });
      await new Promise((resolve) => setTimeout(resolve, 250));
      rmSync(temp, { recursive: true, force: true });
    },
  };
}

test("HTTP booking attempt completes an existing-client free Booking idempotently", { skip: !runHttpTests }, async () => {
  const temp = mkdtempSync(join(tmpdir(), "revvi-booking-attempt-http-"));
  const envFile = join(temp, "functions.env");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the HTTP acceptance test.");
  writeFileSync(envFile, [
    "MINDBODY_API_KEY=stub-key", "MINDBODY_SANDBOX_SITE_ID=stub-site", "MINDBODY_BASE_URL=http://test-double.invalid/public/v6", "MINDBODY_ENVIRONMENT=sandbox", "MINDBODY_ALLOW_TEST_DOUBLE=true", "MINDBODY_TEST_DOUBLE_EMPTY_DATE=2026-07-29",
  ].join("\n"));
  const invocation = process.platform === "win32"
    ? { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", `& '${supabaseCommand}' functions serve booking-attempt --env-file '${envFile}' --no-verify-jwt`] }
    : { command: supabaseCommand, args: ["functions", "serve", "booking-attempt", "--env-file", envFile, "--no-verify-jwt"] };
  const functionProcess = spawn(invocation.command, invocation.args, { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const diagnostics = []; functionProcess.stdout.on("data", (chunk) => diagnostics.push(chunk.toString())); functionProcess.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));
  try {
    const functionUrl = `${apiUrl}/functions/v1/booking-attempt`;
    await waitForFunction(functionUrl, functionProcess, diagnostics);
    const runId = Date.now(); const email = `issue-13-http-${runId}@example.test`; const memberstackId = "local-sandbox-member"; const password = "LocalSandbox123!";
    const adminHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
    for (const table of ["booking_attempts", "mindbody_client_mappings"]) {
      const cleaned = await fetch(`${apiUrl}/rest/v1/${table}?memberstack_id=eq.${memberstackId}`, { method: "DELETE", headers: { ...adminHeaders, Prefer: "return=minimal" } });
      assert.ok([200, 204].includes(cleaned.status), `${table} fixture cleanup failed: ${cleaned.status}`);
    }
    const created = await fetch(`${apiUrl}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { identity_provider: "memberstack", memberstack_id: memberstackId, memberstack_verified: true } }) });
    assert.equal(created.status, 200);
    const session = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(session.status, 200); const { access_token: accessToken } = await session.json();
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const request = { business: "sandbox-wellness", location: "sandbox-location", service: "00000000-0000-0000-0000-000000000031", startTime: nextTestDoubleSlot(), idempotencyKey: `issue-13-${Date.now()}` };
    const first = await fetch(functionUrl, { method: "POST", headers, body: JSON.stringify(request) }); const firstBody = await first.json();
    assert.equal(first.status, 200, JSON.stringify(firstBody)); assert.equal(firstBody.bookingAttempt.state, "confirmed"); assert.equal(firstBody.confirmation.message, "Your Booking is confirmed."); assert.match(firstBody.confirmation.providerAppointmentId, /^sandbox-appointment-/);
    const repeated = await fetch(functionUrl, { method: "POST", headers, body: JSON.stringify(request) }); const repeatedBody = await repeated.json();
    assert.equal(repeated.status, 200); assert.equal(repeatedBody.bookingAttempt.id, firstBody.bookingAttempt.id); assert.equal(repeatedBody.confirmation.providerAppointmentId, firstBody.confirmation.providerAppointmentId);
    const conflicting = await fetch(functionUrl, { method: "POST", headers, body: JSON.stringify({ ...request, startTime: "2026-07-30T17:00:00.000Z" }) }); const conflictingBody = await conflicting.json();
    assert.equal(conflicting.status, 409); assert.equal(conflictingBody.code, "IDEMPOTENCY_KEY_REUSED");
    const attempts = await fetch(`${apiUrl}/rest/v1/booking_attempts?select=id,state,business_id,memberstack_id,mindbody_client_id,mindbody_appointment_id&memberstack_id=eq.${encodeURIComponent(memberstackId)}`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } });
    assert.equal(attempts.status, 200); const attemptRows = await attempts.json(); const row = attemptRows.find((candidate) => candidate.id === firstBody.bookingAttempt.id);
    assert.deepEqual({ ...row, mindbody_client_id: undefined }, { id: firstBody.bookingAttempt.id, state: "confirmed", business_id: "00000000-0000-0000-0000-000000000011", memberstack_id: memberstackId, mindbody_client_id: undefined, mindbody_appointment_id: "sandbox-appointment-100" });
    assert.match(row.mindbody_client_id, /^sandbox-client-issue-13-http-/);
    const mappings = await fetch(`${apiUrl}/rest/v1/mindbody_client_mappings?select=business_id,memberstack_id,mindbody_client_id,verified_email&memberstack_id=eq.${memberstackId}`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } });
    assert.equal(mappings.status, 200); const mapping = (await mappings.json()).find((candidate) => candidate.business_id === "00000000-0000-0000-0000-000000000011"); assert.deepEqual({ ...mapping, mindbody_client_id: undefined }, { business_id: "00000000-0000-0000-0000-000000000011", memberstack_id: memberstackId, mindbody_client_id: undefined, verified_email: email }); assert.match(mapping.mindbody_client_id, /^sandbox-client-issue-13-http-/);
    const events = await fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=event_type,operation,metadata&booking_attempt_id=eq.${firstBody.bookingAttempt.id}&order=created_at.asc`, { headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } });
    assert.equal(events.status, 200); const eventRows = await events.json(); assert.deepEqual(eventRows.map((event) => `${event.event_type}:${event.operation}`), ["attempt_created:booking_attempt", "provider_revalidation_succeeded:booking_facts_revalidation", "provider_read_started:client_lookup", "provider_read_succeeded:client_lookup", "attempt_pending_checkout:state_transition", "provider_write_started:appointment_create", "attempt_confirmed:appointment_create", "duplicate_request:idempotency_replay"]); assert.doesNotMatch(JSON.stringify(eventRows), /Api-Key|FirstName|LastName|PAN|CVV|raw payment/i);
    const disabled = await fetch(functionUrl, { method: "POST", headers, body: JSON.stringify({ ...request, business: "sandbox-secondary", location: "secondary-location" }) });
    assert.equal(disabled.status, 409); assert.equal((await disabled.json()).code, "COMPLETION_UNAVAILABLE");
  } finally {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(functionProcess.pid), "/t", "/f"], { stdio: "ignore" });
    else if (functionProcess.exitCode === null) {
      functionProcess.kill();
      await new Promise((resolve) => functionProcess.once("exit", resolve));
    }
    spawnSync("docker", ["rm", "-f", "supabase_edge_runtime_revvi-booking"], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    rmSync(temp, { recursive: true, force: true });
  }
});

test("HTTP booking attempt creates a minimum Client when no exact match exists", { skip: !runHttpTests }, async () => {
  const memberstackId = "issue-14-missing-member";
  const scenario = await startBookingScenario({ memberstackId, clientMode: "none" });
  try {
    const secondaryMapping = await fetch(`${apiUrl}/rest/v1/mindbody_client_mappings`, { method: "POST", headers: scenario.adminHeaders, body: JSON.stringify({ business_id: "00000000-0000-0000-0000-000000000012", memberstack_id: memberstackId, mindbody_client_id: `sandbox-secondary-${Date.now()}`, verified_email: scenario.email }) });
    assert.equal(secondaryMapping.status, 201, await secondaryMapping.text());
    const response = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) }); const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.bookingAttempt.state, "confirmed");
    const repeated = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify({ ...scenario.request, idempotencyKey: `${scenario.request.idempotencyKey}-new-attempt` }) }); const repeatedBody = await repeated.json();
    assert.equal(repeated.status, 200, JSON.stringify(repeatedBody)); assert.equal(repeatedBody.bookingAttempt.state, "confirmed");
    const mappings = await fetch(`${apiUrl}/rest/v1/mindbody_client_mappings?select=business_id,memberstack_id,mindbody_client_id,verified_email&business_id=eq.00000000-0000-0000-0000-000000000011&memberstack_id=eq.${encodeURIComponent(memberstackId)}`, { headers: scenario.adminHeaders });
    assert.equal(mappings.status, 200); const mappingRows = await mappings.json(); assert.equal(mappingRows.length, 1); assert.equal(mappingRows[0].business_id, "00000000-0000-0000-0000-000000000011"); assert.equal(mappingRows[0].memberstack_id, memberstackId); assert.match(mappingRows[0].mindbody_client_id, /^sandbox-client-created-/); assert.equal(mappingRows[0].verified_email, scenario.email);
    const events = await fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=operation,event_type&booking_attempt_id=eq.${body.bookingAttempt.id}`, { headers: scenario.adminHeaders });
    assert.equal(events.status, 200); assert.equal((await events.json()).filter((event) => event.operation === "client_create" && event.event_type === "provider_write_started").length, 1);
  } finally { await scenario.stop(); }
});

test("HTTP booking attempt stops before provider writes for an ambiguous Client match", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({ memberstackId: "issue-14-ambiguous-member", clientMode: "ambiguous" });
  try {
    const response = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) }); const body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body)); assert.equal(body.code, "CLIENT_MATCH_AMBIGUOUS"); assert.equal(body.supportRequired, true); assert.doesNotMatch(JSON.stringify(body), /sandbox-client-10[01]/);
    const repeated = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) }); const repeatedBody = await repeated.json();
    assert.equal(repeated.status, 409, JSON.stringify(repeatedBody)); assert.equal(repeatedBody.code, "CLIENT_MATCH_AMBIGUOUS"); assert.equal(repeatedBody.bookingAttempt.id, body.bookingAttempt.id);
    const attempts = await fetch(`${apiUrl}/rest/v1/booking_attempts?select=id,state,mindbody_client_id,mindbody_appointment_id&memberstack_id=eq.issue-14-ambiguous-member`, { headers: scenario.adminHeaders });
    assert.equal(attempts.status, 200); const attemptRows = await attempts.json(); assert.deepEqual(attemptRows.map((row) => ({ state: row.state, mindbody_client_id: row.mindbody_client_id, mindbody_appointment_id: row.mindbody_appointment_id })), [{ state: "failed", mindbody_client_id: null, mindbody_appointment_id: null }]);
    const mappings = await fetch(`${apiUrl}/rest/v1/mindbody_client_mappings?memberstack_id=eq.issue-14-ambiguous-member`, { headers: scenario.adminHeaders });
    assert.equal(mappings.status, 200); assert.deepEqual(await mappings.json(), []);
    const support = await fetch(`${apiUrl}/rest/v1/booking_support_items?select=reason,business_id,booking_attempt_id&booking_attempt_id=eq.${attemptRows[0].id}`, { headers: scenario.adminHeaders });
    assert.equal(support.status, 200); assert.deepEqual((await support.json()).map((item) => item.reason), ["CLIENT_MATCH_AMBIGUOUS"]);
  } finally { await scenario.stop(); }
});

test("HTTP booking attempt reports provider Client creation failure without an appointment", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({ memberstackId: "issue-14-failure-member", clientMode: "none", extraEnvironment: ["MINDBODY_TEST_DOUBLE_CLIENT_CREATE_FAILURE=true"] });
  try {
    const response = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) }); const body = await response.json();
    assert.equal(response.status, 502, JSON.stringify(body)); assert.equal(body.code, "MINDBODY_UNAVAILABLE");
    const attempts = await fetch(`${apiUrl}/rest/v1/booking_attempts?select=state,mindbody_client_id,mindbody_appointment_id&memberstack_id=eq.issue-14-failure-member`, { headers: scenario.adminHeaders });
    assert.equal(attempts.status, 200); assert.deepEqual((await attempts.json()).map((row) => ({ state: row.state, mindbody_client_id: row.mindbody_client_id, mindbody_appointment_id: row.mindbody_appointment_id })), [{ state: "failed", mindbody_client_id: null, mindbody_appointment_id: null }]);
    const mappings = await fetch(`${apiUrl}/rest/v1/mindbody_client_mappings?memberstack_id=eq.issue-14-failure-member`, { headers: scenario.adminHeaders });
    assert.equal(mappings.status, 200); assert.deepEqual(await mappings.json(), []);
  } finally { await scenario.stop(); }
});

test("HTTP booking attempt retains its Client-resolution lock when mapping a created Client conflicts", { skip: !runHttpTests }, async () => {
  const memberstackId = "issue-14-created-conflict";
  const scenario = await startBookingScenario({ memberstackId, clientMode: "none", extraEnvironment: ["CLIENT_RESOLUTION_LOCK_WAIT_ATTEMPTS=1"] });
  try {
    const providerClientId = `sandbox-client-created-${scenario.email.replace(/[^a-z0-9]/gi, "-")}`;
    const conflictingMapping = await fetch(`${apiUrl}/rest/v1/mindbody_client_mappings`, {
      method: "POST",
      headers: scenario.adminHeaders,
      body: JSON.stringify({ business_id: "00000000-0000-0000-0000-000000000011", memberstack_id: "issue-14-existing-provider-owner", mindbody_client_id: providerClientId, verified_email: "existing-owner@example.test" }),
    });
    assert.equal(conflictingMapping.status, 201, await conflictingMapping.text());

    const first = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) }); const firstBody = await first.json();
    assert.equal(first.status, 409, JSON.stringify(firstBody)); assert.equal(firstBody.code, "CLIENT_MAPPING_CONFLICT"); assert.equal(firstBody.supportRequired, true);
    const retry = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify({ ...scenario.request, idempotencyKey: `${scenario.request.idempotencyKey}-retry` }) }); const retryBody = await retry.json();
    assert.equal(retry.status, 409, JSON.stringify(retryBody)); assert.equal(retryBody.code, "CLIENT_RESOLUTION_IN_PROGRESS");
    const locks = await fetch(`${apiUrl}/rest/v1/mindbody_client_resolution_locks?select=owner_id&business_id=eq.00000000-0000-0000-0000-000000000011&memberstack_id=eq.${memberstackId}`, { headers: scenario.adminHeaders });
    assert.equal(locks.status, 200); assert.equal((await locks.json()).length, 1);
    const attempts = await fetch(`${apiUrl}/rest/v1/booking_attempts?select=id&memberstack_id=eq.${memberstackId}`, { headers: scenario.adminHeaders });
    assert.equal(attempts.status, 200); const attemptRows = await attempts.json();
    const events = await Promise.all(attemptRows.map((attempt) => fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=operation,event_type&booking_attempt_id=eq.${attempt.id}`, { headers: scenario.adminHeaders }).then((response) => response.json())));
    assert.equal(events.flat().filter((event) => event.operation === "client_create" && event.event_type === "provider_write_started").length, 1);
  } finally { await scenario.stop(); }
});

test("HTTP booking attempt stops safely for a stale Client-resolution lock", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({ memberstackId: "issue-14-stale-lock-member", clientMode: "none" });
  try {
    const staleLock = await fetch(`${apiUrl}/rest/v1/mindbody_client_resolution_locks`, { method: "POST", headers: scenario.adminHeaders, body: JSON.stringify({ business_id: "00000000-0000-0000-0000-000000000011", memberstack_id: "issue-14-stale-lock-member", owner_id: "00000000-0000-0000-0000-000000000099", acquired_at: "2000-01-01T00:00:00.000Z" }) });
    assert.equal(staleLock.status, 201, await staleLock.text());
    const response = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) }); const body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body)); assert.equal(body.code, "CLIENT_RESOLUTION_STALE"); assert.equal(body.supportRequired, true);
    const support = await fetch(`${apiUrl}/rest/v1/booking_support_items?select=reason&booking_attempt_id=eq.${body.bookingAttempt.id}`, { headers: scenario.adminHeaders });
    assert.equal(support.status, 200); assert.deepEqual(await support.json(), [{ reason: "CLIENT_RESOLUTION_STALE" }]);
  } finally { await scenario.stop(); }
});

test("HTTP concurrent no-match Bookings create one Client mapping", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({ memberstackId: "issue-14-concurrent-member", clientMode: "none", extraEnvironment: ["MINDBODY_TEST_DOUBLE_CLIENT_CREATE_DELAY_MS=250"] });
  try {
    const responses = await Promise.all([1, 2].map((suffix) => fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify({ ...scenario.request, idempotencyKey: `${scenario.request.idempotencyKey}-${suffix}` }) })));
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200], JSON.stringify(bodies)); assert.deepEqual(bodies.map((body) => body.bookingAttempt.state).sort(), ["confirmed", "confirmed"]);
    const mappings = await fetch(`${apiUrl}/rest/v1/mindbody_client_mappings?select=mindbody_client_id&memberstack_id=eq.issue-14-concurrent-member`, { headers: scenario.adminHeaders });
    assert.equal(mappings.status, 200); assert.equal((await mappings.json()).length, 1);
    const attemptRows = await fetch(`${apiUrl}/rest/v1/booking_attempts?select=id&memberstack_id=eq.issue-14-concurrent-member`, { headers: scenario.adminHeaders });
    assert.equal(attemptRows.status, 200); const attemptIds = await attemptRows.json(); assert.equal(attemptIds.length, 2);
    const eventResponses = await Promise.all(attemptIds.map((attempt) => fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=operation,event_type&booking_attempt_id=eq.${attempt.id}`, { headers: scenario.adminHeaders })));
    assert.ok(eventResponses.every((response) => response.status === 200)); const eventRows = await Promise.all(eventResponses.map((response) => response.json()));
    assert.equal(eventRows.flat().filter((event) => event.operation === "client_create" && event.event_type === "provider_write_started").length, 1);
  } finally { await scenario.stop(); }
});

test("HTTP Booking revalidation returns refreshed availability when the selected time is taken", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({ memberstackId: "issue-15-stale-slot", clientMode: "none", extraEnvironment: ["MINDBODY_TEST_DOUBLE_STALE_ON_DATE_RANGE=true"] });
  try {
    const response = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(body.code, "SLOT_UNAVAILABLE");
    assert.equal(body.staleSelection.startTime, scenario.request.startTime);
    assert.equal(body.bookingAttempt.state, "failed");
    const selectedDate = scenario.request.startTime.slice(0, 10);
    assert.equal(body.bookingContext.selectedDate, selectedDate);
    assert.equal(body.availability.selectedDate, selectedDate);
    assert.deepEqual(body.availability.slots.map((slot) => slot.startTime), [`${selectedDate}T17:00:00.000Z`]);
    const repeated = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const repeatedBody = await repeated.json();
    assert.equal(repeated.status, 409, JSON.stringify(repeatedBody));
    assert.equal(repeatedBody.bookingAttempt.id, body.bookingAttempt.id);
    assert.deepEqual(repeatedBody.availability, body.availability);
    const attempts = await fetch(`${apiUrl}/rest/v1/booking_attempts?select=id,state,mindbody_client_id,mindbody_appointment_id&memberstack_id=eq.issue-15-stale-slot`, { headers: scenario.adminHeaders });
    assert.equal(attempts.status, 200); const attemptRows = await attempts.json(); const row = attemptRows.find((candidate) => candidate.id === body.bookingAttempt.id); assert.ok(row); assert.equal(row.state, "failed"); assert.match(row.mindbody_client_id, /^sandbox-client-created-/); assert.equal(row.mindbody_appointment_id, null);
    const events = await fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=event_type,operation,error_category&booking_attempt_id=eq.${body.bookingAttempt.id}&order=created_at.asc`, { headers: scenario.adminHeaders });
    assert.equal(events.status, 200); assert.deepEqual((await events.json()).map((event) => `${event.event_type}:${event.operation}:${event.error_category ?? ""}`), ["attempt_created:booking_attempt:", "provider_revalidation_succeeded:booking_facts_revalidation:", "provider_read_started:client_lookup:", "provider_read_succeeded:client_lookup:", "provider_write_started:client_create:", "provider_write_succeeded:client_create:", "attempt_pending_checkout:state_transition:", "provider_revalidation_rejected:booking_facts_revalidation:slot_unavailable", "attempt_failed:booking_attempt:slot_unavailable", "duplicate_request:idempotency_replay:"]);
  } finally { await scenario.stop(); }
});

test("HTTP duplicate submissions wait for one serialized provider write", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({ memberstackId: "issue-15-duplicate", clientMode: "none", extraEnvironment: ["MINDBODY_TEST_DOUBLE_CLIENT_CREATE_DELAY_MS=250", "MINDBODY_TEST_DOUBLE_APPOINTMENT_CREATE_DELAY_MS=250"] });
  try {
    const responses = await Promise.all([1, 2].map(() => fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) })));
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200], JSON.stringify(bodies));
    assert.equal(bodies[0].bookingAttempt.id, bodies[1].bookingAttempt.id);
    assert.equal(bodies[0].confirmation.providerAppointmentId, bodies[1].confirmation.providerAppointmentId);
    const events = await fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=event_type,operation&booking_attempt_id=eq.${bodies[0].bookingAttempt.id}`, { headers: scenario.adminHeaders });
    assert.equal(events.status, 200); const eventRows = await events.json();
    assert.equal(eventRows.filter((event) => event.event_type === "provider_write_started" && event.operation === "appointment_create").length, 1);
  } finally { await scenario.stop(); }
});

test("HTTP worker-style retry replays an unknown outcome without a second provider write", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({ memberstackId: "issue-15-unknown-retry", clientMode: "existing", extraEnvironment: ["MINDBODY_TEST_DOUBLE_APPOINTMENT_CREATE_FAILURE=true"] });
  try {
    const first = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const firstBody = await first.json();
    const retry = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const retryBody = await retry.json();
    assert.equal(first.status, 502, JSON.stringify(firstBody)); assert.equal(retry.status, 202, JSON.stringify(retryBody));
    assert.deepEqual(retryBody, firstBody);
    assert.equal(firstBody.bookingAttempt.id, retryBody.bookingAttempt.id); assert.equal(firstBody.bookingAttempt.state, "unknown");
    const events = await fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=event_type,operation&booking_attempt_id=eq.${firstBody.bookingAttempt.id}`, { headers: scenario.adminHeaders });
    assert.equal(events.status, 200); const eventRows = await events.json();
    assert.equal(eventRows.filter((event) => event.event_type === "provider_write_started" && event.operation === "appointment_create").length, 1);
    assert.equal(eventRows.filter((event) => event.event_type === "provider_write_unknown" && event.operation === "appointment_create").length, 1);
  } finally { await scenario.stop(); }
});

test("HTTP replay reconciles an unknown Booking to authoritative success without another write", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({
    memberstackId: "issue-16-authoritative-success",
    clientMode: "existing",
    extraEnvironment: [
      "MINDBODY_TEST_DOUBLE_APPOINTMENT_CREATE_FAILURE=true",
      "MINDBODY_TEST_DOUBLE_RECONCILIATION_OUTCOME=success",
      "MINDBODY_TEST_DOUBLE_UNIQUE_CLIENT=true",
    ],
  });
  try {
    scenario.request.startTime = nextTestDoubleSlot();
    const first = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const firstBody = await first.json();
    assert.equal(first.status, 502, JSON.stringify(firstBody));
    assert.equal(firstBody.bookingAttempt.state, "unknown");

    const replay = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const replayBody = await replay.json();
    assert.equal(replay.status, 200, JSON.stringify(replayBody));
    assert.equal(replayBody.bookingAttempt.state, "confirmed");
    assert.match(replayBody.confirmation.providerAppointmentId, /^sandbox-reconciled-appointment-/);

    const events = await fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=event_type,operation&booking_attempt_id=eq.${firstBody.bookingAttempt.id}`, { headers: scenario.adminHeaders });
    assert.equal(events.status, 200);
    const eventRows = await events.json();
    assert.equal(eventRows.filter((event) => event.event_type === "provider_write_started" && event.operation === "appointment_create").length, 1);
    assert.equal(eventRows.filter((event) => event.event_type === "reconciliation_confirmed" && event.operation === "appointment_reconciliation").length, 1);
  } finally { await scenario.stop(); }
});

test("HTTP Booking reports payment needs attention without confirming", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({
    memberstackId: "issue-16-payment-needs-attention",
    clientMode: "existing",
    extraEnvironment: ["MINDBODY_TEST_DOUBLE_APPOINTMENT_PAYMENT_NEEDS_ATTENTION=true", "MINDBODY_TEST_DOUBLE_UNIQUE_CLIENT=true"],
  });
  try {
    const response = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const body = await response.json();
    assert.equal(response.status, 202, JSON.stringify(body));
    assert.equal(body.code, "PAYMENT_NEEDS_ATTENTION");
    assert.equal(body.bookingAttempt.state, "payment_needs_attention");
  } finally { await scenario.stop(); }
});

test("HTTP reconciliation records authoritative absence before allowing a controlled next write", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({
    memberstackId: "issue-16-authoritative-absence",
    clientMode: "existing",
    extraEnvironment: [
      "MINDBODY_TEST_DOUBLE_APPOINTMENT_CREATE_FAILURE=true",
      "MINDBODY_TEST_DOUBLE_RECONCILIATION_OUTCOME=absence",
      "MINDBODY_TEST_DOUBLE_UNIQUE_CLIENT=true",
    ],
  });
  try {
    scenario.request.startTime = nextTestDoubleSlot();
    const first = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const firstBody = await first.json();
    assert.equal(first.status, 502, JSON.stringify(firstBody));

    const replay = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const replayBody = await replay.json();
    assert.equal(replay.status, 409, JSON.stringify(replayBody));
    assert.equal(replayBody.code, "BOOKING_NOT_COMPLETED");
    assert.equal(replayBody.bookingAttempt.state, "failed");

    const nextAction = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify({ ...scenario.request, idempotencyKey: `${scenario.request.idempotencyKey}-next` }) });
    assert.equal(nextAction.status, 502, await nextAction.text());
  } finally { await scenario.stop(); }
});

test("HTTP reconciliation remains resolving and opens support after bounded read exhaustion", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({
    memberstackId: "issue-16-reconciliation-exhausted",
    clientMode: "existing",
    extraEnvironment: [
      "MINDBODY_TEST_DOUBLE_APPOINTMENT_CREATE_FAILURE=true",
      "MINDBODY_TEST_DOUBLE_RECONCILIATION_OUTCOME=unknown",
      "BOOKING_RECONCILIATION_MAX_ATTEMPTS=2",
      "MINDBODY_TEST_DOUBLE_UNIQUE_CLIENT=true",
    ],
  });
  try {
    scenario.request.startTime = nextTestDoubleSlot();
    const first = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const firstBody = await first.json();
    assert.equal(first.status, 502, JSON.stringify(firstBody));
    const blocked = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify({ ...scenario.request, idempotencyKey: `${scenario.request.idempotencyKey}-unsafe-retry` }) });
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 202, JSON.stringify(blockedBody));
    assert.equal(blockedBody.bookingAttempt.id, firstBody.bookingAttempt.id);
    for (let attempt = 0; attempt < 1; attempt += 1) {
      const replay = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
      const replayBody = await replay.json();
      assert.equal(replay.status, 202, JSON.stringify(replayBody));
      assert.equal(replayBody.bookingAttempt.state, "unknown");
    }
    const support = await fetch(`${apiUrl}/rest/v1/booking_support_items?select=reason&booking_attempt_id=eq.${firstBody.bookingAttempt.id}`, { headers: scenario.adminHeaders });
    assert.equal(support.status, 200);
    assert.deepEqual((await support.json()).map((item) => item.reason).sort(), ["RECONCILIATION_EXHAUSTED", "provider_unknown"].sort());
    const events = await fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=event_type,operation,latency_ms&booking_attempt_id=eq.${firstBody.bookingAttempt.id}`, { headers: scenario.adminHeaders });
    assert.equal(events.status, 200);
    const eventRows = await events.json();
    assert.equal(eventRows.filter((event) => event.event_type === "provider_write_started" && event.operation === "appointment_create").length, 1);
    assert.equal(typeof eventRows.find((event) => event.event_type === "provider_write_unknown")?.latency_ms, "number");
  } finally { await scenario.stop(); }
});

test("HTTP expires an attempt before a provider write at the resumable-window boundary", { skip: !runHttpTests }, async () => {
  const scenario = await startBookingScenario({
    memberstackId: "issue-16-expired",
    clientMode: "existing",
    extraEnvironment: ["BOOKING_ATTEMPT_WINDOW_MS=0", "MINDBODY_TEST_DOUBLE_UNIQUE_CLIENT=true"],
  });
  try {
    scenario.request.startTime = nextTestDoubleSlot();
    const response = await fetch(scenario.functionUrl, { method: "POST", headers: scenario.headers, body: JSON.stringify(scenario.request) });
    const body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.equal(body.code, "BOOKING_ATTEMPT_EXPIRED");
    assert.equal(body.bookingAttempt.state, "expired");
    const events = await fetch(`${apiUrl}/rest/v1/booking_attempt_events?select=event_type,operation&booking_attempt_id=eq.${body.bookingAttempt.id}`, { headers: scenario.adminHeaders });
    assert.equal(events.status, 200);
    assert.equal((await events.json()).filter((event) => event.event_type === "provider_write_started").length, 0);
  } finally { await scenario.stop(); }
});

test("HTTP callback records correlation for an expired attempt without reviving it", { skip: !runHttpTests }, async () => {
  const booking = await startBookingScenario({
    memberstackId: "issue-16-delayed-callback",
    clientMode: "existing",
    extraEnvironment: ["BOOKING_ATTEMPT_WINDOW_MS=0", "MINDBODY_TEST_DOUBLE_UNIQUE_CLIENT=true"],
  });
  let callback;
  try {
    booking.request.startTime = nextTestDoubleSlot();
    const expiredResponse = await fetch(booking.functionUrl, { method: "POST", headers: booking.headers, body: JSON.stringify(booking.request) });
    const expiredBody = await expiredResponse.json();
    assert.equal(expiredBody.bookingAttempt.state, "expired");
    const attempts = await fetch(`${apiUrl}/rest/v1/booking_attempts?select=correlation_id,state&id=eq.${expiredBody.bookingAttempt.id}`, { headers: booking.adminHeaders });
    assert.equal(attempts.status, 200);
    const [attempt] = await attempts.json();
    await booking.stop();

    callback = await startBookingScenario({
      memberstackId: "issue-16-delayed-callback-receiver",
      functionName: "booking-attempt-callback",
      extraEnvironment: ["MINDBODY_CALLBACK_SECRET=test-callback-secret"],
    });
    const callbackResponse = await fetch(callback.functionUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-Revvi-Callback-Secret": "test-callback-secret" }, body: JSON.stringify({ correlationId: attempt.correlation_id }) });
    assert.equal(callbackResponse.status, 202, await callbackResponse.text());
    const after = await fetch(`${apiUrl}/rest/v1/booking_attempts?select=state&id=eq.${expiredBody.bookingAttempt.id}`, { headers: callback.adminHeaders });
    assert.equal(after.status, 200);
    assert.deepEqual(await after.json(), [{ state: "expired" }]);
  } finally {
    booking.stop();
    if (callback) await callback.stop();
  }
});

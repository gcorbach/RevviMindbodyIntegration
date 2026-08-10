import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runHttpTests = process.env.RUN_HTTP_TESTS === "1";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const supabaseCommand = process.env.SUPABASE_CLI_PATH || join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "supabase.cmd" : "supabase");
const apiUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const anonKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I4";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = "LocalSandbox123!";

async function waitForFunction(url, functionProcess, diagnostics) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (functionProcess.exitCode !== null) throw new Error(`support-operations function exited with ${functionProcess.exitCode}: ${diagnostics.join("")}`);
    const probe = spawnSync(process.execPath, ["-e", `fetch(${JSON.stringify(url)}, { headers: { apikey: ${JSON.stringify(anonKey)} } }).then((response) => console.log(response.status)).catch(() => process.exit(1))`], { encoding: "utf8", timeout: 1_500, windowsHide: true });
    if ([400, 401, 405].includes(Number(probe.stdout?.trim()))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`support-operations function did not start: ${diagnostics.join("")}`);
}

async function signIn(email) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.status === 200) return (await response.json()).access_token;
      const message = await response.text();
      if (response.status < 500) assert.equal(response.status, 200, message);
      lastError = new Error(message);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error("Local Auth did not become ready.");
}

async function createUser(adminHeaders, { email, appMetadata = {} }) {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: appMetadata }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

function authHeaders(token) {
  return { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function runPostgres(sql) {
  const result = spawnSync("docker", [
    "exec", "supabase_db_revvi-booking", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql,
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Postgres command failed.");
}

function attemptFixture({ id, businessId, memberstackId, state, correlationId, reconciliationAttempts = 0 }) {
  const businessOne = businessId === "00000000-0000-0000-0000-000000000011";
  return {
    id,
    business_id: businessId,
    memberstack_id: memberstackId,
    idempotency_key: id,
    location_id: businessOne ? "00000000-0000-0000-0000-000000000021" : "00000000-0000-0000-0000-000000000024",
    service_id: businessOne ? "00000000-0000-0000-0000-000000000031" : "00000000-0000-0000-0000-000000000033",
    business_name: businessOne ? "Revvi Sandbox Wellness" : "Revvi Sandbox Checkout",
    location_name: businessOne ? "Sandbox Location" : "Sandbox Checkout Location",
    location_timezone: "UTC",
    service_name: "Support fixture service",
    mindbody_location_id: "1",
    mindbody_session_type_id: "23",
    selected_start_time: "2026-08-07T09:00:00.000Z",
    selected_end_time: "2026-08-07T09:45:00.000Z",
    duration_minutes: 45,
    price: 120,
    state,
    completion_mode: businessOne ? "free_unpaid" : "mindbody_checkout",
    expires_at: "2026-08-07T09:15:00.000Z",
    correlation_id: correlationId,
    mindbody_client_id: "provider-client-must-not-leak",
    reconciliation_attempts: reconciliationAttempts,
  };
}

let scenario;

test.before(async () => {
  if (!runHttpTests) return;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the HTTP acceptance test.");
  const temp = mkdtempSync(join(tmpdir(), "revvi-support-operations-"));
  const envFile = join(temp, "functions.env");
  writeFileSync(envFile, "ALLOWED_ORIGINS=http://127.0.0.1:3000\nREVVI_APPOINTMENT_PROTOTYPE_ENABLED=true\n");
  const invocation = process.platform === "win32"
    ? { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", `& '${supabaseCommand}' functions serve prototype-appointment-support --env-file '${envFile}' --no-verify-jwt`] }
    : { command: supabaseCommand, args: ["functions", "serve", "prototype-appointment-support", "--env-file", envFile, "--no-verify-jwt"] };
  const functionProcess = spawn(invocation.command, invocation.args, { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
  const diagnostics = [];
  functionProcess.stdout.on("data", (chunk) => diagnostics.push(chunk.toString()));
  functionProcess.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));
  const functionUrl = `${apiUrl}/functions/v1/prototype-appointment-support`;
  await waitForFunction(functionUrl, functionProcess, diagnostics);

  const adminHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  scenario = { temp, functionProcess, functionUrl, diagnostics, adminHeaders };
  const runId = Date.now().toString(16).padStart(12, "0").slice(-12);
  const ids = {
    ambiguous: `18000000-0000-4000-8000-${runId}`,
    unknown: `18000000-0000-4001-8000-${runId}`,
    reconciliation: `18000000-0000-4002-8000-${runId}`,
    expired: `18000000-0000-4003-8000-${runId}`,
    secondary: `18000000-0000-4004-8000-${runId}`,
  };
  const correlations = Object.fromEntries(Object.entries(ids).map(([key, value], index) => [key, value.replace(`400${index}`, `410${index}`)]));
  const supportIds = Object.fromEntries(Object.entries(ids).map(([key, value], index) => [key, value.replace(`400${index}`, `420${index}`)]));
  const mismatchedSupportId = `18000000-0000-4205-8000-${runId}`;
  Object.assign(scenario, { ids, correlations, supportIds, mismatchedSupportId });

  const attempts = [
    attemptFixture({ id: ids.ambiguous, businessId: "00000000-0000-0000-0000-000000000011", memberstackId: `issue-18-ambiguous-${runId}`, state: "failed", correlationId: correlations.ambiguous }),
    attemptFixture({ id: ids.unknown, businessId: "00000000-0000-0000-0000-000000000011", memberstackId: `issue-18-unknown-${runId}`, state: "unknown", correlationId: correlations.unknown, reconciliationAttempts: 1 }),
    attemptFixture({ id: ids.reconciliation, businessId: "00000000-0000-0000-0000-000000000011", memberstackId: `issue-18-reconciliation-${runId}`, state: "unknown", correlationId: correlations.reconciliation, reconciliationAttempts: 3 }),
    attemptFixture({ id: ids.expired, businessId: "00000000-0000-0000-0000-000000000011", memberstackId: `issue-18-expired-${runId}`, state: "expired", correlationId: correlations.expired }),
    attemptFixture({ id: ids.secondary, businessId: "00000000-0000-0000-0000-000000000014", memberstackId: `issue-18-secondary-${runId}`, state: "failed", correlationId: correlations.secondary }),
  ];
  const attemptResponse = await fetch(`${apiUrl}/rest/v1/booking_attempts`, { method: "POST", headers: adminHeaders, body: JSON.stringify(attempts) });
  assert.equal(attemptResponse.status, 201, await attemptResponse.clone().text());

  const mismatchedItemResponse = await fetch(`${apiUrl}/rest/v1/booking_support_items`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      id: mismatchedSupportId,
      business_id: attempts[0].business_id,
      booking_attempt_id: ids.secondary,
      correlation_id: correlations.secondary,
      reason: "CLIENT_MAPPING_CONFLICT",
    }),
  });
  assert.equal(mismatchedItemResponse.status, 409, await mismatchedItemResponse.clone().text());

  const items = [
    { id: supportIds.ambiguous, business_id: attempts[0].business_id, booking_attempt_id: ids.ambiguous, correlation_id: correlations.ambiguous, reason: "CLIENT_MATCH_AMBIGUOUS" },
    { id: supportIds.unknown, business_id: attempts[1].business_id, booking_attempt_id: ids.unknown, correlation_id: correlations.unknown, reason: "provider_unknown" },
    { id: supportIds.reconciliation, business_id: attempts[2].business_id, booking_attempt_id: ids.reconciliation, correlation_id: correlations.reconciliation, reason: "RECONCILIATION_EXHAUSTED" },
    { id: supportIds.expired, business_id: attempts[3].business_id, booking_attempt_id: ids.expired, correlation_id: correlations.expired, reason: "EXPIRED_REQUIRES_ATTENTION" },
    { id: supportIds.secondary, business_id: attempts[4].business_id, booking_attempt_id: ids.secondary, correlation_id: correlations.secondary, reason: "CLIENT_MAPPING_CONFLICT" },
  ];
  const itemResponse = await fetch(`${apiUrl}/rest/v1/booking_support_items`, { method: "POST", headers: adminHeaders, body: JSON.stringify(items) });
  assert.equal(itemResponse.status, 201, await itemResponse.clone().text());

  const eventResponse = await fetch(`${apiUrl}/rest/v1/booking_attempt_events`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify([
      { business_id: attempts[0].business_id, booking_attempt_id: ids.ambiguous, correlation_id: correlations.ambiguous, event_type: "attempt_failed", operation: "client_lookup", error_category: "CLIENT_MATCH_AMBIGUOUS", latency_ms: 87, metadata: { raw_provider_body: { PAN: "4111111111111111", CVV: "123", secret: "must-not-leak" } } },
      { business_id: attempts[1].business_id, booking_attempt_id: ids.unknown, correlation_id: correlations.unknown, event_type: "provider_write_unknown", operation: "appointment_create", error_category: "provider_unknown", latency_ms: 10001, metadata: { provider_payload: "must-not-leak" } },
      { business_id: attempts[2].business_id, booking_attempt_id: ids.reconciliation, correlation_id: correlations.reconciliation, event_type: "reconciliation_exhausted", operation: "appointment_reconciliation", error_category: "authoritative_read_unavailable", latency_ms: 502, metadata: {} },
      { business_id: attempts[3].business_id, booking_attempt_id: ids.expired, correlation_id: correlations.expired, event_type: "attempt_expired", operation: "appointment_reconciliation", error_category: "attempt_expired", latency_ms: 20, metadata: {} },
    ]),
  });
  assert.equal(eventResponse.status, 201, await eventResponse.clone().text());

  const platformEmail = `issue-18-platform-${runId}@example.test`;
  const customerEmail = `issue-18-customer-${runId}@example.test`;
  const staffEmail = `issue-18-staff-${runId}@example.test`;
  const unassignedEmail = `issue-18-unassigned-${runId}@example.test`;
  const [platformUser, customerUser, staffUser, unassignedUser] = await Promise.all([
    createUser(adminHeaders, { email: platformEmail, appMetadata: { platform_operations: true } }),
    createUser(adminHeaders, { email: customerEmail, appMetadata: { identity_provider: "memberstack", memberstack_id: `issue-18-customer-${runId}`, memberstack_verified: true } }),
    createUser(adminHeaders, { email: staffEmail }),
    createUser(adminHeaders, { email: unassignedEmail }),
  ]);
  scenario.userIds = [platformUser.id, customerUser.id, staffUser.id, unassignedUser.id];
  runPostgres(`insert into public.business_staff_access (business_id, user_id) values ('00000000-0000-0000-0000-000000000011', '${staffUser.id}')`);

  Object.assign(scenario, {
    tokens: {
      customer: await signIn(customerEmail),
      staffA: await signIn(staffEmail),
      unassigned: await signIn(unassignedEmail),
      platform: await signIn(platformEmail),
    },
  });
});

test.after(async () => {
  if (!scenario) return;
  let cleanupError;
  try {
    const attemptIds = Object.values(scenario.ids).map((id) => `'${id}'`).join(",");
    const supportIds = [...Object.values(scenario.supportIds), scenario.mismatchedSupportId].map((id) => `'${id}'`).join(",");
    const userIds = (scenario.userIds ?? []).map((id) => `'${id}'`).join(",");
    runPostgres(`
      begin;
      set local session_replication_role = replica;
      delete from public.booking_support_alerts where booking_support_item_id in (${supportIds});
      delete from public.booking_support_actions where booking_support_item_id in (${supportIds});
      delete from public.booking_support_items where id in (${supportIds});
      delete from public.booking_attempt_events where booking_attempt_id in (${attemptIds});
      delete from public.booking_attempts where id in (${attemptIds});
      delete from public.business_staff_access where user_id in (${userIds});
      commit;
    `);
    for (const userId of scenario.userIds ?? []) {
      const response = await fetch(`${apiUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: scenario.adminHeaders });
      assert.ok([200, 204].includes(response.status), await response.text());
    }
  } catch (error) {
    cleanupError = error;
  } finally {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(scenario.functionProcess.pid), "/t", "/f"], { stdio: "ignore" });
    else if (scenario.functionProcess.exitCode === null && scenario.functionProcess.signalCode === null) process.kill(-scenario.functionProcess.pid);
    spawnSync("docker", ["rm", "-f", "supabase_edge_runtime_revvi-booking"], { stdio: "ignore" });
    rmSync(scenario.temp, { recursive: true, force: true });
  }
  if (cleanupError) throw cleanupError;
});

test("staff support HTTP authorizes only tenant staff or platform operations", { skip: !runHttpTests }, async () => {
  const unauthenticated = await fetch(scenario.functionUrl);
  assert.equal(unauthenticated.status, 401);
  for (const tokenName of ["customer", "unassigned"]) {
    const response = await fetch(scenario.functionUrl, { headers: authHeaders(scenario.tokens[tokenName]) });
    assert.equal(response.status, 403, tokenName);
  }

  const staffA = await fetch(scenario.functionUrl, { headers: authHeaders(scenario.tokens.staffA) });
  assert.equal(staffA.status, 200, await staffA.clone().text());
  const staffABody = await staffA.json();
  assert.deepEqual(new Set(staffABody.items.map((item) => item.business.slug)), new Set(["sandbox-wellness"]));
  assert.deepEqual(new Set(staffABody.items.map((item) => item.exceptionCategory)), new Set(["ambiguous_client", "unknown_outcome", "reconciliation_failure", "expired_attempt"]));

  const crossBusiness = await fetch(`${scenario.functionUrl}?business=sandbox-checkout`, { headers: authHeaders(scenario.tokens.staffA) });
  assert.equal(crossBusiness.status, 403);
  const platform = await fetch(scenario.functionUrl, { headers: authHeaders(scenario.tokens.platform) });
  assert.equal(platform.status, 200);
  assert.deepEqual(new Set((await platform.json()).items.map((item) => item.business.slug)), new Set(["sandbox-wellness", "sandbox-checkout"]));
});

test("staff support HTTP filters and returns redacted correlated evidence", { skip: !runHttpTests }, async () => {
  const filtered = await fetch(`${scenario.functionUrl}?status=open&category=ambiguous_client&correlation=${scenario.correlations.ambiguous}`, { headers: authHeaders(scenario.tokens.staffA) });
  assert.equal(filtered.status, 200, await filtered.clone().text());
  const filteredBody = await filtered.json();
  assert.equal(filteredBody.items.length, 1);
  assert.equal(filteredBody.items[0].bookingAttempt.correlationId, scenario.correlations.ambiguous);

  const detail = await fetch(`${scenario.functionUrl}?item=${scenario.supportIds.ambiguous}`, { headers: authHeaders(scenario.tokens.staffA) });
  assert.equal(detail.status, 200, await detail.clone().text());
  const body = await detail.json();
  assert.equal(body.item.bookingAttempt.state, "failed");
  assert.equal(body.item.providerOperation.category, "client_lookup");
  assert.equal(body.item.providerOperation.latencyMs, 87);
  assert.equal(body.item.redactedErrorCategory, "CLIENT_MATCH_AMBIGUOUS");
  assert.equal(body.item.evidence[0].eventType, "attempt_failed");
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /4111111111111111|CVV|must-not-leak|memberstack|provider-client/i);

  const customerRows = await fetch(`${apiUrl}/rest/v1/booking_support_items?select=id,business_id`, { headers: authHeaders(scenario.tokens.customer) });
  assert.ok([401, 403].includes(customerRows.status) || (await customerRows.json()).length === 0);
  const staffRows = await fetch(`${apiUrl}/rest/v1/booking_support_items?select=id,business_id`, { headers: authHeaders(scenario.tokens.staffA) });
  assert.equal(staffRows.status, 200, await staffRows.clone().text());
  assert.ok((await staffRows.json()).every((row) => row.business_id === "00000000-0000-0000-0000-000000000011"));
});

test("staff resolutions are auditable and cannot override authoritative Booking safety", { skip: !runHttpTests }, async () => {
  const resolveAmbiguous = await fetch(scenario.functionUrl, {
    method: "POST",
    headers: authHeaders(scenario.tokens.staffA),
    body: JSON.stringify({ itemId: scenario.supportIds.ambiguous, action: "resolve", resolution: "Reviewed duplicate Clients; canonical mapping recorded outside this action." }),
  });
  assert.equal(resolveAmbiguous.status, 200, await resolveAmbiguous.clone().text());
  assert.equal((await resolveAmbiguous.json()).item.supportStatus, "resolved");

  const resolveReconciliation = await fetch(scenario.functionUrl, {
    method: "POST",
    headers: authHeaders(scenario.tokens.staffA),
    body: JSON.stringify({ itemId: scenario.supportIds.reconciliation, action: "resolve", resolution: "Escalated to provider support; Booking attempt remains blocked." }),
  });
  assert.equal(resolveReconciliation.status, 200, await resolveReconciliation.clone().text());

  const resolveUnknown = await fetch(scenario.functionUrl, {
    method: "POST",
    headers: authHeaders(scenario.tokens.staffA),
    body: JSON.stringify({ itemId: scenario.supportIds.unknown, action: "resolve", resolution: "Assume it failed." }),
  });
  assert.equal(resolveUnknown.status, 409);
  assert.equal((await resolveUnknown.json()).code, "AUTHORITATIVE_EVIDENCE_REQUIRED");

  const expireWithoutEvidence = await fetch(`${apiUrl}/rest/v1/booking_attempts?id=eq.${scenario.ids.unknown}`, { method: "PATCH", headers: scenario.adminHeaders, body: JSON.stringify({ state: "expired" }) });
  assert.equal(expireWithoutEvidence.status, 204, await expireWithoutEvidence.clone().text());
  const resolveExpiredUnknown = await fetch(scenario.functionUrl, {
    method: "POST",
    headers: authHeaders(scenario.tokens.staffA),
    body: JSON.stringify({ itemId: scenario.supportIds.unknown, action: "resolve", resolution: "Time elapsed, but no authoritative result was established." }),
  });
  assert.equal(resolveExpiredUnknown.status, 409);
  assert.equal((await resolveExpiredUnknown.json()).code, "AUTHORITATIVE_EVIDENCE_REQUIRED");

  for (const action of ["confirm", "retry_provider_write"]) {
    const unsafe = await fetch(scenario.functionUrl, { method: "POST", headers: authHeaders(scenario.tokens.staffA), body: JSON.stringify({ itemId: scenario.supportIds.unknown, action }) });
    assert.equal(unsafe.status, 400);
  }

  const attempt = await fetch(`${apiUrl}/rest/v1/booking_attempts?id=eq.${scenario.ids.unknown}&select=state`, { headers: scenario.adminHeaders });
  assert.deepEqual(await attempt.json(), [{ state: "expired" }]);
  const actions = await fetch(`${apiUrl}/rest/v1/booking_support_actions?booking_support_item_id=in.(${scenario.supportIds.ambiguous},${scenario.supportIds.reconciliation})&select=id,action,resolution,actor_user_id&order=created_at.asc`, { headers: scenario.adminHeaders });
  assert.equal(actions.status, 200, await actions.clone().text());
  const actionRows = await actions.json();
  assert.equal(actionRows.length, 2);
  assert.ok(actionRows.every((row) => row.action === "resolve" && row.actor_user_id));
  const mutateHistory = await fetch(`${apiUrl}/rest/v1/booking_support_actions?id=eq.${actionRows[0].id}`, { method: "PATCH", headers: scenario.adminHeaders, body: JSON.stringify({ resolution: "Replace immutable staff history." }) });
  assert.equal(mutateHistory.status, 400);

  const alerts = await fetch(`${apiUrl}/rest/v1/booking_support_alerts?booking_support_item_id=eq.${scenario.supportIds.unknown}&select=business_id,correlation_id,exception_category,status`, { headers: scenario.adminHeaders });
  assert.equal(alerts.status, 200, await alerts.clone().text());
  assert.deepEqual(await alerts.json(), [{ business_id: "00000000-0000-0000-0000-000000000011", correlation_id: scenario.correlations.unknown, exception_category: "unknown_outcome", status: "open" }]);
});

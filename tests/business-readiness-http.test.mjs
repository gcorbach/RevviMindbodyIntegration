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
const anonKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = "LocalSandbox123!";

async function waitForFunction(url, functionProcess, diagnostics) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (functionProcess.exitCode !== null) throw new Error(`business-readiness function exited with ${functionProcess.exitCode}: ${diagnostics.join("")}`);
    const probe = spawnSync(process.platform === "win32" ? "curl.exe" : "curl", ["--silent", "--output", process.platform === "win32" ? "NUL" : "/dev/null", "--write-out", "%{http_code}", "--max-time", "2", "--header", `apikey: ${anonKey}`, url], { encoding: "utf8", windowsHide: true });
    if (Number(probe.stdout?.trim()) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`business-readiness function did not start: ${diagnostics.join("")}`);
}

async function signIn(email) {
  const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).access_token;
}

function authHeaders(token) {
  return { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function readinessAction(body) {
  return fetch(scenario.functionUrl, {
    method: "POST",
    headers: authHeaders(scenario.tokens.platform),
    body: JSON.stringify({ business: "sandbox-secondary", ...body }),
  });
}

const remainingChecks = [
  "sandbox_connectivity", "approved_locations", "approved_services", "live_availability",
  "client_mapping", "branding", "support_contact", "checkout_or_non_paid",
  "transactional_messages", "tenant_isolation", "booking_lifecycle", "controlled_booking",
];

async function recordPassingCheck(check, verifiedAt = new Date().toISOString()) {
  const response = await readinessAction({
    action: "record_check",
    check,
    passed: true,
    verifiedAt,
    evidenceRef: `issue-19/${check}`,
    details: check === "controlled_booking"
      ? { bookingAttemptId: "19000000-0000-4001-8000-000000000019" }
      : { verification: `${check} passed against the Mindbody sandbox.` },
    ...(check === "checkout_or_non_paid" ? { checkoutMode: "approved_non_paid", acceptedLimitations: ["Sandbox pilot uses the explicitly approved non-paid mode."] } : {}),
    ...(check === "transactional_messages" ? { transactionalMessageBehavior: "Mindbody sandbox messages are recorded but not treated as proof of production branding.", acceptedLimitations: ["Production notification branding remains subject to Mindbody approval."] } : {}),
  });
  assert.equal(response.status, 200, `${check}: ${await response.clone().text()}`);
  return response.json();
}

function runPostgres(sql) {
  const result = spawnSync("docker", ["exec", "supabase_db_revvi-booking", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Postgres command failed.");
}

let scenario;

test.before(async () => {
  if (!runHttpTests) return;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the HTTP acceptance test.");
  const temp = mkdtempSync(join(tmpdir(), "revvi-business-readiness-"));
  const envFile = join(temp, "functions.env");
  writeFileSync(envFile, [
    "ALLOWED_ORIGINS=http://127.0.0.1:3000",
    "MINDBODY_API_KEY=stub-key",
    "MINDBODY_SANDBOX_SITE_ID=stub-site",
    "MINDBODY_BASE_URL=http://test-double.invalid/public/v6",
    "MINDBODY_ALLOW_TEST_DOUBLE=true",
  ].join("\n"));
  const invocation = process.platform === "win32"
    ? { command: process.execPath, args: [join(projectRoot, "node_modules", "supabase", "dist", "supabase.js"), "functions", "serve", "business-readiness", "--env-file", envFile, "--no-verify-jwt"] }
    : { command: supabaseCommand, args: ["functions", "serve", "business-readiness", "--env-file", envFile, "--no-verify-jwt"] };
  const functionProcess = spawn(invocation.command, invocation.args, { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
  const diagnostics = [];
  functionProcess.stdout.on("data", (chunk) => diagnostics.push(chunk.toString()));
  functionProcess.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));
  const functionUrl = `${apiUrl}/functions/v1/business-readiness`;
  await waitForFunction(functionUrl, functionProcess, diagnostics);

  const runId = Date.now();
  const platformEmail = `issue-19-platform-${runId}@example.test`;
  const tenantStaffEmail = `issue-19-tenant-staff-${runId}@example.test`;
  const customerEmail = `issue-19-customer-${runId}@example.test`;
  const customerMemberstackId = `issue-19-customer-${runId}`;
  const adminHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" };
  scenario = { temp, functionProcess, functionUrl, diagnostics, adminHeaders, userIds: [] };
  const createUser = (email, appMetadata = {}) => fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true, app_metadata: appMetadata }),
  });
  const [platformResponse, tenantStaffResponse, customerResponse] = await Promise.all([
    createUser(platformEmail, { platform_operations: true }),
    createUser(tenantStaffEmail),
    createUser(customerEmail, { identity_provider: "memberstack", memberstack_id: customerMemberstackId, memberstack_verified: true }),
  ]);
  assert.equal(platformResponse.status, 200, await platformResponse.clone().text());
  assert.equal(tenantStaffResponse.status, 200, await tenantStaffResponse.clone().text());
  assert.equal(customerResponse.status, 200, await customerResponse.clone().text());
  const platformUser = await platformResponse.json();
  const tenantStaffUser = await tenantStaffResponse.json();
  const customerUser = await customerResponse.json();
  scenario.userIds = [platformUser.id, tenantStaffUser.id, customerUser.id];
  runPostgres(`insert into public.business_staff_access (business_id, user_id) values ('00000000-0000-0000-0000-000000000012', '${tenantStaffUser.id}')`);
  runPostgres(`
    update public.businesses
    set status = 'pending', booking_enabled = false, completion_mode = 'free_unpaid'
    where id = '00000000-0000-0000-0000-000000000012';
    insert into public.business_services (id, business_id, location_id, display_name_override, enabled)
    values ('19000000-0000-4000-8000-000000000019', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000022', 'Pilot service', true)
    on conflict (id) do update set enabled = true;
    insert into public.business_service_provider_config (business_id, service_id, mindbody_session_type_id)
    values ('00000000-0000-0000-0000-000000000012', '19000000-0000-4000-8000-000000000019', '23')
    on conflict (business_id, service_id) do update set mindbody_session_type_id = excluded.mindbody_session_type_id;
    insert into public.memberstack_identity_allowlist (memberstack_id, source)
    values ('${customerMemberstackId}', 'sandbox_allowlist') on conflict (memberstack_id) do nothing;
    insert into public.business_customer_access (business_id, memberstack_id)
    values ('00000000-0000-0000-0000-000000000012', '${customerMemberstackId}') on conflict do nothing;
    insert into public.booking_attempts (
      id, business_id, memberstack_id, idempotency_key, location_id, service_id,
      business_name, location_name, location_timezone, service_name,
      mindbody_location_id, mindbody_session_type_id, selected_start_time,
      selected_end_time, duration_minutes, price, state, completion_mode,
      expires_at, correlation_id, mindbody_client_id, mindbody_appointment_id
    ) values (
      '19000000-0000-4001-8000-000000000019', '00000000-0000-0000-0000-000000000012',
      'issue-19-controlled-booking', 'issue-19-controlled-booking',
      '00000000-0000-0000-0000-000000000022', '19000000-0000-4000-8000-000000000019',
      'Revvi Sandbox Secondary', 'Secondary Location', 'UTC', 'Pilot service',
      '2', '23', '2026-08-07T10:00:00.000Z', '2026-08-07T10:45:00.000Z', 45, 120,
      'confirmed', 'free_unpaid', '2026-08-07T10:15:00.000Z',
      '19000000-0000-4002-8000-000000000019', 'sandbox-client', 'sandbox-booking'
    ) on conflict (id) do nothing;
    insert into public.booking_attempt_events (business_id, booking_attempt_id, correlation_id, event_type, operation)
    values
      ('00000000-0000-0000-0000-000000000012', '19000000-0000-4001-8000-000000000019', '19000000-0000-4002-8000-000000000019', 'attempt_created', 'booking_attempt'),
      ('00000000-0000-0000-0000-000000000012', '19000000-0000-4001-8000-000000000019', '19000000-0000-4002-8000-000000000019', 'provider_revalidation_succeeded', 'booking_facts_revalidation'),
      ('00000000-0000-0000-0000-000000000012', '19000000-0000-4001-8000-000000000019', '19000000-0000-4002-8000-000000000019', 'provider_write_started', 'appointment_create'),
      ('00000000-0000-0000-0000-000000000012', '19000000-0000-4001-8000-000000000019', '19000000-0000-4002-8000-000000000019', 'attempt_confirmed', 'appointment_create');
  `);
  const platformToken = await signIn(platformEmail);
  const tenantStaffToken = await signIn(tenantStaffEmail);
  const customerToken = await signIn(customerEmail);
  Object.assign(scenario, {
    temp,
    functionProcess,
    functionUrl,
    diagnostics,
    adminHeaders,
    customerMemberstackId,
    bookingAttemptUrl: `${apiUrl}/functions/v1/booking-attempt`,
    tokens: {
      platform: platformToken,
      tenantStaff: tenantStaffToken,
      customer: customerToken,
    },
  });
});

test.after(async () => {
  if (!scenario) return;
  try {
    runPostgres(`
      begin;
      set local session_replication_role = replica;
      delete from public.business_pilot_readiness_actions where business_id = '00000000-0000-0000-0000-000000000012';
      delete from public.business_pilot_readiness_checks where business_id = '00000000-0000-0000-0000-000000000012';
      update public.business_pilot_readiness set status = 'draft', checkout_mode = null, transactional_message_behavior = null, accepted_limitations = '[]'::jsonb, site_activation_fingerprint = null, responsible_staff_actor = null, activated_at = null, deactivated_at = null, deactivation_reason = null where business_id = '00000000-0000-0000-0000-000000000012';
      delete from public.booking_attempt_events where booking_attempt_id in ('19000000-0000-4001-8000-000000000019', '19000000-0000-4003-8000-000000000019');
      delete from public.booking_attempts where id = '19000000-0000-4001-8000-000000000019';
      delete from public.booking_attempts where id = '19000000-0000-4003-8000-000000000019';
      delete from public.business_customer_access where business_id = '00000000-0000-0000-0000-000000000012' and memberstack_id = '${scenario.customerMemberstackId ?? "setup-incomplete"}';
      delete from public.memberstack_identity_allowlist where memberstack_id = '${scenario.customerMemberstackId ?? "setup-incomplete"}';
      delete from public.business_service_provider_config where service_id = '19000000-0000-4000-8000-000000000019';
      delete from public.business_services where id = '19000000-0000-4000-8000-000000000019';
      update public.business_provider_config set mindbody_site_id = '__MINDBODY_SANDBOX_SITE_ID__' where business_id = '00000000-0000-0000-0000-000000000012';
      update public.businesses set status = 'disabled', booking_enabled = false, completion_mode = 'disabled', provider_environment = 'sandbox' where id = '00000000-0000-0000-0000-000000000012';
      commit;
    `);
    if (scenario.userIds.length) runPostgres(`delete from public.business_staff_access where user_id in (${scenario.userIds.map((id) => `'${id}'`).join(",")})`);
    for (const userId of scenario.userIds) await fetch(`${apiUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: scenario.adminHeaders });
  } finally {
    scenario.functionProcess.stdout.destroy();
    scenario.functionProcess.stderr.destroy();
    if (process.platform === "win32") {
      spawnSync("docker", ["rm", "-f", "supabase_edge_runtime_revvi-booking"], { stdio: "ignore" });
      spawnSync("taskkill", ["/pid", String(scenario.functionProcess.pid), "/t", "/f"], { stdio: "ignore", timeout: 5_000, windowsHide: true });
    }
    else if (scenario.functionProcess.exitCode === null && scenario.functionProcess.signalCode === null) process.kill(-scenario.functionProcess.pid);
    scenario.functionProcess.unref();
    if (process.platform !== "win32") spawnSync("docker", ["rm", "-f", "supabase_edge_runtime_revvi-booking"], { stdio: "ignore" });
    rmSync(scenario.temp, { recursive: true, force: true });
  }
});

test("platform operations can inspect sandbox pilot readiness but tenant staff cannot", { skip: !runHttpTests }, async () => {
  const unauthenticated = await fetch(`${scenario.functionUrl}?business=sandbox-secondary`);
  assert.equal(unauthenticated.status, 401);

  const tenantStaff = await fetch(`${scenario.functionUrl}?business=sandbox-secondary`, { headers: authHeaders(scenario.tokens.tenantStaff) });
  assert.equal(tenantStaff.status, 403);

  const platform = await fetch(`${scenario.functionUrl}?business=sandbox-secondary`, { headers: authHeaders(scenario.tokens.platform) });
  assert.equal(platform.status, 200, await platform.clone().text());
  const body = await platform.json();
  assert.equal(body.business.slug, "sandbox-secondary");
  assert.equal(body.readiness.environment, "sandbox");
  assert.equal(body.readiness.status, "draft");
  assert.deepEqual(body.readiness.checks, []);
});

test("sandbox pilot activation is blocked until every readiness gate has evidence", { skip: !runHttpTests }, async () => {
  const response = await readinessAction({ action: "activate" });
  assert.equal(response.status, 409, await response.clone().text());
  const body = await response.json();
  assert.equal(body.code, "READINESS_GATES_INCOMPLETE");
  assert.deepEqual(new Set(body.missingChecks), new Set([
    "site_activation", "sandbox_connectivity", "approved_locations", "approved_services",
    "live_availability", "client_mapping", "branding", "support_contact",
    "checkout_or_non_paid", "transactional_messages", "tenant_isolation",
    "booking_lifecycle", "controlled_booking",
  ]));
});

test("platform operations can record tenant-scoped sandbox Site Activation evidence", { skip: !runHttpTests }, async () => {
  const response = await readinessAction({
    action: "record_check",
    check: "site_activation",
    passed: true,
    verifiedAt: new Date().toISOString(),
    evidenceRef: "mindbody-sandbox-activation/issue-19",
    details: { verification: "Revvi API key authorised for the sandbox Site." },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.readiness.checks.map((check) => check.name), ["site_activation"]);
  assert.equal(body.readiness.checks[0].evidenceRef, "mindbody-sandbox-activation/issue-19");
  assert.equal(body.readiness.responsibleStaffActor, scenario.userIds[0]);
  assert.doesNotMatch(JSON.stringify(body), /site_activation_fingerprint|__MINDBODY_SANDBOX_SITE_ID__/i);
});

test("passing checkout and transactional-message evidence requires its approval metadata", { skip: !runHttpTests }, async () => {
  const checkout = await readinessAction({
    action: "record_check", check: "checkout_or_non_paid", passed: true,
    verifiedAt: new Date().toISOString(), evidenceRef: "issue-19/invalid-checkout", details: { verification: "missing mode" },
  });
  assert.equal(checkout.status, 400, await checkout.clone().text());
  assert.equal((await checkout.json()).code, "INVALID_READINESS_EVIDENCE");

  const messages = await readinessAction({
    action: "record_check", check: "transactional_messages", passed: true,
    verifiedAt: new Date().toISOString(), evidenceRef: "issue-19/invalid-messages", details: { verification: "missing behaviour" },
    transactionalMessageBehavior: "   ",
  });
  assert.equal(messages.status, 400, await messages.clone().text());
  assert.equal((await messages.json()).code, "INVALID_READINESS_EVIDENCE");
});

test("one Business becomes active only after every sandbox pilot check passes", { skip: !runHttpTests }, async () => {
  let body;
  for (const check of remainingChecks) body = await recordPassingCheck(check);
  assert.equal(body.readiness.status, "ready");
  assert.equal(body.readiness.checks.length, 13);
  assert.equal(body.readiness.transactionalMessageBehavior, "Mindbody sandbox messages are recorded but not treated as proof of production branding.");
  assert.deepEqual(body.readiness.acceptedLimitations, [
    "Sandbox pilot uses the explicitly approved non-paid mode.",
    "Production notification branding remains subject to Mindbody approval.",
  ]);

  const activated = await readinessAction({ action: "activate" });
  assert.equal(activated.status, 200, await activated.clone().text());
  body = await activated.json();
  assert.equal(body.readiness.status, "active");
  assert.equal(body.business.bookingEnabled, true);
  assert.equal(body.readiness.responsibleStaffActor, scenario.userIds[0]);
  assert.equal(body.readiness.actions.at(-1).action, "activated");

  const independent = await fetch(`${scenario.functionUrl}?business=sandbox-wellness`, { headers: authHeaders(scenario.tokens.platform) });
  assert.equal(independent.status, 200, await independent.clone().text());
  assert.equal((await independent.json()).readiness.status, "active");
});

test("an incident disables new Booking attempts, preserves history, and requires re-verification", { skip: !runHttpTests }, async () => {
  const disabled = await readinessAction({ action: "deactivate", reason: "incident: sandbox validation drift" });
  assert.equal(disabled.status, 200, await disabled.clone().text());
  const disabledBody = await disabled.json();
  assert.equal(disabledBody.readiness.status, "disabled");
  assert.equal(disabledBody.business.bookingEnabled, false);
  assert.equal(disabledBody.readiness.deactivationReason, "incident: sandbox validation drift");
  assert.equal(disabledBody.readiness.bookingAttemptHistory.confirmed, 1);
  assert.equal(disabledBody.readiness.actions.at(-1).action, "deactivated");

  const booking = await fetch(scenario.bookingAttemptUrl, {
    method: "POST",
    headers: authHeaders(scenario.tokens.customer),
    body: JSON.stringify({
      business: "sandbox-secondary",
      location: "secondary-location",
      service: "19000000-0000-4000-8000-000000000019",
      startTime: "2026-08-07T16:00:00.000Z",
      idempotencyKey: `issue-19-disabled-${Date.now()}`,
    }),
  });
  assert.equal(booking.status, 409, await booking.clone().text());
  assert.equal((await booking.json()).code, "BUSINESS_UNAVAILABLE");

  const reenable = await readinessAction({ action: "activate" });
  assert.equal(reenable.status, 409, await reenable.clone().text());
  assert.equal((await reenable.json()).missingChecks.length, 13);
});

test("a changed Mindbody sandbox Site Activation automatically revokes the tenant pilot", { skip: !runHttpTests }, async () => {
  await recordPassingCheck("site_activation");
  for (const check of remainingChecks) await recordPassingCheck(check);
  const reactivated = await readinessAction({ action: "activate" });
  assert.equal(reactivated.status, 200, await reactivated.clone().text());

  runPostgres(`update public.business_provider_config set mindbody_site_id = 'changed-sandbox-site' where business_id = '00000000-0000-0000-0000-000000000012'`);
  const response = await fetch(`${scenario.functionUrl}?business=sandbox-secondary`, { headers: authHeaders(scenario.tokens.platform) });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.readiness.status, "disabled");
  assert.equal(body.business.bookingEnabled, false);
  assert.equal(body.readiness.deactivationReason, "site_activation_changed");
  assert.equal(body.readiness.bookingAttemptHistory.confirmed, 1);
  assert.equal(body.readiness.actions.at(-1).action, "site_activation_changed");
  assert.equal(body.readiness.actions.at(-1).actorUserId, null);
});

test("a failed tenant-isolation re-check disables only that Business and all gates must be re-verified", { skip: !runHttpTests }, async () => {
  await recordPassingCheck("site_activation");
  for (const check of remainingChecks) await recordPassingCheck(check);
  const activated = await readinessAction({ action: "activate" });
  assert.equal(activated.status, 200, await activated.clone().text());

  const failed = await readinessAction({
    action: "record_check",
    check: "tenant_isolation",
    passed: false,
    verifiedAt: new Date().toISOString(),
    evidenceRef: "issue-19/tenant-isolation-failure",
    details: { verification: "Cross-Business isolation suite failed." },
  });
  assert.equal(failed.status, 200, await failed.clone().text());
  const failedBody = await failed.json();
  assert.equal(failedBody.readiness.status, "disabled");
  assert.equal(failedBody.business.bookingEnabled, false);
  assert.equal(failedBody.readiness.deactivationReason, "readiness_check_failed:tenant_isolation");

  const immediateOverride = await readinessAction({ action: "activate" });
  assert.equal(immediateOverride.status, 409, await immediateOverride.clone().text());
  assert.equal((await immediateOverride.json()).missingChecks.length, 13);

  const independent = await fetch(`${scenario.functionUrl}?business=sandbox-wellness`, { headers: authHeaders(scenario.tokens.platform) });
  assert.equal(independent.status, 200);
  assert.equal((await independent.json()).business.bookingEnabled, true);
});

test("unresolved Booking outcomes block reactivation until authoritative evidence resolves them", { skip: !runHttpTests }, async () => {
  await recordPassingCheck("site_activation");
  for (const check of remainingChecks) await recordPassingCheck(check);
  runPostgres(`
    insert into public.booking_attempts (
      id, business_id, memberstack_id, idempotency_key, location_id, service_id,
      business_name, location_name, location_timezone, service_name,
      mindbody_location_id, mindbody_session_type_id, selected_start_time,
      selected_end_time, duration_minutes, price, state, completion_mode,
      expires_at, correlation_id, mindbody_client_id
    ) values (
      '19000000-0000-4003-8000-000000000019', '00000000-0000-0000-0000-000000000012',
      'issue-19-unknown', 'issue-19-unknown',
      '00000000-0000-0000-0000-000000000022', '19000000-0000-4000-8000-000000000019',
      'Revvi Sandbox Secondary', 'Secondary Location', 'UTC', 'Pilot service',
      '2', '23', '2026-08-07T11:00:00.000Z', '2026-08-07T11:45:00.000Z', 45, 120,
      'unknown', 'free_unpaid', '2026-08-07T11:15:00.000Z',
      '19000000-0000-4004-8000-000000000019', 'sandbox-client'
    );
  `);

  const blocked = await readinessAction({ action: "activate" });
  assert.equal(blocked.status, 409, await blocked.clone().text());
  assert.equal((await blocked.json()).code, "UNRESOLVED_BOOKING_OUTCOMES");

  runPostgres(`update public.booking_attempts set state = 'confirmed', mindbody_appointment_id = 'authoritative-sandbox-booking' where id = '19000000-0000-4003-8000-000000000019'`);
  const activated = await readinessAction({ action: "activate" });
  assert.equal(activated.status, 200, await activated.clone().text());
  assert.equal((await activated.json()).readiness.status, "active");

  runPostgres(`update public.businesses set provider_environment = 'production' where id = '00000000-0000-0000-0000-000000000012'`);
  const drifted = await fetch(`${scenario.functionUrl}?business=sandbox-secondary`, { headers: authHeaders(scenario.tokens.platform) });
  assert.equal(drifted.status, 200, await drifted.clone().text());
  const driftedBody = await drifted.json();
  assert.equal(driftedBody.readiness.status, "disabled");
  assert.equal(driftedBody.business.bookingEnabled, false);
  assert.equal(driftedBody.readiness.deactivationReason, "provider_environment_changed");
  assert.equal(driftedBody.readiness.actions.at(-1).action, "provider_environment_changed");
});

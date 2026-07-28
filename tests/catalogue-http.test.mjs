import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runHttpTests = process.env.RUN_HTTP_TESTS === "1" && process.platform !== "win32";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const supabaseCommand = process.env.SUPABASE_CLI_PATH || join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "supabase.cmd" : "supabase");
const localSupabase = {
  API_URL: process.env.SUPABASE_URL || "http://127.0.0.1:54321",
  ANON_KEY: process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
};

function cliInvocation(args) {
  if (process.platform !== "win32") return { command: supabaseCommand, args, shell: false };
  return { command: "pnpm.cmd", args: ["supabase", ...args], shell: true };
}

async function waitForFunction(url, functionProcess, diagnostics) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (functionProcess.exitCode !== null) {
      throw new Error(`business-catalogue function exited with ${functionProcess.exitCode}: ${diagnostics.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.status === 401) return;
    } catch {
      // The function runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("business-catalogue function did not start");
}

test("HTTP catalogue acceptance uses local Postgres/RLS and a controllable Mindbody double", { skip: !runHttpTests }, async () => {
  let providerRequest;
  const provider = createServer((request, response) => {
    providerRequest = { siteId: request.headers.siteid, apiKey: request.headers["api-key"] };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(request.url?.startsWith("/site/locations")
      ? JSON.stringify({ Locations: [{ Id: 1, Name: "Clubville" }] })
      : JSON.stringify({ SessionTypes: [{ Id: 23, Name: "Nutrition Consultation", Description: "Stub live service", Duration: 45, OnlinePrice: 120 }] }));
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));

  const temp = mkdtempSync(join(tmpdir(), "revvi-catalogue-http-"));
  const envFile = join(temp, "functions.env");
  writeFileSync(envFile, [
    "MINDBODY_API_KEY=stub-key",
    "MINDBODY_SANDBOX_SITE_ID=stub-site",
    `MINDBODY_BASE_URL=http://127.0.0.1:${provider.address().port}`,
    "MINDBODY_ENVIRONMENT=sandbox",
    "MINDBODY_ALLOW_TEST_DOUBLE=true",
  ].join("\n"));
  const functionInvocation = process.platform === "win32"
    ? {
        command: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-Command", `& '${supabaseCommand}' functions serve business-catalogue --env-file '${envFile}' --no-verify-jwt`],
        shell: false,
      }
    : cliInvocation(["functions", "serve", "business-catalogue", "--env-file", envFile, "--no-verify-jwt"]);
  const functionProcess = spawn(functionInvocation.command, functionInvocation.args, {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: functionInvocation.shell,
  });
  const diagnostics = [];
  functionProcess.stdout.on("data", (chunk) => diagnostics.push(chunk.toString()));
  functionProcess.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));

  try {
    const functionUrl = `${localSupabase.API_URL}/functions/v1/business-catalogue`;
    await waitForFunction(functionUrl, functionProcess, diagnostics);
    const email = `issue-11-http-${Date.now()}@example.test`;
    const password = "LocalSandbox123!";
    const serviceHeaders = { apikey: localSupabase.SERVICE_ROLE_KEY, Authorization: `Bearer ${localSupabase.SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
    const created = await fetch(`${localSupabase.API_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { identity_provider: "memberstack", memberstack_id: "local-sandbox-member", memberstack_verified: true } }),
    });
    assert.equal(created.status, 200);

    const session = await fetch(`${localSupabase.API_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: localSupabase.ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(session.status, 200);
    const { access_token: accessToken } = await session.json();

    const response = await fetch(`${functionUrl}?business=sandbox-wellness&location=sandbox-location`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.business.slug, "sandbox-wellness");
    assert.equal(body.location.slug, "sandbox-location");
    assert.deepEqual(body.services[0], {
      id: "00000000-0000-0000-0000-000000000031",
      name: "Nutrition Consultation",
      description: "Stub live service",
      durationMinutes: 45,
      price: 120,
    });
    assert.deepEqual(providerRequest, { siteId: "stub-site", apiKey: "stub-key" });
  } finally {
    functionProcess.kill();
    provider.close();
    rmSync(temp, { recursive: true, force: true });
  }
});

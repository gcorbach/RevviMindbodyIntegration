import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runHttpTests = process.env.RUN_HTTP_TESTS === "1";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const apiUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const routeUrl = `${apiUrl}/functions/v1/prototype-appointment-sandbox-create-client`;

function prototypeProjects() {
  return readdirSync(tmpdir()).filter((name) => name.startsWith("revvi-appointment-prototype-")).sort();
}

async function waitForStatus(predicate) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(routeUrl, { signal: AbortSignal.timeout(1_000) });
      if (predicate(response.status)) return response.status;
    } catch (error) {
      if (predicate(null)) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Appointment prototype launcher did not reach the expected lifecycle state.");
}

async function waitForContainerStop(diagnostics) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const inspect = spawnSync("docker", ["inspect", "--format", "{{.State.Running}}", "supabase_edge_runtime_revvi-booking"], { encoding: "utf8", windowsHide: true });
    if (inspect.status !== 0 || inspect.stdout.trim() === "false") return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const processes = process.platform === "win32"
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('supabase.exe', 'supabase-go.exe', 'node.exe', 'docker.exe') } | Select-Object ProcessId, ParentProcessId, Name, CommandLine | Format-List"], { encoding: "utf8", windowsHide: true }).stdout
    : spawnSync("ps", ["-ef"], { encoding: "utf8" }).stdout;
  throw new Error(`Appointment prototype Edge Runtime container did not stop: ${diagnostics.join("")}\nRemaining processes:\n${processes}`);
}

function prototypeProcesses(marker) {
  if (process.platform !== "win32") {
    return spawnSync("ps", ["-ef"], { encoding: "utf8" }).stdout.split("\n").filter((line) => line.includes(marker)).join("\n");
  }
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like ('*' + $env:REVVI_PROTOTYPE_PROCESS_MARKER + '*') } | Select-Object -ExpandProperty CommandLine"], {
    encoding: "utf8",
    env: { ...process.env, REVVI_PROTOTYPE_PROCESS_MARKER: marker },
    windowsHide: true,
  }).stdout.trim();
}

test("interactive launcher removes its route, process tree, and temporary project on shutdown", { skip: !runHttpTests }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), "revvi-appointment-launcher-test-"));
  const environmentFile = join(fixture, "functions.env");
  writeFileSync(environmentFile, [
    "MINDBODY_API_KEY=stub-key",
    "MINDBODY_SANDBOX_SITE_ID=stub-site",
    "MINDBODY_BASE_URL=http://test-double.invalid/public/v6",
    "MINDBODY_ENVIRONMENT=sandbox",
  ].join("\n"));

  const before = prototypeProjects();
  const launcher = spawn(process.execPath, ["tools/serve-appointment-prototype-functions.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, REVVI_APPOINTMENT_PROTOTYPE_ENV_FILE: environmentFile },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  const diagnostics = [];
  launcher.stdout.on("data", (chunk) => diagnostics.push(chunk.toString()));
  launcher.stderr.on("data", (chunk) => diagnostics.push(chunk.toString()));

  try {
    assert.equal(await waitForStatus((status) => status === 405), 405, diagnostics.join(""));
    const createdProjects = prototypeProjects().filter((name) => !before.includes(name));
    assert.equal(createdProjects.length, 1, `Expected one temporary prototype project, found ${createdProjects.join(", ")}`);
    const prototypeMarker = join(tmpdir(), createdProjects[0]);
    launcher.send({ type: "shutdown" });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Launcher did not stop: ${diagnostics.join("")}`)), 20_000);
      launcher.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
    await waitForStatus((status) => status !== 405);
    await waitForContainerStop(diagnostics);
    assert.equal(prototypeProcesses(prototypeMarker), "", "A native process still references the temporary prototype project.");
    assert.deepEqual(prototypeProjects(), before);
  } finally {
    if (launcher.exitCode === null && launcher.signalCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(launcher.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      else launcher.kill("SIGKILL");
    }
    spawnSync("docker", ["rm", "-f", "supabase_edge_runtime_revvi-booking"], { stdio: "ignore", windowsHide: true });
    rmSync(fixture, { recursive: true, force: true });
  }
});

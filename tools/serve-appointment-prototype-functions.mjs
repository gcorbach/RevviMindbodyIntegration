import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createAppointmentPrototypeProject, resolveBundledSupabaseBinary } from "./appointment-prototype-local-project.mjs";

const projectRoot = process.cwd();
const configuredEnvironment = process.env.REVVI_APPOINTMENT_PROTOTYPE_ENV_FILE;
const sourceEnvironment = configuredEnvironment
  ? (isAbsolute(configuredEnvironment) ? configuredEnvironment : resolve(projectRoot, configuredEnvironment))
  : join(projectRoot, "supabase", "functions", ".env.local");
if (!existsSync(sourceEnvironment)) {
  throw new Error("Create supabase/functions/.env.local from .env.local.example before serving the Appointment prototype.");
}

const prototypeProject = createAppointmentPrototypeProject(projectRoot);
const environmentFile = join(prototypeProject.path, "functions.env");
writeFileSync(environmentFile, `${readFileSync(sourceEnvironment, "utf8").trimEnd()}\nREVVI_APPOINTMENT_PROTOTYPE_ENABLED=true\n`);

const cli = resolveBundledSupabaseBinary(projectRoot);
const child = spawn(cli, ["functions", "serve", "--env-file", environmentFile, "--no-verify-jwt", "--workdir", prototypeProject.path], {
  cwd: projectRoot,
  detached: process.platform !== "win32",
  env: { ...process.env, REVVI_APPOINTMENT_PROTOTYPE_ENABLED: "true" },
  stdio: "inherit",
});

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let removal;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    removal = spawnSync("docker", ["rm", "-f", "supabase_edge_runtime_revvi-booking"], { encoding: "utf8", windowsHide: true });
    Atomics.wait(sleeper, 0, 0, 200);
  }
  const remaining = spawnSync("docker", ["inspect", "--format", "{{.State.Running}}", "supabase_edge_runtime_revvi-booking"], { encoding: "utf8", windowsHide: true });
  if (remaining.status === 0 && remaining.stdout.trim() === "true") {
    console.error("Appointment prototype Edge Runtime cleanup failed.", removal?.error ?? removal?.stderr ?? "");
  }
  prototypeProject.remove();
}

let requestedSignal;
function stop(signal) {
  if (requestedSignal) return;
  requestedSignal = signal;
  if (process.platform === "win32") {
    const killed = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { encoding: "utf8", windowsHide: true });
    if (killed.status !== 0) console.error("Appointment prototype process-tree cleanup failed.", killed.error ?? killed.stderr);
  } else {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => stop(signal));
}
process.on("message", (message) => {
  if (message?.type === "shutdown") stop("SIGTERM");
});

child.once("error", (error) => {
  cleanup();
  if (process.connected) process.disconnect();
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  cleanup();
  if (process.connected) process.disconnect();
  process.exitCode = requestedSignal ? 130 : code ?? 1;
});

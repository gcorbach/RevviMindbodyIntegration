import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAppointmentPrototypeProject, resolveBundledSupabaseBinary } from "../tools/appointment-prototype-local-project.mjs";

function localSupabaseEnvironment() {
  const cli = join(process.cwd(), "node_modules", "supabase", "dist", "supabase.js");
  const status = spawnSync(process.execPath, [cli, "status", "-o", "json"], { encoding: "utf8" });
  if (status.status !== 0) {
    throw new Error("The local Supabase stack must be running before the Appointment prototype suite can run.");
  }

  const values = JSON.parse(status.stdout);
  return {
    SUPABASE_URL: values.API_URL,
    SUPABASE_ANON_KEY: values.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
    SUPABASE_SECRET_KEY: values.SECRET_KEY,
  };
}

const localEnvironment = localSupabaseEnvironment();
const defaultTests = ["tests/prototype-appointment-mindbody-catalogue.test.mjs", "tests/prototype-appointment-mindbody-availability.test.mjs", "tests/prototype-appointment-catalogue-http.test.mjs", "tests/prototype-appointment-catalogue-browser.test.mjs", "tests/prototype-appointment-availability-http.test.mjs", "tests/prototype-appointment-availability-browser.test.mjs", "tests/prototype-appointment-attempt-http.test.mjs", "tests/prototype-appointment-support-http.test.mjs", "tests/prototype-appointment-support-browser.test.mjs", "tests/prototype-appointment-readiness-http.test.mjs", "tests/prototype-appointment-launcher-lifecycle.test.mjs"];
const selectedTests = process.argv.length > 2 ? process.argv.slice(2) : defaultTests;
const prototypeProject = createAppointmentPrototypeProject(process.cwd());

const cli = resolveBundledSupabaseBinary(process.cwd());
const wrapper = join(prototypeProject.path, process.platform === "win32" ? "supabase-prototype.cmd" : "supabase-prototype");
if (process.platform === "win32") {
  writeFileSync(wrapper, `@echo off\r\n"${cli}" %* --workdir "${prototypeProject.path}"\r\n`);
} else {
  writeFileSync(wrapper, `#!/bin/sh\nexec "${cli}" "$@" --workdir "${prototypeProject.path}"\n`);
  chmodSync(wrapper, 0o755);
}

let result;
try {
  result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...selectedTests], {
    env: {
      ...process.env,
      ...localEnvironment,
      SUPABASE_CLI_PATH: wrapper,
      RUN_HTTP_TESTS: "1",
      RUN_BROWSER_TESTS: "1",
    },
    stdio: "inherit",
  });
} finally {
  prototypeProject.remove();
}

process.exit(result.status ?? 1);

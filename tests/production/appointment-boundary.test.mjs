import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { appointmentPrototypeUnavailable } from "../../supabase/functions/_prototype/appointment/runtime.js";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const functionsRoot = resolve(projectRoot, "supabase/functions");
const legacyRoutes = [
  "booking-attempt",
  "booking-attempt-callback",
  "booking-availability",
  "business-catalogue",
  "business-readiness",
  "support-operations",
  "mindbody-sandbox-check",
  "mindbody-sandbox-create-client",
  "mindbody-sandbox-create-appointment",
];

function filesUnder(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => filesUnder(resolve(path, entry.name)));
}

test("Appointment routes are namespaced and guarded as a local-only prototype", () => {
  const functionNames = new Set(readdirSync(functionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  for (const route of legacyRoutes) assert.equal(functionNames.has(route), false, `legacy route ${route} must not exist`);

  const prototypeRoutes = [...functionNames].filter((name) => name.startsWith("prototype-appointment-"));
  assert.deepEqual(prototypeRoutes.sort(), [
    "prototype-appointment-attempt",
    "prototype-appointment-availability",
    "prototype-appointment-callback",
    "prototype-appointment-catalogue",
    "prototype-appointment-readiness",
    "prototype-appointment-sandbox-check",
    "prototype-appointment-sandbox-create",
    "prototype-appointment-sandbox-create-client",
    "prototype-appointment-support",
  ]);

  for (const route of prototypeRoutes) {
    const source = readFileSync(resolve(functionsRoot, route, "index.ts"), "utf8");
    assert.match(source, /appointmentPrototypeUnavailable\(\)/, `${route} must apply the local-only runtime guard`);
  }

  const runtimeGuard = readFileSync(resolve(functionsRoot, "_prototype/appointment/runtime.js"), "utf8");
  assert.match(runtimeGuard, /DENO_DEPLOYMENT_ID/);
  assert.match(runtimeGuard, /REVVI_APPOINTMENT_PROTOTYPE_ENABLED/);

  const config = readFileSync(resolve(projectRoot, "supabase/config.toml"), "utf8");
  for (const route of prototypeRoutes) {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(config, new RegExp(`\\[functions\\.${escapedRoute}\\]\\s+enabled = false`), `${route} must be excluded from deployment`);
  }
});

test("Appointment prototype runtime guard fails closed for deployed execution", () => {
  const deployed = appointmentPrototypeUnavailable({
    DENO_DEPLOYMENT_ID: "production-deployment",
    REVVI_APPOINTMENT_PROTOTYPE_ENABLED: "true",
  });
  assert.equal(deployed.status, 404);

  const disabledLocally = appointmentPrototypeUnavailable({});
  assert.equal(disabledLocally.status, 404);

  assert.equal(appointmentPrototypeUnavailable({ REVVI_APPOINTMENT_PROTOTYPE_ENABLED: "true" }), null);
});

test("production function sources cannot depend on Appointment operations or identifiers", () => {
  const productionRoots = readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("prototype-appointment-") && name !== "_prototype")
    .map((name) => resolve(functionsRoot, name));

  const forbidden = /\/appointment\/|AppointmentId|AppointmentUniqueId|mindbody_appointment/i;
  for (const file of productionRoots.flatMap(filesUnder)) {
    assert.doesNotMatch(readFileSync(file, "utf8"), forbidden, `${file} crosses the Appointment prototype boundary`);
  }
});

test("default tests and seeded readiness cannot present the Appointment prototype as production", () => {
  const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.test.includes("tests/production"), true);
  assert.equal(packageJson.scripts["test:prototype:appointment"].includes("run-appointment-prototype"), true);
  assert.equal(packageJson.scripts["prototype:appointment:functions"].includes("serve-appointment-prototype-functions"), true);

  const seed = readFileSync(resolve(projectRoot, "supabase/seed.sql"), "utf8");
  const prototypeSeed = seed.slice(seed.indexOf("Retained Appointment prototype fixtures"));
  assert.notEqual(prototypeSeed.length, seed.length, "prototype seed marker is required");
  assert.match(prototypeSeed, /status = 'disabled'/);
  assert.match(prototypeSeed, /appointment_prototype_only/);
  assert.doesNotMatch(prototypeSeed, /status = 'active'/);
});

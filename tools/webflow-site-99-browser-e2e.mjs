import { randomBytes } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createSite99Runner } from "./mindbody-site-99-e2e.mjs";
import {
  createSite99WebflowDemoHandler,
  createSite99WebflowDemoServer,
} from "./serve-site-99-webflow-demo.mjs";

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("Chrome is required for the live Webflow Site -99 browser E2E.");
  return executable;
}

function chromeProfile(executable) {
  const windowsChromeFromWsl = process.platform !== "win32" && executable.toLowerCase().endsWith(".exe");
  const path = windowsChromeFromWsl
    ? mkdtempSync("/mnt/c/Windows/Temp/revvi-live-browser-e2e-")
    : mkdtempSync(join(tmpdir(), "revvi-live-browser-e2e-"));
  return {
    path,
    argument: windowsChromeFromWsl
      ? execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim()
      : path,
  };
}

async function dumpAutomatedPage(executable, profile, url) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--run-all-compositor-stages-before-draw",
      "--window-size=1440,900",
      "--virtual-time-budget=120000",
      "--dump-dom",
      `--user-data-dir=${profile.argument}`,
      url,
    ], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function closeServer(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  if (process.env.MINDBODY_SANDBOX_WRITE_CONFIRM !== "BOOK_AND_CANCEL_SITE_-99") {
    throw new Error("Set the exact Site -99 write confirmation before running the live browser E2E.");
  }
  const executable = chromeExecutable();
  const profile = chromeProfile(executable);
  const demoBearerToken = [0, 1, 2].map(() => randomBytes(18).toString("base64url")).join(".");
  const runner = createSite99Runner({ exposeSyntheticClientReference: true });
  const handler = createSite99WebflowDemoHandler({ runner, demoBearerToken });
  const server = createSite99WebflowDemoServer({
    handler,
    demoBearerToken,
    automateBooking: true,
  });
  await new Promise((resolve) => server.listen(3000, "127.0.0.1", resolve));
  let primaryError = null;
  try {
    const result = await dumpAutomatedPage(
      executable,
      profile,
      "http://127.0.0.1:3000/",
    );
    if (result.status !== 0) {
      throw new Error(`Chrome exited before the live browser E2E completed (status ${result.status}).`);
    }
    const outcome = result.stdout.match(/data-live-browser-e2e="([^"]+)"/)?.[1] ?? "missing";
    const states = result.stdout.match(/data-live-browser-e2e-states="([^"]*)"/)?.[1] ?? "";
    if (outcome !== "passed") {
      throw new Error(`The live Webflow browser E2E did not pass (outcome ${outcome}, states ${states || "none"}).`);
    }
    process.stdout.write(`${JSON.stringify({
      result: "passed",
      mode: "webflow-browser-book-and-cleanup",
      states: states.split(",").filter(Boolean),
      cleanupConfirmed: true,
    }, null, 2)}\n`);
  } catch (error) {
    primaryError = error;
  } finally {
    let cleanupError = null;
    try {
      const cleanup = await handler.beginShutdown();
      if (cleanup.confirmed !== cleanup.attempted) {
        cleanupError = new Error(
          `The live browser E2E confirmed ${cleanup.confirmed} of ${cleanup.attempted} sandbox Booking cleanups.`,
        );
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      await closeServer(server);
      rmSync(profile.path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    if (primaryError && cleanupError) {
      throw new AggregateError([primaryError, cleanupError], "The browser journey failed and sandbox cleanup was not confirmed.");
    }
    if (cleanupError) throw cleanupError;
    if (primaryError) throw primaryError;
  }
}

await main();

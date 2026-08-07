import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "tests/catalogue-http.test.mjs", "tests/catalogue-browser.test.mjs", "tests/availability-http.test.mjs", "tests/availability-browser.test.mjs", "tests/booking-attempt-http.test.mjs", "tests/support-operations-http.test.mjs", "tests/support-operations-browser.test.mjs"], {
  env: {
    ...process.env,
    RUN_HTTP_TESTS: "1",
    RUN_BROWSER_TESTS: "1",
  },
  stdio: "inherit",
});

process.exit(result.status ?? 1);

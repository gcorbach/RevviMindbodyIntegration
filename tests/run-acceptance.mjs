import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--test", "tests/catalogue-http.test.mjs", "tests/catalogue-browser.test.mjs"], {
  env: {
    ...process.env,
    RUN_HTTP_TESTS: "1",
    RUN_BROWSER_TESTS: "1",
  },
  stdio: "inherit",
});

process.exit(result.status ?? 1);

import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await mkdir(new URL("../webflow/dist/", import.meta.url), { recursive: true });
await Promise.all([
  build({
    entryPoints: [fileURLToPath(new URL("../webflow/src/index.js", import.meta.url))],
    outfile: fileURLToPath(new URL("../webflow/dist/revvi-booking.js", import.meta.url)),
    bundle: true,
    format: "iife",
    globalName: "RevviBooking",
    legalComments: "none",
    platform: "browser",
    target: ["es2020"],
  }),
  cp(
    new URL("../webflow/src/revvi-booking.css", import.meta.url),
    new URL("../webflow/dist/revvi-booking.css", import.meta.url),
  ),
  cp(
    new URL("../webflow/assets/revvi-booking-rail.png", import.meta.url),
    new URL("../webflow/dist/revvi-booking-rail.png", import.meta.url),
  ),
  cp(
    new URL("../webflow/assets/CormorantGaramond-Regular.ttf", import.meta.url),
    new URL("../webflow/dist/CormorantGaramond-Regular.ttf", import.meta.url),
  ),
  cp(
    new URL("../webflow/hosting/index.html", import.meta.url),
    new URL("../webflow/dist/index.html", import.meta.url),
  ),
]);

// This repository's legacy Pages source is main:/, while the Actions deployment
// publishes webflow/dist. Keep both roots identical so either publisher serves
// the stable URLs embedded in Webflow. These root files are generated artifacts.
await Promise.all([
  "index.html",
  "revvi-booking.js",
  "revvi-booking.css",
  "revvi-booking-rail.png",
  "CormorantGaramond-Regular.ttf",
].map((name) => cp(
  new URL(`../webflow/dist/${name}`, import.meta.url),
  new URL(`../${name}`, import.meta.url),
)));

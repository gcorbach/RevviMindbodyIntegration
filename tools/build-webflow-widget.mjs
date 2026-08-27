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
]);

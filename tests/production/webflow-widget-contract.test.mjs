import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const embed = readFileSync(new URL("../../webflow/embed.html", import.meta.url), "utf8");
const history = readFileSync(new URL("../../webflow/history.html", import.meta.url), "utf8");
const demoDocs = readFileSync(new URL("../../docs/operations/webflow-site-99-demo.md", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const bundle = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");

test("the Webflow markup binds one stable Offer and preselected Location for the /book route", () => {
  assert.match(embed, /data-business-slug=/);
  assert.match(embed, /data-location-id=/);
  assert.match(embed, /data-offer-id=/);
  assert.match(embed, /data-booking-date/);
  assert.match(embed, /data-booking-location/);
  assert.match(embed, /data-booking-class-choices/);
  assert.match(embed, /data-booking-occurrences/);
  assert.match(embed, /data-availability-endpoint="SUPABASE_FUNCTIONS_URL\/offer-class-availability"/);
  assert.match(embed, /data-payment-completion-endpoint="SUPABASE_FUNCTIONS_URL\/complete-paid-booking"/);
  assert.doesNotMatch(embed, /data-location-select/i);
  assert.doesNotMatch(embed, /data-booking-session|data-session-/i);
});

test("the Webflow booking route uses the prototype-shaped class, time, and review steps", () => {
  assert.match(embed, /data-booking-step-panel="1"/);
  assert.match(embed, /data-booking-step-panel="2"/);
  assert.match(embed, /data-booking-step-panel="3"/);
  assert.match(embed, /data-booking-class-choices/);
  assert.match(embed, /data-booking-time-options/);
  assert.match(embed, /data-booking-continue/);
  assert.match(embed, /Choose your class/);
  assert.match(embed, /Pick a time that works/);
  assert.match(embed, /Review and reserve/);
  assert.doesNotMatch(embed, /data-booking-family-select/);
});

test("Booking confirmation renders outside the booking widget", () => {
  const widgetStart = embed.indexOf("<div\n  data-revvi-booking");
  const scriptStart = embed.indexOf("<script src=\"/assets/revvi-booking.js\"");
  const confirmation = embed.indexOf("data-booking-confirmation");

  assert.notEqual(widgetStart, -1);
  assert.notEqual(scriptStart, -1);
  assert.notEqual(confirmation, -1);
  assert.ok(confirmation < widgetStart || confirmation > scriptStart);
});

test("the Site -99 demo manifest names the currently observed Yoga Session Type", () => {
  assert.match(demoDocs, /programName":"Yoga","classDescriptionName":"Yoga","sessionTypeName":"Hatha Yoga"/);
  assert.match(demoDocs, /pricingOptionName":"5 Class Card"/);
  assert.match(demoDocs, /clears inherited provider variables before loading `webflow\/\.env`/);
});

test("the Site -99 dev command loads the ignored Webflow environment file", () => {
  const command = packageJson.scripts["demo:webflow:site99"];
  assert.match(command, /env -u MINDBODY_API_KEY/);
  assert.match(command, /-u MINDBODY_SANDBOX_PRODUCT_ID/);
  assert.match(command, /-u MINDBODY_SANDBOX_CLASS_FAMILIES_JSON/);
  assert.match(command, /--env-file=webflow\/\.env/);
});

test("the browser bundle contains no provider credential, raw-card, Appointment, or fulfilment-mode contract", () => {
  assert.doesNotMatch(bundle, /Api-Key|MINDBODY_API_KEY|service[_-]?role|SiteId/i);
  assert.doesNotMatch(bundle, /cardNumber|creditCard|\bpan\b|\bcvv\b|expiryMonth|expiryYear/i);
  assert.doesNotMatch(bundle, /appointment/i);
  assert.doesNotMatch(bundle, /fulfilmentMode|providerServiceProductId|clientServiceId/i);
});

test("the Webflow history component binds only Customer lifecycle endpoints and shows separate cancellation facts", () => {
  assert.match(history, /data-revvi-booking-history/);
  assert.match(history, /data-upcoming-endpoint="SUPABASE_FUNCTIONS_URL\/upcoming-bookings"/);
  assert.match(history, /data-cancellation-endpoint="SUPABASE_FUNCTIONS_URL\/cancel-booking"/);
  assert.match(history, /data-history-cancel/);
  assert.doesNotMatch(history, /provider[_-]|Mindbody|refund button|return sale/i);
});

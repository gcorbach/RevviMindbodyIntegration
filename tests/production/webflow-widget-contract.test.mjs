import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const embed = readFileSync(new URL("../../webflow/embed.html", import.meta.url), "utf8");
const bundle = readFileSync(new URL("../../webflow/dist/revvi-booking.js", import.meta.url), "utf8");

test("the Webflow markup binds one stable Offer and preselected Location without a Location picker", () => {
  assert.match(embed, /data-business-slug=/);
  assert.match(embed, /data-location-id=/);
  assert.match(embed, /data-offer-id=/);
  assert.match(embed, /data-booking-date/);
  assert.match(embed, /data-booking-location/);
  assert.match(embed, /data-booking-occurrences/);
  assert.match(embed, /data-availability-endpoint="SUPABASE_FUNCTIONS_URL\/offer-class-availability"/);
  assert.doesNotMatch(embed, /data-location-select|<select/i);
  assert.doesNotMatch(embed, /data-booking-session|data-session-/i);
});

test("the browser bundle contains no provider credential, raw-card, Appointment, or fulfilment-mode contract", () => {
  assert.doesNotMatch(bundle, /Api-Key|MINDBODY_API_KEY|service[_-]?role|SiteId/i);
  assert.doesNotMatch(bundle, /cardNumber|creditCard|\bpan\b|\bcvv\b|expiryMonth|expiryYear/i);
  assert.doesNotMatch(bundle, /appointment/i);
  assert.doesNotMatch(bundle, /fulfilmentMode|providerServiceProductId|clientServiceId/i);
});

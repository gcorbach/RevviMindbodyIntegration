import assert from "node:assert/strict";
import test from "node:test";
import { resolveBookingContext, applyAvailabilityLocation } from "../../webflow/src/booking-context.js";

const context = { businessSlug: "test-studio", locationId: "11111111-1111-4111-8111-111111111111",
  offerId: "22222222-2222-4222-8222-222222222222" };
const query = new URLSearchParams(context).toString();
function browser(path = `/book?${query}`) {
  const storage = new Map();
  const b = { location: { href: `https://revvi.test${path}` },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key) } };
  b.history = { replaceState: (_state, _title, url) => { b.location.href = url; } };
  return b;
}

test("a complete URL replaces all embed identifiers and canonicalizes UUIDs", () => {
  const result = resolveBookingContext({ ...context, businessSlug: "wrong-studio" }, browser());
  assert.deepEqual(result.context, context);
  assert.equal(result.dynamic, true);
});

test("partial, duplicate and malformed links never fall back to the embed or saved context", () => {
  for (const suffix of ["businessSlug=test-studio", `${query}&offerId=${context.offerId}`,
    query.replace("test-studio", "bad%2Fslug"), query.replace(context.offerId, "bad-id")]) {
    const b = browser();
    resolveBookingContext(context, b, 100);
    b.location.href = `https://revvi.test/book?${suffix}`;
    assert.throws(() => resolveBookingContext(context, b, 200));
    b.location.href = "https://revvi.test/book";
    assert.throws(() => resolveBookingContext(context, b, 300));
  }
});

test("login recovery restores one recent same-tab context to the URL, then clears after authentication", () => {
  const b = browser();
  resolveBookingContext({}, b, 100);
  b.location.href = "https://revvi.test/book?booking=payment-return#confirmation";
  const result = resolveBookingContext({}, b, 200);
  assert.deepEqual(result.context, context);
  assert.equal(new URL(b.location.href).searchParams.get("offerId"), context.offerId);
  assert.equal(new URL(b.location.href).searchParams.get("booking"), "payment-return");
  result.clearPending();
  b.location.href = "https://revvi.test/book";
  assert.throws(() => resolveBookingContext(context, b, 300));
});

test("expired login recovery and a bare /book never select the sandbox", () => {
  const b = browser();
  resolveBookingContext(context, b, 100);
  b.location.href = "https://revvi.test/book";
  assert.throws(() => resolveBookingContext(context, b, 31 * 60 * 1000));
  assert.throws(() => resolveBookingContext(context, browser("/book")));
});

test("storage denial does not break a complete booking URL; fixed embeds still work", () => {
  const b = browser();
  Object.defineProperty(b, "sessionStorage", { get: () => { throw Error("disabled"); } });
  assert.deepEqual(resolveBookingContext({}, b).context, context);
  assert.equal(resolveBookingContext(context, browser("/demo")).dynamic, false);
});

test("location metadata must match the selected location and contain a valid timezone", () => {
  const label = {};
  const root = { dataset: {}, querySelectorAll: () => [label] };
  const data = { location: { id: context.locationId, name: "Selected Studio", timezone: "America/New_York" },
    offer: { title: "Selected Offer" } };
  applyAvailabilityLocation(root, data, context, true);
  assert.equal(label.textContent, "Selected Studio");
  assert.equal(root.dataset.locationTimezone, "America/New_York");
  assert.throws(() => applyAvailabilityLocation(root, {}, context, true));
  assert.throws(() => applyAvailabilityLocation(root, { ...data, location: { ...data.location, id: "wrong" } }, context, true));
  assert.throws(() => applyAvailabilityLocation(root, { ...data, location: { ...data.location, timezone: "invalid" } }, context, true));
});

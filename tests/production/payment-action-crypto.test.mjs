import assert from "node:assert/strict";
import test from "node:test";

import {
  openPaymentActionToken,
  sealPaymentActionToken,
} from "../../supabase/functions/_shared/payment-action-crypto.js";

const options = Object.freeze({
  encryptionKeyHex: "01".repeat(32),
  keyVersion: "payment-action-v1",
});
const context = Object.freeze({
  businessId: "business-a",
  bookingId: "booking-a",
  attemptId: "attempt-a",
  route: "mindbody_alternative_payment",
});

test("provider access tokens are sealed with context-bound AES-GCM before persistence", async () => {
  const sealed = await sealPaymentActionToken("opaque-provider-token", context, options);
  assert.match(sealed.ciphertext, /^[A-Za-z0-9_-]+$/);
  assert.match(sealed.nonce, /^[A-Za-z0-9_-]+$/);
  assert.equal(sealed.keyVersion, "payment-action-v1");
  assert.doesNotMatch(JSON.stringify(sealed), /opaque-provider-token/);
  assert.equal(
    await openPaymentActionToken(sealed, context, options),
    "opaque-provider-token",
  );
});

test("a sealed token cannot be opened for another Booking attempt", async () => {
  const sealed = await sealPaymentActionToken("opaque-provider-token", context, options);
  await assert.rejects(
    openPaymentActionToken(sealed, { ...context, bookingId: "booking-b" }, options),
  );
});

test("a sealed token cannot be opened for another approved payment route", async () => {
  const sealed = await sealPaymentActionToken("opaque-provider-token", context, options);
  await assert.rejects(
    openPaymentActionToken(sealed, { ...context, route: "different-route" }, options),
  );
});

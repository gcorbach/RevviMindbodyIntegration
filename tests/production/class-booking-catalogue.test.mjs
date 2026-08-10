import assert from "node:assert/strict";
import test from "node:test";

import { createClassBookingCatalogue } from "../../supabase/functions/_shared/class-booking-catalogue.js";

test("a payment redirect and requires-action state use one atomic catalogue RPC", async () => {
  const calls = [];
  const supabase = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      return {
        data: {
          booking: {
            id: "booking-a", status: "requires_action",
            redirectUrl: "https://payments.example.test/continue",
          },
          attempt: { id: "attempt-a", status: "requires_action" },
        },
        error: null,
      };
    },
  };
  const catalogue = createClassBookingCatalogue(supabase, {});
  const result = await catalogue.completeAttempt({
    businessId: "business-a",
    bookingId: "booking-a",
    attemptId: "attempt-a",
    writeToken: "a".repeat(64),
    status: "requires_action",
    attemptStatus: "requires_action",
    paymentStatus: "requires_action",
    requiredAction: { url: "https://payments.example.test/continue" },
    paymentAction: {
      route: "mindbody_alternative_payment",
      ciphertext: "sealed",
      nonce: "0123456789abcdef",
      keyVersion: "payment-action-v1",
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "persist_class_booking_payment_action");
  assert.equal(result.booking.status, "requires_action");
  assert.equal(result.booking.redirectUrl, "https://payments.example.test/continue");
});

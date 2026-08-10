import assert from "node:assert/strict";
import test from "node:test";

import { handleClassPaidBookingCompletion } from "../../supabase/functions/_shared/class-paid-booking-handler.js";

const bookingId = "40000000-0000-4000-8000-000000000071";

function request(body = { bookingId }, overrides = {}) {
  return new Request("https://example.supabase.co/functions/v1/complete-paid-booking", {
    method: "POST",
    headers: {
      Authorization: "Bearer header.payload.signature",
      "Content-Type": "application/json",
      Origin: "https://www.revvi.co.za",
      "X-Request-Id": "request-40",
    },
    body: JSON.stringify(body),
    ...overrides,
  });
}

function dependencies(overrides = {}) {
  return {
    requestId: "request-40",
    allowedOrigins: new Set(["https://www.revvi.co.za"]),
    authorizeCustomer: async ({ browserToken }) => {
      assert.equal(browserToken, "header.payload.signature");
      return { customer: { id: "customer-a" } };
    },
    completeBooking: async (input) => {
      assert.deepEqual(input, { bookingId, customerId: "customer-a" });
      return {
        booking: {
          id: bookingId, status: "confirmed", paymentStatus: "paid",
          providerVisitId: "visit-1", providerSaleId: "sale-1",
          providerTransactionId: "transaction-1",
        },
        attempt: { id: "attempt-a", status: "confirmed" },
      };
    },
    logger: { error() {} },
    ...overrides,
  };
}

test("the authenticated payment return completes by server-owned Booking ID", async () => {
  const response = await handleClassPaidBookingCompletion(request(), dependencies());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      booking: {
        id: bookingId,
        status: "confirmed",
        paymentStatus: "paid",
        providerReferences: {
          visitId: "visit-1", saleId: "sale-1", transactionId: "transaction-1",
        },
      },
    },
    requestId: "request-40",
  });
});

test("unknown completion returns 202 and never claims callback success", async () => {
  const response = await handleClassPaidBookingCompletion(request(), dependencies({
    completeBooking: async () => ({
      booking: { id: bookingId, status: "unknown", paymentStatus: "unknown" },
      attempt: { id: "attempt-a", status: "unknown" },
    }),
  }));
  assert.equal(response.status, 202);
  const booking = (await response.json()).data.booking;
  assert.equal(booking.status, "unknown");
  assert.equal(booking.paymentStatus, "unknown");
});

test("browser-supplied payment, Client, provider token, or outcome facts are rejected", async () => {
  let writes = 0;
  const response = await handleClassPaidBookingCompletion(request({
    bookingId,
    paymentStatus: "paid",
    clientId: "attacker",
    accessToken: "opaque-provider-token",
  }), dependencies({ completeBooking: async () => { writes += 1; } }));
  assert.equal(response.status, 400);
  assert.equal(writes, 0);
});

test("missing authentication and unapproved origins stop before completion", async () => {
  let writes = 0;
  const deps = dependencies({ completeBooking: async () => { writes += 1; } });
  const loggedOut = request(undefined, {
    headers: { "Content-Type": "application/json", Origin: "https://www.revvi.co.za" },
  });
  assert.equal((await handleClassPaidBookingCompletion(loggedOut, deps)).status, 401);
  const wrongOrigin = request(undefined, {
    headers: { Authorization: "Bearer header.payload.signature", "Content-Type": "application/json", Origin: "https://attacker.example" },
  });
  assert.equal((await handleClassPaidBookingCompletion(wrongOrigin, deps)).status, 403);
  assert.equal(writes, 0);
});

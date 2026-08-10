import assert from "node:assert/strict";
import test from "node:test";

import {
  handleMindbodyWebhook,
  verifyMindbodyWebhook,
} from "../../supabase/functions/_shared/mindbody-webhook.js";

const encoder = new TextEncoder();
const signatureKey = "mindbody-signature-key-39";
const subscriptions = [{
  integrationId: "39000000-0000-4000-8000-000000000099",
  siteId: "-39001",
  signatureKey,
}];

async function sign(rawBody, key = signatureKey) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(rawBody)));
  return `sha256=${Buffer.from(digest).toString("base64")}`;
}

function payload(overrides = {}) {
  return JSON.stringify({
    messageId: "message-39",
    eventId: "classRosterBooking.cancelled",
    eventSchemaVersion: 1,
    eventInstanceOriginationDateTime: "2026-08-10T12:00:00Z",
    transactionKey: "revvi-transaction-39",
    eventData: {
      siteId: -39001,
      locationId: 7,
      classId: 771,
      classRosterBookingId: 991,
      clientId: "rss-39",
      clientUniqueId: 12339,
    },
    ...overrides,
  });
}

test("Mindbody webhook verification binds the exact raw body, key, Site, and typed facts", async () => {
  const rawBody = payload();
  const event = await verifyMindbodyWebhook(rawBody, await sign(rawBody), subscriptions);
  assert.equal(event.messageId, "message-39");
  assert.equal(event.eventId, "classRosterBooking.cancelled");
  assert.equal(event.providerSiteId, "-39001");
  assert.equal(event.providerClassId, "771");
  assert.equal(event.providerRosterBookingId, "991");
  assert.equal(event.providerClientId, "rss-39");
  assert.match(event.payloadFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(event.supported, true);

  await assert.rejects(
    verifyMindbodyWebhook(`${rawBody} `, await sign(rawBody), subscriptions),
    (error) => error.code === "WEBHOOK_SIGNATURE_INVALID",
  );
  const wrongSite = payload({ eventData: { siteId: -1, classId: 771 } });
  await assert.rejects(
    verifyMindbodyWebhook(wrongSite, await sign(wrongSite), subscriptions),
    (error) => error.code === "WEBHOOK_SITE_MISMATCH",
  );
});

test("the webhook receiver returns 2xx only after durable enqueue and reports duplicates", async () => {
  const rawBody = payload();
  let enqueueCalls = 0;
  const dependencies = {
    subscriptions,
    verify: verifyMindbodyWebhook,
    catalogue: {
      enqueue: async (event) => {
        enqueueCalls += 1;
        assert.equal(event.messageId, "message-39");
        return { id: "event-39", duplicate: enqueueCalls > 1 };
      },
    },
  };
  for (const expectedDuplicate of [false, true]) {
    const response = await handleMindbodyWebhook(new Request("https://api.example.test/functions/v1/webhooks/mindbody", {
      method: "POST",
      headers: { "X-Mindbody-Signature": await sign(rawBody) },
      body: rawBody,
    }), dependencies);
    assert.equal(response.status, 202);
    const envelope = await response.json();
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.queued, true);
    assert.equal(envelope.data.duplicate, expectedDuplicate);
  }
});

test("invalid webhook signatures cannot parse or enqueue provider payloads", async () => {
  let enqueued = false;
  const response = await handleMindbodyWebhook(new Request("https://api.example.test/functions/v1/webhooks/mindbody", {
    method: "POST",
    headers: { "X-Mindbody-Signature": await sign(payload(), "another-signature-key") },
    body: "not-json-and-not-authenticated",
  }), {
    subscriptions,
    verify: verifyMindbodyWebhook,
    catalogue: { enqueue: async () => { enqueued = true; } },
  });
  assert.equal(response.status, 401);
  assert.equal(enqueued, false);
});

const SUPPORTED_EVENTS = new Set([
  "classRosterBooking.created",
  "classRosterBookingStatus.updated",
  "classRosterBooking.cancelled",
  "classWaitlistRequest.created",
  "classWaitlistRequest.cancelled",
  "class.created",
  "class.updated",
  "class.cancelled",
  "classSchedule.updated",
  "classSchedule.cancelled",
  "clientSale.created",
]);
const encoder = new TextEncoder();

export class MindbodyWebhookError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MindbodyWebhookError";
    this.code = code;
    this.status = status;
  }
}

function text(value) {
  return value == null ? null : String(value).trim() || null;
}

function constantTimeEqual(left, right) {
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function signature(secret, rawBody) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `sha256=${btoa(binary)}`;
}

async function fingerprint(rawBody) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(rawBody)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyMindbodyWebhook(rawBody, suppliedSignature, subscriptions) {
  if (typeof rawBody !== "string" || rawBody.length === 0 || rawBody.length > 262_144) {
    throw new MindbodyWebhookError("WEBHOOK_BODY_INVALID", "Mindbody webhook body is invalid.");
  }
  if (typeof suppliedSignature !== "string" || !/^sha256=[A-Za-z0-9+/]+={0,2}$/.test(suppliedSignature)) {
    throw new MindbodyWebhookError("WEBHOOK_SIGNATURE_MISSING", "Mindbody webhook signature is required.", 401);
  }
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    throw new MindbodyWebhookError("WEBHOOK_NOT_CONFIGURED", "Mindbody webhook verification is not configured.", 503);
  }
  const matches = [];
  for (const subscription of subscriptions) {
    if (typeof subscription?.signatureKey !== "string" || subscription.signatureKey.length < 16
      || typeof subscription?.siteId !== "string" || subscription.siteId.length === 0) continue;
    const expected = await signature(subscription.signatureKey, rawBody);
    if (constantTimeEqual(expected, suppliedSignature)) matches.push(subscription);
  }
  if (matches.length === 0) {
    throw new MindbodyWebhookError("WEBHOOK_SIGNATURE_INVALID", "Mindbody webhook signature is invalid.", 401);
  }

  let envelope;
  try { envelope = JSON.parse(rawBody); } catch {
    throw new MindbodyWebhookError("WEBHOOK_JSON_INVALID", "Mindbody webhook JSON is invalid.");
  }
  const data = envelope?.eventData;
  const siteId = text(data?.siteId);
  const matchedSubscription = matches.find((subscription) => subscription.siteId === siteId);
  if (!matchedSubscription) {
    throw new MindbodyWebhookError("WEBHOOK_SITE_MISMATCH", "Mindbody webhook Site does not match its signature key.", 403);
  }
  const eventId = text(envelope?.eventId);
  const eventOccurredAt = text(
    envelope?.eventInstanceOriginationDateTime ?? envelope?.eventInstanceOriginationDate,
  );
  if (!eventId || !data || typeof data !== "object" || Array.isArray(data)
    || Number(envelope?.eventSchemaVersion) !== 1
    || !eventOccurredAt || Number.isNaN(new Date(eventOccurredAt).getTime())) {
    throw new MindbodyWebhookError("WEBHOOK_CONTRACT_INVALID", "Mindbody webhook facts are invalid.");
  }
  const payloadFingerprint = await fingerprint(rawBody);
  return Object.freeze({
    messageId: text(envelope.messageId) ?? `fingerprint:${payloadFingerprint}`,
    payloadFingerprint,
    eventId,
    supported: SUPPORTED_EVENTS.has(eventId),
    eventSchemaVersion: 1,
    eventOccurredAt: new Date(eventOccurredAt).toISOString(),
    transactionKey: text(envelope.transactionKey),
    providerSiteId: siteId,
    providerLocationId: text(data.locationId),
    providerClassId: text(data.classId),
    providerClientId: text(data.clientId),
    providerClientUniqueId: text(data.clientUniqueId),
    providerRosterBookingId: text(data.classRosterBookingId),
    providerWaitlistEntryId: text(data.classWaitlistRequestId ?? data.waitlistEntryId ?? data.id),
    providerSaleId: text(data.saleId),
    subscription: Object.freeze({
      integrationId: matchedSubscription.integrationId,
      siteId: matchedSubscription.siteId,
    }),
  });
}

export function createMindbodyWebhookCatalogue(supabase) {
  return Object.freeze({
    async enqueue(event) {
      const { data, error } = await supabase.rpc("enqueue_class_mindbody_webhook", {
        candidate_message_id: event.messageId,
        candidate_payload_fingerprint: event.payloadFingerprint,
        candidate_event_id: event.eventId,
        candidate_event_schema_version: event.eventSchemaVersion,
        candidate_event_occurred_at: event.eventOccurredAt,
        candidate_transaction_key: event.transactionKey,
        candidate_provider_site_id: event.providerSiteId,
        candidate_provider_location_id: event.providerLocationId,
        candidate_provider_class_id: event.providerClassId,
        candidate_provider_client_id: event.providerClientId,
        candidate_provider_client_unique_id: event.providerClientUniqueId,
        candidate_provider_roster_booking_id: event.providerRosterBookingId,
        candidate_provider_waitlist_entry_id: event.providerWaitlistEntryId,
        candidate_provider_sale_id: event.providerSaleId,
      });
      if (error || !data?.id) {
        throw new MindbodyWebhookError(
          "WEBHOOK_QUEUE_UNAVAILABLE",
          "Mindbody webhook could not be queued safely.",
          error && /reused with different/i.test(error.message ?? "") ? 409 : 503,
        );
      }
      return { id: data.id, duplicate: data.duplicate === true };
    },
  });
}

function json(body, status, requestId) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  });
}

export async function handleMindbodyWebhook(request, dependencies) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  if (request.method === "HEAD") return new Response(null, { status: 204 });
  if (request.method !== "POST") {
    return json({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST.", retryable: false }, requestId }, 405, requestId);
  }
  try {
    const rawBody = await request.text();
    const event = await dependencies.verify(
      rawBody,
      request.headers.get("X-Mindbody-Signature"),
      dependencies.subscriptions,
    );
    const queued = await dependencies.catalogue.enqueue(event);
    return json({ ok: true, data: { queued: true, duplicate: queued.duplicate }, requestId }, 202, requestId);
  } catch (error) {
    if (error instanceof MindbodyWebhookError) {
      return json({
        ok: false,
        error: { code: error.code, message: error.message, retryable: error.status >= 500 },
        requestId,
      }, error.status, requestId);
    }
    dependencies.logger?.error?.(JSON.stringify({ event: "mindbody_webhook_failed", requestId }));
    return json({
      ok: false,
      error: { code: "WEBHOOK_UNAVAILABLE", message: "Mindbody webhook intake failed.", retryable: true },
      requestId,
    }, 503, requestId);
  }
}

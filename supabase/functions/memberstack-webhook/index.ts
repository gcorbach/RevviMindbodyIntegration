import memberstackAdmin from "npm:@memberstack/admin@1.6.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createMemberstackAdminClient,
  createSupabaseMemberstackAdmission,
  createMemberstackWebhookVerifier,
  isProvisionableMemberstackPlanConnection,
  MemberstackAuthenticationError,
  MemberstackServiceError,
  parseMemberstackWebhookEnvelope,
} from "../_shared/memberstack.js";

function json(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  if (request.method !== "POST") {
    return json({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Use POST.", requestId }, 405);
  }
  const requiredEnvironment = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MEMBERSTACK_SECRET_KEY",
    "MEMBERSTACK_WEBHOOK_SECRET",
    "MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST",
  ].filter((name) => !Deno.env.get(name));
  const evidenceDigest = Deno.env.get("MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST") ?? "";
  if (requiredEnvironment.length > 0 || !/^[a-f0-9]{64}$/i.test(evidenceDigest)) {
    return json({ ok: false, code: "CONFIGURATION_ERROR", error: "Memberstack webhooks are not configured.", requestId }, 500);
  }

  try {
    const secretKey = Deno.env.get("MEMBERSTACK_SECRET_KEY")!;
    const sdk = memberstackAdmin.init(secretKey);
    const verified = await createMemberstackWebhookVerifier({
      secret: Deno.env.get("MEMBERSTACK_WEBHOOK_SECRET")!,
      verifyWebhookSignature: (input) => sdk.verifyWebhookSignature({ ...input, tolerance: 300 }),
    }).verify(request);
    const event = parseMemberstackWebhookEnvelope(verified.envelope);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: received, error: receiveError } = await supabase.rpc(
      "receive_class_memberstack_webhook",
      {
        candidate_svix_id: verified.eventId,
        candidate_event_type: event.eventType,
        candidate_external_event_type: event.externalEventType,
        candidate_memberstack_member_id: event.memberId,
      },
    );
    if (receiveError) {
      throw new MemberstackServiceError("DATABASE_UNAVAILABLE", "Webhook receipt could not be persisted.");
    }
    if (received === false) {
      const { data: stored, error: storedError } = await supabase
        .from("class_memberstack_webhook_events")
        .select("event_type, external_event_type, memberstack_member_id, status")
        .eq("svix_id", verified.eventId)
        .single();
      if (storedError) {
        throw new MemberstackServiceError("DATABASE_UNAVAILABLE", "Webhook receipt could not be resolved.");
      }
      if (stored.event_type !== event.eventType
        || stored.external_event_type !== event.externalEventType
        || stored.memberstack_member_id !== event.memberId) {
        throw new MemberstackServiceError(
          "WEBHOOK_DELIVERY_CONFLICT",
          "Memberstack reused a delivery ID with different verified facts.",
          409,
        );
      }
      if (["processed", "ignored"].includes(stored.status)) {
        return json({ ok: true, duplicate: true, requestId }, 200);
      }
    }

    let subscriptionStatus = "inactive";
    let planIds: string[] = [];
    let summary: Record<string, unknown> = { memberId: event.memberId };
    if (event.eventType !== "unknown" && event.eventType !== "member.deleted") {
      const member = await createMemberstackAdminClient({
        secretKey,
        admitRequest: createSupabaseMemberstackAdmission(supabase),
      }).getCurrentMember(event.memberId);
      const provisionable = member.planConnections.filter(isProvisionableMemberstackPlanConnection);
      planIds = [...new Set(provisionable.map((connection) => connection.planId))].sort();
      subscriptionStatus = planIds.length > 0 ? "active" : "inactive";
      const [connection] = provisionable;
      summary = connection
        ? {
          memberId: event.memberId,
          planId: connection.planId,
          planConnectionId: connection.id,
          status: connection.status,
          active: connection.active,
        }
        : { memberId: event.memberId, status: "INACTIVE", active: false };
    } else if (event.eventType === "unknown") {
      subscriptionStatus = "unknown";
      summary = { memberId: event.memberId, shapeCode: "UNKNOWN_EVENT" };
    }

    const { data: applied, error: applyError } = await supabase.rpc("process_class_memberstack_webhook", {
      candidate_svix_id: verified.eventId,
      candidate_subscription_status: subscriptionStatus,
      candidate_plan_ids: planIds,
      candidate_redacted_summary: summary,
    });
    if (applyError) throw new MemberstackServiceError("DATABASE_UNAVAILABLE", "Webhook facts could not be processed.");
    return json({ ok: true, duplicate: applied === false, requestId }, 200);
  } catch (error) {
    if (error instanceof MemberstackAuthenticationError) {
      return json({ ok: false, code: error.code, error: error.message, requestId }, 401);
    }
    if (error instanceof MemberstackServiceError) {
      return json({ ok: false, code: error.code, error: error.message, requestId }, error.status);
    }
    console.error(JSON.stringify({ event: "memberstack_webhook_failed", requestId }));
    return json({ ok: false, code: "WEBHOOK_UNAVAILABLE", error: "Memberstack webhook processing failed.", requestId }, 503);
  }
});

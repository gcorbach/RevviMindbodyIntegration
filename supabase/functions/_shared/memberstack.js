const MEMBERSTACK_ISSUER = "https://api.memberstack.com";
const MEMBERSTACK_JWKS_URL = "https://auth.memberstack.com/jwks";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SUPPORTED_WEBHOOK_EVENTS = new Set([
  "member.created",
  "member.updated",
  "member.deleted",
  "member.plan.added",
  "member.plan.updated",
  "member.plan.canceled",
]);
const ROOT_MEMBER_ID_WEBHOOK_EVENTS = new Set([
  "member.created",
  "member.updated",
]);

export class MemberstackAuthenticationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MemberstackAuthenticationError";
    this.code = code;
  }
}

export class MemberstackServiceError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = "MemberstackServiceError";
    this.code = code;
    this.status = status;
  }
}

export function isProvisionableMemberstackPlanConnection(connection) {
  return typeof connection?.planId === "string"
    && connection.planId.length > 0
    && connection.active === true
    && typeof connection.status === "string"
    && /^[A-Za-z]+$/.test(connection.status)
    && ["ACTIVE", "TRIALING"].includes(String(connection.status).toUpperCase());
}

export function createSupabaseMemberstackAdmission(supabase) {
  return async () => {
    const { data, error } = await supabase.rpc("claim_class_memberstack_admin_admission");
    if (error) {
      throw new MemberstackServiceError(
        "MEMBERSTACK_ADMISSION_UNAVAILABLE",
        "Memberstack request admission is temporarily unavailable.",
      );
    }
    return data === true;
  };
}

export function extractMemberstackBearerToken(request) {
  const authorization = request.headers.get("Authorization");
  if (authorization === null) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match) throw invalidToken();
  return match[1];
}

function decodeBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  return JSON.parse(decoder.decode(decodeBase64url(value)));
}

function invalidToken() {
  return new MemberstackAuthenticationError(
    "AUTHENTICATION_INVALID",
    "Memberstack identity could not be verified.",
  );
}

export function createMemberstackJwtVerifier({
  appId,
  fetchImpl = fetch,
  now = () => new Date(),
  jwksUrl = MEMBERSTACK_JWKS_URL,
  cacheTtlMs = 24 * 60 * 60 * 1000,
}) {
  if (typeof appId !== "string" || !appId.startsWith("app_")) {
    throw new Error("A Memberstack app ID is required.");
  }

  let cachedJwks = null;
  let cachedAt = 0;

  async function loadJwks(forceRefresh = false) {
    const currentTime = now().getTime();
    if (!forceRefresh && cachedJwks && currentTime - cachedAt < cacheTtlMs) return cachedJwks;
    let response;
    try {
      response = await fetchImpl(jwksUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new MemberstackServiceError(
        "MEMBERSTACK_UNAVAILABLE",
        "Memberstack identity verification is temporarily unavailable.",
      );
    }
    if (!response.ok) {
      throw new MemberstackServiceError(
        "MEMBERSTACK_UNAVAILABLE",
        "Memberstack identity verification is temporarily unavailable.",
      );
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new MemberstackServiceError(
        "MEMBERSTACK_UNAVAILABLE",
        "Memberstack identity verification is temporarily unavailable.",
      );
    }
    if (!payload || !Array.isArray(payload.keys)) {
      throw new MemberstackServiceError(
        "MEMBERSTACK_UNAVAILABLE",
        "Memberstack identity verification is temporarily unavailable.",
      );
    }
    cachedJwks = payload.keys;
    cachedAt = currentTime;
    return cachedJwks;
  }

  async function keyFor(kid) {
    let keys = await loadJwks();
    let key = keys.find((candidate) => candidate?.kid === kid);
    if (!key) {
      keys = await loadJwks(true);
      key = keys.find((candidate) => candidate?.kid === kid);
    }
    if (!key || key.kty !== "RSA" || (key.alg && key.alg !== "RS256")) throw invalidToken();
    return crypto.subtle.importKey(
      "jwk",
      key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  }

  return {
    async verifyBrowserToken(token) {
      try {
        if (typeof token !== "string" || token.length < 32 || token.length > 16_384 || /\s/.test(token)) {
          throw invalidToken();
        }
        const segments = token.split(".");
        if (segments.length !== 3) throw invalidToken();
        const [encodedHeader, encodedPayload, encodedSignature] = segments;
        const header = decodeJsonSegment(encodedHeader);
        const claims = decodeJsonSegment(encodedPayload);
        if (header?.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) {
          throw invalidToken();
        }
        const key = await keyFor(header.kid);
        const validSignature = await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          key,
          decodeBase64url(encodedSignature),
          encoder.encode(`${encodedHeader}.${encodedPayload}`),
        );
        if (!validSignature
          || claims?.iss !== MEMBERSTACK_ISSUER
          || claims?.aud !== appId
          || typeof claims.exp !== "number"
          || claims.exp * 1000 <= now().getTime()
          || typeof claims.sub !== "string"
          || claims.sub.length === 0) {
          throw invalidToken();
        }
        return { memberId: claims.sub };
      } catch (error) {
        if (error instanceof MemberstackAuthenticationError
          || error instanceof MemberstackServiceError) throw error;
        throw invalidToken();
      }
    },
  };
}

export function createMemberstackAdminClient({
  secretKey,
  fetchImpl = fetch,
  now = () => new Date(),
  baseUrl = "https://admin.memberstack.com",
  admitRequest,
}) {
  if (typeof secretKey !== "string" || !/^sk(?:_sb)?_/.test(secretKey)) {
    throw new Error("A Memberstack server secret is required.");
  }
  if (typeof admitRequest !== "function") {
    throw new Error("Global Memberstack Admin request admission is required.");
  }

  return {
    async getCurrentMember(memberId) {
      if (typeof memberId !== "string" || memberId.length === 0) {
        throw new MemberstackServiceError("MEMBERSTACK_MEMBER_INVALID", "Memberstack member ID is required.", 500);
      }
      if (await admitRequest() !== true) {
        throw new MemberstackServiceError(
          "MEMBERSTACK_RATE_LIMITED",
          "Current Revvi membership verification is temporarily busy.",
        );
      }
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/members/${encodeURIComponent(memberId)}`, {
          method: "GET",
          headers: { Accept: "application/json", "X-API-KEY": secretKey },
        });
      } catch {
        throw new MemberstackServiceError(
          "MEMBERSTACK_UNAVAILABLE",
          "Current Revvi membership could not be verified.",
        );
      }
      if (!response.ok) {
        throw new MemberstackServiceError(
          response.status === 404 ? "MEMBERSTACK_MEMBER_NOT_FOUND" : "MEMBERSTACK_UNAVAILABLE",
          "Current Revvi membership could not be verified.",
          response.status === 404 ? 403 : 503,
        );
      }
      const envelope = await response.json();
      const member = envelope?.data;
      if (member?.id !== memberId || !Array.isArray(member.planConnections)) {
        throw new MemberstackServiceError(
          "MEMBERSTACK_CONTRACT_INVALID",
          "Memberstack returned an unrecognized member contract.",
        );
      }
      const planConnections = member.planConnections.map((connection) => {
        if (typeof connection?.id !== "string"
          || typeof connection.planId !== "string"
          || typeof connection.active !== "boolean"
          || typeof connection.status !== "string") {
          throw new MemberstackServiceError(
            "MEMBERSTACK_CONTRACT_INVALID",
            "Memberstack returned an unrecognized plan contract.",
          );
        }
        return {
          id: connection.id,
          planId: connection.planId,
          active: connection.active,
          status: connection.status,
        };
      });
      const email = typeof member.auth?.email === "string" ? member.auth.email.trim().toLowerCase() : "";
      const firstName = typeof member.customFields?.["first-name"] === "string"
        ? member.customFields["first-name"].trim()
        : "";
      const lastName = typeof member.customFields?.["last-name"] === "string"
        ? member.customFields["last-name"].trim()
        : "";
      return {
        memberId,
        ...(email && firstName && lastName ? {
          identity: { email, firstName, lastName, emailVerified: member.verified === true },
        } : {}),
        planConnections,
        verifiedAt: now().toISOString(),
      };
    },
  };
}

export function createMemberstackWebhookVerifier({ secret, verifyWebhookSignature }) {
  if (typeof secret !== "string" || !secret.startsWith("whsec_")
    || typeof verifyWebhookSignature !== "function") {
    throw new Error("Memberstack webhook verification is not configured.");
  }

  return {
    async verify(request) {
      const eventId = request.headers.get("svix-id");
      const timestamp = request.headers.get("svix-timestamp");
      const signature = request.headers.get("svix-signature");
      if (!eventId || !timestamp || !signature) {
        throw new MemberstackAuthenticationError(
          "WEBHOOK_SIGNATURE_INVALID",
          "Memberstack webhook signature is invalid.",
        );
      }
      try {
        const rawBody = await request.text();
        if (rawBody.length === 0 || rawBody.length > 262_144) throw new Error("invalid body");
        const envelope = JSON.parse(rawBody);
        if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("invalid envelope");
        const verified = verifyWebhookSignature({
          payload: envelope,
          headers: {
            "SVIX-ID": eventId,
            "SVIX-TIMESTAMP": timestamp,
            "SVIX-SIGNATURE": signature,
          },
          secret,
        });
        if (verified !== true) throw new Error("signature rejected");
        return { eventId, envelope };
      } catch {
        throw new MemberstackAuthenticationError(
          "WEBHOOK_SIGNATURE_INVALID",
          "Memberstack webhook signature is invalid.",
        );
      }
    },
  };
}

export function parseMemberstackWebhookEnvelope(envelope) {
  const externalEventType = typeof envelope?.event === "string" && envelope.event.length > 0
    ? envelope.event
    : null;
  const candidateMemberIds = [
    envelope?.payload?.member?.id,
    envelope?.data?.member?.id,
    ...(ROOT_MEMBER_ID_WEBHOOK_EVENTS.has(externalEventType)
      ? [envelope?.payload?.id]
      : []),
  ].filter((value) => typeof value === "string" && value.length > 0);
  const distinctMemberIds = [...new Set(candidateMemberIds)];
  if (!externalEventType || distinctMemberIds.length > 1) {
    throw new MemberstackServiceError(
      "MEMBERSTACK_WEBHOOK_CONTRACT_INVALID",
      "Memberstack returned an unrecognized webhook envelope.",
      400,
    );
  }
  if (SUPPORTED_WEBHOOK_EVENTS.has(externalEventType) && distinctMemberIds.length !== 1) {
    throw new MemberstackServiceError(
      "MEMBERSTACK_WEBHOOK_CONTRACT_INVALID",
      "Memberstack returned an unrecognized webhook member identity.",
      400,
    );
  }
  return {
    eventType: SUPPORTED_WEBHOOK_EVENTS.has(externalEventType) ? externalEventType : "unknown",
    externalEventType,
    memberId: distinctMemberIds[0] ?? "unresolved",
  };
}

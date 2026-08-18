import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import memberstackAdmin from "@memberstack/admin";

import {
  createMemberstackAdminClient,
  createMemberstackJwtVerifier,
  createMemberstackWebhookVerifier,
  extractMemberstackBearerToken,
  isProvisionableMemberstackPlanConnection,
  MemberstackAuthenticationError,
  MemberstackServiceError,
  parseMemberstackWebhookEnvelope,
} from "../../supabase/functions/_shared/memberstack.js";

const encoder = new TextEncoder();
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signedWebhookRequest({ envelope, eventId, timestamp, secret }) {
  const secretBytes = Buffer.from(secret.split("_")[1], "base64");
  const signature = createHmac("sha256", secretBytes)
    .update(`${eventId}.${timestamp}.${JSON.stringify(envelope)}`)
    .digest("base64");
  return new Request("https://api.revvi.test/memberstack-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": eventId,
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${signature}`,
    },
    body: JSON.stringify(envelope),
  });
}

async function signedToken(privateKey, payload, kid = "memberstack-test-key") {
  const encodedHeader = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

async function memberstackKeyFixture() {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return {
    privateKey: keys.privateKey,
    publicJwk: { ...publicJwk, alg: "RS256", use: "sig", kid: "memberstack-test-key" },
  };
}

test("Memberstack bearer JWTs require the official RS256/JWKS identity contract", async () => {
  const fixture = await memberstackKeyFixture();
  const token = await signedToken(fixture.privateKey, {
    id: "member-a",
    type: "member",
    iss: "https://api.memberstack.com",
    aud: "app_revvi",
    iat: 1_786_363_100,
    exp: 1_786_366_700,
  });
  const verifier = createMemberstackJwtVerifier({
    appId: "app_revvi",
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    fetchImpl: async (url) => {
      assert.equal(url, "https://auth.memberstack.com/jwks");
      return new Response(JSON.stringify({ keys: [fixture.publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.deepEqual(await verifier.verifyBrowserToken(token), { memberId: "member-a" });
});

test("Memberstack bearer identity requires the captured root id claim", async () => {
  const fixture = await memberstackKeyFixture();
  const verifier = createMemberstackJwtVerifier({
    appId: "app_revvi",
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({ keys: [fixture.publicJwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const common = {
    type: "member",
    iss: "https://api.memberstack.com",
    aud: "app_revvi",
    iat: 1_786_363_100,
    exp: 1_786_366_700,
  };
  const invalidTokens = [
    await signedToken(fixture.privateKey, { ...common, sub: "member-a" }),
    await signedToken(fixture.privateKey, { ...common, id: "member-a", sub: "member-b" }),
    await signedToken(fixture.privateKey, { ...common, id: "member-a", data: { id: "member-b" } }),
  ];

  for (const token of invalidTokens) {
    await assert.rejects(
      verifier.verifyBrowserToken(token),
      (error) => error instanceof MemberstackAuthenticationError
        && error.code === "AUTHENTICATION_INVALID",
    );
  }
});

test("an unknown Memberstack test-mode signing key uses the official Admin REST verifier", async () => {
  const fixture = await memberstackKeyFixture();
  const token = await signedToken(fixture.privateKey, {
    id: "member-a",
    type: "member",
    iss: "https://api.memberstack.com",
    aud: "app_revvi",
    iat: 1_786_363_100,
    exp: 1_786_366_700,
  });
  let remoteVerification;
  const verifier = createMemberstackJwtVerifier({
    appId: "app_revvi",
    secretKey: "sk_sb_memberstack_test",
    admitRequest: async () => true,
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      if (url === "https://auth.memberstack.com/jwks") {
        return new Response(JSON.stringify({
          keys: [{ ...fixture.publicJwk, kid: "different-live-key" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      assert.equal(url, "https://admin.memberstack.com/members/verify-token");
      remoteVerification = { init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ data: {
        id: "member-a",
        type: "member",
        iss: "https://api.memberstack.com",
        aud: "app_revvi",
        iat: 1_786_363_100,
        exp: 1_786_366_700,
      } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.deepEqual(await verifier.verifyBrowserToken(token), { memberId: "member-a" });
  assert.equal(remoteVerification.init.method, "POST");
  assert.equal(remoteVerification.init.headers["X-API-KEY"], "sk_sb_memberstack_test");
  assert.deepEqual(remoteVerification.body, { token });
});

test("the Admin REST fallback cannot bypass known-key signatures or substitute another member", async () => {
  const signedFixture = await memberstackKeyFixture();
  const otherFixture = await memberstackKeyFixture();
  const claims = {
    id: "member-a",
    type: "member",
    iss: "https://api.memberstack.com",
    aud: "app_revvi",
    iat: 1_786_363_100,
    exp: 1_786_366_700,
  };
  const token = await signedToken(signedFixture.privateKey, claims);
  let remoteCalls = 0;
  const knownKeyVerifier = createMemberstackJwtVerifier({
    appId: "app_revvi",
    secretKey: "sk_sb_memberstack_test",
    admitRequest: async () => true,
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    fetchImpl: async (url) => {
      if (url === "https://auth.memberstack.com/jwks") {
        return new Response(JSON.stringify({ keys: [otherFixture.publicJwk] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      remoteCalls += 1;
      return new Response(JSON.stringify({ data: claims }), { status: 200 });
    },
  });
  await assert.rejects(
    knownKeyVerifier.verifyBrowserToken(token),
    (error) => error instanceof MemberstackAuthenticationError
      && error.code === "AUTHENTICATION_INVALID",
  );
  assert.equal(remoteCalls, 0);

  const unknownKeyVerifier = createMemberstackJwtVerifier({
    appId: "app_revvi",
    secretKey: "sk_sb_memberstack_test",
    admitRequest: async () => true,
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    fetchImpl: async (url) => {
      if (url === "https://auth.memberstack.com/jwks") {
        return new Response(JSON.stringify({
          keys: [{ ...otherFixture.publicJwk, kid: "different-live-key" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: { ...claims, id: "member-b" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(
    unknownKeyVerifier.verifyBrowserToken(token),
    (error) => error instanceof MemberstackAuthenticationError
      && error.code === "AUTHENTICATION_INVALID",
  );
});

test("both Memberstack verification paths enforce the same typed claims", async () => {
  const fixture = await memberstackKeyFixture();
  const validClaims = {
    id: "member-a",
    type: "member",
    iss: "https://api.memberstack.com",
    aud: "app_revvi",
    iat: 1_786_363_100,
    exp: 1_786_366_700,
  };
  const invalidClaims = [
    { ...validClaims, type: "admin" },
    { ...validClaims, type: undefined },
    { ...validClaims, iss: "https://attacker.test" },
    { ...validClaims, aud: "app_other" },
    { ...validClaims, iat: "1786363100" },
    { ...validClaims, exp: 1_786_363_000 },
  ];

  for (const claims of invalidClaims) {
    const token = await signedToken(fixture.privateKey, claims);
    for (const publishedKey of [true, false]) {
      let remoteCalls = 0;
      const verifier = createMemberstackJwtVerifier({
        appId: "app_revvi",
        secretKey: "sk_sb_memberstack_test",
        admitRequest: async () => true,
        now: () => new Date("2026-08-10T12:00:00.000Z"),
        fetchImpl: async (url) => {
          if (url === "https://auth.memberstack.com/jwks") {
            return new Response(JSON.stringify({ keys: publishedKey
              ? [fixture.publicJwk]
              : [{ ...fixture.publicJwk, kid: "another-key" }] }), { status: 200 });
          }
          remoteCalls += 1;
          return new Response(JSON.stringify({ data: claims }), { status: 200 });
        },
      });
      await assert.rejects(
        verifier.verifyBrowserToken(token),
        (error) => error instanceof MemberstackAuthenticationError
          && error.code === "AUTHENTICATION_INVALID",
      );
      assert.equal(remoteCalls, 0);
    }
  }
});

test("the Admin REST fallback rejects mismatched returned claims", async () => {
  const fixture = await memberstackKeyFixture();
  const claims = {
    id: "member-a",
    type: "member",
    iss: "https://api.memberstack.com",
    aud: "app_revvi",
    iat: 1_786_363_100,
    exp: 1_786_366_700,
  };
  const token = await signedToken(fixture.privateKey, claims);
  const invalidResponses = [
    { ...claims, type: "admin" },
    { ...claims, type: undefined },
    { ...claims, iss: "https://attacker.test" },
    { ...claims, aud: "app_other" },
    { ...claims, iat: claims.iat + 1 },
    { ...claims, exp: claims.exp + 1 },
  ];

  for (const returnedClaims of invalidResponses) {
    let remoteCalls = 0;
    const verifier = createMemberstackJwtVerifier({
      appId: "app_revvi",
      secretKey: "sk_sb_memberstack_test",
      admitRequest: async () => true,
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      fetchImpl: async (url) => {
        if (url === "https://auth.memberstack.com/jwks") {
          return new Response(JSON.stringify({
            keys: [{ ...fixture.publicJwk, kid: "another-key" }],
          }), { status: 200 });
        }
        remoteCalls += 1;
        return new Response(JSON.stringify({ data: returnedClaims }), { status: 200 });
      },
    });
    await assert.rejects(
      verifier.verifyBrowserToken(token),
      (error) => error instanceof MemberstackAuthenticationError
        && error.code === "AUTHENTICATION_INVALID",
    );
    assert.equal(remoteCalls, 1);
  }
});

test("the Admin REST fallback fails closed for admission and provider errors", async () => {
  const fixture = await memberstackKeyFixture();
  const claims = {
    id: "member-a",
    type: "member",
    iss: "https://api.memberstack.com",
    aud: "app_revvi",
    iat: 1_786_363_100,
    exp: 1_786_366_700,
  };
  const token = await signedToken(fixture.privateKey, claims);

  for (const scenario of [
    { admitted: false, status: 200, expectedCode: "MEMBERSTACK_RATE_LIMITED" },
    { admitted: true, status: 400, expectedCode: "AUTHENTICATION_INVALID" },
    { admitted: true, status: 503, expectedCode: "MEMBERSTACK_UNAVAILABLE" },
  ]) {
    let remoteCalls = 0;
    const verifier = createMemberstackJwtVerifier({
      appId: "app_revvi",
      secretKey: "sk_sb_memberstack_test",
      admitRequest: async () => scenario.admitted,
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      fetchImpl: async (url) => {
        if (url === "https://auth.memberstack.com/jwks") {
          return new Response(JSON.stringify({
            keys: [{ ...fixture.publicJwk, kid: "another-key" }],
          }), { status: 200 });
        }
        remoteCalls += 1;
        return new Response(JSON.stringify({ data: claims }), { status: scenario.status });
      },
    });
    await assert.rejects(
      verifier.verifyBrowserToken(token),
      (error) => error.code === scenario.expectedCode,
    );
    assert.equal(remoteCalls, scenario.admitted ? 1 : 0);
  }
});

test("the browser supplies exactly one Memberstack bearer credential", () => {
  assert.equal(
    extractMemberstackBearerToken(new Request("https://revvi.test", {
      headers: { Authorization: "Bearer memberstack.jwt.value" },
    })),
    "memberstack.jwt.value",
  );
  assert.equal(extractMemberstackBearerToken(new Request("https://revvi.test")), null);
  assert.throws(
    () => extractMemberstackBearerToken(new Request("https://revvi.test", {
      headers: { Authorization: "Basic browser-claim" },
    })),
    (error) => error instanceof MemberstackAuthenticationError,
  );
  assert.throws(
    () => extractMemberstackBearerToken(new Request("https://revvi.test", {
      headers: { Authorization: "Bearer first, Bearer second" },
    })),
    (error) => error instanceof MemberstackAuthenticationError,
  );
});

test("current eligibility comes from the Admin member record by verified ID", async () => {
  let admissions = 0;
  const client = createMemberstackAdminClient({
    secretKey: "sk_sb_memberstack_test",
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://admin.memberstack.com/members/member-a");
      assert.equal(init.method, "GET");
      assert.equal(init.headers["X-API-KEY"], "sk_sb_memberstack_test");
      return new Response(JSON.stringify({
        data: {
          id: "member-a",
          auth: { email: "member@example.com" },
          verified: true,
          customFields: { "first-name": "Ava", "last-name": "Ndlovu" },
          planConnections: [
            { id: "connection-a", planId: "plan-revvi", active: true, status: "trialing" },
            { id: "connection-b", planId: "expired-plan", active: false, status: "CANCELED" },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    admitRequest: async () => {
      admissions += 1;
      return true;
    },
  });

  assert.deepEqual(await client.getCurrentMember("member-a"), {
    memberId: "member-a",
    identity: { email: "member@example.com", firstName: "Ava", lastName: "Ndlovu", emailVerified: true },
    planConnections: [
      { id: "connection-a", planId: "plan-revvi", active: true, status: "trialing" },
      { id: "connection-b", planId: "expired-plan", active: false, status: "CANCELED" },
    ],
    verifiedAt: "2026-08-10T12:00:00.000Z",
  });
  assert.equal(admissions, 1);
});

test("the Admin adapter preserves a hostile Unicode status for fail-closed evaluation", async () => {
  const client = createMemberstackAdminClient({
    secretKey: "sk_sb_memberstack_test",
    admitRequest: async () => true,
    fetchImpl: async () => new Response(JSON.stringify({
      data: {
        id: "member-a",
        planConnections: [
          { id: "connection-a", planId: "plan-revvi", active: true, status: "actıve" },
        ],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const member = await client.getCurrentMember("member-a");
  assert.equal(member.planConnections[0].status, "actıve");
  assert.equal(isProvisionableMemberstackPlanConnection(member.planConnections[0]), false);
});

test("a denied global Memberstack admission fails before the Admin API", async () => {
  let fetchReached = false;
  const client = createMemberstackAdminClient({
    secretKey: "sk_sb_memberstack_test",
    admitRequest: async () => false,
    fetchImpl: async () => {
      fetchReached = true;
    },
  });

  await assert.rejects(
    client.getCurrentMember("member-a"),
    (error) => error instanceof MemberstackServiceError
      && error.code === "MEMBERSTACK_RATE_LIMITED"
      && error.status === 503,
  );
  assert.equal(fetchReached, false);
});

test("wrong-audience, expired, and modified Memberstack JWTs fail closed", async (t) => {
  const fixture = await memberstackKeyFixture();
  const verifier = createMemberstackJwtVerifier({
    appId: "app_revvi",
    now: () => new Date("2026-08-10T12:00:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({ keys: [fixture.publicJwk] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  const common = {
    id: "member-a",
    type: "member",
    iss: "https://api.memberstack.com",
    aud: "app_revvi",
    iat: 1_786_363_100,
    exp: 1_786_366_700,
  };
  const fixtures = [
    ["wrong audience", await signedToken(fixture.privateKey, { ...common, aud: "app_other" })],
    ["expired", await signedToken(fixture.privateKey, { ...common, exp: 1_786_363_000 })],
  ];
  const valid = await signedToken(fixture.privateKey, common);
  const [header, , signature] = valid.split(".");
  fixtures.push(["modified payload", `${header}.${base64url(JSON.stringify({ ...common, id: "member-b" }))}.${signature}`]);

  for (const [label, token] of fixtures) {
    await t.test(label, async () => {
      await assert.rejects(
        verifier.verifyBrowserToken(token),
        (error) => error instanceof MemberstackAuthenticationError
          && error.code === "AUTHENTICATION_INVALID",
      );
    });
  }
});

test("a Memberstack JWKS outage remains retryable instead of blaming the Customer", async () => {
  const fixture = await memberstackKeyFixture();
  const token = await signedToken(fixture.privateKey, {
    id: "member-a",
    type: "member",
    iss: "https://api.memberstack.com",
    aud: "app_revvi",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const verifier = createMemberstackJwtVerifier({
    appId: "app_revvi",
    fetchImpl: async () => {
      throw new Error("network unavailable");
    },
  });

  await assert.rejects(
    verifier.verifyBrowserToken(token),
    (error) => error instanceof MemberstackServiceError
      && error.code === "MEMBERSTACK_UNAVAILABLE"
      && error.status === 503,
  );
});

test("Memberstack webhooks verify the whole envelope with required Svix headers", async () => {
  const envelope = {
    event: "member.plan.updated",
    payload: { member: { id: "member-a" } },
  };
  let verifiedInput;
  const verifier = createMemberstackWebhookVerifier({
    secret: "whsec_memberstack_test",
    verifyWebhookSignature: (input) => {
      verifiedInput = input;
      return true;
    },
  });
  const request = new Request("https://api.revvi.test/memberstack-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": "msg_memberstack_1",
      "svix-timestamp": "1786363200",
      "svix-signature": "v1,fixture-signature",
    },
    body: JSON.stringify(envelope),
  });

  assert.deepEqual(await verifier.verify(request), {
    eventId: "msg_memberstack_1",
    envelope,
  });
  assert.deepEqual(verifiedInput, {
    payload: envelope,
    headers: {
      "SVIX-ID": "msg_memberstack_1",
      "SVIX-TIMESTAMP": "1786363200",
      "SVIX-SIGNATURE": "v1,fixture-signature",
    },
    secret: "whsec_memberstack_test",
  });
});

test("the pinned official Memberstack SDK accepts a current signed fixture and rejects replay", async () => {
  const envelope = {
    event: "member.plan.updated",
    payload: { member: { id: "member-a" } },
  };
  const secret = `whsec_${Buffer.from("memberstack-fixture-secret").toString("base64")}`;
  const sdk = memberstackAdmin.init("sk_sb_memberstack_test");
  const verifier = createMemberstackWebhookVerifier({
    secret,
    verifyWebhookSignature: (input) => sdk.verifyWebhookSignature({ ...input, tolerance: 300 }),
  });
  const currentTimestamp = Math.floor(Date.now() / 1000);

  assert.deepEqual(await verifier.verify(signedWebhookRequest({
    envelope,
    eventId: "msg_memberstack_signed",
    timestamp: currentTimestamp,
    secret,
  })), {
    eventId: "msg_memberstack_signed",
    envelope,
  });

  await assert.rejects(
    verifier.verify(signedWebhookRequest({
      envelope,
      eventId: "msg_memberstack_replayed",
      timestamp: currentTimestamp - 600,
      secret,
    })),
    (error) => error instanceof MemberstackAuthenticationError
      && error.code === "WEBHOOK_SIGNATURE_INVALID",
  );

  const signedOriginal = signedWebhookRequest({
    envelope,
    eventId: "msg_memberstack_modified",
    timestamp: currentTimestamp,
    secret,
  });
  await assert.rejects(
    verifier.verify(new Request(signedOriginal.url, {
      method: "POST",
      headers: signedOriginal.headers,
      body: JSON.stringify({ ...envelope, event: "member.deleted" }),
    })),
    (error) => error instanceof MemberstackAuthenticationError
      && error.code === "WEBHOOK_SIGNATURE_INVALID",
  );

  await assert.rejects(
    verifier.verify(new Request("https://api.revvi.test/memberstack-webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    })),
    (error) => error instanceof MemberstackAuthenticationError
      && error.code === "WEBHOOK_SIGNATURE_INVALID",
  );
});

test("supported webhook envelopes resolve one current Memberstack member", () => {
  assert.deepEqual(parseMemberstackWebhookEnvelope({
    event: "member.created",
    payload: { id: "member-a", planConnections: [] },
  }), {
    eventType: "member.created",
    externalEventType: "member.created",
    memberId: "member-a",
  });

  assert.deepEqual(parseMemberstackWebhookEnvelope({
    event: "member.updated",
    payload: { id: "member-a" },
  }), {
    eventType: "member.updated",
    externalEventType: "member.updated",
    memberId: "member-a",
  });

  assert.deepEqual(parseMemberstackWebhookEnvelope({
    event: "member.plan.updated",
    payload: { member: { id: "member-a" } },
  }), {
    eventType: "member.plan.updated",
    externalEventType: "member.plan.updated",
    memberId: "member-a",
  });

  assert.deepEqual(parseMemberstackWebhookEnvelope({
    event: "member.updated",
    data: { member: { id: "member-a" } },
  }), {
    eventType: "member.updated",
    externalEventType: "member.updated",
    memberId: "member-a",
  });
});

test("ambiguous webhook identities fail closed and unknown events cannot grant eligibility", () => {
  assert.throws(
    () => parseMemberstackWebhookEnvelope({
      event: "member.updated",
      data: { id: "member-a" },
    }),
    (error) => error instanceof MemberstackServiceError
      && error.code === "MEMBERSTACK_WEBHOOK_CONTRACT_INVALID",
  );

  assert.throws(
    () => parseMemberstackWebhookEnvelope({
      event: "member.updated",
      payload: { member: { id: "member-a" } },
      data: { member: { id: "member-b" } },
    }),
    (error) => error instanceof MemberstackServiceError
      && error.code === "MEMBERSTACK_WEBHOOK_CONTRACT_INVALID",
  );

  assert.deepEqual(parseMemberstackWebhookEnvelope({
    event: "member.plan.expired",
    payload: { anything: true },
  }), {
    eventType: "unknown",
    externalEventType: "member.plan.expired",
    memberId: "unresolved",
  });
});

test("production routes pin the selected Memberstack contracts", () => {
  const config = readFileSync(resolve(projectRoot, "supabase/config.toml"), "utf8");
  assert.match(config, /\[functions\.class-offer-eligibility\]\s+enabled = true\s+verify_jwt = false/);
  assert.match(config, /\[functions\.memberstack-webhook\]\s+enabled = true\s+verify_jwt = false/);

  const eligibility = readFileSync(
    resolve(projectRoot, "supabase/functions/class-offer-eligibility/index.ts"),
    "utf8",
  );
  assert.match(eligibility, /createMemberstackJwtVerifier/);
  assert.match(eligibility, /createSupabaseMemberstackAdmission/);
  assert.match(eligibility, /MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST/);
  assert.doesNotMatch(eligibility, /verifyToken/);
  assert.doesNotMatch(eligibility, /customerId:\s*context\.customer\.id/);

  for (const route of [
    "offer-class-availability",
    "booking-quote",
    "create-booking",
    "cancel-booking",
    "upcoming-bookings",
    "complete-paid-booking",
    "class-offer-eligibility",
  ]) {
    const source = readFileSync(
      resolve(projectRoot, `supabase/functions/${route}/index.ts`),
      "utf8",
    );
    assert.match(source, /createMemberstackJwtVerifier\(\{[\s\S]*?secretKey:[\s\S]*?admitRequest:/);
  }

  const webhook = readFileSync(
    resolve(projectRoot, "supabase/functions/memberstack-webhook/index.ts"),
    "utf8",
  );
  assert.match(webhook, /npm:@memberstack\/admin@1\.6\.0/);
  assert.match(webhook, /tolerance:\s*300/);
  assert.match(webhook, /MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST/);
  assert.match(webhook, /createSupabaseMemberstackAdmission/);
  assert.ok(
    webhook.indexOf("receive_class_memberstack_webhook")
      < webhook.indexOf("getCurrentMember(event.memberId)"),
    "verified webhook receipt must be persisted before the Admin API read",
  );
  assert.doesNotMatch(webhook, /record_class_memberstack_webhook/);
});

# Memberstack authentication, Offer eligibility, and webhook contracts

Researched: 2026-08-10
Scope: first-party Memberstack documentation and the published `@memberstack/dom` package only. Community answers and third-party tutorials are not treated as contracts. This note resolves the Memberstack decisions needed by GitHub issue #32 and records where Memberstack does not publish a sufficiently exact contract.

## Decision summary

Revvi should use the Memberstack 2.0 DOM package already exposed on Webflow as `window.$memberstackDom`. The browser gets the current Customer with `getCurrentMember()`, gets the current compact JWT with the public `getMemberCookie()` method, and sends that JWT to a Supabase Edge Function as `Authorization: Bearer <token>`. The token is identity evidence only; browser-supplied member IDs, plan IDs, and eligibility flags are untrusted.

For Supabase Edge Functions, Revvi should verify the JWT locally using Memberstack's official RS256 JWKS contract, with `@memberstack/admin` or Admin REST verification as tested fallbacks. Local verification must require algorithm `RS256`, the key selected by JWT `kid` from `https://auth.memberstack.com/jwks`, issuer `https://api.memberstack.com`, exact audience `MEMBERSTACK_APP_ID`, and an unexpired token. It then retrieves the current member through the Admin API using the verified member ID. Offer eligibility is an exact intersection between the Offer's configured Memberstack plan IDs and freshly retrieved `member.planConnections` with `active === true` and a closed provisionable status (`ACTIVE` or `TRIALING`, normalized only for Memberstack's documented case inconsistency). Unknown, missing, inactive, or contradictory values fail closed.

Immediately before **every Mindbody write**, repeat the Memberstack member retrieval and exact `planId` + `ACTIVE` test. A local subscription snapshot and signed webhooks are useful for display, reconciliation, and revocation, but are not sufficient authorization for a provider write.

Memberstack webhooks use Svix delivery. Verify them with `@memberstack/admin` and the endpoint signing secret, map incoming lowercase headers to the uppercase keys the SDK currently requires, reject every thrown verification error, and deduplicate on `svix-id`. Do not implement a home-grown webhook HMAC verifier: unlike the JWT RS256/JWKS contract, Memberstack does not publish the webhook cryptographic construction as its public integration surface.

## Browser authentication contract

### Package and Webflow entry point

- The supported client package is `@memberstack/dom`, initialized with the public key (`pk_sb_...` in test and `pk_...` live). The Admin package and its secret key are server-only. [DOM quick start](https://developers.memberstack.com/dom-package/quick-start), [Admin quick start](https://developers.memberstack.com/admin-node-package/quick-start)
- On an existing Webflow installation, use `window.$memberstackDom`; Memberstack identifies the Data Attribute package as a wrapper around the DOM package. Revvi does not need a second login system. [DOM package outline](https://docs.memberstack.com/hc/en-us/articles/25818119332123-Memberstack-DOM-Front-end-Package-Outline), [advanced integration](https://developers.memberstack.com/dom-package/advanced-integration)
- The no-build browser script is `https://static.memberstack.com/scripts/v2/memberstack.js`. Custom code that might run before it is ready must wait for `window.$memberstackReady` or the `memberstack.ready` event before calling the global. [plain-HTML/Webflow initialization guide](https://docs.memberstack.com/hc/en-us/articles/11217223809819-Using-Memberstack-on-a-Plain-HTML-Site-No-npm-or-Build-Step)
- `getCurrentMember()` resolves to `{ data: member }`; the member is `null` when there is no authenticated Customer. `onAuthChange` receives the member directly or `null`. [member journey](https://developers.memberstack.com/dom-package/member-journey), [core authentication](https://developers.memberstack.com/dom-package/core-authentication)
- Browser-side plan checks are suitable for choosing UI states, not for authorizing a Booking. Memberstack's own protected-content guidance says sensitive access must also be validated server-side. [member journey: protected content](https://developers.memberstack.com/dom-package/member-journey)

### Token shape and transport

The Memberstack 2.0 DOM declarations describe an authentication result as:

```ts
{
  tokens: {
    accessToken: string;
    expires: number;
    type: "bearer";
  };
  member: Member;
  redirect: string;
}
```

The access token is a compact JWT. The current documented public DOM surface exposes `getMemberCookie()` to recover the persisted token for an already authenticated Customer. Despite its name, the SDK can persist `_ms-mid` in local storage by default or in a cookie when `useCookies: true`; callers should use the public method rather than reading storage directly. A published 2.0.x package declaration does **not** expose `getMemberToken()` as a public DOM method. [custom-backend security guide](https://docs.memberstack.com/hc/en-us/articles/7253255689755-Using-Permissions-and-Token-Verification-to-Secure-Your-Site-on-a-Custom-Backend), [published `@memberstack/dom` declarations](https://app.unpkg.com/%40memberstack/dom%402.0.1/files/lib/index.d.mts), [published request/storage implementation](https://app.unpkg.com/%40memberstack/dom%402.0.1/files/lib/methods/requests/requests.mjs), [published payload declarations](https://app.unpkg.com/%40memberstack/dom%402.0.1/files/lib/types/utils/payloads.d.mts)

For the Webflow widget:

```js
const memberstack = window.$memberstackDom;
const { data: member } = await memberstack.getCurrentMember();
const token = memberstack.getMemberCookie();

if (!member || !token) {
  // Render the logged-out state. Do not call a protected Revvi endpoint.
}

await fetch(edgeFunctionUrl, {
  headers: { Authorization: `Bearer ${token}` },
});
```

Memberstack's server examples use exactly the `Authorization: Bearer <JWT>` transport. The server must reject a missing header, a non-Bearer scheme, an empty token, or multiple/ambiguous credentials. [Admin verification](https://developers.memberstack.com/admin-node-package/verification), [permissions and token verification](https://docs.memberstack.com/hc/en-us/articles/7253255689755-Using-Permissions-and-Token-Verification-to-Secure-Your-Site)

The browser may decode the JWT to display an expiry hint, but decoded claims are not verified and cannot authorize anything. Memberstack's documentation contains inconsistent timestamp examples (a millisecond-looking sample alongside code treating `exp` as seconds), so Revvi must let Memberstack's verifier enforce expiry instead of implementing its own expiry format assumptions. [core authentication: session handling](https://developers.memberstack.com/dom-package/core-authentication), [Admin verification](https://developers.memberstack.com/admin-node-package/verification)

## Server verification and member retrieval

### Admin SDK verification path

```ts
import memberstackAdmin from "@memberstack/admin";

const memberstack = memberstackAdmin.init(MEMBERSTACK_SECRET_KEY);

const claims = await memberstack.verifyToken({
  token,
  audience: MEMBERSTACK_APP_ID,
});

const { data: member } = await memberstack.members.retrieve({
  id: claims.id,
});
```

- `verifyToken` validates the Memberstack JWT and returns an identity payload containing `id`, `type`, `iat`, `exp`, `iss`, and `aud`. Memberstack recommends audience validation; Revvi should require the configured live/test app ID rather than accept a token minted for another app. [Admin verification](https://developers.memberstack.com/admin-node-package/verification)
- The verified `id` is the only member ID used for the subsequent lookup. Never use a request-body member ID or compare only an email address. [permissions and token verification](https://docs.memberstack.com/hc/en-us/articles/7253255689755-Using-Permissions-and-Token-Verification-to-Secure-Your-Site)
- `members.retrieve({ id })` returns the current member, including `planConnections`. A token proves the session identity; it does not prove that the Customer still has an eligible plan. [Admin member actions](https://developers.memberstack.com/admin-node-package/member-actions)
- `@memberstack/admin` is server-only and is initialized with `sk_sb_...` for test mode or `sk_...` for live mode. Never send this key to Webflow. [Admin quick start](https://developers.memberstack.com/admin-node-package/quick-start)

Do **not** select the 1.6.0 SDK's `verifyToken` implementation for issue #32 without Memberstack correction: the published artifact still constructs its remote key set from the historical insecure URL `http://member-jwt.s3-website-us-east-1.amazonaws.com/`, whereas Memberstack's July 2026 security guide binds the supported endpoint to `https://auth.memberstack.com/jwks`. Use the documented HTTPS JWKS directly or the Admin REST verification endpoint. This discrepancy should be reported upstream and covered by a dependency-contract test. [official 1.6.0 package artifact](https://registry.npmjs.org/@memberstack/admin/-/admin-1.6.0.tgz), [current custom-backend security guide](https://docs.memberstack.com/hc/en-us/articles/7253255689755-Using-Permissions-and-Token-Verification-to-Secure-Your-Site-on-a-Custom-Backend)

### REST fallback

If the pinned Admin SDK cannot run in the Supabase Edge runtime, the documented REST fallback is:

1. `POST https://admin.memberstack.com/members/verify-token` with JSON `{ "token": "..." }` and server-only `X-API-KEY: <secret>`.
2. `GET https://admin.memberstack.com/members/{verifiedMemberId}` with the same server-only `X-API-KEY`.

The verification endpoint returns `id`, `type`, `iat`, `exp`, `aud`, and `iss`; any token failure returns HTTP `400` with `INVALID_TOKEN`, never `401`. Revvi must still compare returned `type`, `aud`, `iss`, and `exp` to its configured contract and translate any non-200 into its own unauthenticated response. [Admin REST verification](https://developers.memberstack.com/admin-rest-api/verification)

### Supported local RS256/JWKS verification

Memberstack now explicitly supports local JWT verification for serverless environments:

- algorithm: `RS256` only;
- JWKS: `https://auth.memberstack.com/jwks`;
- OpenID discovery: `https://auth.memberstack.com/.well-known/openid-configuration`;
- issuer: `https://api.memberstack.com`;
- audience: the exact Memberstack App ID (`app_...`);
- signing key: select by JWT header `kid`; and
- lifetime: require `exp` in the future (Memberstack documents a 14-day default, but Revvi should use the actual claim).

Memberstack recommends caching the JWKS in memory; its Node example uses a 24-hour cache and up to five keys. A standards-based JWT/JWKS library should perform algorithm, signature, issuer, audience, and expiry checks atomically. If the selected `kid` is absent, refresh the JWKS once and fail closed rather than accepting an unmatched key. [Memberstack custom-backend security guide](https://docs.memberstack.com/hc/en-us/articles/7253255689755-Using-Permissions-and-Token-Verification-to-Secure-Your-Site-on-a-Custom-Backend)

The same guide's local examples identify the member with verified claim `sub`, while its later illustrative payload nests `data.id`; the Admin SDK and REST response expose `id`. Issue #32 must capture one real test-mode token fixture and bind the local verifier to the actual verified `sub` shape. Never accept an unverified alternate claim path. The current-member Admin retrieval remains authoritative after identity verification.

## Current plan and subscription contract

A retrieved member has zero or more `planConnections`. The current documented/published fields are:

```ts
type MemberPlanConnection = {
  id: string;                 // connection ID, not the Plan ID
  active: boolean;
  status: string;
  planId: string;             // the identifier Revvi allowlists
  type: string;               // examples include "FREE"
  payment: null | {
    amount: number;
    currency: string;
    status: string;
    lastBillingDate: number | null;
    nextBillingDate: number | null;
    cancelAtDate: number | null;
    priceId: string;
  };
};
```

The current official package is `@memberstack/admin@1.6.0`. It exports both the default `{ init }` object and a named `init` with this published signature:

```ts
init(
  secretKey: string,
  options?: { test?: boolean; baseUrl?: string },
): {
  members: MemberMethods;
  dataTables: DataTablesMethods;
  verifyToken(args: { token: string; audience?: string }): Promise<...>;
  verifyWebhookSignature(args: {
    headers: object;
    secret: string;
    payload: object;
    tolerance?: number;
  }): boolean;
};
```

The `test`/`baseUrl` options target Memberstack's internal/local or alternate Admin API and are not needed for ordinary sandbox credentials; use the correct `sk_sb_...` or `sk_...` secret with the default base URL. [official npm metadata](https://registry.npmjs.org/@memberstack%2fadmin/latest), [official 1.6.0 package artifact](https://registry.npmjs.org/@memberstack/admin/-/admin-1.6.0.tgz)

[published DOM payload declarations](https://app.unpkg.com/%40memberstack/dom%402.0.1/files/lib/types/utils/payloads.d.mts), [Admin member response](https://developers.memberstack.com/admin-node-package/member-actions)

Memberstack's official access-control examples test `plan.planId === requiredPlanId && plan.status === "ACTIVE"`. They do not authorize by the connection `id`, price ID, plan name, `type`, `payment.status`, or the browser's selected plan. [Admin common use cases](https://developers.memberstack.com/admin-node-package/common-use-cases), [DOM plan management](https://developers.memberstack.com/dom-package/plan-management)

Memberstack separately publishes the paid-subscription status set `trialing`, `active`, `incomplete`, `incomplete_expired`, `past_due`, `canceled`, `unpaid`, and `sca`. It explicitly says both `trialing` and `active` are safe to provision; none of the other statuses receives that assurance. [subscription and plan statuses](https://docs.memberstack.com/hc/en-us/articles/13088732983963-Subscription-Plan-Statuses)

Issue #32 should therefore bind Offer eligibility to this predicate:

```ts
const eligible = member.planConnections.some(
  (connection) =>
    offer.eligibleMemberstackPlanIds.includes(connection.planId) &&
    connection.active === true &&
    ["ACTIVE", "TRIALING"].includes(connection.status.toUpperCase()),
);
```

Additional rules:

- Treat plan IDs as opaque, case-sensitive exact strings. Do not use prefixes to distinguish free from paid eligibility; a Revvi Offer explicitly allowlists the accepted IDs.
- A Customer can have multiple plans, so test the complete array rather than element zero. [Admin member actions](https://developers.memberstack.com/admin-node-package/member-actions)
- Normalize only ASCII case, then treat every status outside the explicit `ACTIVE`/`TRIALING` allowlist as ineligible. Memberstack's Admin responses show uppercase while its status guide uses lowercase. This deliberately fails closed for incomplete, expired, past-due, canceled, unpaid, SCA, unknown, or future statuses.
- Do not add email verification (`member.verified`) as an Offer rule unless Revvi makes that a separate product decision; it is available on the member but is not part of the current PRD's subscription eligibility definition. [member journey: email verification](https://developers.memberstack.com/dom-package/member-journey)
- Require `active === true` as well as an allowed status. If the fields disagree, fail closed and record redacted diagnostics. Memberstack's current Admin REST response explicitly returns both fields. [Admin REST member actions](https://developers.memberstack.com/admin-rest-api/member-actions)

## Immediate revalidation before a Mindbody write

Use this order inside every write-capable Edge Function:

1. Parse the bearer token and verify RS256 signature, `kid`, issuer, audience, and expiry through the official JWKS contract (or the Admin verifier).
2. Resolve the Revvi Customer only from the verified `claims.id`.
3. Load the active Supabase Offer and its exact eligible plan IDs.
4. For quote/availability UX, retrieve the current Memberstack member and evaluate eligibility.
5. After quote, idempotency, mapping, and provider-input validation—and **immediately before the Mindbody write**—retrieve the same verified member again.
6. Require at least one freshly returned plan connection whose `planId` is in the Offer allowlist, whose `active` flag is `true`, and whose normalized status is `ACTIVE` or `TRIALING`; apply any explicit blocking pilot override.
7. If Memberstack times out, rate-limits, returns an error, returns no member, or returns an unrecognized shape/status, stop before the provider call and return a retryable or ineligible Revvi error as appropriate.
8. Record the checked member ID, matching plan ID, connection ID, status, and check time as minimal authorization evidence; do not store the bearer token or full member response.
9. Perform the single intended Mindbody write. A later provider write requires another eligibility check.

This is intentionally a fresh authoritative read, not a webhook snapshot read. Memberstack documents a 25 requests/second Admin API limit, so the implementation needs bounded concurrency and a clear unavailable response, but must not weaken the pre-write check by serving cached eligibility. [Admin member actions](https://developers.memberstack.com/admin-node-package/member-actions)

## Webhook verification and event mapping

### Signature contract

Memberstack states that it uses Svix for webhook delivery and requires:

- `svix-id` — unique delivery/message identifier;
- `svix-timestamp` — send timestamp; and
- `svix-signature` — signature value.

The current Admin SDK looks up uppercase object keys, so map the HTTP framework's lowercase values to `SVIX-ID`, `SVIX-TIMESTAMP`, and `SVIX-SIGNATURE`. `verifyWebhookSignature` returns `true` on success and **throws** on a missing header, out-of-tolerance timestamp, or signature mismatch; it never returns `false`. Reject the request from the catch path before processing it. The current official package is `@memberstack/admin@1.6.0`; its published signature is `verifyWebhookSignature({ headers: object, secret: string, payload: object, tolerance?: number }): boolean`, and its implementation defaults `tolerance` to 300 seconds. [Admin verification](https://developers.memberstack.com/admin-node-package/verification), [official npm metadata](https://registry.npmjs.org/@memberstack%2fadmin/latest), [official 1.6.0 package artifact](https://registry.npmjs.org/@memberstack/admin/-/admin-1.6.0.tgz)

```ts
const headers = {
  "SVIX-ID": request.headers.get("svix-id"),
  "SVIX-TIMESTAMP": request.headers.get("svix-timestamp"),
  "SVIX-SIGNATURE": request.headers.get("svix-signature"),
};

try {
  memberstack.verifyWebhookSignature({
    payload: parsedWholeBody,
    headers,
    secret: MEMBERSTACK_WEBHOOK_SECRET,
  });
} catch {
  return new Response("Invalid signature", { status: 401 });
}
```

Use the endpoint-specific signing secret from Memberstack Dashboard → Dev Tools → Webhooks, stored only as a server secret. The SDK documentation says to preserve the raw body and also shows passing `JSON.parse(rawBody)` as `payload`; another current Memberstack example passes the parsed whole body. Because those instructions are internally inconsistent, issue #32 must pin the Admin SDK version and include one real signed test-delivery fixture proving the exact body adapter. Never pass only `body.payload`; verification covers the whole webhook envelope. [Admin verification](https://developers.memberstack.com/admin-node-package/verification), [Admin common use cases](https://developers.memberstack.com/admin-node-package/common-use-cases)

Memberstack's developer prose does not promise the cryptographic construction as a long-lived compatibility contract, but the first-party 1.6.0 package source is exact for that pinned release: it signs `${svix-id}.${svix-timestamp}.${JSON.stringify(payload)}` using HMAC-SHA256, with the base64-decoded bytes after the signing secret's underscore, and compares the base64 result to the `v1,` signature using Node's constant-time comparison. Treat the pinned SDK and real delivery fixtures as the algorithm boundary rather than copying this implementation into business code. [official 1.6.0 package artifact](https://registry.npmjs.org/@memberstack/admin/-/admin-1.6.0.tgz)

### Replay and delivery handling

- Create a unique ledger key from `svix-id` before applying an event. A duplicate verified delivery returns success without applying the transition twice. Memberstack explicitly recommends idempotency using the webhook ID. [Admin verification](https://developers.memberstack.com/admin-node-package/verification)
- Rely on the verifier's timestamp-tolerance failure for freshness, and test an old signed fixture. The pinned `@memberstack/admin@1.6.0` implementation defaults to 300 seconds and accepts an explicit numeric `tolerance`; configure 300 explicitly so an upgrade cannot silently change Revvi's policy.
- Authenticate first, persist/dedupe second, enqueue/process third, and acknowledge promptly. Keep processing idempotent because delivery can be retried. [Admin verification](https://developers.memberstack.com/admin-node-package/verification)
- Memberstack documents exponential-backoff retry delivery for non-2xx responses over 24 hours and permits manual resend of the same payload from the Dashboard. This makes the durable `svix-id` uniqueness constraint mandatory, not optional. [Webhook Events Reference](https://docs.memberstack.com/hc/en-us/articles/7329156946587-Webhook-Events-Reference)
- A webhook is not a live authorization credential. Even a newly received plan event may be reordered with another delivery; retrieve the member before a provider write.

### Events relevant to Revvi

The current documented event names are:

| Event | Revvi use |
| --- | --- |
| `member.created` | Create/update the local Customer snapshot. |
| `member.updated` | Refresh non-authoritative profile/snapshot fields. |
| `member.deleted` | Revoke local eligibility and flag existing records for support/reconciliation. |
| `member.plan.added` | Refresh current member and plan snapshot. |
| `member.plan.updated` | Refresh current member; this is the documented event for plan status changes. |
| `member.plan.canceled` | Revoke/refresh the local plan snapshot. |

[advanced integration](https://developers.memberstack.com/dom-package/advanced-integration), [Admin common use cases](https://developers.memberstack.com/admin-node-package/common-use-cases)

Memberstack does not document a separate `member.plan.expired` event in the reviewed catalog. Do not invent one. Map expiry or other state changes through `member.plan.updated` and the freshly retrieved `planConnections`, with `member.plan.canceled` as the explicit cancellation signal.

The documented examples conflict between envelopes using `payload` and newer event-reference samples using `data`, and between member-ID/status field shapes. The safe processing rule is to pin the parser to captured test-mode fixtures, use the verified envelope only for routing and identifiers, then retrieve the affected member to build the canonical local snapshot. Unknown event names or shapes are stored as redacted diagnostics and do not mutate eligibility. [Webhook Events Reference](https://docs.memberstack.com/hc/en-us/articles/7329156946587-Webhook-Events-Reference), [advanced integration](https://developers.memberstack.com/dom-package/advanced-integration), [Admin common use cases](https://developers.memberstack.com/admin-node-package/common-use-cases)

## Version, plan, and contract gaps

These are activation gates or explicit fail-closed boundaries, not fields to guess:

1. **Pin and test SDK versions.** The current public browser surface is documented as `getMemberCookie()`, while older snippets mention differently named token methods. Pin both DOM and Admin packages and run contract fixtures before changing versions.
2. **JWT member-ID shape conflicts.** Current local-verification examples use `sub`, while another payload example uses nested `data.id`; SDK/REST verification returns `id`. Capture a real token fixture and fail closed on a missing/ambiguous verified identifier.
3. **Status case and type are open.** Memberstack Admin examples use uppercase but the paid-status guide uses lowercase, and published types use `string`. Normalize case only and allow only `ACTIVE`/`TRIALING`; capture free-plan, trial, cancellation-at-period-end, and payment-failure fixtures before activation.
4. **`active` and `status` must agree.** Both exist in the current Admin member shape. Require `active === true` plus the closed provisionable status allowlist; fail closed on disagreement.
5. **Webhook body adapter is inconsistent in the docs.** Pin `@memberstack/admin@1.6.0` and prove its object-plus-`JSON.stringify` adapter with a real Dashboard test delivery, including duplicate, modified-body, missing-header, and stale-timestamp cases.
6. **Webhook payload schemas are incomplete.** Do not depend on optional nested fields for authorization; re-read the member.
7. **Replay tolerance is a pinned-package fact.** Version 1.6.0 defaults to 300 seconds; pass `tolerance: 300` explicitly and lock it down with a stale-delivery test.
8. **Deno/Edge support is not official.** Memberstack labels this the Admin **Node** Package. Version 1.6.0 ships CommonJS only (`main: ./lib/index.js`, no ESM `module`/`exports` or `engines` declaration) and directly requires Node `crypto`, `Buffer`, `axios`, and its own `package.json`. Supabase's Node-compatibility layer may run it, but Memberstack provides no Deno or Supabase Edge compatibility statement. Test `npm:@memberstack/admin@1.6.0` in the actual Edge runtime before depending on it. JWT authentication can use the official JWKS contract with a Deno-compatible JWT library; webhook REST verification is explicitly unavailable, so an Edge-incompatible Admin package is a genuine implementation blocker requiring a tested isolated Node verifier or a Memberstack-approved alternative. [Admin REST verification](https://developers.memberstack.com/admin-rest-api/verification), [official npm metadata](https://registry.npmjs.org/@memberstack%2fadmin/latest)

   Issue #32 verification on 2026-08-10 resolved this implementation gate for the pinned runtime pair: `@memberstack/admin@1.6.0` compiled and served under local `supabase-edge-runtime-1.74.2` (Deno 2.1.4 compatibility), and the production contract test passed a current signed whole-envelope fixture through the real SDK while rejecting a replay outside the explicit 300-second tolerance. This is a pinned compatibility result, not a general Memberstack guarantee; repeat it before either dependency is upgraded.
9. **Production billing dependency.** Memberstack says live keys become available when paying, and its current advanced guide calls for a paid plan for production use. Confirm Revvi's live Memberstack plan exposes the Admin API and Webhooks before launch. [API keys](https://docs.memberstack.com/hc/en-us/articles/11916762087835-Memberstack-API-Keys), [advanced integration](https://developers.memberstack.com/dom-package/advanced-integration)
10. **Test and live modes are separate.** `pk_sb_`/`sk_sb_` and test members must never mix with `pk_`/`sk_` and live Customers. Validate app audience and environment pairing at startup. [DOM quick start](https://developers.memberstack.com/dom-package/quick-start), [Admin quick start](https://developers.memberstack.com/admin-node-package/quick-start)
11. **Session duration is configurable.** Memberstack documents a 14-day default, but Revvi must enforce the token's actual `exp` rather than assume the default. Handle an expired token with `401` and ask the Customer to sign in again.

## Activation checklist

`MEMBERSTACK_CONTRACT_EVIDENCE_DIGEST` must remain unset until controlled Memberstack test-mode evidence satisfies this checklist. The Edge routes fail closed without a 64-character evidence digest; the digest records evidence identity, not a bypass of any runtime eligibility check.

- The Webflow browser adapter uses `window.$memberstackDom`, `getCurrentMember()`, and `getMemberCookie()`.
- Every protected request sends one bearer JWT; no member ID or plan list is trusted from the request body.
- Server verifies `RS256`, JWKS `kid`, signature, exact issuer, exact audience, and expiry (or receives and checks the equivalent Admin verifier result).
- Server retrieves the Revvi Customer's current Memberstack record by verified claim ID and uses the complete `planConnections` array.
- Eligibility is exact Offer plan-ID intersection plus `active === true` and normalized status in `ACTIVE`/`TRIALING`; all unknowns fail closed.
- The Revvi Customer's Memberstack record is retrieved again immediately before each Mindbody write; no cached/webhook-only authorization.
- Authorization evidence is minimal and redacted; JWTs and full Memberstack payloads are never logged or persisted.
- Webhook verification uses the pinned Admin SDK, endpoint secret, whole envelope, required Svix headers, timestamp tolerance, and `svix-id` dedupe.
- Webhook events refresh a local snapshot but never grant provider-write authority by themselves.
- [ ] Controlled Memberstack test-mode fixtures cover token expiry, wrong audience, removed Customer, multiple plans, inactive status, SDK body adapter, duplicate delivery, modified payload, and stale timestamp; their evidence bundle digest is configured only in the matching environment.

## First-party sources

- [Memberstack DOM Package quick start](https://developers.memberstack.com/dom-package/quick-start)
- [Memberstack plain-HTML/Webflow initialization](https://docs.memberstack.com/hc/en-us/articles/11217223809819-Using-Memberstack-on-a-Plain-HTML-Site-No-npm-or-Build-Step)
- [Memberstack DOM core authentication](https://developers.memberstack.com/dom-package/core-authentication)
- [Memberstack DOM member journey](https://developers.memberstack.com/dom-package/member-journey)
- [Memberstack DOM plan management](https://developers.memberstack.com/dom-package/plan-management)
- [Memberstack advanced integration](https://developers.memberstack.com/dom-package/advanced-integration)
- [Memberstack Admin Package quick start](https://developers.memberstack.com/admin-node-package/quick-start)
- [Official `@memberstack/admin` current npm metadata](https://registry.npmjs.org/@memberstack%2fadmin/latest)
- [Official `@memberstack/admin` 1.6.0 package artifact](https://registry.npmjs.org/@memberstack/admin/-/admin-1.6.0.tgz)
- [Memberstack Admin member actions](https://developers.memberstack.com/admin-node-package/member-actions)
- [Memberstack Admin REST member actions](https://developers.memberstack.com/admin-rest-api/member-actions)
- [Memberstack Admin REST verification](https://developers.memberstack.com/admin-rest-api/verification)
- [Memberstack Admin token and webhook verification](https://developers.memberstack.com/admin-node-package/verification)
- [Memberstack Admin common use cases](https://developers.memberstack.com/admin-node-package/common-use-cases)
- [Memberstack Admin REST help](https://docs.memberstack.com/hc/en-us/articles/17385829931419-Memberstack-Admin-Package-REST)
- [Memberstack token-verification security guide](https://docs.memberstack.com/hc/en-us/articles/7253255689755-Using-Permissions-and-Token-Verification-to-Secure-Your-Site)
- [Memberstack custom-backend RS256/JWKS security guide](https://docs.memberstack.com/hc/en-us/articles/7253255689755-Using-Permissions-and-Token-Verification-to-Secure-Your-Site-on-a-Custom-Backend)
- [Memberstack subscription and plan statuses](https://docs.memberstack.com/hc/en-us/articles/13088732983963-Subscription-Plan-Statuses)
- [Memberstack Webhook Events Reference](https://docs.memberstack.com/hc/en-us/articles/7329156946587-Webhook-Events-Reference)
- [Memberstack API keys](https://docs.memberstack.com/hc/en-us/articles/11916762087835-Memberstack-API-Keys)
- [Published `@memberstack/dom` 2.0.1 public declarations](https://app.unpkg.com/%40memberstack/dom%402.0.1/files/lib/index.d.mts)
- [Published `@memberstack/dom` 2.0.1 member payload declarations](https://app.unpkg.com/%40memberstack/dom%402.0.1/files/lib/types/utils/payloads.d.mts)
- [Published `@memberstack/dom` 2.0.1 request/storage implementation](https://app.unpkg.com/%40memberstack/dom%402.0.1/files/lib/methods/requests/requests.mjs)

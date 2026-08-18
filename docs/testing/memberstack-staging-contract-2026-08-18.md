# Memberstack staging contract evidence — 2026-08-18

## Scope

This bundle records controlled Memberstack test-mode contract evidence for Supabase staging project `hqjgsqlniuhphvhyeejm` and GitHub issue #57. It does not establish a live Memberstack or production Mindbody pilot.

The test Customer identifier is represented only by SHA-256 digest `987ec9c95b2a83ef7f474d31c0110847f332b0f3c88b06aa9c7ffb92d272038c`. The source email and raw Memberstack Customer identifier are intentionally omitted.

## Captured test-mode envelopes

The Memberstack dashboard emitted these real test-mode contracts in order:

1. `member.created` at `1787057040388`: Customer identity is at `payload.id`; `payload.planConnections` was empty and `payload.verified` was false.
2. `member.plan.added` at `1787057249004`: Customer identity is at `payload.member.id`; `payload.planConnection.planId` was `pln_test-plan-0tv40j5v` and status was `ACTIVE`.
3. `member.updated` at `1787058090372`: Customer identity is at `payload.id`; reason was `customFields.updated` and the required first/last-name fields were present.
4. `member.updated` at `1787058176558`: Customer identity is at `payload.id`; reason was `verified` and `payload.verified` was true.

The production parser accepts the captured root `payload.id` identity contract only for `member.created` and `member.updated`, and the captured nested identity contract for supported plan events. Unevidenced root `data.id` and `member.deleted` forms remain fail-closed.

## Automated contract evidence

`pnpm test` passed 203/203 tests on 2026-08-18 after replaying the captured root identity shapes through `parseMemberstackWebhookEnvelope`.

The Memberstack-focused suite also covers:

- exact RS256 issuer, audience, expiry, signature, and key selection;
- wrong-audience, expired, and modified browser tokens;
- current, inactive, multiple-plan, and removed-Customer admission behavior;
- whole-envelope verification through pinned `@memberstack/admin@1.6.0`;
- required Svix headers, modified payload rejection, stale replay rejection, and durable delivery dedupe;
- unknown and ambiguous webhook envelopes remaining unable to grant eligibility.

## Hosted acceptance

The staging secret digest identifies this evidence bundle.

- [x] Signed test-mode delivery `msg_3I5epbP1hjWo1fmR1mD9WPSBH3v` passed whole-envelope verification, authoritative current-Customer retrieval, and durable event handling with HTTP `200` (`duplicate: false`, request `8fe0593f-28d3-405b-8cd7-833a68dfd263`).
- [x] The same delivery was safely acknowledged as a duplicate with HTTP `200` (`duplicate: true`, request `903ae06a-0a9f-44d9-a135-2cdb9b1b1a41`).
- [ ] The resulting redacted Customer snapshot contains the active test plan. The captured update delivery may have been intentionally marked `ignored` because the test-mode webhook endpoint was created after the original Customer; replay the original `member.created` and `member.plan.added` deliveries in order before claiming snapshot onboarding.
- [ ] Webflow browser JWT and Offer-eligibility acceptance passes using the verified test Customer.

The successful delivery required the Memberstack test-mode server key (`sk_sb_...`) and test-mode endpoint signing secret; a live-mode server key correctly could not retrieve the test Customer.

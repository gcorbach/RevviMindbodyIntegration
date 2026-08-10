import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemberstackAuthorizationHeader,
  MemberstackBrowserAuthenticationError,
} from "../../docs/webflow/memberstack-auth.js";

test("the Webflow adapter waits for Memberstack and sends only its bearer token", async () => {
  let resolveReady;
  const browser = {
    $memberstackReady: new Promise((resolve) => {
      resolveReady = resolve;
    }),
  };
  const resultPromise = createMemberstackAuthorizationHeader(browser);
  browser.$memberstackDom = {
    getCurrentMember: async () => ({ data: { id: "member-must-not-leave-browser-adapter" } }),
    getMemberCookie: async () => "memberstack.jwt.signature",
  };
  resolveReady();

  assert.deepEqual(await resultPromise, {
    Authorization: "Bearer memberstack.jwt.signature",
  });
});

test("the Webflow adapter represents a logged-out Customer without inventing identity", async () => {
  const browser = {
    $memberstackDom: {
      getCurrentMember: async () => ({ data: null }),
      getMemberCookie: async () => "must-not-be-used",
    },
  };

  assert.equal(await createMemberstackAuthorizationHeader(browser), null);
});

test("an unsupported or malformed Memberstack browser contract fails closed", async (t) => {
  await t.test("missing DOM package", async () => {
    await assert.rejects(
      createMemberstackAuthorizationHeader({ $memberstackReady: Promise.resolve() }),
      (error) => error instanceof MemberstackBrowserAuthenticationError,
    );
  });
  await t.test("malformed token", async () => {
    await assert.rejects(
      createMemberstackAuthorizationHeader({
        $memberstackDom: {
          getCurrentMember: async () => ({ data: { id: "member-a" } }),
          getMemberCookie: async () => "not a compact jwt",
        },
      }),
      (error) => error instanceof MemberstackBrowserAuthenticationError,
    );
  });
});

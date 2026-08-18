import assert from "node:assert/strict";
import test from "node:test";

import {
  createSite99SandboxProvider,
  Site99SandboxConfigurationError,
} from "../../supabase/functions/_shared/mindbody-site-99-hosted.js";
import { mindbodyStaffRuntimeConfigured } from "../../supabase/functions/_shared/mindbody-runtime-provider.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const exactContext = Object.freeze({
  integration: { environment: "sandbox", providerSiteId: "-99" },
  location: { providerLocationId: "1" },
  mapping: {
    paidPaymentRoute: "mindbody_sandbox_cash",
    sandboxDemoWriteEnabled: true,
    sandboxDemoCustomerId: "customer-demo",
  },
});

test("hosted Site -99 provider issues and revokes a temporary staff token around one operation", async () => {
  const requests = [];
  const provider = createSite99SandboxProvider({
    context: exactContext,
    customerId: "customer-demo",
    apiKey: "api-key",
    username: "sandbox-staff",
    password: "sandbox-password",
    fetchImpl: async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/usertoken/issue")) {
        return json({ AccessToken: "temporary-staff-token", TokenType: "Bearer" });
      }
      if (String(url).endsWith("/usertoken/revoke")) return json({});
      return json({ marker: "provider-result" });
    },
    createProvider: (options) => ({
      probe: async () => {
        assert.equal(options.siteId, "-99");
        assert.equal(options.userToken, "temporary-staff-token");
        return options.fetchImpl("https://api.mindbodyonline.com/provider-operation");
      },
    }),
  });

  const result = await provider.probe();
  assert.equal((await result.json()).marker, "provider-result");
  assert.match(requests[0].url, /\/public\/v6\/usertoken\/issue$/);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    Username: "sandbox-staff",
    Password: "sandbox-password",
  });
  assert.match(requests.at(-1).url, /\/public\/v6\/usertoken\/revoke$/);
  assert.equal(requests.at(-1).init.headers.Authorization, "Bearer temporary-staff-token");
});

test("hosted Site -99 provider rejects production, another Site, or another Customer before authentication", () => {
  const base = {
    context: exactContext,
    customerId: "customer-demo",
    apiKey: "api-key",
    username: "sandbox-staff",
    password: "sandbox-password",
    fetchImpl: async () => { throw new Error("must not call Mindbody"); },
    createProvider: () => ({ probe: async () => ({}) }),
  };
  for (const candidate of [
    { ...base, context: { ...exactContext, integration: { environment: "production", providerSiteId: "-99" } } },
    { ...base, context: { ...exactContext, integration: { environment: "sandbox", providerSiteId: "123" } } },
    { ...base, customerId: "customer-attacker" },
  ]) {
    assert.throws(
      () => createSite99SandboxProvider(candidate),
      (error) => error instanceof Site99SandboxConfigurationError,
    );
  }
});

test("a revoke failure after an accepted operation preserves evidence and remains unknown", async () => {
  const accepted = { status: "confirmed", visitId: "visit-99", saleId: "sale-99" };
  const provider = createSite99SandboxProvider({
    context: exactContext,
    customerId: "customer-demo",
    apiKey: "api-key",
    username: "sandbox-staff",
    password: "sandbox-password",
    fetchImpl: async (url) => String(url).endsWith("/usertoken/issue")
      ? json({ AccessToken: "temporary-staff-token" })
      : json({}, 503),
    createProvider: () => ({ createBooking: async () => accepted }),
  });
  await assert.rejects(
    provider.createBooking({}),
    (error) => error instanceof Site99SandboxConfigurationError
      && error.certainty === "unknown"
      && error.providerResult === accepted,
  );
});

test("runtime configuration predicates return booleans rather than credential values", () => {
  assert.equal(mindbodyStaffRuntimeConfigured({
    staffTokens: {}, sandboxUsername: "staff", sandboxPassword: "secret-value",
  }), true);
  assert.equal(typeof mindbodyStaffRuntimeConfigured({
    staffTokens: {}, sandboxUsername: "staff", sandboxPassword: "secret-value",
  }), "boolean");
});

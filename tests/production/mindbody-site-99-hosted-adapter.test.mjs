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

const withStaffOperationLease = (operation) => operation();

test("hosted Site -99 provider issues and revokes a temporary staff token around one operation", async () => {
  const requests = [];
  const provider = createSite99SandboxProvider({
    withStaffOperationLease,
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

test("hosted Site -99 serializes parallel operations so temporary staff tokens cannot invalidate each other", async () => {
  const events = [];
  let issued = 0;
  let releaseFirst;
  const firstOperation = new Promise((resolve) => { releaseFirst = resolve; });
  const provider = createSite99SandboxProvider({
    withStaffOperationLease,
    context: exactContext,
    customerId: "customer-demo",
    apiKey: "api-key",
    username: "sandbox-staff",
    password: "sandbox-password",
    fetchImpl: async (url) => {
      if (String(url).endsWith("/usertoken/issue")) {
        issued += 1;
        events.push(`issue-${issued}`);
        return json({ AccessToken: `token-${issued}` });
      }
      if (String(url).endsWith("/usertoken/revoke")) {
        events.push("revoke");
        return json({});
      }
      throw new Error("unexpected request");
    },
    createProvider: ({ userToken }) => ({
      probe: async (name) => {
        events.push(`${name}-${userToken}`);
        if (name === "first") await firstOperation;
        return name;
      },
    }),
  });

  const first = provider.probe("first");
  const second = provider.probe("second");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["issue-1", "first-token-1"]);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, [
    "issue-1", "first-token-1", "revoke",
    "issue-2", "second-token-2", "revoke",
  ]);
});

test("hosted Site -99 supplies only its proven fictitious Client defaults", async () => {
  const providerCalls = [];
  const provider = createSite99SandboxProvider({
    withStaffOperationLease,
    context: exactContext,
    customerId: "customer-demo",
    apiKey: "api-key",
    username: "sandbox-staff",
    password: "sandbox-password",
    fetchImpl: async (url) => {
      if (String(url).endsWith("/usertoken/issue")) {
        return json({ AccessToken: "temporary-staff-token" });
      }
      if (String(url).endsWith("/site/genders")) {
        return json({ GenderOptions: [{ Id: 1, Name: "None", IsActive: true, IsDefault: true }] });
      }
      return json({});
    },
    createProvider: () => ({
      getRequiredClientFields: async () => ["AddressLine1", "BirthDate", "Email", "IsMale"],
      addClient: async (input) => {
        providerCalls.push(input);
        return { id: "client-99", uniqueId: 99 };
      },
    }),
  });

  assert.deepEqual(await provider.getRequiredClientFields(), ["Email"]);
  assert.deepEqual(await provider.addClient({
    client: { FirstName: "Test", LastName: "Customer", Email: "test@example.test" },
    test: false,
  }), { id: "client-99", uniqueId: 99 });
  assert.deepEqual(providerCalls, [{
    client: {
      FirstName: "Test",
      LastName: "Customer",
      Email: "test@example.test",
      AddressLine1: "123 Sandbox Way",
      BirthDate: "1990-01-01T00:00:00",
      Gender: "None",
    },
    test: false,
  }]);
});

test("hosted Site -99 provider rejects production, another Site, or a disabled mapping before authentication", () => {
  const base = {
    withStaffOperationLease,
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
    { ...base, context: { ...exactContext, mapping: { ...exactContext.mapping, sandboxDemoWriteEnabled: false } } },
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
    withStaffOperationLease,
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

test("two eligible Customers can use the same enabled partner sandbox mapping", async () => {
  const calls = [];
  for (const customerId of ["customer-demo", "customer-second"]) {
    const provider = createSite99SandboxProvider({
      withStaffOperationLease, context: exactContext, customerId,
      apiKey: "api-key", username: "staff", password: "password",
      fetchImpl: async (url) => String(url).endsWith("/usertoken/issue")
        ? json({ AccessToken: "temporary-token" }) : json({}),
      createProvider: () => ({ findClient: async (input) => { calls.push(input); return input; } }),
    });
    assert.deepEqual(await provider.findClient({ customerId }), { customerId });
  }
  assert.deepEqual(calls, [{ customerId: "customer-demo" }, { customerId: "customer-second" }]);
});

test("runtime selects each partner's Site and credentials without fallback to another integration", async () => {
  const { createMindbodyRuntimeProvider } = await import("../../supabase/functions/_shared/mindbody-runtime-provider.js");
  const staffTokens = { "integration-a": "partner-a-private-token", "integration-b": "partner-b-private-token" };
  const calls = [];
  const options = {
    customerId: "same-member", apiKey: "api-key", staffTokens,
    createProvider: (input) => { calls.push(input); return {}; },
  };
  for (const suffix of ["a", "b"]) {
    createMindbodyRuntimeProvider({ ...options, context: {
      integration: { id: `integration-${suffix}`, providerSiteId: `site-${suffix}` },
    } });
  }
  assert.deepEqual(calls.map(({ siteId, userToken }) => ({ siteId, userToken })), [
    { siteId: "site-a", userToken: staffTokens["integration-a"] },
    { siteId: "site-b", userToken: staffTokens["integration-b"] },
  ]);
  assert.throws(() => createMindbodyRuntimeProvider({ ...options,
    context: { integration: { id: "integration-c", providerSiteId: "site-c" } },
  }), /No staff token/);
  assert.equal(calls.length, 2);
});

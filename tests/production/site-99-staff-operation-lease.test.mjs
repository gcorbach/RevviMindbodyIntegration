import assert from "node:assert/strict";
import test from "node:test";

import {
  createSite99StaffOperationLease,
  Site99StaffOperationLeaseError,
} from "../../supabase/functions/_shared/site-99-staff-operation-lease.js";

test("the Site -99 staff lease wraps an operation in durable claim and release RPCs", async () => {
  const calls = [];
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: true, error: null };
    },
  };
  const withLease = createSite99StaffOperationLease(supabase);

  assert.equal(await withLease(async () => "done"), "done");
  assert.deepEqual(calls.map((call) => call.name), [
    "claim_site_99_staff_operation_lease",
    "release_site_99_staff_operation_lease",
  ]);
  assert.equal(calls[0].args.candidate_holder_token, calls[1].args.candidate_holder_token);
  assert.equal(calls[0].args.candidate_ttl_seconds, 300);
});

test("the Site -99 staff lease waits for another Edge request and then acquires", async () => {
  const claims = [false, false, true];
  let elapsed = 0;
  const supabase = {
    rpc: async (name) => name.startsWith("claim_")
      ? { data: claims.shift(), error: null }
      : { data: true, error: null },
  };
  const withLease = createSite99StaffOperationLease(supabase, {
    waitMs: 1_000,
    pollMs: 100,
    now: () => elapsed,
    sleep: async (milliseconds) => { elapsed += milliseconds; },
  });

  assert.equal(await withLease(async () => "acquired"), "acquired");
  assert.equal(elapsed, 200);
});

test("the Site -99 staff lease fails closed when the durable lease stays busy", async () => {
  let elapsed = 0;
  const supabase = { rpc: async () => ({ data: false, error: null }) };
  const withLease = createSite99StaffOperationLease(supabase, {
    waitMs: 200,
    pollMs: 100,
    now: () => elapsed,
    sleep: async (milliseconds) => { elapsed += milliseconds; },
  });

  await assert.rejects(
    withLease(async () => "must not run"),
    (error) => error instanceof Site99StaffOperationLeaseError
      && error.code === "SITE_99_STAFF_LEASE_BUSY",
  );
});

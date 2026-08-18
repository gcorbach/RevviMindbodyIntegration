const DEFAULT_WAIT_MS = 20_000;
const DEFAULT_POLL_MS = 100;
const DEFAULT_TTL_SECONDS = 300;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class Site99StaffOperationLeaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Site99StaffOperationLeaseError";
    this.code = code;
    this.certainty = "unknown";
  }
}

export function createSite99StaffOperationLease(supabase, options = {}) {
  if (!supabase || typeof supabase.rpc !== "function") throw new TypeError("supabase.rpc is required.");
  const waitMs = Number(options.waitMs ?? DEFAULT_WAIT_MS);
  const pollMs = Number(options.pollMs ?? DEFAULT_POLL_MS);
  const ttlSeconds = Number(options.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? delay;
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 60_000
    || !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 5_000
    || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 300) {
    throw new TypeError("Site -99 staff lease timing is invalid.");
  }

  return async function withSite99StaffOperationLease(operation) {
    if (typeof operation !== "function") throw new TypeError("operation is required.");
    const holderToken = crypto.randomUUID();
    const deadline = now() + waitMs;
    let acquired = false;
    while (!acquired) {
      const { data, error } = await supabase.rpc("claim_site_99_staff_operation_lease", {
        candidate_holder_token: holderToken,
        candidate_ttl_seconds: ttlSeconds,
      });
      if (error) {
        throw new Site99StaffOperationLeaseError(
          "SITE_99_STAFF_LEASE_UNAVAILABLE",
          "The Mindbody sandbox staff-operation lease is unavailable.",
        );
      }
      acquired = data === true;
      if (!acquired) {
        if (now() >= deadline) {
          throw new Site99StaffOperationLeaseError(
            "SITE_99_STAFF_LEASE_BUSY",
            "The Mindbody sandbox is busy. Try again shortly.",
          );
        }
        await sleep(pollMs);
      }
    }

    let primaryError;
    try {
      return await operation();
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      const { data, error } = await supabase.rpc("release_site_99_staff_operation_lease", {
        candidate_holder_token: holderToken,
      });
      if (!primaryError && (error || data !== true)) {
        throw new Site99StaffOperationLeaseError(
          "SITE_99_STAFF_LEASE_RELEASE_UNCONFIRMED",
          "The Mindbody sandbox staff-operation lease release could not be confirmed.",
        );
      }
    }
  };
}

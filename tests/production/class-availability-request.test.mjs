import assert from "node:assert/strict";
import test from "node:test";

import {
  ClassAvailabilityRequestError,
  normalizeMindbodyDateTime,
  parseClassAvailabilityRequest,
  resolveClassAvailabilityDateRange,
} from "../../supabase/functions/_shared/class-availability-request.js";

const ids = Object.freeze({
  offerId: "33000000-0000-4000-8000-000000000001",
  locationId: "33000000-0000-4000-8000-000000000002",
});

test("the Webflow request keeps only the binding Offer and preselected Location context", () => {
  assert.deepEqual(parseClassAvailabilityRequest({
    businessSlug: "pilot-yoga",
    ...ids,
    startDate: "2026-08-11",
    endDate: "2026-08-24",
    classFamilyId: "33000000-0000-4000-8000-000000000003",
    classId: "caller-must-not-authorize-an-occurrence",
    providerLocationId: "caller-must-not-authorize-provider-ids",
  }), {
    businessSlug: "pilot-yoga",
    ...ids,
    startDate: "2026-08-11",
    endDate: "2026-08-24",
    classFamilyId: "33000000-0000-4000-8000-000000000003",
  });
});

test("the default availability range is fourteen local calendar days", () => {
  assert.deepEqual(resolveClassAvailabilityDateRange({
    startDate: null,
    endDate: null,
    timezone: "Africa/Johannesburg",
    now: new Date("2026-08-10T23:30:00.000Z"),
  }), {
    startDate: "2026-08-11",
    endDate: "2026-08-24",
    startAt: "2026-08-10T22:00:00.000Z",
    endAt: "2026-08-24T21:59:59.999Z",
  });
});

test("Mindbody local Class times are converted with the configured Location timezone", () => {
  assert.equal(
    normalizeMindbodyDateTime("2026-08-12T18:00:00", "Africa/Johannesburg"),
    "2026-08-12T16:00:00.000Z",
  );
  assert.equal(
    normalizeMindbodyDateTime("2026-08-12T18:00:00+02:00", "Africa/Johannesburg"),
    "2026-08-12T16:00:00.000Z",
  );
});

test("invalid identifiers, dates, reversed ranges, and ranges over 31 days fail before provider reads", () => {
  const invalidRequests = [
    { businessSlug: "Pilot Yoga", ...ids },
    { businessSlug: "pilot-yoga", ...ids, offerId: "not-a-uuid" },
    { businessSlug: "pilot-yoga", ...ids, startDate: "2026-02-30" },
    { businessSlug: "pilot-yoga", ...ids, endDate: "2026-08-20" },
  ];
  for (const request of invalidRequests) {
    assert.throws(
      () => parseClassAvailabilityRequest(request),
      (error) => error instanceof ClassAvailabilityRequestError && error.status === 400,
    );
  }
  assert.throws(
    () => resolveClassAvailabilityDateRange({
      startDate: "2026-08-11",
      endDate: "2026-08-10",
      timezone: "Africa/Johannesburg",
      now: new Date("2026-08-10T12:00:00Z"),
    }),
    (error) => error.code === "INVALID_DATE_RANGE",
  );
  assert.throws(
    () => resolveClassAvailabilityDateRange({
      startDate: "2026-08-01",
      endDate: "2026-09-01",
      timezone: "Africa/Johannesburg",
      now: new Date("2026-08-01T00:00:00Z"),
    }),
    (error) => error.code === "DATE_RANGE_TOO_LONG",
  );
});

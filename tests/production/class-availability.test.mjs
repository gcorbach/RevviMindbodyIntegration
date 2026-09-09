import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverOfferClassAvailability,
} from "../../supabase/functions/_shared/class-availability.js";

const context = Object.freeze({
  business: { id: "business-a", slug: "pilot-yoga", displayName: "Pilot Yoga" },
  location: {
    id: "location-a",
    displayName: "Rosebank",
    providerLocationId: "7",
    timezone: "Africa/Johannesburg",
  },
  offer: {
    id: "offer-a",
    displayName: "Revvi Yoga Offer",
    fulfilmentMode: "purchase_pricing_option",
  },
  integration: { id: "integration-a", providerSiteId: "-99", status: "active" },
  mapping: {
    id: "mapping-a",
    status: "active",
    providerServiceProductId: "product-revvi",
  },
  customerProviderProfile: {
    providerClientId: "client-1",
    providerClientUniqueId: "unique-client-1",
  },
  inventoryAllowlist: {
    location: ["7"],
    program: ["11"],
    classDescription: ["13"],
    sessionType: ["23"],
    classSchedule: ["17"],
  },
});

function happyProvider(overrides = {}) {
  return {
    getSites: async () => [{ Id: -99, Name: "Pilot Yoga", CurrencyIsoCode: "ZAR" }],
    getLocations: async () => [{ Id: 7, Name: "Rosebank", HasClasses: true }],
    getPrograms: async () => [{ Id: 11, Name: "Yoga", ScheduleType: "Class" }],
    getClassDescriptions: async () => [{
      Id: 13,
      Name: "Yoga Flow",
      Description: "A one-hour flow class.",
      Active: true,
      Program: { Id: 11 },
      SessionType: { Id: 23 },
    }],
    getClassSchedules: async () => [{ Id: 17 }],
    getClasses: async () => [{
      Id: 19,
      ClassScheduleId: 17,
      StartDateTime: "2026-08-12T18:00:00+02:00",
      EndDateTime: "2026-08-12T19:00:00+02:00",
      Location: { Id: 7 },
      Staff: { Id: 29, DisplayName: "Amina" },
      ClassDescription: {
        Id: 13,
        Name: "Yoga Flow",
        Description: "A one-hour flow class.",
        Program: { Id: 11 },
        SessionType: { Id: 23 },
      },
      Active: true,
      IsCanceled: false,
      IsAvailable: true,
      IsWaitlistAvailable: false,
      MaxCapacity: 20,
      WebCapacity: 12,
      TotalBooked: 7,
      WebBooked: 5,
      BookingWindow: {
        StartDateTime: "2026-08-01T00:00:00+02:00",
        EndDateTime: "2026-08-12T17:55:00+02:00",
      },
    }],
    getServices: async () => [{
      ProductId: "product-revvi",
      Id: "barcode-must-not-be-used",
      Name: "Revvi — Yoga — Rosebank",
      Price: 39,
      OnlinePrice: 32,
      SellOnline: true,
      Discontinued: false,
      SellAtLocationIds: [7],
      UseAtLocationIds: [7],
    }],
    ...overrides,
  };
}

test("an approved Offer discovers future client-aware Class occurrences and its ProductId price", async () => {
  const calls = [];
  const provider = happyProvider({
    getClasses: async (query) => {
      calls.push(["classes", query]);
      return happyProvider().getClasses();
    },
    getServices: async (query) => {
      calls.push(["services", query]);
      return happyProvider().getServices();
    },
  });

  const result = await discoverOfferClassAvailability({
    context,
    startAt: "2026-08-11T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, { provider, now: () => new Date("2026-08-10T12:00:00.000Z") });

  assert.deepEqual(result, {
    business: { id: "business-a", name: "Pilot Yoga", slug: "pilot-yoga" },
    location: { id: "location-a", name: "Rosebank", timezone: "Africa/Johannesburg" },
    offer: { id: "offer-a", title: "Revvi Yoga Offer" },
    sessions: [{
      sessionId: "19",
      classId: "19",
      classScheduleId: "17",
      classDescriptionId: "13",
      programId: "11",
      sessionTypeId: "23",
      name: "Yoga Flow",
      description: "A one-hour flow class.",
      staffId: "29",
      staffName: "Amina",
      startAt: "2026-08-12T16:00:00.000Z",
      endAt: "2026-08-12T17:00:00.000Z",
      timezone: "Africa/Johannesburg",
      maxCapacity: 20,
      webCapacity: 12,
      totalBooked: 7,
      webBooked: 5,
      estimatedAvailableSlots: 7,
      availabilityState: "available",
      availabilityReasons: [],
      provisionalPrice: {
        amount: 32,
        currency: "ZAR",
        serviceProductId: "product-revvi",
      },
    }],
  });
  assert.deepEqual(calls, [
    ["classes", {
      locationIds: ["7"],
      programIds: ["11"],
      classDescriptionIds: ["13"],
      sessionTypeIds: ["23"],
      classScheduleIds: ["17"],
      startDateTime: "2026-08-11T22:00:00.000Z",
      endDateTime: "2026-08-25T21:59:59.999Z",
      clientId: "client-1",
      hideCanceledClasses: false,
      schedulingWindow: true,
    }],
    ["services", {
      classId: "19",
      locationId: "7",
      staffId: "29",
      sellOnline: true,
      includeDiscontinued: false,
    }],
  ]);
});

test("a paid Offer can resolve one applicable Product from its approved Product set", async () => {
  const multiProductContext = {
    ...context,
    mapping: {
      ...context.mapping,
      providerServiceProductIds: ["product-shared", "product-strength"],
    },
  };
  const result = await discoverOfferClassAvailability({
    context: multiProductContext,
    startAt: "2026-08-11T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, {
    provider: happyProvider({
      getServices: async () => [{
        ProductId: "product-strength",
        OnlinePrice: 44,
        SellOnline: true,
        Discontinued: false,
        SellAtLocationIds: [7],
        UseAtLocationIds: [7],
      }],
    }),
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  });
  assert.equal(result.sessions[0].provisionalPrice.serviceProductId, "product-strength");
  assert.equal(result.sessions[0].provisionalPrice.amount, 44);
});

test("Site -99 availability resolves a reset pricing-option ID from its stable name", async () => {
  const resetSafeContext = {
    ...context,
    mapping: { ...context.mapping, providerServiceProductId: "stale-product" },
    classFamilies: [{
      id: "family-yoga",
      status: "active",
      providerServiceProductName: "5 Class Card",
      providerMappings: [{
        providerLocationId: "7",
        providerClassDescriptionId: "13",
        providerProgramId: "11",
        providerSessionTypeId: "23",
        providerClassScheduleId: "17",
      }],
    }],
  };
  const result = await discoverOfferClassAvailability({
    context: resetSafeContext,
    classFamilyId: "family-yoga",
    startAt: "2026-08-11T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, {
    provider: happyProvider({
      getServices: async () => [{
        ProductId: "today-product",
        Name: "  5   CLASS card ",
        OnlinePrice: 55,
        SellOnline: true,
        Discontinued: false,
        SellAtLocationIds: [7],
        UseAtLocationIds: [7],
      }],
    }),
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  });

  assert.equal(result.sessions[0].provisionalPrice.serviceProductId, "today-product");
  assert.equal(result.sessions[0].provisionalPrice.amount, 55);
});

test("a selected Class family admits only its complete provider taxonomy mappings", async () => {
  const familyContext = {
    ...context,
    classFamilies: [{
      id: "family-hot",
      displayName: "Hot Yoga",
      providerMappings: [{
        id: "family-mapping-hot",
        providerLocationId: "7",
        providerClassDescriptionId: "13",
        providerProgramId: "11",
        providerSessionTypeId: "23",
      }],
    }, {
      id: "family-restorative",
      displayName: "Restorative Yoga",
      providerMappings: [{
        id: "family-mapping-restorative",
        providerLocationId: "7",
        providerClassDescriptionId: "14",
        providerProgramId: "11",
        providerSessionTypeId: "24",
      }],
    }],
  };
  const provider = happyProvider({
    getClassDescriptions: async () => [
      {
        Id: 13,
        Name: "Hot Yoga",
        Description: "A heated flow class.",
        Active: true,
        Program: { Id: 11 },
        SessionType: { Id: 23 },
      },
      {
        Id: 14,
        Name: "Restorative Yoga",
        Description: "A gentle evening class.",
        Active: true,
        Program: { Id: 11 },
        SessionType: { Id: 24 },
      },
    ],
    getClasses: async () => [
      ...(await happyProvider().getClasses()),
      {
        Id: 20,
        ClassScheduleId: 18,
        StartDateTime: "2026-08-13T18:00:00+02:00",
        EndDateTime: "2026-08-13T19:00:00+02:00",
        Location: { Id: 7 },
        ClassDescription: {
          Id: 14,
          Name: "Restorative Yoga",
          Description: "A gentle evening class.",
          Program: { Id: 11 },
          SessionType: { Id: 24 },
        },
        Active: true,
        IsCanceled: false,
        IsAvailable: true,
        MaxCapacity: 12,
        WebCapacity: 12,
        TotalBooked: 2,
        WebBooked: 2,
      },
    ],
  });

  const result = await discoverOfferClassAvailability({
    context: familyContext,
    classFamilyId: "family-restorative",
    startAt: "2026-08-11T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, { provider, now: () => new Date("2026-08-10T12:00:00.000Z") });

  assert.equal(result.classFamily.id, "family-restorative");
  assert.deepEqual(result.sessions.map((session) => session.classId), ["20"]);
  assert.equal(result.sessions[0].classDescriptionId, "14");
  assert.equal(result.sessions[0].programId, "11");
  assert.equal(result.sessions[0].sessionTypeId, "24");

  const catalogueResult = await discoverOfferClassAvailability({
    context: familyContext,
    startAt: "2026-08-11T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, { provider, now: () => new Date("2026-08-10T12:00:00.000Z") });
  assert.deepEqual(catalogueResult.classFamilies.map(({ id, name, available }) => ({ id, name, available })), [
    { id: "family-hot", name: "Hot Yoga", available: true },
    { id: "family-restorative", name: "Restorative Yoga", available: true },
  ]);
  assert.deepEqual(
    catalogueResult.classFamilies.map(({ nextOccurrence: session }) => [session.classId, session.classFamilyId]),
    [["19", "family-hot"], ["20", "family-restorative"]],
  );
});

test("unapproved, inactive, cancelled, past, and wrong-location occurrences never reach pricing", async () => {
  const [approved] = await happyProvider().getClasses();
  const serviceClassIds = [];
  const provider = happyProvider({
    getClasses: async () => [
      approved,
      { ...approved, Id: 20, Location: { Id: 8 } },
      { ...approved, Id: 21, ClassDescription: { ...approved.ClassDescription, Program: { Id: 12 } } },
      { ...approved, Id: 22, ClassDescription: { ...approved.ClassDescription, Id: 14 } },
      { ...approved, Id: 23, ClassDescription: { ...approved.ClassDescription, SessionType: { Id: 24 } } },
      { ...approved, Id: 24, ClassScheduleId: 18 },
      { ...approved, Id: 25, Active: false },
      { ...approved, Id: 250, Active: undefined },
      { ...approved, Id: 26, IsCanceled: true },
      { ...approved, Id: 27, StartDateTime: "2026-08-10T10:00:00Z" },
      { ...approved, Id: 28, StartDateTime: "2026-09-10T10:00:00Z" },
    ],
    getServices: async ({ classId }) => {
      serviceClassIds.push(classId);
      return happyProvider().getServices();
    },
  });

  const result = await discoverOfferClassAvailability({
    context,
    startAt: "2026-08-09T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, { provider, now: () => new Date("2026-08-10T12:00:00.000Z") });

  assert.deepEqual(result.sessions.map((item) => item.classId), ["19"]);
  assert.deepEqual(serviceClassIds, ["19"]);
});

test("capacity and booking-window uncertainty is normalized without inventing remaining spots", async () => {
  const [approved] = await happyProvider().getClasses();
  const provider = happyProvider({
    getClasses: async () => [
      {
        ...approved,
        Id: 30,
        MaxCapacity: null,
        WebCapacity: null,
        TotalBooked: null,
        WebBooked: null,
      },
      {
        ...approved,
        Id: 31,
        IsAvailable: false,
        MaxCapacity: 20,
        WebCapacity: 12,
        TotalBooked: 20,
        WebBooked: 12,
      },
      {
        ...approved,
        Id: 32,
        IsAvailable: false,
        IsWaitlistAvailable: true,
        MaxCapacity: 20,
        WebCapacity: 12,
        TotalBooked: 20,
        WebBooked: 12,
      },
      {
        ...approved,
        Id: 33,
        BookingWindow: {
          StartDateTime: "2026-08-11T00:00:00Z",
          EndDateTime: "2026-08-12T15:00:00Z",
        },
      },
      {
        ...approved,
        Id: 34,
        IsAvailable: true,
        MaxCapacity: 20,
        WebCapacity: 12,
        TotalBooked: 7,
        WebBooked: 13,
      },
      {
        ...approved,
        Id: 35,
        IsAvailable: false,
        MaxCapacity: null,
        WebCapacity: null,
        TotalBooked: null,
        WebBooked: null,
      },
      {
        ...approved,
        Id: 36,
        BookingWindow: {
          StartDateTime: "2026-08-01T00:00:00+02:00",
          EndDateTime: "2026-08-12T17:55:00+02:00",
          DailyStartTime: "15:00:00",
          DailyEndTime: "17:00:00",
        },
      },
    ],
  });
  const entitlementContext = {
    ...context,
    offer: { ...context.offer, fulfilmentMode: "existing_entitlement" },
    mapping: { ...context.mapping, providerServiceProductId: null },
  };

  const result = await discoverOfferClassAvailability({
    context: entitlementContext,
    startAt: "2026-08-11T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, { provider, now: () => new Date("2026-08-10T12:00:00.000Z") });

  assert.deepEqual(result.sessions.map((item) => ({
    id: item.classId,
    slots: item.estimatedAvailableSlots,
    state: item.availabilityState,
    reasons: item.availabilityReasons,
  })), [
    { id: "30", slots: null, state: "available", reasons: [] },
    { id: "31", slots: 0, state: "full", reasons: ["capacity_full"] },
    { id: "32", slots: 0, state: "waitlist_available", reasons: ["regular_booking_unavailable"] },
    { id: "33", slots: 7, state: "outside_booking_window", reasons: ["outside_booking_window"] },
    { id: "34", slots: null, state: "unknown", reasons: ["capacity_contradictory"] },
    { id: "35", slots: null, state: "client_ineligible", reasons: ["provider_client_unavailable"] },
    { id: "36", slots: 7, state: "outside_booking_window", reasons: ["outside_booking_window"] },
  ]);
});

test("anonymous IsAvailable=false remains unknown rather than claiming client ineligibility", async () => {
  const [approved] = await happyProvider().getClasses();
  let classesQuery;
  const provider = happyProvider({
    getClasses: async (query) => {
      classesQuery = query;
      return [{
        ...approved,
        IsAvailable: false,
        MaxCapacity: null,
        WebCapacity: null,
        TotalBooked: null,
        WebBooked: null,
      }];
    },
  });
  const anonymousContext = {
    ...context,
    offer: { ...context.offer, fulfilmentMode: "existing_entitlement" },
    mapping: { ...context.mapping, providerServiceProductId: null },
    customerProviderProfile: null,
  };

  const result = await discoverOfferClassAvailability({
    context: anonymousContext,
    startAt: "2026-08-11T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, { provider, now: () => new Date("2026-08-10T12:00:00.000Z") });

  assert.equal(Object.hasOwn(classesQuery, "clientId"), false);
  assert.equal(result.sessions[0].availabilityState, "unknown");
  assert.deepEqual(
    result.sessions[0].availabilityReasons,
    ["anonymous_availability_not_client_specific"],
  );
});

test("provider inventory requires explicit active Class Description evidence", async () => {
  const provider = happyProvider({
    getClassDescriptions: async () => [{
      Id: 13,
      Name: "Yoga Flow",
      Program: { Id: 11 },
      SessionType: { Id: 23 },
    }],
  });

  const result = await discoverOfferClassAvailability({
    context,
    startAt: "2026-08-11T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, { provider, now: () => new Date("2026-08-10T12:00:00.000Z") });

  assert.deepEqual(result.sessions, []);
});

test("overnight daily booking windows are evaluated in the Business Location timezone", async () => {
  const [approved] = await happyProvider().getClasses();
  const provider = happyProvider({
    getClasses: async () => [{
      ...approved,
      BookingWindow: {
        StartDateTime: "2026-08-01T00:00:00+02:00",
        EndDateTime: "2026-08-12T17:55:00+02:00",
        DailyStartTime: "22:00:00",
        DailyEndTime: "06:00:00",
      },
    }],
  });

  const result = await discoverOfferClassAvailability({
    context,
    startAt: "2026-08-11T22:00:00.000Z",
    endAt: "2026-08-25T21:59:59.999Z",
  }, { provider, now: () => new Date("2026-08-10T12:00:00.000Z") });

  assert.equal(result.sessions[0].availabilityState, "outside_booking_window");
  assert.deepEqual(result.sessions[0].availabilityReasons, ["outside_booking_window"]);
});

test("paid availability requires the exact mapped ProductId and its online sale/use Location", async (t) => {
  const baseService = (await happyProvider().getServices())[0];
  const cases = [
    ["barcode-only match", [{ ...baseService, ProductId: "another-product", Id: "product-revvi" }]],
    ["wrong sale Location", [{ ...baseService, SellAtLocationIds: [8] }]],
    ["wrong use Location", [{ ...baseService, UseAtLocationIds: [8] }]],
    ["not sold online", [{ ...baseService, SellOnline: false }]],
    ["discontinued", [{ ...baseService, Discontinued: true }]],
    ["ambiguous duplicate ProductId", [baseService, { ...baseService, Id: "other-barcode" }]],
  ];

  for (const [label, services] of cases) {
    await t.test(label, async () => {
      const result = await discoverOfferClassAvailability({
        context,
        startAt: "2026-08-11T22:00:00.000Z",
        endAt: "2026-08-25T21:59:59.999Z",
      }, {
        provider: happyProvider({ getServices: async () => services }),
        now: () => new Date("2026-08-10T12:00:00.000Z"),
      });
      assert.deepEqual(result.sessions, []);
    });
  }
});

test("an overly broad provider result fails closed before per-Class pricing fan-out", async () => {
  const [approved] = await happyProvider().getClasses();
  let pricingReached = false;
  const provider = happyProvider({
    getClasses: async () => Array.from({ length: 201 }, (_, index) => ({ ...approved, Id: 1_000 + index })),
    getServices: async () => { pricingReached = true; return happyProvider().getServices(); },
  });

  await assert.rejects(
    discoverOfferClassAvailability({
      context,
      startAt: "2026-08-11T22:00:00.000Z",
      endAt: "2026-08-25T21:59:59.999Z",
    }, { provider, now: () => new Date("2026-08-10T12:00:00.000Z") }),
    (error) => error.code === "CLASS_RESULT_LIMIT_EXCEEDED" && error.status === 409,
  );
  assert.equal(pricingReached, false);
});

test("family catalogue prices one preview and defers full times until family selection", async () => {
  const familyContext = { ...context, classFamilies: [{
    id: "family-yoga", displayName: "Yoga", providerMappings: [{
      providerLocationId: "7", providerProgramId: "11",
      providerClassDescriptionId: "13", providerSessionTypeId: "23",
    }],
  }] };
  const [first] = await happyProvider().getClasses();
  const calls = [];
  const provider = happyProvider({
    getClasses: async () => [first, { ...first, Id: 20, StartDateTime: "2026-08-13T18:00:00+02:00", EndDateTime: "2026-08-13T19:00:00+02:00" }],
    getServices: async (query) => { calls.push(query.classId); return happyProvider().getServices(); },
  });
  const input = { context: familyContext, startAt: "2026-08-11T22:00:00.000Z", endAt: "2026-08-25T21:59:59.999Z" };
  const dependencies = { provider, now: () => new Date("2026-08-10T12:00:00.000Z") };
  const catalogue = await discoverOfferClassAvailability(input, dependencies);
  assert.deepEqual(calls, ["19"]);
  assert.deepEqual(catalogue.sessions, []);
  assert.equal(catalogue.classFamilies[0].availabilityState, "available");
  assert.equal(catalogue.classFamilies[0].nextOccurrence.classId, "19");
  assert.equal(catalogue.classFamilies[0].provisionalPrice.amount, 32);
  calls.length = 0;
  const times = await discoverOfferClassAvailability({ ...input, classFamilyId: "family-yoga" }, dependencies);
  assert.deepEqual(calls.sort(), ["19", "20"]);
  assert.deepEqual(times.sessions.map(item => item.classId), ["19", "20"]);
});

test("catalogue keeps cancelled and waitlist-only families disabled without pricing them", async () => {
  const [first] = await happyProvider().getClasses();
  for (const [changes, expected] of [[{ IsCanceled: true }, "cancelled"], [{ IsAvailable: false, IsWaitlistAvailable: true }, "unavailable"]]) {
    const familyContext = { ...context, classFamilies: [{ id: "family-yoga", providerMappings: [{
      providerLocationId: "7", providerProgramId: "11", providerClassDescriptionId: "13", providerSessionTypeId: "23",
    }] }] };
    const result = await discoverOfferClassAvailability({ context: familyContext,
      startAt: "2026-08-11T22:00:00.000Z", endAt: "2026-08-25T21:59:59.999Z",
    }, { now: () => new Date("2026-08-10T12:00:00Z"), provider: happyProvider({
      getClasses: async () => [{ ...first, ...changes }],
      getServices: async () => assert.fail("Disabled families must not be priced"),
    }) });
    assert.equal(result.classFamilies[0].availabilityState, expected);
    assert.equal(result.classFamilies[0].available, false);
    assert.deepEqual(result.sessions, []);
  }
});

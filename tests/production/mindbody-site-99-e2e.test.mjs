import assert from "node:assert/strict";
import test from "node:test";

import { createSite99Runner, Site99RunError } from "../../tools/mindbody-site-99-e2e.mjs";

const environment = Object.freeze({
  MINDBODY_API_KEY: "sandbox-app-key",
  MINDBODY_SANDBOX_USERNAME: "sandbox-staff",
  MINDBODY_SANDBOX_PASSWORD: "sandbox-password",
  MINDBODY_SANDBOX_SITE_ID: "-99",
  MINDBODY_SANDBOX_CLIENT_ID: "client-shared",
  MINDBODY_SANDBOX_PRODUCT_ID: "1424",
  MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([{
    id: "00000000-0000-4000-8000-000000000101",
    name: "Yoga",
    mappings: [{
      providerLocationId: "1",
      providerClassDescriptionId: "223",
      providerProgramId: "27",
      providerSessionTypeId: "250",
    }],
  }]),
});

test("the Site -99 runner requires an explicit current sandbox Product mapping", () => {
  assert.throws(
    () => createSite99Runner({
      environment: { ...environment, MINDBODY_SANDBOX_PRODUCT_ID: undefined },
    }),
    (error) => error instanceof Site99RunError
      && error.code === "MISSING_ENVIRONMENT"
      && error.detail === "MINDBODY_SANDBOX_PRODUCT_ID",
  );
});

test("the Site -99 runner requires an explicit Class-family manifest", () => {
  assert.throws(
    () => createSite99Runner({
      environment: { ...environment, MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: undefined },
    }),
    (error) => error instanceof Site99RunError
      && error.code === "MISSING_ENVIRONMENT"
      && error.detail === "MINDBODY_SANDBOX_CLASS_FAMILIES_JSON",
  );
});

test("the Site -99 runner accepts stable family selectors without daily provider IDs", async () => {
  const provider = sandboxProvider();
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: undefined,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([{
      id: "00000000-0000-4000-8000-000000000101",
      name: "Yoga",
      selectors: [{
        locationName: "Clubville",
        programName: "Yoga",
        classDescriptionName: "Yoga",
        sessionTypeName: "Hatha Yoga",
      }],
    }]),
  };
  const result = await runner(provider, { environment: selectorEnvironment }).run("quote");

  assert.equal(result.result, "passed");
  assert.equal(result.fixture.productId, "1424");
  assert.deepEqual(result.fixture, {
    classId: "19364",
    classFamilyId: "00000000-0000-4000-8000-000000000101",
    classFamilyName: "Yoga",
    classStart: "2026-08-18T10:00:00",
    classEnd: "2026-08-18T11:00:00",
    className: "Yoga",
    locationId: "1",
    programId: "27",
    classDescriptionId: "223",
    sessionTypeId: "250",
    classScheduleId: "2152",
    staffId: "9",
    staffName: "Sandbox Staff",
    productId: "1424",
    paymentSeed: 13,
  });
  assert.ok(provider.requests.some((request) => request.url.pathname.endsWith("site/sessiontypes")));
  const checkout = provider.requests.find((request) => request.url.pathname.endsWith("checkoutshoppingcart"));
  assert.equal(checkout.body.Items[0].Item.Metadata.Id, "1424");
});

test("stable family selectors ignore a stale daily Product ID and resolve the current Class-filtered pricing option", async () => {
  const provider = sandboxProvider({ multipleProducts: true });
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: "1428",
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([{
      id: "00000000-0000-4000-8000-000000000101",
      name: "Yoga",
      selectors: [{
        locationName: "Clubville",
        programName: "Yoga",
        classDescriptionName: "Yoga",
        sessionTypeName: "Hatha Yoga",
      }],
    }]),
  };

  const result = await runner(provider, { environment: selectorEnvironment }).run("probe");

  assert.equal(result.fixture.productId, "1419");
  const serviceRequests = provider.requests.filter((request) => request.url.pathname.endsWith("sale/services"));
  assert.ok(serviceRequests.every((request) => request.url.searchParams.get("request.classId") === "19364"));
  assert.ok(serviceRequests.every((request) => !request.url.searchParams.has("ClassId")));
});

test("each selector-mode run rediscovers the current Product after a sandbox reset", async () => {
  const provider = sandboxProvider({ productChangesBetweenRuns: true });
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: undefined,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([{
      id: "00000000-0000-4000-8000-000000000101",
      name: "Yoga",
      selectors: [{
        locationName: "Clubville",
        programName: "Yoga",
        classDescriptionName: "Yoga",
        sessionTypeName: "Hatha Yoga",
      }],
    }]),
  };
  const resetSafeRunner = runner(provider, { environment: selectorEnvironment });

  const beforeReset = await resetSafeRunner.run("probe");
  const afterReset = await resetSafeRunner.run("probe");

  assert.equal(beforeReset.fixture.productId, "1424");
  assert.equal(afterReset.fixture.productId, "1419");
});

test("a stable pricing-option name resolves one Product from the current Class candidates", async () => {
  const provider = sandboxProvider({ liveAmbiguousProducts: true, classIdReadsRequireDateWindow: true });
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: undefined,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([{
      id: "00000000-0000-4000-8000-000000000101",
      name: "Yoga",
      pricingOptionName: "5 Class Card",
      selectors: [{
        locationName: "Clubville",
        programName: "Yoga",
        classDescriptionName: "Yoga",
        sessionTypeName: "Hatha Yoga",
      }],
    }]),
  };

  const result = await runner(provider, { environment: selectorEnvironment }).run("probe");

  assert.equal(result.fixture.productId, "1300");
  const serviceRequests = provider.requests.filter((request) => request.url.pathname.endsWith("sale/services"));
  assert.ok(serviceRequests.every((request) => !request.url.searchParams.has("request.hideRelatedPrograms")));
  assert.ok(serviceRequests.every((request) => !request.url.searchParams.has("request.programIds")));
  assert.ok(serviceRequests.every((request) => !request.url.searchParams.has("request.sessionTypeIds")));
});

test("the Site -99 runner fails closed when a selector occurrence has multiple applicable Products", async () => {
  const provider = sandboxProvider({ ambiguousProduct: true });
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: undefined,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([{
      id: "00000000-0000-4000-8000-000000000101",
      name: "Yoga",
      selectors: [{
        locationName: "Clubville",
        programName: "Yoga",
        classDescriptionName: "Yoga",
        sessionTypeName: "Hatha Yoga",
      }],
    }]),
  };

  await assert.rejects(
    runner(provider, { environment: selectorEnvironment }).run("probe"),
    (error) => error instanceof Site99RunError
      && error.code === "AMBIGUOUS_PRODUCT"
      && error.detail.includes("19364")
      && error.detail.includes("1424:Yoga Drop-in")
      && error.detail.includes("1425:Another Yoga Drop-in"),
  );
});

test("selector-based families keep multiple live taxonomy tuples and one shared Product", async () => {
  const provider = sandboxProvider({ multiFamily: true });
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: undefined,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000101",
        name: "Yoga",
        selectors: [{
          locationName: "Clubville",
          programName: "Yoga",
          classDescriptionName: "Yoga",
          sessionTypeName: "Hatha Yoga",
        }],
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        name: "Strength Yoga",
        selectors: [{
          locationName: "Clubville",
          programName: "Yoga",
          classDescriptionName: "Strength Yoga",
          sessionTypeName: "Strength Yoga",
        }],
      },
    ]),
  };
  const result = await runner(provider, { environment: selectorEnvironment }).run("probe");

  assert.deepEqual(result.families, [
    { id: "00000000-0000-4000-8000-000000000101", name: "Yoga", available: true, availabilityState: "available" },
    { id: "00000000-0000-4000-8000-000000000102", name: "Strength Yoga", available: true, availabilityState: "available" },
  ]);
  assert.deepEqual(result.fixtures.map((fixture) => [
    fixture.classFamilyId,
    fixture.classDescriptionId,
    fixture.sessionTypeId,
    fixture.productId,
  ]), [
    ["00000000-0000-4000-8000-000000000101", "223", "250", "1424"],
    ["00000000-0000-4000-8000-000000000102", "224", "251", "1424"],
  ]);
});

test("probe mode reports the live availability state of every configured Class family", async () => {
  const provider = sandboxProvider({ mixedFamilyStates: true });
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: undefined,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000101",
        name: "Yoga",
        pricingOptionName: "5 Class Card",
        selectors: [{
          locationName: "Clubville", programName: "Yoga",
          classDescriptionName: "Yoga", sessionTypeName: "Hatha Yoga",
        }],
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        name: "Sweat",
        pricingOptionName: "5 Class Card",
        selectors: [{
          locationName: "Clubville", programName: "Yoga",
          classDescriptionName: "Sweat", sessionTypeName: "Work out of the day",
        }],
      },
      {
        id: "00000000-0000-4000-8000-000000000103",
        name: "RPM Spinning",
        pricingOptionName: "5 Class Card",
        selectors: [{
          locationName: "Clubville", programName: "Yoga",
          classDescriptionName: "RPM Spinning", sessionTypeName: "Spinning",
        }],
      },
    ]),
  };

  const result = await runner(provider, { environment: selectorEnvironment }).run("probe");

  assert.deepEqual(result.families, [
    { id: "00000000-0000-4000-8000-000000000101", name: "Yoga", available: true, availabilityState: "available" },
    { id: "00000000-0000-4000-8000-000000000102", name: "Sweat", available: false, availabilityState: "unavailable" },
    { id: "00000000-0000-4000-8000-000000000103", name: "RPM Spinning", available: false, availabilityState: "cancelled" },
  ]);
  assert.deepEqual(result.fixtures.map((fixture) => fixture.classId), ["19364"]);
});

test("catalogue mode reports one priced next occurrence per available family without staff reads", async () => {
  const provider = sandboxProvider({ mixedFamilyStates: true });
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: undefined,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000101",
        name: "Yoga",
        pricingOptionName: "5 Class Card",
        selectors: [{
          locationName: "Clubville", programName: "Yoga",
          classDescriptionName: "Yoga", sessionTypeName: "Hatha Yoga",
        }],
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        name: "Sweat",
        pricingOptionName: "5 Class Card",
        selectors: [{
          locationName: "Clubville", programName: "Yoga",
          classDescriptionName: "Sweat", sessionTypeName: "Work out of the day",
        }],
      },
      {
        id: "00000000-0000-4000-8000-000000000103",
        name: "RPM Spinning",
        pricingOptionName: "5 Class Card",
        selectors: [{
          locationName: "Clubville", programName: "Yoga",
          classDescriptionName: "RPM Spinning", sessionTypeName: "Spinning",
        }],
      },
    ]),
  };

  const result = await runner(provider, { environment: selectorEnvironment }).run("catalogue");

  assert.deepEqual(result.families, [
    {
      id: "00000000-0000-4000-8000-000000000101",
      name: "Yoga",
      available: true,
      availabilityState: "available",
      nextOccurrence: {
        classId: "19364",
        classStart: "2026-08-18T10:00:00",
        classEnd: "2026-08-18T11:00:00",
        className: "Yoga",
        staffName: "Sandbox Staff",
      },
      provisionalPrice: { amount: 55, currency: "USD" },
    },
    { id: "00000000-0000-4000-8000-000000000102", name: "Sweat", available: false, availabilityState: "unavailable" },
    { id: "00000000-0000-4000-8000-000000000103", name: "RPM Spinning", available: false, availabilityState: "cancelled" },
  ]);
  assert.deepEqual(result.fixtures, []);
  assert.equal(provider.requests.filter((request) => request.url.pathname.endsWith("sale/services")).length, 1);
  assert.equal(provider.requests.filter((request) => request.url.pathname.endsWith("usertoken/issue")).length, 0);
  assert.equal(provider.requests.filter((request) => request.url.pathname.endsWith("client/clients")).length, 0);
});

test("catalogue mode follows every Class page before choosing the chronological next occurrence", async () => {
  const provider = sandboxProvider({ reversePagedClasses: true });

  const result = await runner(provider).run("catalogue");

  assert.equal(result.families[0].nextOccurrence.classId, "19364");
  assert.equal(result.families[0].nextOccurrence.classStart, "2026-08-18T10:00:00");
  const classReads = provider.requests.filter((request) => request.url.pathname.endsWith("class/classes"));
  assert.deepEqual(classReads.map((request) => [
    request.url.searchParams.get("request.limit"),
    request.url.searchParams.get("request.offset"),
  ]), [["100", "0"], ["100", "1"]]);
});

test("a selected Class family validates pricing with bounded parallel API-key-only reads", async () => {
  const provider = sandboxProvider({ occurrenceCount: 8, serviceDelayMs: 10 });

  const result = await runner(provider).run("availability", {
    classFamilyId: "00000000-0000-4000-8000-000000000101",
  });

  assert.equal(result.fixtures.length, 8);
  assert.ok(provider.maxConcurrentServiceReads() > 1);
  assert.ok(provider.maxConcurrentServiceReads() <= 6);
  assert.equal(provider.requests.filter((request) => request.url.pathname.endsWith("usertoken/issue")).length, 0);
  assert.equal(provider.requests.filter((request) => request.url.pathname.endsWith("client/clients")).length, 0);
});

test("selector discovery reads every description page and admits an inactive description with a live Class", async () => {
  const provider = sandboxProvider({ pagedInactiveDescription: true });
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: undefined,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([{
      id: "00000000-0000-4000-8000-000000000102",
      name: "Daily Work Out",
      pricingOptionName: "5 Class Card",
      selectors: [{
        locationName: "Clubville", programName: "Classes",
        classDescriptionName: "Daily Work Out", sessionTypeName: "Work out of the day",
      }],
    }]),
  };

  const result = await runner(provider, { environment: selectorEnvironment }).run("probe");

  assert.equal(result.fixture.classId, "21978");
  assert.equal(result.fixture.classDescriptionId, "301");
  const descriptionReads = provider.requests
    .filter((request) => request.url.pathname.endsWith("class/classdescriptions"));
  assert.deepEqual(descriptionReads.map((request) => [
    request.url.searchParams.get("IncludeInactive"),
    request.url.searchParams.get("Offset"),
  ]), [["true", "0"], ["true", "100"]]);
});

test("selector discovery prefers the one active description when stable taxonomy names are duplicated", async () => {
  const provider = sandboxProvider({ activeDuplicateDescription: true });
  const selectorEnvironment = {
    ...environment,
    MINDBODY_SANDBOX_PRODUCT_ID: undefined,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([{
      id: "00000000-0000-4000-8000-000000000106",
      name: "Body Pump",
      pricingOptionName: "5 Class Card",
      selectors: [{
        locationName: "Clubville", programName: "Classes",
        classDescriptionName: "Body Pump", sessionTypeName: "Les Mills",
      }],
    }]),
  };

  const result = await runner(provider, { environment: selectorEnvironment }).run("probe");

  assert.equal(result.fixture.classId, "24061");
  assert.equal(result.fixture.classDescriptionId, "170");
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "provider-request-test" },
  });
}

function sandboxProvider({
  omitSale = false,
  ambiguousCheckout = false,
  delayedVisitReads = 0,
  revokeFails = false,
  ambiguousCancellation = false,
  cancellationLagReads = 0,
  multiFamily = false,
  ambiguousProduct = false,
  multipleProducts = false,
  productChangesBetweenRuns = false,
  liveAmbiguousProducts = false,
  classIdReadsRequireDateWindow = false,
  mixedFamilyStates = false,
  pagedInactiveDescription = false,
  activeDuplicateDescription = false,
  occurrenceCount = 1,
  serviceDelayMs = 0,
  providerPaymentType = "Cash",
  reversePagedClasses = false,
} = {}) {
  const requests = [];
  let clientId = "client-shared";
  let visitActive = false;
  let saleCreated = false;
  let hiddenVisitReads = 0;
  let remainingCancellationLagReads = 0;
  let serviceReads = 0;
  let activeServiceReads = 0;
  let maxConcurrentServiceReads = 0;
  const fetchImpl = async (urlValue, init) => {
    const url = new URL(urlValue);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, init, body });
    const path = url.pathname.replace("/public/v6/", "");
    if (path === "site/sites") return json({ Sites: [{ Id: -99, Name: "LastSpot", CurrencyCode: "USD" }] });
    if (path === "site/locations") return json({ Locations: [{ Id: 1, Name: "Clubville" }] });
    if (path === "site/programs") return json({ Programs: pagedInactiveDescription || activeDuplicateDescription
      ? [{ Id: 26, Name: "Classes", ScheduleType: "Class" }]
      : [{ Id: 27, Name: "Yoga", ScheduleType: "Class" }] });
    if (path === "class/classdescriptions") {
      if (pagedInactiveDescription) {
        const offset = Number(url.searchParams.get("Offset") ?? 0);
        return offset === 0
          ? json({
            ClassDescriptions: Array.from({ length: 100 }, (_, index) => ({
              Id: 1000 + index, Name: `Filler ${index}`, Program: { Id: 26 }, Active: false,
            })),
            PaginationResponse: { RequestedLimit: 100, RequestedOffset: 0, PageSize: 100, TotalResults: 101 },
          })
          : json({
            ClassDescriptions: [{ Id: 301, Name: "Daily Work Out", Program: { Id: 26 }, Active: false }],
            PaginationResponse: { RequestedLimit: 100, RequestedOffset: 100, PageSize: 1, TotalResults: 101 },
          });
      }
      if (activeDuplicateDescription) return json({ ClassDescriptions: [
        { Id: 170, Name: "Body Pump", Program: { Id: 26 }, SessionType: { Id: 206 }, Active: true },
        { Id: 198, Name: "Body Pump", Program: { Id: 26 }, SessionType: { Id: 206 }, Active: false },
      ] });
      return json({ ClassDescriptions: mixedFamilyStates
        ? [
          { Id: 223, Name: "Yoga", Program: { Id: 27 }, Active: true },
          { Id: 224, Name: "Sweat", Program: { Id: 27 }, Active: true },
          { Id: 225, Name: "RPM Spinning", Program: { Id: 27 }, Active: true },
        ]
        : multiFamily
        ? [{ Id: 223, Name: "Yoga", Active: true }, { Id: 224, Name: "Strength Yoga", Active: true }]
        : [{ Id: 223, Name: "Yoga", Active: true }] });
    }
    if (path === "site/sessiontypes") return json({ SessionTypes: [
      ...(pagedInactiveDescription || activeDuplicateDescription
        ? [{
          Id: activeDuplicateDescription ? 206 : 251,
          Name: activeDuplicateDescription ? "Les Mills" : "Work out of the day",
          Program: { Id: 26 }, Active: true,
        }]
        : [{ Id: 250, Name: "Hatha Yoga", Program: { Id: 27 }, Active: true }]),
      ...(mixedFamilyStates ? [
        { Id: 251, Name: "Work out of the day", Program: { Id: 27 }, Active: true },
        { Id: 252, Name: "Spinning", Program: { Id: 27 }, Active: true },
      ] : []),
      ...(multiFamily ? [{ Id: 251, Name: "Strength Yoga", Program: { Id: 27 }, Active: true }] : []),
    ] });
    if (path === "usertoken/issue") {
      return json({ AccessToken: "temporary-staff-token", Expires: "2026-08-18T00:00:00Z" });
    }
    if (path === "usertoken/revoke") {
      return revokeFails ? json({ Error: { Code: "TokenRevokeFailed" } }, 503) : json({});
    }
    if (path === "client/clients") return json({ Clients: [{ Id: clientId }] });
    if (path === "client/addclient") {
      if (body.Test === false) clientId = "client-unique";
      return json(body.Test ? {} : { Client: { Id: clientId } });
    }
    if (path === "client/requiredclientfields") {
      return json({ RequiredClientFields: ["AddressLine1", "BirthDate", "Email", "IsMale"] });
    }
    if (path === "site/genders") {
      return json({ GenderOptions: [{ Id: 1, Name: "None", IsActive: true, IsDefault: true }] });
    }
    if (path === "class/classes") {
      if (reversePagedClasses) {
        const offset = Number(url.searchParams.get("request.offset") ?? 0);
        const occurrence = offset === 0
          ? {
            Id: 20386,
            StartDateTime: "2026-08-30T10:00:00",
            EndDateTime: "2026-08-30T11:00:00",
          }
          : {
            Id: 19364,
            StartDateTime: "2026-08-18T10:00:00",
            EndDateTime: "2026-08-18T11:00:00",
          };
        return json({
          Classes: [{
            ...occurrence,
            IsCanceled: false,
            IsAvailable: true,
            IsEnrolled: false,
            ClassScheduleId: 2152,
            Location: { Id: 1, Name: "Clubville" },
            Staff: { Id: 9, Name: "Sandbox Staff" },
            ClassDescription: {
              Id: 223, Name: "Yoga", Program: { Id: 27 }, SessionType: { Id: 250 },
            },
          }],
          PaginationResponse: { RequestedLimit: 100, RequestedOffset: offset, PageSize: 1, TotalResults: 2 },
        });
      }
      const readsByClassId = url.searchParams.has("ClassIds") || url.searchParams.has("request.classIds");
      const requestedClientId = url.searchParams.get("request.clientId");
      const hasDateWindow = url.searchParams.has("request.startDateTime")
        && url.searchParams.has("request.endDateTime");
      if (classIdReadsRequireDateWindow && readsByClassId && !hasDateWindow) {
        return json({ Classes: [] });
      }
      return json({
        Classes: pagedInactiveDescription || activeDuplicateDescription ? [{
          Id: activeDuplicateDescription ? 24061 : 21978,
          StartDateTime: activeDuplicateDescription ? "2026-08-18T14:00:00" : "2026-08-18T06:30:00",
          EndDateTime: activeDuplicateDescription ? "2026-08-18T15:00:00" : "2026-08-18T07:30:00",
          IsCanceled: false,
          IsAvailable: true,
          IsEnrolled: false,
          ClassScheduleId: activeDuplicateDescription ? 2406 : 2197,
          Location: { Id: 1, Name: "Clubville" },
          Staff: { Id: 10, Name: "Jake Hay" },
          ClassDescription: {
            Id: activeDuplicateDescription ? 170 : 301,
            Name: activeDuplicateDescription ? "Body Pump" : "Daily Work Out",
            Program: { Id: 26 },
            SessionType: { Id: activeDuplicateDescription ? 206 : 251 },
          },
        }] : [
          ...Array.from({ length: occurrenceCount }, (_, index) => ({
            Id: 19364 + index,
            StartDateTime: `2026-08-${String(18 + index).padStart(2, "0")}T10:00:00`,
            EndDateTime: `2026-08-${String(18 + index).padStart(2, "0")}T11:00:00`,
            IsCanceled: false,
            IsAvailable: true,
            IsEnrolled: visitActive && requestedClientId === clientId,
            ClassScheduleId: 2152 + index,
            Location: { Id: 1, Name: "Clubville" },
            Staff: { Id: 9, Name: "Sandbox Staff" },
            ClassDescription: {
              Id: 223, Name: "Yoga", Program: { Id: 27 }, SessionType: { Id: 250 },
            },
          })),
          ...(multiFamily ? [{
            Id: 19365,
            StartDateTime: "2026-08-18T11:00:00",
            EndDateTime: "2026-08-18T12:00:00",
            IsCanceled: false,
            IsAvailable: true,
            IsEnrolled: false,
            ClassScheduleId: 2153,
            Location: { Id: 1, Name: "Clubville" },
            Staff: { Id: 9, Name: "Sandbox Staff" },
            ClassDescription: {
              Id: 224, Name: "Strength Yoga", Program: { Id: 27 }, SessionType: { Id: 251 },
            },
          }] : []),
          ...(mixedFamilyStates ? [{
            Id: 19365,
            StartDateTime: "2026-08-18T16:00:00",
            EndDateTime: "2026-08-18T17:00:00",
            IsCanceled: false,
            IsAvailable: false,
            ClassScheduleId: 2153,
            Location: { Id: 1, Name: "Clubville" },
            Staff: { Id: 10, Name: "Unavailable Staff" },
            ClassDescription: {
              Id: 224, Name: "Sweat", Program: { Id: 27 }, SessionType: { Id: 251 },
            },
          }, {
            Id: 19366,
            StartDateTime: "2026-08-18T15:00:00",
            EndDateTime: "2026-08-18T16:00:00",
            IsCanceled: true,
            IsAvailable: false,
            ClassScheduleId: 2154,
            Location: { Id: 1, Name: "Clubville" },
            Staff: { Id: 11, Name: "Cancelled Staff" },
            ClassDescription: {
              Id: 225, Name: "RPM Spinning", Program: { Id: 27 }, SessionType: { Id: 252 },
            },
          }] : []),
        ],
      });
    }
    if (path === "sale/services") {
      serviceReads += 1;
      activeServiceReads += 1;
      maxConcurrentServiceReads = Math.max(maxConcurrentServiceReads, activeServiceReads);
      if (serviceDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, serviceDelayMs));
      activeServiceReads -= 1;
      const resetProductId = productChangesBetweenRuns && serviceReads > 2 ? 1419 : 1424;
      const currentService = {
        ProductId: multipleProducts ? 1419 : resetProductId,
        Name: multipleProducts ? "Single Class" : "Yoga Drop-in",
        SellOnline: true,
        Discontinued: false,
        OnlinePrice: 13,
        TaxRate: 0,
        TaxIncluded: false,
        SellAtLocationIds: [1],
        UseAtLocationIds: [1],
      };
      const ambiguousServices = ambiguousProduct ? [{
        ProductId: 1425,
        Name: "Another Yoga Drop-in",
        SellOnline: true,
        Discontinued: false,
        OnlinePrice: 13,
        TaxRate: 0,
        TaxIncluded: false,
        SellAtLocationIds: [1],
        UseAtLocationIds: [1],
      }] : [];
      const unfilteredResetServices = multipleProducts ? [{
        ProductId: 1357,
        Name: "Five Classes",
        SellOnline: true,
        Discontinued: false,
        OnlinePrice: 55,
        TaxRate: 0,
        TaxIncluded: false,
        SellAtLocationIds: [1],
        UseAtLocationIds: [1],
      }, {
        ProductId: 1364,
        Name: "Ten Classes",
        SellOnline: true,
        Discontinued: false,
        OnlinePrice: 100,
        TaxRate: 0,
        TaxIncluded: false,
        SellAtLocationIds: [1],
        UseAtLocationIds: [1],
      }, {
        ProductId: 1300,
        Name: "Monthly Unlimited",
        SellOnline: true,
        Discontinued: false,
        OnlinePrice: 150,
        TaxRate: 0,
        TaxIncluded: false,
        SellAtLocationIds: [1],
        UseAtLocationIds: [1],
      }] : [];
      const liveServices = liveAmbiguousProducts || mixedFamilyStates
        || pagedInactiveDescription || activeDuplicateDescription ? [{
        ProductId: 1357,
        Name: "1 Month Unlimited",
        SellOnline: true,
        Discontinued: false,
        OnlinePrice: 150,
        TaxRate: 0,
        TaxIncluded: false,
        SellAtLocationIds: [1],
        UseAtLocationIds: [1],
      }, {
        ProductId: 1364,
        Name: "10 Class Card",
        SellOnline: true,
        Discontinued: false,
        OnlinePrice: 100,
        TaxRate: 0,
        TaxIncluded: false,
        SellAtLocationIds: [1],
        UseAtLocationIds: [1],
      }, {
        ProductId: 1300,
        Name: "5 Class Card",
        SellOnline: true,
        Discontinued: false,
        OnlinePrice: 55,
        TaxRate: 0,
        TaxIncluded: false,
        SellAtLocationIds: [1],
        UseAtLocationIds: [1],
      }, {
        ProductId: 1419,
        Name: "World Membership",
        SellOnline: true,
        Discontinued: false,
        OnlinePrice: 200,
        TaxRate: 0,
        TaxIncluded: false,
        SellAtLocationIds: [1],
        UseAtLocationIds: [1],
      }] : null;
      const classFilterApplied = url.searchParams.get("request.classId") === "19364";
      if (liveAmbiguousProducts && url.searchParams.get("request.hideRelatedPrograms") === "true") {
        return json({ Services: [] });
      }
      return json({
        Services: liveServices
          ?? [currentService, ...ambiguousServices, ...(classFilterApplied ? [] : unfilteredResetServices)],
      });
    }
    const visit = { Id: 100343801, ClassId: 19364, ClientId: clientId, ServiceId: 7001 };
    const visitVisible = () => {
      if (!visitActive && remainingCancellationLagReads > 0) {
        remainingCancellationLagReads -= 1;
        return true;
      }
      if (!visitActive) return false;
      if (hiddenVisitReads > 0) {
        hiddenVisitReads -= 1;
        return false;
      }
      return true;
    };
    if (path === "client/clientvisits") return json({ Visits: visitVisible() ? [visit] : [] });
    if (path === "class/classvisits") {
      return json({ Class: { Id: 19364, Clients: visitVisible() ? [{ Id: clientId, VisitId: 100343801 }] : [] } });
    }
    if (path === "client/clientschedule") {
      return json({ Classes: visitVisible() ? [{ Id: 19364, Clients: [{ Id: clientId, VisitId: 100343801 }] }] : [] });
    }
    if (path === "sale/sales") {
      return json({
        Sales: saleCreated && !omitSale
          ? [{
            Id: 100170553,
            ClientId: clientId,
            ShoppingCartId: "cart-1",
            PurchasedItems: [{ Id: 1424, SaleDetailId: 188790, Returned: false }],
            Payments: [{ Id: 168194, Type: providerPaymentType, Amount: 13, TransactionId: null }],
          }]
          : [],
      });
    }
    if (path === "sale/transactions") return json({ Transactions: [] });
    if (path === "client/clientservices") {
      return json({
        ClientServices: saleCreated
          ? [{ Id: 7001, ProductId: 1424, Current: true, Returned: false, Remaining: 0 }]
          : [],
      });
    }
    if (path === "sale/checkoutshoppingcart") {
      if (body.Test === false) {
        visitActive = true;
        saleCreated = true;
        hiddenVisitReads = delayedVisitReads;
        if (ambiguousCheckout) throw new TypeError("connection reset after acceptance");
      }
      return json({
        ShoppingCart: {
          Id: "cart-1", SubTotal: 13, DiscountTotal: 0, TaxTotal: 0, GrandTotal: 13,
          ...(body.Test === false ? { SaleId: 100170553 } : {}),
        },
      });
    }
    if (path === "class/removeclientfromclass") {
      if (body.Test === false) {
        visitActive = false;
        remainingCancellationLagReads = cancellationLagReads;
        if (ambiguousCancellation) throw new TypeError("connection reset after cancellation acceptance");
      }
      return json({});
    }
    return json({ Error: { Code: "UnexpectedEndpoint" } }, 404);
  };
  return {
    fetchImpl,
    requests,
    state: () => ({ clientId, visitActive, saleCreated }),
    maxConcurrentServiceReads: () => maxConcurrentServiceReads,
  };
}

function runner(provider, overrides = {}) {
  return createSite99Runner({
    environment,
    fetchImpl: provider.fetchImpl,
    clock: () => new Date("2026-08-17T00:00:00Z"),
    uniqueId: () => "run-123",
    pollOptions: { attempts: 1, intervalMs: 0 },
    ...overrides,
  });
}

test("the Site -99 runner rejects every other provider Site and origin", () => {
  assert.throws(
    () => createSite99Runner({ environment: { ...environment, MINDBODY_SANDBOX_SITE_ID: "123" } }),
    (error) => error instanceof Site99RunError && error.code === "SITE_NOT_ALLOWED",
  );
  assert.throws(
    () => createSite99Runner({ environment: { ...environment, MINDBODY_BASE_URL: "https://example.test" } }),
    (error) => error instanceof Site99RunError && error.code === "ORIGIN_NOT_ALLOWED",
  );
});

test("quote mode proves key-only catalogue reads and two Test=true quotes create no provider state", async () => {
  const provider = sandboxProvider();
  const result = await runner(provider).run("quote");

  assert.equal(result.result, "passed");
  assert.match(result.quote.requestDigest, /^[a-f0-9]{64}$/);
  assert.match(result.quote.immediateRequote.requestDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual({
    ...result.quote,
    requestDigest: "<digest>",
    immediateRequote: { ...result.quote.immediateRequote, requestDigest: "<digest>" },
  }, {
    subtotal: 13,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: 13,
    requestDigest: "<digest>",
    providerRequestId: "provider-request-test",
    testCreatedProviderState: false,
    immediateRequote: {
      subtotal: 13,
      discountTotal: 0,
      taxTotal: 0,
      grandTotal: 13,
      requestDigest: "<digest>",
      providerRequestId: "provider-request-test",
    },
    totalsUnchanged: true,
  });
  assert.deepEqual(provider.state(), { clientId: "client-shared", visitActive: false, saleCreated: false });
  const checkouts = provider.requests.filter((request) => request.url.pathname.endsWith("checkoutshoppingcart"));
  assert.deepEqual(checkouts.map((request) => request.body.Test), [true, true]);
  assert.ok(checkouts.every((request) => request.body.SendEmail === false));
  const publicClassRead = provider.requests.find((request) => request.url.pathname.endsWith("class/classes"));
  assert.equal(publicClassRead.init.headers.Authorization, undefined);
  assert.deepEqual(result.auth.endpointAuthMatrix.apiKeyOnly, {
    sites: "accepted",
    locations: "accepted",
    programs: "accepted",
    classDescriptions: "accepted",
    classes: "accepted",
    services: "accepted",
  });
  assert.equal(result.auth.staffTokenRevoked, true);
  assert.doesNotMatch(JSON.stringify(result), /sandbox-app-key|sandbox-password|temporary-staff-token/);
});

test("probe mode exposes live occurrences grouped by configured Class family", async () => {
  const provider = sandboxProvider({ multiFamily: true });
  const environmentWithFamilies = {
    ...environment,
    MINDBODY_SANDBOX_CLASS_FAMILIES_JSON: JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000101",
        name: "Yoga",
        mappings: [{
          providerLocationId: "1",
          providerClassDescriptionId: "223",
          providerProgramId: "27",
          providerSessionTypeId: "250",
        }],
      },
      {
        id: "00000000-0000-4000-8000-000000000102",
        name: "Strength Yoga",
        mappings: [{
          providerLocationId: "1",
          providerClassDescriptionId: "224",
          providerProgramId: "27",
          providerSessionTypeId: "251",
        }],
      },
    ]),
  };
  const result = await runner(provider, { environment: environmentWithFamilies }).run("probe");

  assert.deepEqual(result.families, [
    { id: "00000000-0000-4000-8000-000000000101", name: "Yoga", available: true, availabilityState: "available" },
    { id: "00000000-0000-4000-8000-000000000102", name: "Strength Yoga", available: true, availabilityState: "available" },
  ]);
  assert.deepEqual(result.fixtures.map((fixture) => [fixture.classFamilyId, fixture.classId]), [
    ["00000000-0000-4000-8000-000000000101", "19364"],
    ["00000000-0000-4000-8000-000000000102", "19365"],
  ]);
  assert.deepEqual(result.fixtures.map((fixture) => [fixture.classEnd, fixture.staffName]), [
    ["2026-08-18T11:00:00", "Sandbox Staff"],
    ["2026-08-18T12:00:00", "Sandbox Staff"],
  ]);
  const selected = await runner(provider, { environment: environmentWithFamilies })
    .run("probe", { classFamilyId: "00000000-0000-4000-8000-000000000102" });
  assert.deepEqual(selected.fixtures.map((fixture) => fixture.classId), ["19365"]);
});

test("committed mode waits for every evidence surface, proves exact facts, and always removes the Visit", async () => {
  const provider = sandboxProvider({ delayedVisitReads: 6, providerPaymentType: "Sandbox configured label" });
  const result = await runner(provider, {
    environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    pollOptions: { attempts: 3, intervalMs: 0 },
  }).run("book-and-cancel");

  assert.equal(result.result, "passed");
  assert.deepEqual(result.syntheticClient, {
    syntheticClientCreated: true,
    addClientTestMode: "unsupported-by-site-99",
  });
  assert.match(result.booking.checkoutRequestDigest, /^[a-f0-9]{64}$/);
  assert.match(result.booking.cancellationRequestDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual({
    ...result.booking,
    checkoutRequestDigest: "<digest>",
    cancellationRequestDigest: "<digest>",
  }, {
    cartId: "cart-1",
    checkoutRequestDigest: "<digest>",
    checkoutProviderRequestId: "provider-request-test",
    saleId: "100170553",
    paymentId: "168194",
    paymentType: "Cash",
    providerPaymentType: "Sandbox configured label",
    paymentAmount: 13,
    transactionId: null,
    transactionEvidence: "not-returned-for-cash",
    visitId: "100343801",
    clientServiceId: "7001",
    clientServiceCurrent: true,
    clientServiceRemaining: 0,
    clientVisitConfirmed: true,
    rosterConfirmed: true,
    clientScheduleConfirmed: true,
    checkoutReplayAttempted: false,
    testCancellationPreservedVisit: true,
    cancellationConfirmed: true,
    cancellationRequestDigest: "<digest>",
    cancellationProviderRequestIds: {
      test: "provider-request-test",
      committed: "provider-request-test",
    },
    postCancellation: {
      saleReturned: false,
      paymentStillRecorded: true,
      refundEvidence: "none-observed",
      clientServiceCurrent: true,
      clientServiceRemaining: 0,
      entitlementRestorationObserved: false,
    },
  });
  assert.deepEqual(provider.state(), { clientId: "client-unique", visitActive: false, saleCreated: true });
  const addClientBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("client/addclient"))
    .map((request) => request.body);
  assert.deepEqual(addClientBodies.map((body) => body.Test), [false]);
  assert.match(addClientBodies[0].Email, /^revvi-sandbox-/);
  assert.equal(addClientBodies[0].Gender, "None");
  assert.equal("GenderOptionId" in addClientBodies[0], false);
  assert.equal("IsMale" in addClientBodies[0], false);
  const checkoutBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("checkoutshoppingcart"))
    .map((request) => request.body);
  assert.deepEqual(checkoutBodies.map((body) => body.Test), [true, true, false]);
  assert.ok(checkoutBodies.every((body) => body.ClientId === "client-unique"));
  const cancellationBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("removeclientfromclass"))
    .map((request) => request.body);
  assert.deepEqual(cancellationBodies.map((body) => body.Test), [true, false]);
});

test("inspection mode leaves the exact evidenced Visit active until cleanup", async () => {
  const provider = sandboxProvider({ delayedVisitReads: 6 });
  const result = await runner(provider, {
    environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    pollOptions: { attempts: 3, intervalMs: 0 },
  }).run("book-for-inspection");

  assert.equal(result.result, "passed");
  assert.equal(result.booking.inspectionStatus, "active");
  assert.equal(result.booking.visitId, "100343801");
  assert.equal(provider.state().visitActive, true);
  assert.equal(provider.requests.some((request) => request.url.pathname.endsWith("removeclientfromclass")), false);
});

test("inspection cleanup removes the exact pending Visit and proves the result", async () => {
  const provider = sandboxProvider({ delayedVisitReads: 6 });
  const site99 = runner(provider, {
    environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    pollOptions: { attempts: 3, intervalMs: 0 },
  });
  const active = await site99.run("book-for-inspection");

  const cleaned = await site99.run("cleanup-inspection");

  assert.equal(active.booking.visitId, "100343801");
  assert.equal(cleaned.booking.visitId, active.booking.visitId);
  assert.equal(cleaned.booking.inspectionStatus, "cleaned");
  assert.equal(cleaned.booking.cancellationConfirmed, true);
  assert.equal(provider.state().visitActive, false);
  const cancellationBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("removeclientfromclass"))
    .map((request) => request.body);
  assert.deepEqual(cancellationBodies.map((body) => body.Test), [true, false]);
});

test("probe refresh stays public while an inspection Booking is active", async () => {
  const provider = sandboxProvider({ delayedVisitReads: 6 });
  const site99 = runner(provider, {
    environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    pollOptions: { attempts: 3, intervalMs: 0 },
  });
  const active = await site99.run("book-for-inspection");

  const refreshed = await site99.run("probe");
  const cleaned = await site99.run("cleanup-inspection");

  assert.equal(active.booking.inspectionStatus, "active");
  assert.deepEqual(refreshed.fixtures.map((fixture) => fixture.classId), ["19364"]);
  assert.equal(cleaned.booking.cancellationConfirmed, true);
  assert.equal(provider.state().visitActive, false);
});

test("ambiguous inspection cancellation is reconciled through reads without replaying the write", async () => {
  const provider = sandboxProvider({ ambiguousCancellation: true, cancellationLagReads: 5 });
  const site99 = runner(provider, {
    environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    pollOptions: { attempts: 3, intervalMs: 0 },
  });
  await site99.run("book-for-inspection");
  await assert.rejects(
    () => site99.run("cleanup-inspection"),
    (error) => error instanceof Site99RunError && error.code === "NETWORK_ERROR",
  );

  const reconciled = await site99.run("cleanup-inspection");

  assert.equal(reconciled.booking.cancellationConfirmed, true);
  const committedCancellations = provider.requests.filter((request) => request.url.pathname.endsWith("removeclientfromclass")
    && request.body.Test === false);
  assert.equal(committedCancellations.length, 1);
});

test("a missing post-checkout Sale is unknown but still triggers targeted cleanup", async () => {
  const provider = sandboxProvider({ omitSale: true });
  await assert.rejects(
    () => runner(provider, {
      environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    }).run("book-and-cancel"),
    (error) => error instanceof Site99RunError
      && error.code === "EVIDENCE_NOT_CONVERGED"
      && error.detail?.activeVisit === true
      && error.detail?.newSale === false
      && error.detail?.clientService === true,
  );
  assert.equal(provider.state().visitActive, false);
  const cancellationBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("removeclientfromclass"))
    .map((request) => request.body);
  assert.deepEqual(cancellationBodies.map((body) => body.Test), [true, false]);
});

test("an ambiguous checkout response polls delayed evidence and removes the accepted Visit", async () => {
  const provider = sandboxProvider({ ambiguousCheckout: true, delayedVisitReads: 6 });
  await assert.rejects(
    () => runner(provider, {
      environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
      pollOptions: { attempts: 3, intervalMs: 0 },
    }).run("book-and-cancel"),
    (error) => error instanceof Site99RunError && error.code === "NETWORK_ERROR",
  );
  assert.equal(provider.state().visitActive, false);
  const cancellationBodies = provider.requests
    .filter((request) => request.url.pathname.endsWith("removeclientfromclass"))
    .map((request) => request.body);
  assert.deepEqual(cancellationBodies.map((body) => body.Test), [true, false]);
});

test("committed mode cannot write without the exact Site -99 confirmation phrase", async () => {
  const provider = sandboxProvider();
  await assert.rejects(
    () => runner(provider).run("book-and-cancel"),
    (error) => error instanceof Site99RunError && error.code === "WRITE_NOT_CONFIRMED",
  );
  assert.deepEqual(provider.state(), { clientId: "client-shared", visitActive: false, saleCreated: false });
  assert.equal(provider.requests.some((request) => request.init.method === "POST"
    && !request.url.pathname.endsWith("usertoken/issue")), false);
});

test("a staff-token revocation failure prevents a passed result", async () => {
  const provider = sandboxProvider({ revokeFails: true });
  await assert.rejects(
    () => runner(provider).run("quote"),
    (error) => error instanceof Site99RunError && error.code === "TokenRevokeFailed",
  );
});

test("a token-revocation failure after inspection Booking cannot orphan the active Visit", async () => {
  const provider = sandboxProvider({ revokeFails: true });

  await assert.rejects(
    () => runner(provider, {
      environment: { ...environment, MINDBODY_SANDBOX_WRITE_CONFIRM: "BOOK_AND_CANCEL_SITE_-99" },
    }).run("book-for-inspection"),
    (error) => error instanceof Site99RunError && error.code === "TokenRevokeFailed",
  );

  assert.equal(provider.state().visitActive, false);
  const committedCancellations = provider.requests.filter((request) => request.url.pathname.endsWith("removeclientfromclass")
    && request.body.Test === false);
  assert.equal(committedCancellations.length, 1);
});

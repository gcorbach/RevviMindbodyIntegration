import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

// Independent provider-contract oracle: it deliberately does not call the production adapter.
const API_ORIGIN = "https://api.mindbodyonline.com";
const API_BASE = `${API_ORIGIN}/public/v6`;
const SITE_ID = "-99";
const WRITE_CONFIRMATION = "BOOK_AND_CANCEL_SITE_-99";
const PROVIDER_REQUEST_ID = Symbol("providerRequestId");
const RUN_MODE_POLICIES = Object.freeze({
  probe: Object.freeze({ outcome: "probe" }),
  quote: Object.freeze({ outcome: "quote", quotes: true }),
  "book-and-cancel": Object.freeze({
    outcome: "booking", quotes: true, createsSyntheticClient: true, cleanupOnSuccess: true,
  }),
  "book-for-inspection": Object.freeze({
    outcome: "booking", quotes: true, createsSyntheticClient: true, retainsInspection: true,
  }),
  "cleanup-inspection": Object.freeze({ outcome: "cleanup", requiresInspection: true }),
});

function text(value) {
  return value == null ? null : String(value).trim() || null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function id(value) {
  return text(value?.Id ?? value?.id ?? value);
}

function requiredEnvironment(environment, name) {
  const value = text(environment[name]);
  if (!value) throw new Site99RunError("configuration", "MISSING_ENVIRONMENT", null, name);
  return value;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Site99RunError("fixture", "INVALID_PRICE");
  return Math.round(number * 100) / 100;
}

function nullableMoney(value) {
  return Number.isFinite(Number(value)) ? money(value) : null;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function providerRequestId(envelope) {
  return text(envelope?.[PROVIDER_REQUEST_ID]);
}

function paymentSeed(service) {
  const price = money(service.OnlinePrice);
  if (service.TaxIncluded === true) return price;
  return money(price * (1 + Number(service.TaxRate ?? 0)));
}

function query(values) {
  const result = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) value.forEach((item) => result.append(name, String(item)));
    else result.set(name, String(value));
  }
  return result;
}

function sortedFacts(facts, key) {
  return facts.filter(Boolean).sort((left, right) => String(left[key]).localeCompare(String(right[key])));
}

function visitFact(value, inheritedClassId = null) {
  if (!value || typeof value !== "object") return null;
  const visitId = id(value.Visit ?? value.VisitId ?? value);
  if (!visitId) return null;
  return {
    visitId,
    classId: text(value.ClassId ?? value.Class?.Id ?? inheritedClassId),
    clientId: text(value.ClientId ?? value.Client?.Id ?? value.Id),
    clientServiceId: text(value.ServiceId ?? value.ClientServiceId ?? value.ClientService?.Id),
    cancelled: value.Cancelled === true
      || value.IsCancelled === true
      || value.LateCancelled === true
      || /cancel/i.test(text(value.Status ?? value.AppointmentStatus) ?? ""),
  };
}

function scheduledVisits(envelope) {
  const occurrences = [
    ...array(envelope?.Classes),
    ...(envelope?.Class && typeof envelope.Class === "object" ? [envelope.Class] : []),
  ];
  return occurrences.flatMap((occurrence) => array(occurrence?.Clients).map((client) => ({
    visitId: text(client.VisitId ?? client.Visit?.Id),
    classId: id(occurrence),
    clientId: text(client.ClientId ?? client.Id ?? client.Client?.Id),
    clientServiceId: text(client.ServiceId ?? client.ClientServiceId ?? client.ClientService?.Id),
    cancelled: client.Cancelled === true || client.IsCancelled === true,
  })));
}

function saleFact(value) {
  if (!value || typeof value !== "object") return null;
  const purchasedItems = array(value.PurchasedItems ?? value.Items);
  return {
    saleId: id(value),
    clientId: text(value.ClientId ?? value.Client?.Id),
    cartId: text(value.CartId ?? value.ShoppingCartId ?? value.Cart?.Id ?? value.ShoppingCart?.Id),
    productIds: purchasedItems.flatMap((item) => [item.ProductId, item.Product?.Id, item.Id]).map(text).filter(Boolean),
    returned: purchasedItems.some((item) => item.Returned === true),
    payments: array(value.Payments).map((payment) => ({
      paymentId: id(payment),
      type: text(payment.Type ?? payment.Method),
      amount: Number.isFinite(Number(payment.Amount)) ? money(payment.Amount) : null,
      transactionId: text(payment.TransactionId),
    })).filter((payment) => payment.paymentId),
  };
}

function transactionFact(value) {
  const transactionId = id(value);
  if (!transactionId) return null;
  return {
    transactionId,
    saleId: text(value.SaleId ?? value.Sale?.Id),
    paymentId: text(value.PaymentId ?? value.Payment?.Id),
    status: text(value.Status ?? value.TransactionStatus),
  };
}

function clientServiceFact(value) {
  const clientServiceId = id(value);
  if (!clientServiceId) return null;
  return {
    clientServiceId,
    productId: text(value.ProductId ?? value.Product?.Id),
    current: value.Current === true,
    returned: value.Returned === true,
    remaining: Number.isFinite(Number(value.Remaining)) ? Number(value.Remaining) : null,
    unlimited: value.Unlimited === true,
  };
}

function cartId(envelope) {
  return id(envelope?.ShoppingCart ?? envelope?.Cart);
}

function checkoutSaleId(envelope) {
  return id(
    envelope?.Sale
      ?? envelope?.Sales?.[0]
      ?? envelope?.ShoppingCart?.Sale
      ?? envelope?.ShoppingCart?.Sales?.[0]
      ?? envelope?.ShoppingCart?.SaleId,
  );
}

function sameEvidence(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function poll(read, accept, { attempts = 6, intervalMs = 500 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    const accepted = accept(value);
    if (accepted) return accepted;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export class Site99RunError extends Error {
  constructor(stage, code, status = null, detail = null) {
    super(`${stage}:${code}`);
    this.name = "Site99RunError";
    this.stage = stage;
    this.code = code;
    this.status = status;
    this.detail = detail;
  }

  safeFacts() {
    return {
      result: "failed",
      stage: this.stage,
      code: this.code,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

export function createSite99Runner({
  environment = process.env,
  fetchImpl = fetch,
  clock = () => new Date(),
  uniqueId = () => crypto.randomUUID(),
  pollOptions,
  exposeSyntheticClientReference = false,
} = {}) {
  const apiKey = requiredEnvironment(environment, "MINDBODY_API_KEY");
  const username = requiredEnvironment(environment, "MINDBODY_SANDBOX_USERNAME");
  const password = requiredEnvironment(environment, "MINDBODY_SANDBOX_PASSWORD");
  const configuredSiteId = text(environment.MINDBODY_SANDBOX_SITE_ID ?? SITE_ID);
  if (configuredSiteId !== SITE_ID) throw new Site99RunError("configuration", "SITE_NOT_ALLOWED", null, configuredSiteId);
  if (text(environment.MINDBODY_BASE_URL ?? API_ORIGIN) !== API_ORIGIN) {
    throw new Site99RunError("configuration", "ORIGIN_NOT_ALLOWED");
  }
  let clientId = text(environment.MINDBODY_SANDBOX_CLIENT_ID ?? "100013562");
  const locationId = text(environment.MINDBODY_SANDBOX_LOCATION_ID ?? "1");
  const programId = text(environment.MINDBODY_SANDBOX_PROGRAM_ID ?? "27");
  const classDescriptionId = text(environment.MINDBODY_SANDBOX_CLASS_DESCRIPTION_ID ?? "223");
  const sessionTypeId = text(environment.MINDBODY_SANDBOX_SESSION_TYPE_ID ?? "250");
  const productId = text(environment.MINDBODY_SANDBOX_PRODUCT_ID ?? "1424");
  let authorization = null;
  let pendingInspection = null;

  const headers = (body = false) => ({
    Accept: "application/json",
    "Api-Key": apiKey,
    SiteId: SITE_ID,
    "User-Agent": "Revvi-Site-99-E2E/1.0",
    ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  });

  async function request(stage, path, {
    method = "GET", searchParams, body, allowEmpty = false,
  } = {}) {
    const url = new URL(`${API_BASE}/${path}`);
    if (searchParams) url.search = searchParams.toString();
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: headers(body !== undefined),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause) {
      throw new Site99RunError(stage, cause?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR");
    }
    let envelope = null;
    try {
      envelope = await response.json();
    } catch {
      if (response.ok && !allowEmpty) throw new Site99RunError(stage, "INVALID_JSON", response.status);
    }
    if (!response.ok) {
      throw new Site99RunError(
        stage,
        text(envelope?.Error?.Code ?? envelope?.error?.code) ?? `HTTP_${response.status}`,
        response.status,
        text(envelope?.Error?.Message ?? envelope?.error?.message)?.slice(0, 240) ?? null,
      );
    }
    if (envelope && typeof envelope === "object") {
      const requestId = response.headers.get("x-request-id")
        ?? response.headers.get("request-id")
        ?? response.headers.get("apim-request-id")
        ?? response.headers.get("x-ms-request-id")
        ?? response.headers.get("x-correlation-id")
        ?? response.headers.get("request-context");
      if (requestId) Object.defineProperty(envelope, PROVIDER_REQUEST_ID, { value: requestId });
    }
    return envelope;
  }

  function requireWriteConfirmation() {
    if (text(environment.MINDBODY_SANDBOX_WRITE_CONFIRM) !== WRITE_CONFIRMATION) {
      throw new Site99RunError("configuration", "WRITE_NOT_CONFIRMED");
    }
  }

  async function connectSite() {
    const sites = await request("site_connectivity", "site/sites");
    const selectedSite = array(sites?.Sites).find((site) => id(site) === SITE_ID)
      ?? (array(sites?.Sites).length === 1 ? sites.Sites[0] : null);
    if (!selectedSite) throw new Site99RunError("site_connectivity", "SITE_NOT_FOUND");
    return {
      siteId: SITE_ID,
      siteName: text(selectedSite.Name),
      currency: text(selectedSite.CurrencyIsoCode ?? selectedSite.CurrencyCode ?? selectedSite.Currency?.Code),
    };
  }

  async function issueStaffToken() {
    const token = await request("staff_token", "usertoken/issue", {
      method: "POST",
      body: { Username: username, Password: password },
    });
    authorization = text(token?.AccessToken);
    if (!authorization) throw new Site99RunError("staff_token", "TOKEN_MISSING");
    const harmless = await request("staff_read", "client/clients", { searchParams: query({ Limit: 1 }) });
    return { staffTokenIssued: true, harmlessReadCount: array(harmless?.Clients).length };
  }

  async function revokeStaffToken() {
    if (!authorization) return false;
    try {
      await request("staff_token_revoke", "usertoken/revoke", { method: "DELETE", allowEmpty: true });
      return true;
    } finally {
      authorization = null;
    }
  }

  async function readPublicCatalogue() {
    const [locations, programs, descriptions] = await Promise.all([
      request("public_location_discovery", "site/locations", { searchParams: query({ Limit: 100 }) }),
      request("public_program_discovery", "site/programs", {
        searchParams: query({ ScheduleType: "Class", Limit: 100 }),
      }),
      request("public_class_description_discovery", "class/classdescriptions", {
        searchParams: query({ ProgramIds: [programId], LocationIds: [locationId], Limit: 100 }),
      }),
    ]);
    if (!array(locations?.Locations).some((location) => id(location) === locationId)) {
      throw new Site99RunError("public_location_discovery", "LOCATION_NOT_FOUND");
    }
    if (!array(programs?.Programs).some((program) => id(program) === programId)) {
      throw new Site99RunError("public_program_discovery", "PROGRAM_NOT_FOUND");
    }
    if (!array(descriptions?.ClassDescriptions).some((description) => id(description) === classDescriptionId)) {
      throw new Site99RunError("public_class_description_discovery", "CLASS_DESCRIPTION_NOT_FOUND");
    }
    return {
      sites: "accepted",
      locations: "accepted",
      programs: "accepted",
      classDescriptions: "accepted",
      classes: "accepted",
      services: "accepted",
    };
  }

  async function discoverFixture({ forClient = false, classId = null } = {}) {
    const start = new Date(clock().getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(clock().getTime() + 14 * 24 * 60 * 60 * 1000);
    const classes = await request(forClient ? "client_class_discovery" : "public_class_discovery", "class/classes", {
      searchParams: query({
        StartDateTime: classId ? undefined : start.toISOString(),
        EndDateTime: classId ? undefined : end.toISOString(),
        ClassIds: classId ? [classId] : undefined,
        LocationIds: classId ? undefined : [locationId],
        ClassDescriptionIds: classId ? undefined : [classDescriptionId],
        ClientId: forClient ? clientId : undefined,
        Limit: 100,
      }),
    });
    const occurrence = array(classes?.Classes)
      .filter((candidate) => candidate.IsCanceled !== true
        && candidate.IsAvailable === true
        && (!forClient || candidate.IsEnrolled !== true)
        && id(candidate.Location) === locationId
        && id(candidate.ClassDescription) === classDescriptionId
        && id(candidate.ClassDescription?.Program) === programId
        && id(candidate.ClassDescription?.SessionType) === sessionTypeId)
      .sort((left, right) => String(left.StartDateTime).localeCompare(String(right.StartDateTime)))[0];
    if (!occurrence) throw new Site99RunError(forClient ? "client_class_discovery" : "public_class_discovery", "NO_ELIGIBLE_CLASS");
    const selectedClassId = id(occurrence);
    const services = await request(forClient ? "client_service_discovery" : "public_service_discovery", "sale/services", {
      searchParams: query({ ClassId: selectedClassId, LocationId: locationId, SellOnline: true, Limit: 100 }),
    });
    const service = array(services?.Services).find((candidate) => id(candidate.ProductId) === productId
      && candidate.SellOnline === true
      && candidate.Discontinued !== true
      && array(candidate.SellAtLocationIds).map(String).includes(locationId)
      && array(candidate.UseAtLocationIds).map(String).includes(locationId));
    if (!service) throw new Site99RunError(forClient ? "client_service_discovery" : "public_service_discovery", "PRODUCT_NOT_APPLICABLE");
    return {
      classId: selectedClassId,
      classStart: text(occurrence.StartDateTime),
      className: text(occurrence.ClassDescription?.Name),
      locationId,
      programId,
      classDescriptionId,
      sessionTypeId,
      classScheduleId: text(occurrence.ClassScheduleId),
      staffId: id(occurrence.Staff),
      productId,
      paymentSeed: paymentSeed(service),
    };
  }

  async function createSyntheticClient() {
    requireWriteConfirmation();
    const runId = uniqueId().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
    const required = await request("required_client_fields", "client/requiredclientfields");
    const requiredFields = array(required?.RequiredClientFields ?? required?.RequiredFields)
      .map((field) => text(field?.FieldName ?? field))
      .filter(Boolean);
    const genders = await request("gender_options", "site/genders");
    const defaultGenderOptions = array(genders?.GenderOptions)
      .filter((option) => option?.IsActive === true && option?.IsDefault === true);
    const genderOptionId = id(defaultGenderOptions[0]);
    const gender = text(defaultGenderOptions[0]?.Name);
    if (defaultGenderOptions.length !== 1 || !genderOptionId || !gender) {
      throw new Site99RunError("gender_options", "DEFAULT_GENDER_OPTION_NOT_UNIQUE");
    }
    const supportedFields = new Set([
      "FirstName", "LastName", "Email", "BirthDate", "AddressLine1", "City", "State", "PostalCode", "MobilePhone",
      "IsMale",
    ]);
    if (requiredFields.some((field) => !supportedFields.has(field))) {
      throw new Site99RunError("required_client_fields", "UNSUPPORTED_REQUIRED_FIELD");
    }
    const client = {
      FirstName: "Revvi",
      LastName: `Sandbox ${runId.slice(0, 8)}`,
      Email: `revvi-sandbox-${runId}@example.test`,
      BirthDate: "1990-01-01T00:00:00",
      AddressLine1: "123 Sandbox Way",
      City: "San Luis Obispo",
      State: "CA",
      PostalCode: "93401",
      MobilePhone: "5555550100",
      Gender: gender,
    };
    const created = await request("committed_client_creation", "client/addclient", {
      method: "POST",
      body: { ...client, Test: false },
    });
    clientId = id(created?.Client ?? created?.Clients?.[0]);
    if (!clientId) throw new Site99RunError("committed_client_creation", "CLIENT_ID_MISSING");
    return {
      syntheticClientCreated: true,
      addClientTestMode: "unsupported-by-site-99",
      ...(exposeSyntheticClientReference ? {
        reference: {
          clientId,
          displayName: `${client.FirstName} ${client.LastName}`,
          email: client.Email,
        },
      } : {}),
    };
  }

  function evidenceWindow() {
    const start = new Date(clock().getTime() - 24 * 60 * 60 * 1000);
    const end = new Date(clock().getTime() + 30 * 24 * 60 * 60 * 1000);
    return { StartDate: start.toISOString().slice(0, 10), EndDate: end.toISOString().slice(0, 10) };
  }

  async function readEvidence(fixture) {
    const [visits, sales, roster, schedule, transactions, services] = await Promise.all([
      request("visit_read", "client/clientvisits", {
        searchParams: query({ ClientId: clientId, ...evidenceWindow(), Limit: 200 }),
      }),
      request("sale_read", "sale/sales", {
        searchParams: query({ ClientId: clientId, ...evidenceWindow(), Limit: 200 }),
      }),
      request("roster_read", "class/classvisits", {
        searchParams: query({ "request.classID": fixture.classId }),
      }),
      request("schedule_read", "client/clientschedule", {
        searchParams: query({
          "request.clientId": clientId,
          "request.startDate": new Date(`${evidenceWindow().StartDate}T00:00:00Z`).toISOString(),
          "request.endDate": new Date(`${evidenceWindow().EndDate}T23:59:59Z`).toISOString(),
          "request.limit": 200,
        }),
      }),
      request("transaction_read", "sale/transactions", {
        searchParams: query({ ClientId: clientId, Limit: 200 }),
      }),
      request("client_service_read", "client/clientservices", {
        searchParams: query({ ClientId: clientId, ClassId: fixture.classId, Limit: 200 }),
      }),
    ]);
    return {
      clientVisits: sortedFacts(array(visits?.Visits).map(visitFact), "visitId"),
      rosterVisits: sortedFacts([
        ...array(roster?.Visits).map(visitFact),
        ...array(roster?.Class?.Visits).map(visitFact),
        ...scheduledVisits(roster),
      ], "visitId"),
      scheduleVisits: sortedFacts([...array(schedule?.Visits).map(visitFact), ...scheduledVisits(schedule)], "visitId"),
      sales: sortedFacts(array(sales?.Sales).map(saleFact), "saleId"),
      transactions: sortedFacts(array(transactions?.Transactions).map(transactionFact), "transactionId"),
      clientServices: sortedFacts(array(services?.ClientServices).map(clientServiceFact), "clientServiceId"),
    };
  }

  function checkoutBody(fixture, amount, test) {
    return {
      ClientId: clientId,
      LocationId: Number(locationId),
      Test: test,
      InStore: false,
      CalculateTax: true,
      SendEmail: false,
      EnforceLocationRestrictions: true,
      Items: [{
        Item: { Type: "Service", Metadata: { Id: productId } },
        Quantity: 1,
        ClassIds: [Number(fixture.classId)],
      }],
      Payments: [{
        Type: "Cash",
        MetaData: { Amount: amount, Notes: "Revvi Site -99 controlled E2E" },
      }],
    };
  }

  async function quote(fixture) {
    const before = await readEvidence(fixture);
    const requestDigest = digest({
      operation: "CheckoutShoppingCart",
      siteId: SITE_ID,
      locationId,
      classId: fixture.classId,
      productId,
      amount: fixture.paymentSeed,
      tender: "Cash",
      test: true,
      sendEmail: false,
    });
    const envelope = await request("test_quote", "sale/checkoutshoppingcart", {
      method: "POST",
      body: checkoutBody(fixture, fixture.paymentSeed, true),
    });
    const cart = envelope?.ShoppingCart;
    const grandTotal = money(cart?.GrandTotal);
    const after = await readEvidence(fixture);
    if (!sameEvidence(before, after)) throw new Site99RunError("test_quote", "TEST_MUTATED_PROVIDER_STATE");
    return {
      subtotal: nullableMoney(cart?.SubTotal),
      discountTotal: nullableMoney(cart?.DiscountTotal),
      taxTotal: nullableMoney(cart?.TaxTotal),
      grandTotal,
      requestDigest,
      providerRequestId: providerRequestId(envelope),
      testCreatedProviderState: false,
    };
  }

  function exactActiveVisit(evidence, fixture, before = null) {
    const beforeIds = new Set([
      ...array(before?.clientVisits),
      ...array(before?.rosterVisits),
      ...array(before?.scheduleVisits),
    ].map((visit) => visit.visitId));
    return [...evidence.clientVisits, ...evidence.rosterVisits, ...evidence.scheduleVisits]
      .find((candidate) => candidate.visitId
        && candidate.classId === fixture.classId
        && candidate.clientId === clientId
        && candidate.cancelled !== true
        && !beforeIds.has(candidate.visitId));
  }

  function surfaceHasVisit(visits, fixture, visitId) {
    return visits.some((visit) => visit.classId === fixture.classId
      && visit.clientId === clientId
      && (!visit.visitId || visit.visitId === visitId)
      && visit.cancelled !== true);
  }

  function postCancellationFacts(cancelled, bookingEvidence) {
    const sale = cancelled.sales.find((candidate) => candidate.saleId === bookingEvidence?.saleId) ?? null;
    const service = cancelled.clientServices
      .find((candidate) => candidate.clientServiceId === bookingEvidence?.clientServiceId) ?? null;
    const comparableRemaining = Number.isFinite(bookingEvidence?.clientServiceRemaining)
      && Number.isFinite(service?.remaining);
    return {
      saleReturned: sale?.returned ?? null,
      paymentStillRecorded: sale
        ? sale.payments.some((payment) => payment.paymentId === bookingEvidence?.paymentId)
        : null,
      refundEvidence: sale?.returned === true ? "sale-returned" : "none-observed",
      clientServiceCurrent: service?.current ?? null,
      clientServiceRemaining: service?.remaining ?? null,
      entitlementRestorationObserved: comparableRemaining
        ? service.remaining > bookingEvidence.clientServiceRemaining
        : null,
    };
  }

  async function cancelledEvidence(fixture, visitId) {
    const cancelled = await poll(
      () => readEvidence(fixture),
      (evidence) => ([evidence.clientVisits, evidence.rosterVisits, evidence.scheduleVisits]
        .every((visits) => !surfaceHasVisit(visits, fixture, visitId)) ? evidence : null),
      pollOptions,
    );
    if (!cancelled) throw new Site99RunError("cancellation_reconciliation", "VISIT_STILL_ACTIVE");
    return cancelled;
  }

  async function cancelVisit(fixture, visitId, bookingEvidence = null, {
    onCommittedWriteStarted = () => {},
  } = {}) {
    const cancellation = {
      ClientId: clientId,
      ClassId: Number(fixture.classId),
      VisitId: Number(visitId),
      SendEmail: false,
      LateCancel: false,
    };
    const cancellationRequestDigest = digest({
      operation: "RemoveClientFromClass",
      siteId: SITE_ID,
      classId: fixture.classId,
      visitId,
      lateCancel: false,
      sendEmail: false,
    });
    let testCancellationError = null;
    let testCancellationResponse = null;
    let committedCancellationResponse = null;
    try {
      testCancellationResponse = await request("test_cancellation", "class/removeclientfromclass", {
        method: "POST",
        body: { ...cancellation, Test: true },
      });
    } catch (error) {
      testCancellationError = error;
    }
    const afterTest = await readEvidence(fixture);
    const testPreservedAllSurfaces = [afterTest.clientVisits, afterTest.rosterVisits, afterTest.scheduleVisits]
      .every((visits) => surfaceHasVisit(visits, fixture, visitId));
    if (exactActiveVisit(afterTest, fixture)) {
      onCommittedWriteStarted();
      committedCancellationResponse = await request("committed_cancellation", "class/removeclientfromclass", {
        method: "POST",
        body: { ...cancellation, Test: false },
      });
    }
    const cancelled = await cancelledEvidence(fixture, visitId);
    if (testCancellationError) throw testCancellationError;
    if (!testPreservedAllSurfaces) throw new Site99RunError("test_cancellation", "TEST_DID_NOT_PRESERVE_ALL_SURFACES");
    return {
      testCancellationPreservedVisit: true,
      cancellationConfirmed: true,
      cancellationRequestDigest,
      cancellationProviderRequestIds: {
        test: providerRequestId(testCancellationResponse),
        committed: providerRequestId(committedCancellationResponse),
      },
      postCancellation: postCancellationFacts(cancelled, bookingEvidence),
    };
  }

  async function cleanPendingInspection(inspection) {
    if (inspection.cancellationWriteStarted) {
      const cancelled = await cancelledEvidence(inspection.fixture, inspection.booking.visitId);
      return {
        cancellationConfirmed: true,
        cancellationEvidence: "read-only-after-uncertain-write",
        postCancellation: postCancellationFacts(cancelled, inspection.booking),
      };
    }
    return cancelVisit(inspection.fixture, inspection.booking.visitId, inspection.booking, {
      onCommittedWriteStarted: () => { inspection.cancellationWriteStarted = true; },
    });
  }

  async function bookClass(fixture, quoteResult, { cleanupOnSuccess = true } = {}) {
    requireWriteConfirmation();
    const before = await readEvidence(fixture);
    let newVisit = null;
    let primaryError = null;
    let bookingEvidence = null;
    let cleanupEvidence = null;
    try {
      const checkout = await request("committed_checkout", "sale/checkoutshoppingcart", {
        method: "POST",
        body: checkoutBody(fixture, quoteResult.grandTotal, false),
      });
      const committedCartId = cartId(checkout);
      if (!committedCartId) throw new Site99RunError("committed_checkout", "CART_ID_MISSING");
      const expectedSaleId = checkoutSaleId(checkout);
      const beforeSaleIds = new Set(before.sales.map((sale) => sale.saleId));
      const reconciled = await poll(
        () => readEvidence(fixture),
        (evidence) => {
          const visit = exactActiveVisit(evidence, fixture, before);
          if (visit) newVisit = visit;
          if (!visit) return null;
          const sale = evidence.sales.find((candidate) => candidate.clientId === clientId
            && candidate.productIds.includes(productId)
            && !candidate.returned
            && !beforeSaleIds.has(candidate.saleId)
            && (!expectedSaleId || candidate.saleId === expectedSaleId));
          const payment = sale?.payments.find((candidate) => candidate.type?.toLowerCase() === "cash"
            && candidate.amount === quoteResult.grandTotal);
          const service = evidence.clientServices.find((candidate) => candidate.productId === productId
            && candidate.returned === false);
          const allVisitSurfaces = surfaceHasVisit(evidence.clientVisits, fixture, visit.visitId)
            && surfaceHasVisit(evidence.rosterVisits, fixture, visit.visitId)
            && surfaceHasVisit(evidence.scheduleVisits, fixture, visit.visitId);
          return sale && payment?.paymentId && service && allVisitSurfaces
            ? { evidence, visit, sale, payment, service }
            : null;
        },
        pollOptions,
      );
      if (!reconciled) throw new Site99RunError("booking_reconciliation", "EVIDENCE_NOT_CONVERGED");
      newVisit = reconciled.visit;
      const evidence = reconciled.evidence;
      const newSale = reconciled.sale;
      const cashPayment = reconciled.payment;
      const exactClientService = reconciled.service;
      const exactTransaction = evidence.transactions.find((transaction) => transaction.saleId === newSale.saleId
        || transaction.paymentId === cashPayment.paymentId) ?? null;
      bookingEvidence = {
        cartId: committedCartId,
        checkoutRequestDigest: digest({
          operation: "CheckoutShoppingCart",
          siteId: SITE_ID,
          locationId,
          classId: fixture.classId,
          productId,
          amount: quoteResult.grandTotal,
          tender: "Cash",
          test: false,
          sendEmail: false,
        }),
        checkoutProviderRequestId: providerRequestId(checkout),
        saleId: newSale.saleId,
        paymentId: cashPayment.paymentId,
        paymentType: cashPayment.type,
        paymentAmount: cashPayment.amount,
        transactionId: exactTransaction?.transactionId ?? cashPayment.transactionId,
        transactionEvidence: exactTransaction ? "returned" : "not-returned-for-cash",
        visitId: newVisit.visitId,
        clientServiceId: exactClientService.clientServiceId,
        clientServiceCurrent: exactClientService.current,
        clientServiceRemaining: exactClientService.remaining,
        clientVisitConfirmed: true,
        rosterConfirmed: true,
        clientScheduleConfirmed: true,
        checkoutReplayAttempted: false,
      };
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (!newVisit && (primaryError || cleanupOnSuccess)) {
        try {
          newVisit = await poll(
            () => readEvidence(fixture),
            (evidence) => exactActiveVisit(evidence, fixture, before),
            pollOptions,
          );
        } catch {
          // The original reconciliation error remains the truthful outcome.
        }
      }
      if (newVisit && (primaryError || cleanupOnSuccess)) {
        try {
          cleanupEvidence = await cancelVisit(fixture, newVisit.visitId, bookingEvidence);
        } catch (cleanupError) {
          if (!primaryError) throw cleanupError;
          throw new Site99RunError("emergency_cleanup", "CANCELLATION_FAILED", cleanupError.status, {
            primaryCode: primaryError.code ?? "UNEXPECTED_ERROR",
            cleanupCode: cleanupError.code ?? "UNEXPECTED_ERROR",
            classId: fixture.classId,
            visitId: newVisit.visitId,
          });
        }
      }
    }
    return cleanupOnSuccess
      ? { ...bookingEvidence, ...cleanupEvidence }
      : { ...bookingEvidence, inspectionStatus: "active" };
  }

  return Object.freeze({
    async run(mode = "probe") {
      const policy = RUN_MODE_POLICIES[mode];
      if (!policy) {
        throw new Site99RunError("configuration", "INVALID_MODE", null, mode);
      }
      if (policy.requiresInspection && !pendingInspection) {
        throw new Site99RunError("configuration", "NO_PENDING_INSPECTION");
      }
      if (policy.retainsInspection && pendingInspection) {
        throw new Site99RunError("configuration", "INSPECTION_ALREADY_ACTIVE");
      }
      let auth = null;
      try {
        const site = await connectSite();
        const apiKeyOnly = await readPublicCatalogue();
        await discoverFixture();
        const staff = await issueStaffToken();
        let syntheticClient = { syntheticClientCreated: false };
        if (policy.createsSyntheticClient) {
          syntheticClient = await createSyntheticClient();
        }
        const fixture = await discoverFixture({ forClient: true });
        auth = {
          ...site,
          ...staff,
          endpointAuthMatrix: {
            apiKeyOnly,
            staffToken: { issue: "accepted", harmlessClientRead: "accepted" },
          },
          staffTokenRevoked: false,
        };
        if (policy.outcome === "cleanup") {
          const inspection = pendingInspection;
          clientId = inspection.clientId;
          const cleanup = await cleanPendingInspection(inspection);
          pendingInspection = null;
          return {
            result: "passed",
            mode,
            auth,
            fixture: inspection.fixture,
            booking: { ...inspection.booking, ...cleanup, inspectionStatus: "cleaned" },
          };
        }
        if (!policy.quotes) return { result: "passed", mode, auth, fixture };
        const initialQuote = await quote(fixture);
        const immediateRequote = await quote(fixture);
        if (["subtotal", "discountTotal", "taxTotal", "grandTotal"]
          .some((field) => initialQuote[field] !== immediateRequote[field])) {
          throw new Site99RunError("immediate_requote", "TOTAL_CHANGED");
        }
        const quoteResult = {
          ...initialQuote,
          immediateRequote: {
            subtotal: immediateRequote.subtotal,
            discountTotal: immediateRequote.discountTotal,
            taxTotal: immediateRequote.taxTotal,
            grandTotal: immediateRequote.grandTotal,
            requestDigest: immediateRequote.requestDigest,
            providerRequestId: immediateRequote.providerRequestId,
          },
          totalsUnchanged: true,
        };
        if (policy.outcome === "quote") {
          return { result: "passed", mode, auth, fixture, quote: quoteResult };
        }
        const booking = await bookClass(fixture, quoteResult, {
          cleanupOnSuccess: policy.cleanupOnSuccess === true,
        });
        if (policy.retainsInspection) {
          pendingInspection = { clientId, fixture, booking };
        }
        return { result: "passed", mode, auth, fixture, syntheticClient, quote: quoteResult, booking };
      } finally {
        if (authorization) {
          try {
            const revoked = await revokeStaffToken();
            if (auth) auth.staffTokenRevoked = revoked;
          } catch (revokeError) {
            if (policy.retainsInspection && pendingInspection) {
              const inspection = pendingInspection;
              try {
                await issueStaffToken();
                clientId = inspection.clientId;
                await cleanPendingInspection(inspection);
                pendingInspection = null;
              } catch (cleanupError) {
                throw new Site99RunError("emergency_cleanup", "CANCELLATION_FAILED", cleanupError.status, {
                  primaryCode: revokeError.code ?? "TOKEN_REVOCATION_FAILED",
                  cleanupCode: cleanupError.code ?? "UNEXPECTED_ERROR",
                  classId: inspection.fixture.classId,
                  visitId: inspection.booking.visitId,
                });
              } finally {
                if (authorization) {
                  try { await revokeStaffToken(); } catch { /* Preserve the original revocation failure. */ }
                }
              }
            }
            throw revokeError;
          }
        }
      }
    },
  });
}

async function main() {
  const mode = process.argv[2] ?? "probe";
  try {
    const result = await createSite99Runner().run(mode);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const safe = error instanceof Site99RunError
      ? error.safeFacts()
      : { result: "failed", stage: "unexpected", code: "UNEXPECTED_ERROR" };
    process.stderr.write(`${JSON.stringify(safe, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

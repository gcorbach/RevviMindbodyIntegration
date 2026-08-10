import {
  createMindbodyJsonTransport,
  instrumentMindbodyProvider,
  requiredMindbodyText,
} from "./mindbody-http.js";

export class MindbodyClassBookingError extends Error {
  constructor(message, diagnostic = {}, cause, options = {}) {
    super(message, { cause });
    this.name = "MindbodyClassBookingError";
    this.diagnostic = Object.freeze({ ...diagnostic });
    const status = Number(diagnostic.statusCode);
    this.certainty = options.certainty
      ?? (status >= 400 && status < 500 && status !== 408 ? "provider_rejected" : "unknown");
    this.code = options.code ?? diagnostic.errorCode ?? "PROVIDER_OUTCOME_UNKNOWN";
    this.providerErrorCode = this.code;
  }
}

const BOOKING_ENDPOINTS = Object.freeze({
  createBooking: "class/addclienttoclass",
  reconcileBooking: "class/reconciliation",
  cancelBooking: "class/cancellation",
  reconcileCancellation: "class/cancellation-reconciliation",
  readEntitlementState: "client/clientservices",
  reconcileEntitlementRestoration: "client/clientservices",
});

function queryParameters(query) {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((item) => parameters.append(name, String(item)));
    else parameters.set(name, String(value));
  }
  return parameters;
}

function text(value) {
  return value == null ? null : String(value).trim() || null;
}

function id(value) {
  return text(value?.Id ?? value?.id ?? value);
}

function visitFact(value) {
  if (!value || typeof value !== "object") return null;
  return {
    visitId: id(value),
    classId: text(value.ClassId ?? value.Class?.Id ?? value.classId),
    clientId: text(value.ClientId ?? value.Client?.Id ?? value.clientId),
    clientServiceId: text(value.ServiceId ?? value.ClientServiceId ?? value.ClientService?.Id),
    rosterBookingId: text(value.BookingId ?? value.ClassRosterBookingId),
    cancelled: value.Cancelled === true
      || value.IsCancelled === true
      || ["CANCELLED", "LATECANCELLED", "LATE_CANCELLED"].includes(
        text(value.Status ?? value.AppointmentStatus)?.toUpperCase(),
      ),
  };
}

function waitlistFact(value) {
  if (!value || typeof value !== "object") return null;
  return {
    waitlistEntryId: id(value),
    classId: text(value.ClassId ?? value.Class?.Id ?? value.classId),
    clientId: text(value.ClientId ?? value.Client?.Id ?? value.clientId),
    cancelled: value.Cancelled === true || value.IsCancelled === true,
  };
}

function exactFact(fact, input) {
  return fact?.classId === String(input.classId)
    && fact?.clientId === String(input.clientId);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function paginationTotal(envelope) {
  const total = Number(envelope?.PaginationResponse?.TotalResults);
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function scheduleVisits(envelope) {
  const facts = [];
  for (const occurrence of array(envelope?.Classes)) {
    for (const client of array(occurrence?.Clients)) {
      const visit = visitFact({
        ...client,
        ClassId: occurrence.Id,
        ClientId: client.Id ?? client.ClientId,
        Id: client.VisitId ?? client.Visit?.Id,
      });
      if (visit?.visitId) facts.push(visit);
    }
  }
  return facts;
}

const SUCCESSFUL_TRANSACTION_STATUSES = new Set([
  "APPROVED",
  "COMPLETED",
  "PAID",
  "SETTLED",
  "SUCCESS",
  "SUCCESSFUL",
]);

function saleFact(value) {
  if (!value || typeof value !== "object") return null;
  const classIds = [
    ...array(value.ClassIds),
    ...array(value.Classes).map((entry) => entry?.Id ?? entry),
    ...array(value.Items).flatMap((item) => [item?.ClassId, item?.Class?.Id]),
  ].map(text).filter(Boolean);
  const productIds = array(value.Items)
    .flatMap((item) => [item?.ProductId, item?.Product?.Id])
    .map(text)
    .filter(Boolean);
  return {
    saleId: id(value),
    clientId: text(value.ClientId ?? value.Client?.Id),
    classIds,
    productIds,
  };
}

function transactionFact(value) {
  if (!value || typeof value !== "object") return null;
  return {
    transactionId: id(value),
    saleId: text(value.SaleId ?? value.Sale?.Id),
    status: text(value.Status ?? value.TransactionStatus)?.toUpperCase() ?? null,
  };
}

function exactSaleState(salesEnvelope, transactionsEnvelope, input) {
  const expectedProductId = text(input.serviceProductId);
  const exactSale = array(salesEnvelope?.Sales)
    .map(saleFact)
    .filter(Boolean)
    .find((sale) => sale.saleId
      && sale.clientId === String(input.clientId)
      && sale.classIds.includes(String(input.classId))
      && (!expectedProductId || sale.productIds.includes(expectedProductId)));
  if (!exactSale) return null;
  const matchingTransactions = array(transactionsEnvelope?.Transactions)
    .map(transactionFact)
    .filter(Boolean)
    .filter((transaction) => transaction.transactionId && transaction.saleId === exactSale.saleId);
  const successfulTransaction = matchingTransactions.find((transaction) => (
    SUCCESSFUL_TRANSACTION_STATUSES.has(transaction.status)
  ));
  return {
    saleId: exactSale.saleId,
    transactionId: (successfulTransaction ?? matchingTransactions[0])?.transactionId ?? null,
    transactionConfirmed: Boolean(successfulTransaction),
  };
}

function exactFinancialEvidence(salesEnvelope, transactionsEnvelope, input) {
  const state = exactSaleState(salesEnvelope, transactionsEnvelope, input);
  if (!state?.transactionConfirmed) return null;
  return {
    status: "confirmed",
    certainty: "provider_confirmed",
    atomicCheckoutConfirmed: true,
    saleId: state.saleId,
    transactionId: state.transactionId,
    serviceProductId: text(input.serviceProductId),
  };
}

function exactWebhookEvidence(values, input) {
  for (const value of array(values)) {
    if (value?.verified !== true
      || text(value.classId) !== String(input.classId)
      || text(value.clientId) !== String(input.clientId)) continue;
    if (value.type === "class_roster") {
      const visitId = text(value.visitId);
      const rosterBookingId = text(value.rosterBookingId);
      if (visitId || rosterBookingId) {
        return {
          status: "confirmed",
          certainty: "provider_confirmed",
          visitId,
          rosterBookingId,
          clientServiceId: text(value.clientServiceId),
        };
      }
    }
    if (value.type === "class_waitlist") {
      const waitlistEntryId = text(value.waitlistEntryId);
      if (waitlistEntryId) {
        return { status: "waitlisted", certainty: "provider_confirmed", waitlistEntryId };
      }
    }
  }
  return null;
}

export function createMindbodyClassBookingClient(options) {
  requiredMindbodyText(options?.userToken, "userToken");
  const sendProviderEmail = options?.sendProviderEmail === true
    && options?.notificationEvidenceVerified === true;
  const transport = createMindbodyJsonTransport({
    ...options,
    unavailableMessage: "Mindbody Class Booking is temporarily unavailable.",
    invalidMessage: "Mindbody returned an invalid Class Booking response.",
    createError: (message, diagnostic, cause) => new MindbodyClassBookingError(message, diagnostic, cause),
  });

  const request = (path, { method = "GET", query = {}, body } = {}) => transport.request(path, {
    method,
    searchParams: queryParameters(query),
    body,
  });

  async function getAll(path, query, collection) {
    const items = [];
    for (let page = 0; page < 10; page += 1) {
      const envelope = await request(path, {
        query: { ...query, Limit: 100, Offset: page * 100 },
      });
      const pageItems = array(envelope?.[collection]);
      items.push(...pageItems);
      const total = paginationTotal(envelope);
      if ((total !== null && items.length >= total) || (total === null && pageItems.length < 100)) {
        return items;
      }
    }
    throw new MindbodyClassBookingError(
      "Mindbody Class Booking reconciliation exceeded the safe paging limit.",
      { endpointName: path, statusCode: 200, errorCode: "PAGE_LIMIT_EXCEEDED" },
      undefined,
      { code: "PAGE_LIMIT_EXCEEDED", certainty: "unknown" },
    );
  }

  async function readEntitlementState(input) {
    const classId = requiredMindbodyText(input?.classId, "classId");
    const clientId = requiredMindbodyText(input?.clientId, "clientId");
    const clientServiceId = requiredMindbodyText(input?.clientServiceId, "clientServiceId");
    let services;
    try {
      services = await getAll(
        "client/clientservices",
        { ClientId: clientId, ClassId: classId },
        "ClientServices",
      );
    } catch (error) {
      return {
        status: "unknown",
        clientServiceId,
        errorCode: error?.code ?? "ENTITLEMENT_RESTORATION_READ_UNAVAILABLE",
      };
    }
    const service = services.find((candidate) => id(candidate) === clientServiceId);
    if (!service) return { status: "missing", clientServiceId };
    const remaining = service.Remaining == null ? null : Number(service.Remaining);
    return {
      status: "observed",
      observedAt: new Date().toISOString(),
      clientServiceId,
      current: service.Current === true,
      returned: service.Returned === true,
      unlimited: service.Unlimited === true,
      remaining: Number.isFinite(remaining) ? remaining : null,
    };
  }

  return Object.freeze({
    async createBooking(input) {
      const mode = requiredMindbodyText(input?.mode, "mode");
      const classId = requiredMindbodyText(input?.classId, "classId");
      const clientId = requiredMindbodyText(input?.clientId, "clientId");
      if (mode === "purchase_pricing_option") {
        throw new MindbodyClassBookingError(
          "No approved no-card Mindbody payment route is configured.",
          { endpointName: "sale/checkoutshoppingcart", statusCode: null, errorCode: "PAID_ROUTE_NOT_APPROVED" },
          undefined,
          { code: "PAID_ROUTE_NOT_APPROVED", certainty: "provider_rejected" },
        );
      }
      if (mode !== "existing_entitlement" && mode !== "approved_unpaid") {
        throw new MindbodyClassBookingError(
          "The configured Mindbody Class Booking mode is unsupported.",
          { endpointName: "class/addclienttoclass", statusCode: null, errorCode: "FULFILMENT_MODE_UNSUPPORTED" },
          undefined,
          { code: "FULFILMENT_MODE_UNSUPPORTED", certainty: "provider_rejected" },
        );
      }
      const clientServiceId = mode === "existing_entitlement"
        ? requiredMindbodyText(input?.clientServiceId, "clientServiceId")
        : null;
      const envelope = await request("class/addclienttoclass", {
        method: "POST",
        body: {
          ClientId: clientId,
          ClassId: classId,
          ...(clientServiceId ? { ClientServiceId: clientServiceId } : {}),
          RequirePayment: mode === "existing_entitlement",
          SendEmail: sendProviderEmail,
          Waitlist: false,
        },
      });
      const visit = visitFact(envelope?.Visit ?? envelope?.Visits?.[0]);
      const waitlist = waitlistFact(envelope?.WaitlistEntry ?? envelope?.WaitlistEntries?.[0]);
      if (visit?.visitId && exactFact(visit, { classId, clientId })) {
        return {
          status: "confirmed",
          certainty: "provider_confirmed",
          ...visit,
          clientServiceId: visit.clientServiceId,
        };
      }
      if (waitlist?.waitlistEntryId && exactFact(waitlist, { classId, clientId })) {
        return { status: "waitlisted", certainty: "provider_confirmed", ...waitlist };
      }
      return { status: "unknown", certainty: "unknown", errorCode: "BOOKING_EVIDENCE_MISSING" };
    },

    async reconcileBooking(input) {
      const classId = requiredMindbodyText(input?.classId, "classId");
      const clientId = requiredMindbodyText(input?.clientId, "clientId");
      const mode = text(input?.mode);
      const operations = [
        request("client/clientschedule", { query: { ClientIds: [clientId] } }),
        request("client/clientvisits", { query: { ClientId: clientId } }),
        request("class/classvisits", { query: { ClassId: classId } }),
        request("class/waitlistentries", { query: { ClassIds: [classId], ClientIds: [clientId] } }),
        request("sale/sales", { query: { ClientId: clientId } }),
        request("sale/transactions", { query: { ClientId: clientId } }),
      ];
      const settled = await Promise.allSettled(operations);
      if (settled.every((result) => result.status === "rejected")) {
        throw settled[0].reason;
      }
      const envelopes = settled.map((result) => result.status === "fulfilled" ? result.value : {});
      const visits = [
        ...scheduleVisits(envelopes[0]),
        ...array(envelopes[1]?.Visits).map(visitFact),
        ...array(envelopes[2]?.Visits).map(visitFact),
      ].filter(Boolean);
      const exactVisit = visits.find((visit) => exactFact(visit, { classId, clientId }));
      const financialInput = {
        classId,
        clientId,
        serviceProductId: input.serviceProductId,
      };
      const financialContamination = mode === "approved_unpaid"
        ? exactSaleState(envelopes[4], envelopes[5], financialInput)
        : null;
      const financialEvidence = mode === "approved_unpaid"
        ? null
        : exactFinancialEvidence(envelopes[4], envelopes[5], financialInput);
      if (financialContamination) {
        return {
          status: "unknown",
          certainty: "unknown",
          errorCode: "APPROVED_UNPAID_FINANCIAL_EVIDENCE",
          saleId: financialContamination.saleId,
          transactionId: financialContamination.transactionId,
        };
      }
      if (mode === "approved_unpaid"
        && (settled[4]?.status !== "fulfilled" || settled[5]?.status !== "fulfilled")) {
        return {
          status: "unknown",
          certainty: "unknown",
          errorCode: "APPROVED_UNPAID_FINANCIAL_STATE_UNVERIFIED",
        };
      }
      if (exactVisit?.visitId) {
        return { status: "confirmed", certainty: "provider_confirmed", ...exactVisit };
      }
      const waitlists = array(envelopes[3]?.WaitlistEntries).map(waitlistFact).filter(Boolean);
      const exactWaitlist = waitlists.find((entry) => exactFact(entry, { classId, clientId }));
      if (exactWaitlist?.waitlistEntryId) {
        return { status: "waitlisted", certainty: "provider_confirmed", ...exactWaitlist };
      }
      const webhookEvidence = exactWebhookEvidence(input.webhookEvidence, { classId, clientId });
      if (webhookEvidence) return webhookEvidence;
      if (financialEvidence) return financialEvidence;
      return { status: "unknown", certainty: "unknown" };
    },

    async cancelBooking(input) {
      const classId = requiredMindbodyText(input?.classId, "classId");
      const clientId = requiredMindbodyText(input?.clientId, "clientId");
      const removalType = requiredMindbodyText(input?.removalType, "removalType");
      if (removalType === "waitlist") {
        const waitlistEntryId = requiredMindbodyText(input?.waitlistEntryId, "waitlistEntryId");
        await request("class/removefromwaitlist", {
          method: "POST",
          body: { Id: waitlistEntryId },
        });
        return { status: "accepted", certainty: "unverified", waitlistEntryId };
      }
      if (removalType !== "roster") {
        throw new TypeError("removalType must be roster or waitlist.");
      }
      const visitId = requiredMindbodyText(input?.visitId, "visitId");
      await request("class/removeclientfromclass", {
        method: "POST",
        body: {
          ClientId: clientId,
          ClassId: classId,
          VisitId: visitId,
          SendEmail: sendProviderEmail,
        },
      });
      return { status: "accepted", certainty: "unverified", visitId };
    },

    async reconcileCancellation(input) {
      const classId = requiredMindbodyText(input?.classId, "classId");
      const clientId = requiredMindbodyText(input?.clientId, "clientId");
      const removalType = requiredMindbodyText(input?.removalType, "removalType");
      if (removalType === "waitlist") {
        const waitlistEntryId = requiredMindbodyText(input?.waitlistEntryId, "waitlistEntryId");
        let entries;
        try {
          entries = await getAll(
            "class/waitlistentries",
            { ClassIds: [classId], ClientIds: [clientId] },
            "WaitlistEntries",
          );
        } catch {
          return {
            status: "unknown",
            certainty: "unknown",
            errorCode: "CANCELLATION_RECONCILIATION_UNAVAILABLE",
          };
        }
        const exactWaitlist = entries
          .map(waitlistFact)
          .filter(Boolean)
          .find((entry) => entry.waitlistEntryId === waitlistEntryId
            && exactFact(entry, { classId, clientId }));
        if (exactWaitlist && !exactWaitlist.cancelled) {
          return { status: "active", certainty: "provider_confirmed", ...exactWaitlist };
        }
        return {
          status: "cancelled",
          certainty: "provider_confirmed",
          waitlistEntryId,
          authoritativeCancelled: true,
        };
      }
      if (removalType !== "roster") throw new TypeError("removalType must be roster or waitlist.");
      const visitId = requiredMindbodyText(input?.visitId, "visitId");
      const settled = await Promise.allSettled([
        getAll("client/clientschedule", { ClientIds: [clientId] }, "Classes"),
        getAll("client/clientvisits", { ClientId: clientId }, "Visits"),
        getAll("class/classvisits", { ClassId: classId }, "Visits"),
      ]);
      if (settled.some((result) => result.status !== "fulfilled")) {
        return {
          status: "unknown",
          certainty: "unknown",
          errorCode: "CANCELLATION_RECONCILIATION_UNAVAILABLE",
        };
      }
      const exactVisits = [
        ...scheduleVisits({ Classes: settled[0].value }),
        ...settled[1].value.map(visitFact),
        ...settled[2].value.map(visitFact),
      ].filter((visit) => visit && visit.visitId === visitId
        && exactFact(visit, { classId, clientId }));
      if (exactVisits.some((visit) => !visit.cancelled)) {
        return { status: "active", certainty: "provider_confirmed", ...exactVisits[0] };
      }
      return {
        status: "cancelled",
        certainty: "provider_confirmed",
        visitId,
        authoritativeCancelled: true,
      };
    },

    readEntitlementState,

    async reconcileEntitlementRestoration(input) {
      const baseline = input?.baseline;
      const after = await readEntitlementState(input);
      const comparable = baseline?.status === "observed"
        && after.status === "observed"
        && baseline.clientServiceId === after.clientServiceId
        && baseline.current === true
        && baseline.returned === false
        && after.current === true
        && after.returned === false
        && baseline.unlimited === false
        && after.unlimited === false
        && Number.isFinite(baseline.remaining)
        && Number.isFinite(after.remaining);
      if (comparable && after.remaining > baseline.remaining) {
        return {
          status: "confirmed",
          certainty: "provider_confirmed",
          clientServiceId: after.clientServiceId,
          remainingBefore: baseline.remaining,
          remainingAfter: after.remaining,
          errorCode: null,
        };
      }
      return {
        status: "unknown",
        certainty: "unknown",
        clientServiceId: after.clientServiceId ?? baseline?.clientServiceId ?? null,
        errorCode: after.errorCode ?? "ENTITLEMENT_RESTORATION_NOT_PROVEN",
      };
    },
  });
}

export function instrumentClassBookingProvider(provider, options) {
  return instrumentMindbodyProvider(provider, BOOKING_ENDPOINTS, options);
}

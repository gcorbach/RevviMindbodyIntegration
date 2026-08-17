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
  createBooking: "class-or-sale/create-booking",
  completePaidBooking: "sale/completecheckoutshoppingcart",
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

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive Mindbody integer ID.`);
  }
  return number;
}

function money(value, name) {
  const number = Number(value);
  const cents = number * 100;
  if (!Number.isFinite(number) || number <= 0
    || Math.abs(cents - Math.round(cents)) > 1e-6) {
    throw new TypeError(`${name} must be a positive two-decimal amount.`);
  }
  return number;
}

function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
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
  const occurrences = [
    ...array(envelope?.Classes),
    ...(envelope?.Class && typeof envelope.Class === "object" ? [envelope.Class] : []),
  ];
  for (const occurrence of occurrences) {
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
  const purchasedItems = array(value.PurchasedItems ?? value.Items);
  const classIds = [
    ...array(value.ClassIds),
    ...array(value.Classes).map((entry) => entry?.Id ?? entry),
    ...purchasedItems.flatMap((item) => [item?.ClassId, item?.Class?.Id]),
  ].map(text).filter(Boolean);
  const productIds = purchasedItems
    .flatMap((item) => [item?.ProductId, item?.Product?.Id, item?.Id])
    .map(text)
    .filter(Boolean);
  return {
    saleId: id(value),
    clientId: text(value.ClientId ?? value.Client?.Id),
    cartId: text(value.CartId ?? value.ShoppingCartId ?? value.Cart?.Id ?? value.ShoppingCart?.Id),
    paymentId: text(value.PaymentId ?? value.Payment?.Id ?? value.Payments?.[0]?.Id),
    classIds,
    productIds,
  };
}

function transactionFact(value) {
  if (!value || typeof value !== "object") return null;
  return {
    transactionId: id(value),
    saleId: text(value.SaleId ?? value.Sale?.Id),
    cartId: text(value.CartId ?? value.ShoppingCartId ?? value.Cart?.Id ?? value.ShoppingCart?.Id),
    paymentId: text(value.PaymentId ?? value.Payment?.Id ?? value.Payments?.[0]?.Id),
    status: text(value.Status ?? value.TransactionStatus)?.toUpperCase() ?? null,
  };
}

function clientServiceFact(value) {
  if (!value || typeof value !== "object") return null;
  return {
    clientServiceId: id(value),
    serviceProductId: text(value.ProductId ?? value.Product?.Id),
    current: value.Current === true,
    returned: value.Returned === true,
  };
}

function exactSaleState(salesEnvelope, transactionsEnvelope, input) {
  const expectedProductId = text(input.serviceProductId);
  const expectedSaleId = text(input.saleId);
  const expectedCartId = text(input.cartId);
  const expectedTransactionId = text(input.transactionId);
  const expectedPaymentId = text(input.paymentId);
  const exactSale = array(salesEnvelope?.Sales)
    .map(saleFact)
    .filter(Boolean)
    .find((sale) => sale.saleId
      && (!expectedSaleId || sale.saleId === expectedSaleId)
      && sale.clientId === String(input.clientId)
      && (!expectedProductId || sale.productIds.includes(expectedProductId))
      && (sale.classIds.includes(String(input.classId))
        || (Boolean(expectedSaleId)
          && sale.saleId === expectedSaleId
          && Boolean(expectedProductId)
          && sale.productIds.includes(expectedProductId))));
  if (!exactSale) return null;
  const matchingTransactions = array(transactionsEnvelope?.Transactions)
    .map(transactionFact)
    .filter(Boolean)
    .filter((transaction) => transaction.transactionId
      && transaction.saleId === exactSale.saleId
      && (!expectedTransactionId || transaction.transactionId === expectedTransactionId));
  const successfulTransaction = matchingTransactions.find((transaction) => (
    SUCCESSFUL_TRANSACTION_STATUSES.has(transaction.status)
      && (!expectedCartId
        || transaction.cartId === expectedCartId
        || exactSale.cartId === expectedCartId)
      && (!expectedPaymentId
        || transaction.paymentId === expectedPaymentId
        || exactSale.paymentId === expectedPaymentId)
  ));
  return {
    saleId: exactSale.saleId,
    cartId: successfulTransaction?.cartId ?? exactSale.cartId ?? null,
    transactionId: (successfulTransaction ?? matchingTransactions[0])?.transactionId ?? null,
    paymentId: successfulTransaction?.paymentId ?? exactSale.paymentId ?? null,
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
    cartId: state.cartId,
    transactionId: state.transactionId,
    paymentId: state.paymentId,
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
  const configuredPaidRoute = options?.paidRoute?.type === "mindbody_alternative_payment"
    && Number.isSafeInteger(options.paidRoute.paymentMethodId)
    && options.paidRoute.paymentMethodId > 0
    && options.paidRoute.checkoutLocationId === 98
    && httpsUrl(options.paidRoute.callbackUrl)
    ? Object.freeze({
      type: options.paidRoute.type,
      paymentMethodId: options.paidRoute.paymentMethodId,
      checkoutLocationId: options.paidRoute.checkoutLocationId,
      callbackUrl: httpsUrl(options.paidRoute.callbackUrl),
    })
    : null;
  const configuredPaidCompletionRoute = options?.paidCompletionRoute === "mindbody_alternative_payment"
    ? options.paidCompletionRoute
    : configuredPaidRoute?.type ?? null;
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

  const now = options?.now ?? (() => new Date());
  function clientVisitWindow() {
    const observedAt = now();
    if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) {
      throw new TypeError("now must return a valid Date.");
    }
    const start = new Date(observedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
    const end = new Date(observedAt.getTime() + 31 * 24 * 60 * 60 * 1000);
    return {
      StartDate: start.toISOString().slice(0, 10),
      EndDate: end.toISOString().slice(0, 10),
    };
  }

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
        if (!configuredPaidRoute) {
          throw new MindbodyClassBookingError(
            "No approved no-card Mindbody payment route is configured.",
            { endpointName: "sale/initiatecheckoutshoppingcart", statusCode: null, errorCode: "PAID_ROUTE_NOT_APPROVED" },
            undefined,
            { code: "PAID_ROUTE_NOT_APPROVED", certainty: "provider_rejected" },
          );
        }
        const selectedClassId = positiveInteger(classId, "classId");
        const serviceProductId = requiredMindbodyText(input?.serviceProductId, "serviceProductId");
        const priceAmount = money(input?.priceAmount, "priceAmount");
        if (!/^[A-Z]{3}$/.test(requiredMindbodyText(input?.currency, "currency"))) {
          throw new TypeError("currency must be a three-letter uppercase code.");
        }
        const envelope = await request("sale/initiatecheckoutshoppingcart", {
          method: "POST",
          body: {
            ClientId: clientId,
            Test: false,
            InStore: false,
            CalculateTax: true,
            SendEmail: false,
            LocationId: configuredPaidRoute.checkoutLocationId,
            PaymentAuthenticationCallbackUrl: configuredPaidRoute.callbackUrl,
            EnforceLocationRestrictions: true,
            Items: [{
              Item: { Type: "Service", Metadata: { Id: serviceProductId } },
              Quantity: 1,
              ClassIds: [selectedClassId],
            }],
            Payments: [{
              PaymentMethodId: configuredPaidRoute.paymentMethodId,
              Amount: priceAmount,
            }],
          },
        });
        const redirectUrl = httpsUrl(envelope?.RedirectUrl);
        const providerAccessToken = text(envelope?.AccessToken);
        if (!redirectUrl || !providerAccessToken || providerAccessToken.length > 4096) {
          return {
            status: "unknown",
            certainty: "unknown",
            serviceProductId,
            errorCode: "PAYMENT_INITIATION_EVIDENCE_MISSING",
          };
        }
        return {
          status: "requires_action",
          certainty: "provider_confirmed",
          paymentStatus: "requires_action",
          serviceProductId,
          paymentRoute: configuredPaidRoute.type,
          providerAccessToken,
          requiredAction: { type: "redirect", url: redirectUrl },
        };
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

    async completePaidBooking(input) {
      if (!configuredPaidCompletionRoute
        || input?.paymentRoute !== configuredPaidCompletionRoute) {
        throw new MindbodyClassBookingError(
          "No approved no-card Mindbody payment route is configured.",
          { endpointName: "sale/completecheckoutshoppingcart", statusCode: null, errorCode: "PAID_ROUTE_NOT_APPROVED" },
          undefined,
          { code: "PAID_ROUTE_NOT_APPROVED", certainty: "provider_rejected" },
        );
      }
      const providerAccessToken = requiredMindbodyText(
        input?.providerAccessToken,
        "providerAccessToken",
      );
      if (providerAccessToken.length > 4096) {
        throw new TypeError("providerAccessToken is too long.");
      }
      const clientId = requiredMindbodyText(input?.clientId, "clientId");
      const envelope = await request("sale/completecheckoutshoppingcart", {
        method: "POST",
        body: { AccessToken: providerAccessToken, ClientId: clientId, Test: false },
      });
      const sale = saleFact(envelope?.Sale ?? envelope?.Sales?.[0]);
      const transaction = transactionFact(
        envelope?.Transaction ?? envelope?.Transactions?.[0],
      );
      return {
        status: "accepted",
        certainty: "unverified",
        saleId: sale?.saleId ?? null,
        cartId: id(envelope?.Cart ?? envelope?.ShoppingCart),
        transactionId: transaction?.transactionId ?? null,
        paymentId: id(envelope?.Payment ?? envelope?.Payments?.[0]),
      };
    },

    async reconcileBooking(input) {
      const classId = requiredMindbodyText(input?.classId, "classId");
      const clientId = requiredMindbodyText(input?.clientId, "clientId");
      const mode = text(input?.mode);
      const operations = [
        request("client/clientschedule", { query: { "request.clientId": clientId } }),
        request("client/clientvisits", {
          query: { ClientId: clientId, ...clientVisitWindow() },
        }),
        request("class/classvisits", { query: { "request.classID": classId } }),
        request("class/waitlistentries", { query: { ClassIds: [classId], ClientIds: [clientId] } }),
        request("sale/sales", { query: { ClientId: clientId } }),
        request("sale/transactions", { query: { ClientId: clientId } }),
        mode === "purchase_pricing_option"
          ? request("client/clientservices", { query: { ClientId: clientId, ClassId: classId } })
          : Promise.resolve({ ClientServices: [] }),
      ];
      const settled = await Promise.allSettled(operations);
      const providerOperationCount = mode === "purchase_pricing_option" ? 7 : 6;
      if (settled.slice(0, providerOperationCount).every((result) => result.status === "rejected")) {
        throw settled[0].reason;
      }
      const envelopes = settled.map((result) => result.status === "fulfilled" ? result.value : {});
      const visits = [
        ...scheduleVisits(envelopes[0]),
        ...array(envelopes[1]?.Visits).map(visitFact),
        ...array(envelopes[2]?.Visits).map(visitFact),
        ...array(envelopes[2]?.Class?.Visits).map(visitFact),
        ...scheduleVisits(envelopes[2]),
      ].filter(Boolean);
      const exactVisit = visits.find((visit) => !visit.cancelled
        && exactFact(visit, { classId, clientId }));
      const financialInput = {
        classId,
        clientId,
        serviceProductId: input.serviceProductId,
        saleId: input.saleId,
        cartId: input.cartId,
        transactionId: input.transactionId,
        paymentId: input.paymentId,
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
      const webhookEvidence = exactWebhookEvidence(input.webhookEvidence, { classId, clientId });
      if (mode === "purchase_pricing_option") {
        const rosterEvidence = exactVisit?.visitId ? exactVisit : webhookEvidence;
        const exactClientService = array(envelopes[6]?.ClientServices)
          .map(clientServiceFact)
          .filter(Boolean)
          .find((service) => service.clientServiceId === rosterEvidence?.clientServiceId
            && service.serviceProductId === text(input.serviceProductId)
            && service.current === true
            && service.returned === false);
        if (rosterEvidence
          && exactClientService
          && text(input.saleId)
          && text(input.cartId)
          && text(input.transactionId)
          && text(input.paymentId)
          && financialEvidence?.atomicCheckoutConfirmed === true) {
          return {
            ...financialEvidence,
            ...rosterEvidence,
            clientServiceId: exactClientService.clientServiceId,
            status: "confirmed",
            certainty: "provider_confirmed",
          };
        }
        return {
          errorCode: "PAID_PURCHASE_AND_ROSTER_EVIDENCE_INCOMPLETE",
          ...(rosterEvidence ?? {}),
          ...(financialEvidence ?? {}),
          status: "unknown",
          certainty: "unknown",
        };
      }
      if (exactVisit?.visitId) {
        return { status: "confirmed", certainty: "provider_confirmed", ...exactVisit };
      }
      const waitlists = array(envelopes[3]?.WaitlistEntries).map(waitlistFact).filter(Boolean);
      const exactWaitlist = waitlists.find((entry) => !entry.cancelled
        && exactFact(entry, { classId, clientId }));
      if (exactWaitlist?.waitlistEntryId) {
        return { status: "waitlisted", certainty: "provider_confirmed", ...exactWaitlist };
      }
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
        getAll("client/clientschedule", { "request.clientId": clientId }, "Classes"),
        getAll(
          "client/clientvisits",
          { ClientId: clientId, ...clientVisitWindow() },
          "Visits",
        ),
        request("class/classvisits", { query: { "request.classID": classId } }),
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
        ...array(settled[2].value?.Visits).map(visitFact),
        ...array(settled[2].value?.Class?.Visits).map(visitFact),
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

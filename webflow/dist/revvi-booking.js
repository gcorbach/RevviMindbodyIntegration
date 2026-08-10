var RevviBooking = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // webflow/src/index.js
  var index_exports = {};
  __export(index_exports, {
    mountBookingWidget: () => mountBookingWidget,
    mountBookingWidgets: () => mountBookingWidgets
  });

  // webflow/src/api.js
  var SAFE_ERROR_MESSAGES = Object.freeze({
    AUTHENTICATION_REQUIRED: "Sign in to Revvi to view this Offer.",
    MEMBERSTACK_TOKEN_MISSING: "Sign in to Revvi to view this Offer.",
    MEMBERSTACK_TOKEN_INVALID: "Sign in to Revvi again to view this Offer.",
    AUTHENTICATION_INVALID: "Sign in to Revvi again to view this Offer.",
    SUBSCRIPTION_INACTIVE: "An active Revvi subscription is required for this Offer.",
    CUSTOMER_NOT_FOUND: "Revvi could not verify this Customer for the selected Offer.",
    ELIGIBILITY_OVERRIDE_BLOCKED: "This Offer is not available for your Revvi account.",
    OFFER_INELIGIBLE: "Your current Revvi subscription does not include this Offer.",
    BUSINESS_CONTEXT_MISMATCH: "This Offer is not available at the selected Location.",
    LOCATION_CONTEXT_MISMATCH: "This Offer is not available at the selected Location.",
    OFFER_CONTEXT_MISMATCH: "This Offer is not available at the selected Location.",
    QUOTE_EXPIRED: "That quote expired. Refresh the Class times and try again.",
    QUOTE_CHANGED: "The Class details changed. Refresh the times before confirming.",
    CLASS_UNAVAILABLE: "That Class is no longer available. Refresh the times and choose again.",
    SLOT_UNAVAILABLE: "That Class is no longer available. Refresh the times and choose again."
  });
  var BookingWidgetRequestError = class extends Error {
    constructor({ code = "REQUEST_FAILED", status = 500, retryable = false } = {}) {
      super(SAFE_ERROR_MESSAGES[code] ?? "Revvi could not complete that request safely.");
      this.name = "BookingWidgetRequestError";
      this.code = code;
      this.status = status;
      this.retryable = retryable;
    }
  };
  async function postJson(fetcher, endpoint, authorization, body) {
    let response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch {
      throw new BookingWidgetRequestError({ code: "NETWORK_FAILURE", status: 0, retryable: true });
    }
    let envelope;
    try {
      envelope = await response.json();
    } catch {
      throw new BookingWidgetRequestError({
        code: "INVALID_RESPONSE",
        status: response.status,
        retryable: response.status >= 500
      });
    }
    if (!response.ok || envelope?.ok !== true || !envelope?.data) {
      throw new BookingWidgetRequestError({
        code: typeof envelope?.code === "string" ? envelope.code : "REQUEST_FAILED",
        status: response.status,
        retryable: response.status === 429 || response.status >= 500
      });
    }
    return envelope.data;
  }
  function createBookingWidgetApi({
    fetcher = window.fetch.bind(window),
    availabilityEndpoint = "/functions/v1/offer-class-availability",
    quoteEndpoint = "/functions/v1/booking-quote",
    bookingEndpoint = "/functions/v1/create-booking"
  } = {}) {
    return Object.freeze({
      async availability(authorization, context) {
        const { sessions: wireOccurrences, ...data } = await postJson(
          fetcher,
          availabilityEndpoint,
          authorization,
          context
        );
        return { ...data, occurrences: wireOccurrences };
      },
      async quote(authorization, offerId, classId) {
        const { session: wireOccurrence, ...data } = await postJson(
          fetcher,
          quoteEndpoint,
          authorization,
          { offerId, sessionId: classId }
        );
        return { ...data, occurrence: wireOccurrence };
      },
      createBooking: (authorization, quoteId, idempotencyKey) => postJson(
        fetcher,
        bookingEndpoint,
        authorization,
        { quoteId, idempotencyKey }
      )
    });
  }

  // webflow/src/customer.js
  var MemberstackBrowserAuthenticationError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "MemberstackBrowserAuthenticationError";
    }
  };
  function waitForMemberstackReadyEvent(browser, timeoutMs = 5e3) {
    if (typeof browser?.addEventListener !== "function") {
      throw new MemberstackBrowserAuthenticationError(
        "The supported Memberstack browser contract is unavailable."
      );
    }
    return new Promise((resolve, reject) => {
      const schedule = typeof browser.setTimeout === "function" ? browser.setTimeout.bind(browser) : setTimeout;
      const cancel = typeof browser.clearTimeout === "function" ? browser.clearTimeout.bind(browser) : clearTimeout;
      const ready = () => {
        cancel(timer);
        browser.removeEventListener?.("memberstack.ready", ready);
        resolve();
      };
      const timer = schedule(() => {
        browser.removeEventListener?.("memberstack.ready", ready);
        reject(new MemberstackBrowserAuthenticationError("Memberstack did not become ready."));
      }, timeoutMs);
      browser.addEventListener("memberstack.ready", ready, { once: true });
    });
  }
  async function currentMemberstackDom(browser) {
    if (!browser?.$memberstackDom && browser?.$memberstackReady) {
      try {
        await browser.$memberstackReady;
      } catch {
        throw new MemberstackBrowserAuthenticationError("Memberstack did not become ready.");
      }
    } else if (!browser?.$memberstackDom) {
      await waitForMemberstackReadyEvent(browser);
    }
    const dom = browser?.$memberstackDom;
    if (typeof dom?.getCurrentMember !== "function" || typeof dom?.getMemberCookie !== "function") {
      throw new MemberstackBrowserAuthenticationError(
        "The supported Memberstack browser contract is unavailable."
      );
    }
    return dom;
  }
  async function createMemberstackAuthorizationHeader(browser = window) {
    const dom = await currentMemberstackDom(browser);
    const current = await dom.getCurrentMember();
    if (current?.data === null) return null;
    if (typeof current?.data?.id !== "string" || current.data.id.length === 0) {
      throw new MemberstackBrowserAuthenticationError(
        "Memberstack returned an unrecognized Customer session."
      );
    }
    const token = await dom.getMemberCookie();
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new MemberstackBrowserAuthenticationError(
        "Memberstack returned an unrecognized Customer token."
      );
    }
    return { Authorization: `Bearer ${token}` };
  }

  // webflow/src/ui.js
  var VIEW_SELECTORS = Object.freeze({
    loading: "[data-booking-loading]",
    ineligible: "[data-booking-ineligible]",
    error: "[data-booking-error]",
    empty: "[data-booking-empty]",
    stale: "[data-booking-stale]",
    occurrences: "[data-booking-occurrences]",
    quote: "[data-booking-quote]",
    submitting: "[data-booking-submitting]",
    paymentAction: "[data-booking-payment-action]",
    reconciliation: "[data-booking-reconciliation]",
    confirmation: "[data-booking-confirmation]"
  });
  function element(root, selector) {
    const found = root.querySelector(selector);
    if (!found) throw new Error(`Revvi Booking markup is missing ${selector}.`);
    return found;
  }
  function setText(root, selector, value) {
    element(root, selector).textContent = value ?? "";
  }
  function formatDateTime(value, timezone) {
    try {
      return new Intl.DateTimeFormat(void 0, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone
      }).format(new Date(value));
    } catch {
      return "Time to be confirmed";
    }
  }
  function formatMoney(amount, currency) {
    if (!Number.isFinite(amount) || typeof currency !== "string") return "Price confirmed before Booking";
    try {
      return new Intl.NumberFormat(void 0, { style: "currency", currency }).format(amount);
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }
  function availabilityPresentation(occurrence) {
    switch (occurrence.availabilityState) {
      case "available":
        return { label: "Available", bookable: true };
      case "waitlist_available":
        return { label: "Waitlist available", bookable: true };
      case "full":
        return { label: "Class is full", bookable: false };
      case "outside_booking_window":
        return { label: "Booking window closed", bookable: false };
      case "client_ineligible":
        return { label: "Not available for this Customer", bookable: false };
      default:
        return { label: "Availability to be confirmed", bookable: false };
    }
  }
  function createBookingWidgetUi(root) {
    const views = Object.fromEntries(
      Object.entries(VIEW_SELECTORS).map(([name, selector]) => [name, element(root, selector)])
    );
    const template = element(root, "[data-booking-occurrence-template]");
    const selection = element(root, "[data-booking-selection]");
    setText(root, "[data-booking-offer]", root.dataset.offerName);
    setText(root, "[data-booking-location]", root.dataset.locationName);
    function show(status, viewName) {
      root.dataset.bookingState = status;
      root.setAttribute("aria-busy", String(status.startsWith("loading-") || status === "submitting"));
      for (const [name, view] of Object.entries(views)) view.hidden = name !== viewName;
    }
    function renderOccurrences(occurrences, onSelect) {
      views.occurrences.replaceChildren();
      for (const occurrence of occurrences) {
        const fragment = template.content.cloneNode(true);
        const card = fragment.querySelector("[data-booking-occurrence]");
        const presentation = availabilityPresentation(occurrence);
        card.dataset.classId = String(occurrence.classId);
        setText(fragment, "[data-occurrence-name]", occurrence.name);
        setText(fragment, "[data-occurrence-time]", formatDateTime(occurrence.startAt, occurrence.timezone));
        setText(fragment, "[data-occurrence-staff]", occurrence.staffName ?? "Instructor to be confirmed");
        setText(fragment, "[data-occurrence-location]", root.dataset.locationName);
        setText(
          fragment,
          "[data-occurrence-price]",
          occurrence.provisionalPrice ? `Estimated ${formatMoney(occurrence.provisionalPrice.amount, occurrence.provisionalPrice.currency)} \u2014 confirmed before Booking` : "Terms confirmed before Booking"
        );
        setText(
          fragment,
          "[data-occurrence-capacity]",
          Number.isSafeInteger(occurrence.estimatedAvailableSlots) && occurrence.estimatedAvailableSlots > 0 ? `${occurrence.estimatedAvailableSlots} spots left` : ""
        );
        setText(fragment, "[data-occurrence-status]", presentation.label);
        const button = element(fragment, "[data-occurrence-book]");
        button.disabled = !presentation.bookable;
        button.textContent = occurrence.availabilityState === "waitlist_available" ? "View waitlist" : "Book";
        if (presentation.bookable) button.addEventListener("click", () => onSelect(occurrence));
        views.occurrences.append(fragment);
      }
      show("showing-availability", "occurrences");
    }
    return Object.freeze({
      loadingEligibility() {
        views.loading.textContent = "Checking your Revvi access\u2026";
        show("loading-eligibility", "loading");
      },
      loadingAvailability() {
        views.loading.textContent = "Loading live Class times\u2026";
        show("loading-availability", "loading");
      },
      loadingQuote() {
        views.loading.textContent = "Checking this Class and your Revvi terms\u2026";
        show("loading-quote", "loading");
      },
      ineligible(message) {
        views.ineligible.textContent = message;
        show("ineligible", "ineligible");
      },
      empty() {
        show("empty", "empty");
      },
      occurrences: renderOccurrences,
      selected(occurrence) {
        selection.textContent = `${occurrence.name} \u2014 ${formatDateTime(occurrence.startAt, occurrence.timezone)}`;
        selection.hidden = false;
      },
      clearSelection() {
        selection.textContent = "";
        selection.hidden = true;
      },
      quote(quote) {
        setText(root, "[data-quote-class]", quote.occurrence?.name);
        setText(root, "[data-quote-time]", formatDateTime(quote.occurrence?.startAt, quote.occurrence?.timezone));
        setText(root, "[data-quote-location]", quote.occurrence?.locationName ?? root.dataset.locationName);
        setText(root, "[data-quote-price]", formatMoney(quote.price?.grandTotal, quote.price?.currency));
        setText(root, "[data-quote-expiry]", quote.expiresAt ? `Quote expires ${formatDateTime(quote.expiresAt, quote.occurrence?.timezone)}` : "");
        setText(root, "[data-quote-policy]", quote.cancellationPolicy?.displayText ?? "Cancellation terms will be confirmed by the Business.");
        show("confirming", "quote");
      },
      submitting() {
        show("submitting", "submitting");
      },
      stale(message) {
        setText(root, "[data-booking-stale-message]", message);
        show("stale", "stale");
      },
      reconciliation(message) {
        views.reconciliation.textContent = message;
        show("pending-reconciliation", "reconciliation");
      },
      requiresPaymentAction(redirectUrl) {
        const link = element(root, "[data-booking-payment-link]");
        link.href = redirectUrl;
        show("requires-payment-action", "paymentAction");
      },
      markAvailabilityStale() {
        const freshness = element(root, "[data-booking-freshness]");
        freshness.hidden = false;
        freshness.textContent = "Refreshing Class times after this Booking attempt\u2026";
      },
      markAvailabilityRefreshed() {
        const freshness = element(root, "[data-booking-freshness]");
        freshness.hidden = false;
        freshness.textContent = "Class times refreshed after this Booking attempt.";
      },
      markAvailabilityRefreshFailed() {
        const freshness = element(root, "[data-booking-freshness]");
        freshness.hidden = false;
        freshness.textContent = "Class times are stale and could not yet be refreshed.";
      },
      success(booking) {
        views.confirmation.textContent = `Booking confirmed: ${booking.className} at ${formatDateTime(booking.startAt, booking.timezone)} \u2014 ${booking.locationName ?? root.dataset.locationName}.`;
        show("success", "confirmation");
      },
      error(message, retryable = false) {
        views.error.textContent = retryable ? `${message} Please try again.` : message;
        show("error", "error");
      },
      confirmButton: element(root, "[data-quote-confirm]"),
      backButton: element(root, "[data-quote-back]"),
      refreshButton: element(root, "[data-booking-refresh]")
    });
  }

  // webflow/src/widget.js
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  var STALE_CODES = /* @__PURE__ */ new Set(["QUOTE_EXPIRED", "QUOTE_CHANGED", "CLASS_UNAVAILABLE", "SLOT_UNAVAILABLE"]);
  function configuredContext(root) {
    const businessSlug = root.dataset.businessSlug?.trim();
    const locationId = root.dataset.locationId?.trim();
    const offerId = root.dataset.offerId?.trim();
    if (!businessSlug || !UUID.test(locationId ?? "") || !UUID.test(offerId ?? "")) {
      throw new Error("The Revvi Booking context is incomplete.");
    }
    return Object.freeze({ businessSlug, locationId, offerId });
  }
  function exactAvailability(data, context) {
    if (data?.business?.slug !== context.businessSlug || data?.offer?.id !== context.offerId || !Array.isArray(data?.occurrences)) {
      throw new Error("The live Class response did not match this Offer.");
    }
    return data.occurrences.filter((occurrence) => typeof occurrence?.classId === "string" && occurrence.classId.length > 0 && typeof occurrence?.startAt === "string" && typeof occurrence?.timezone === "string");
  }
  function exactQuote(data, selectedOccurrence) {
    if (typeof data?.quoteId !== "string" || data.quoteId.length === 0 || String(data?.occurrence?.classId) !== selectedOccurrence.classId) {
      throw new Error("The Booking quote did not match the selected Class.");
    }
    return data;
  }
  function paymentActionUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }
  function currentDateAtLocation(timezone, now = /* @__PURE__ */ new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function mountBookingWidget(root, dependencies = {}) {
    const browser = dependencies.browser ?? window;
    const context = configuredContext(root);
    const dateInput = root.querySelector("[data-booking-date]");
    if (!dateInput || !root.dataset.locationTimezone) {
      throw new Error("The Revvi Booking date context is missing.");
    }
    if (!dateInput.value) {
      dateInput.value = currentDateAtLocation(root.dataset.locationTimezone);
    }
    const ui = createBookingWidgetUi(root);
    const api = dependencies.api ?? createBookingWidgetApi({
      fetcher: dependencies.fetcher ?? browser.fetch.bind(browser),
      availabilityEndpoint: root.dataset.availabilityEndpoint,
      quoteEndpoint: root.dataset.quoteEndpoint,
      bookingEndpoint: root.dataset.bookingEndpoint
    });
    const authenticate = dependencies.authenticate ?? (() => createMemberstackAuthorizationHeader(browser));
    const randomUuid = dependencies.randomUuid ?? (() => browser.crypto.randomUUID());
    let authorization;
    let occurrences = [];
    let selectedOccurrence = null;
    let quote = null;
    let requestActive = false;
    let loadSequence = 0;
    function availabilityContext() {
      const startDate = dateInput.value?.trim();
      if (!ISO_DATE.test(startDate ?? "")) throw new Error("Choose a valid Class date.");
      return { ...context, startDate };
    }
    async function loadAvailability() {
      const sequence = ++loadSequence;
      ui.loadingEligibility();
      try {
        authorization = await authenticate();
        if (!authorization) {
          ui.ineligible("Sign in to Revvi to view live Class times for this Offer.");
          return;
        }
        ui.loadingAvailability();
        const data = await api.availability(authorization, availabilityContext());
        if (sequence !== loadSequence) return;
        occurrences = exactAvailability(data, context);
        if (occurrences.length === 0) ui.empty();
        else ui.occurrences(occurrences, selectOccurrence);
      } catch (error) {
        if (sequence !== loadSequence) return;
        if (error instanceof BookingWidgetRequestError && [401, 403].includes(error.status)) {
          ui.ineligible(error.message);
        } else if (error instanceof MemberstackBrowserAuthenticationError) {
          ui.ineligible("Sign in to Revvi to view live Class times for this Offer.");
        } else {
          ui.error("Live Class times could not be loaded safely.", error?.retryable === true);
        }
      }
    }
    async function selectOccurrence(occurrence) {
      if (requestActive) return;
      requestActive = true;
      selectedOccurrence = occurrence;
      dateInput.disabled = true;
      root.dataset.selectedClassId = occurrence.classId;
      root.dataset.selectedClassTime = occurrence.startAt;
      ui.selected(occurrence);
      ui.loadingQuote();
      try {
        const providerQuote = exactQuote(
          await api.quote(authorization, context.offerId, occurrence.classId),
          occurrence
        );
        quote = {
          ...providerQuote,
          occurrence: { ...providerQuote.occurrence, timezone: occurrence.timezone }
        };
        ui.quote(quote);
      } catch (error) {
        quote = null;
        if (error instanceof BookingWidgetRequestError && STALE_CODES.has(error.code)) {
          root.dataset.selectedClassId = occurrence.classId;
          root.dataset.selectedClassTime = occurrence.startAt;
          ui.stale(error.message);
        } else {
          ui.error("This Class could not be checked safely.", error?.retryable === true);
        }
      } finally {
        requestActive = false;
      }
    }
    async function refreshAvailabilityAfterAttempt() {
      try {
        const data = await api.availability(authorization, availabilityContext());
        occurrences = exactAvailability(data, context);
        root.dataset.availabilityStale = "false";
        ui.markAvailabilityRefreshed();
      } catch {
        root.dataset.availabilityStale = "true";
        ui.markAvailabilityRefreshFailed();
      }
    }
    async function submitBooking() {
      if (requestActive || !quote) return;
      requestActive = true;
      ui.confirmButton.disabled = true;
      root.dataset.availabilityStale = "true";
      ui.markAvailabilityStale();
      ui.submitting();
      try {
        const data = await api.createBooking(authorization, quote.quoteId, randomUuid());
        const booking = data?.booking;
        if (booking?.status === "confirmed") {
          ui.success({ ...booking, timezone: quote.occurrence?.timezone ?? selectedOccurrence?.timezone });
        } else if (booking?.status === "requires_action") {
          const redirectUrl = paymentActionUrl(booking.redirectUrl ?? data.redirectUrl);
          if (!redirectUrl) throw new Error("The payment action URL was invalid.");
          ui.requiresPaymentAction(redirectUrl);
        } else if (["unknown", "pending", "reconciliation"].includes(booking?.status)) {
          ui.reconciliation("Your Booking attempt is being reconciled. Do not submit it again.");
        } else {
          ui.error("Mindbody did not confirm this Booking.", false);
        }
      } catch (error) {
        if (error instanceof BookingWidgetRequestError && STALE_CODES.has(error.code)) {
          root.dataset.selectedClassId = selectedOccurrence?.classId ?? "";
          root.dataset.selectedClassTime = selectedOccurrence?.startAt ?? "";
          ui.stale(error.message);
        } else if (error instanceof BookingWidgetRequestError && (error.status === 0 || error.status >= 500)) {
          ui.reconciliation("The Booking result is not yet known. Do not submit it again while Revvi checks Mindbody.");
        } else {
          ui.error("Mindbody did not confirm this Booking.", false);
        }
      } finally {
        requestActive = false;
        ui.confirmButton.disabled = false;
        void refreshAvailabilityAfterAttempt();
      }
    }
    ui.confirmButton.addEventListener("click", submitBooking);
    function resetSelection() {
      selectedOccurrence = null;
      quote = null;
      dateInput.disabled = false;
      delete root.dataset.selectedClassId;
      delete root.dataset.selectedClassTime;
      ui.clearSelection();
    }
    ui.backButton.addEventListener("click", () => {
      if (!requestActive && occurrences.length > 0) {
        resetSelection();
        ui.occurrences(occurrences, selectOccurrence);
      }
    });
    ui.refreshButton.addEventListener("click", () => {
      if (!requestActive) {
        resetSelection();
        void loadAvailability();
      }
    });
    dateInput.addEventListener("change", () => {
      if (!requestActive) void loadAvailability();
    });
    void loadAvailability();
    return Object.freeze({ refresh: loadAvailability });
  }

  // webflow/src/index.js
  function mountBookingWidgets(documentRoot = document) {
    return [...documentRoot.querySelectorAll("[data-revvi-booking]")].filter((root) => root.dataset.bookingMounted !== "true").map((root) => {
      root.dataset.bookingMounted = "true";
      try {
        return mountBookingWidget(root);
      } catch {
        root.dataset.bookingState = "error";
        const error = root.querySelector("[data-booking-error]");
        if (error) {
          error.hidden = false;
          error.textContent = "This Revvi Booking widget is not configured correctly.";
        }
        return null;
      }
    }).filter(Boolean);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountBookingWidgets(), { once: true });
  } else {
    mountBookingWidgets();
  }
  return __toCommonJS(index_exports);
})();

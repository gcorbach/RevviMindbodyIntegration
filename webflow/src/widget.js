import {
  BookingWidgetRequestError,
  createBookingWidgetApi,
} from "./api.js";
import {
  createMemberstackAuthorizationHeader,
  MemberstackBrowserAuthenticationError,
} from "./customer.js";
import { createBookingWidgetUi } from "./ui.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STALE_CODES = new Set(["QUOTE_EXPIRED", "QUOTE_CHANGED", "CLASS_UNAVAILABLE", "SLOT_UNAVAILABLE"]);

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
  if (data?.business?.slug !== context.businessSlug
    || data?.offer?.id !== context.offerId
    || !Array.isArray(data?.occurrences)) {
    throw new Error("The live Class response did not match this Offer.");
  }
  return data.occurrences.filter((occurrence) => typeof occurrence?.classId === "string"
    && occurrence.classId.length > 0
    && typeof occurrence?.startAt === "string"
    && typeof occurrence?.timezone === "string");
}

function exactQuote(data, selectedOccurrence) {
  if (typeof data?.quoteId !== "string" || data.quoteId.length === 0
    || String(data?.occurrence?.classId) !== selectedOccurrence.classId) {
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

function currentDateAtLocation(timezone, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function mountBookingWidget(root, dependencies = {}) {
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
    bookingEndpoint: root.dataset.bookingEndpoint,
    paymentCompletionEndpoint: root.dataset.paymentCompletionEndpoint,
    demoCleanupEndpoint: root.dataset.demoCleanupEndpoint,
  });
  const authenticate = dependencies.authenticate
    ?? (() => createMemberstackAuthorizationHeader(browser));
  const randomUuid = dependencies.randomUuid ?? (() => browser.crypto.randomUUID());
  let authorization;
  let occurrences = [];
  let families = [];
  let selectedFamilyId = null;
  let selectedOccurrence = null;
  let quote = null;
  let requestActive = false;
  let activeDemoBookingId = null;
  let activeDemoBooking = null;
  let loadSequence = 0;

  function availabilityContext() {
    const startDate = dateInput.value?.trim();
    if (!ISO_DATE.test(startDate ?? "")) throw new Error("Choose a valid Class date.");
    return { ...context, startDate, ...(selectedFamilyId ? { classFamilyId: selectedFamilyId } : {}) };
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
      if (!selectedFamilyId && Array.isArray(data?.classFamilies)) {
        families = data.classFamilies;
        ui.families(families, selectedFamilyId, selectFamily);
      }
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

  function selectFamily(familyId) {
    if (requestActive || !UUID.test(familyId ?? "")) return;
    selectedFamilyId = familyId;
    selectedOccurrence = null;
    quote = null;
    ui.clearSelection();
    void loadAvailability();
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
        await api.quote(
          authorization,
          context.offerId,
          occurrence.classId,
          occurrence.classFamilyId ?? selectedFamilyId,
        ),
        occurrence,
      );
      quote = {
        ...providerQuote,
        occurrence: { ...providerQuote.occurrence, timezone: occurrence.timezone },
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
        activeDemoBookingId = booking?.sandboxDemo?.cleanupStatus === "pending"
          && UUID.test(booking?.sandboxDemo?.demoBookingId ?? "")
          ? booking.sandboxDemo.demoBookingId
          : null;
        activeDemoBooking = activeDemoBookingId ? booking : null;
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

  async function cleanupDemoBooking() {
    if (requestActive || !activeDemoBookingId) return;
    requestActive = true;
    ui.cleaningDemoBooking();
    try {
      const data = await api.cleanupDemoBooking(authorization, activeDemoBookingId);
      if (data?.bookingId !== activeDemoBookingId || data?.status !== "cancelled" || !activeDemoBooking) {
        throw new Error("The sandbox cleanup was not confirmed.");
      }
      const booking = {
        ...activeDemoBooking,
        sandboxDemo: {
          ...activeDemoBooking.sandboxDemo,
          cleanupStatus: "confirmed",
          entitlementRestorationObserved: data.passRestoration === "restored"
            ? true
            : data.passRestoration === "not_restored" ? false : null,
        },
      };
      activeDemoBookingId = null;
      activeDemoBooking = null;
      ui.success({ ...booking, timezone: quote?.occurrence?.timezone ?? selectedOccurrence?.timezone });
    } catch {
      ui.demoCleanupFailed();
    } finally {
      requestActive = false;
    }
  }

  async function completeReturnedPayment() {
    let returnedBookingId;
    try {
      returnedBookingId = new URL(browser.location.href).searchParams.get("booking");
    } catch {
      return false;
    }
    if (!UUID.test(returnedBookingId ?? "")) return false;
    requestActive = true;
    ui.submitting();
    try {
      authorization = await authenticate();
      if (!authorization) {
        ui.ineligible("Sign in to Revvi to finish checking this paid Booking.");
        return true;
      }
      const data = await api.completePaidBooking(authorization, returnedBookingId);
      const booking = data?.booking;
      if (booking?.status === "confirmed") {
        ui.success({ ...booking, timezone: root.dataset.locationTimezone });
      } else if (["unknown", "pending", "requires_action", "reconciliation"].includes(booking?.status)) {
        ui.reconciliation("Your payment and Class Booking are being reconciled. Do not submit another Booking.");
      } else {
        ui.error("Mindbody did not confirm this paid Booking.", false);
      }
    } catch (error) {
      if (error instanceof BookingWidgetRequestError && [401, 403].includes(error.status)) {
        ui.ineligible(error.message);
      } else {
        ui.reconciliation("The paid Booking result is not yet known. Do not submit another Booking while Revvi checks Mindbody.");
      }
    } finally {
      requestActive = false;
    }
    return true;
  }

  ui.confirmButton.addEventListener("click", submitBooking);
  ui.demoCleanupButton.addEventListener("click", cleanupDemoBooking);
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
  void (async () => {
    if (!await completeReturnedPayment()) await loadAvailability();
  })();
  return Object.freeze({ refresh: loadAvailability });
}

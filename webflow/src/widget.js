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
  let selectedClassKey = null;
  let selectedClassFamilyId = null;
  let selectedClassOccurrences = [];
  let selectedClassName = null;
  let selectedDateKey = null;
  let selectedOccurrence = null;
  let quote = null;
  let requestActive = false;
  let activeDemoBookingId = null;
  let activeDemoBooking = null;
  let loadSequence = 0;

  function announce(name, detail) {
    const CustomEvent = root.ownerDocument?.defaultView?.CustomEvent;
    if (typeof CustomEvent === "function") {
      root.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
    }
  }

  function availabilityContext() {
    const startDate = dateInput.value?.trim();
    if (!ISO_DATE.test(startDate ?? "")) throw new Error("Choose a valid Class date.");
    return { ...context, startDate };
  }

  function occurrenceDateKey(occurrence) {
    try {
      const parts = new Intl.DateTimeFormat("en", {
        timeZone: occurrence.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(occurrence.startAt));
      const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${fields.year}-${fields.month}-${fields.day}`;
    } catch {
      return null;
    }
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
      families = Array.isArray(data?.classFamilies) ? data.classFamilies : [];
      announce("revvi:availability-loaded", {
        business: data.business,
        offer: data.offer,
        classFamilies: families,
        occurrences,
      });
      ui.businessName(data?.business?.name);
      selectedClassKey = null;
      selectedClassFamilyId = null;
      selectedClassOccurrences = [];
      selectedClassName = null;
      selectedDateKey = null;
      selectedOccurrence = null;
      if (occurrences.length === 0 && families.length === 0) ui.empty();
      else ui.classChoices(occurrences, selectClass, families);
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

  function applyClassSelection(classKey, classOccurrences, priceLabel, family = null) {
    selectedClassKey = classKey;
    selectedClassOccurrences = [...classOccurrences].sort((left, right) => String(left.startAt).localeCompare(String(right.startAt)));
    selectedClassFamilyId = family?.id ?? selectedClassOccurrences[0]?.classFamilyId ?? null;
    selectedClassName = family?.displayName ?? family?.name
      ?? families.find((candidate) => String(candidate.id) === String(selectedClassOccurrences[0]?.classFamilyId))?.displayName
      ?? selectedClassOccurrences[0]?.name
      ?? "Class";
    const firstBookable = selectedClassOccurrences.find((occurrence) => ["available", "waitlist_available"].includes(occurrence.availabilityState));
    selectedDateKey = occurrenceDateKey(firstBookable ?? selectedClassOccurrences[0]);
    selectedOccurrence = null;
    quote = null;
    ui.clearSelection();
    ui.selectedClass(classKey, selectedClassName, priceLabel);
  }

  function selectClass(classKey, classOccurrences, priceLabel, family = null) {
    if (requestActive || !classKey || !Array.isArray(classOccurrences)) return;
    if (classOccurrences.length === 0
      && (!family?.id || family.availabilityState !== "available" || !family.nextOccurrence)) return;
    applyClassSelection(classKey, classOccurrences, priceLabel, family);
  }

  async function continueToTimes() {
    if (requestActive || !selectedClassKey) return;
    if (selectedClassOccurrences.length > 0) {
      ui.times(selectedClassOccurrences, selectedDateKey, selectDate, selectOccurrence, null, selectedClassName);
      return;
    }
    if (!selectedClassFamilyId) return;
    requestActive = true;
    dateInput.disabled = true;
    ui.loadingAvailability();
    try {
      const data = await api.availability(authorization, {
        ...availabilityContext(),
        classFamilyId: selectedClassFamilyId,
      });
      const familyOccurrences = exactAvailability(data, context)
        .filter((occurrence) => String(occurrence.classFamilyId) === String(selectedClassFamilyId));
      occurrences = [
        ...occurrences.filter((occurrence) => String(occurrence.classFamilyId) !== String(selectedClassFamilyId)),
        ...familyOccurrences,
      ];
      const selectedFamilyUpdate = Array.isArray(data?.classFamilies)
        ? data.classFamilies.find((candidate) => String(candidate.id) === String(selectedClassFamilyId))
        : null;
      if (selectedFamilyUpdate) {
        families = families.map((candidate) => String(candidate.id) === String(selectedClassFamilyId)
          ? { ...candidate, ...selectedFamilyUpdate }
          : candidate);
      }
      announce("revvi:availability-loaded", {
        business: data.business,
        offer: data.offer,
        classFamilies: families,
        occurrences: familyOccurrences,
      });
      if (familyOccurrences.length === 0) {
        ui.error("No current times for this Class could be validated safely.", true);
        return;
      }
      selectedClassOccurrences = familyOccurrences;
      const firstBookable = selectedClassOccurrences.find((occurrence) => ["available", "waitlist_available"].includes(occurrence.availabilityState));
      selectedDateKey = occurrenceDateKey(firstBookable ?? selectedClassOccurrences[0]);
      selectedOccurrence = null;
      quote = null;
      ui.clearSelection();
      ui.times(selectedClassOccurrences, selectedDateKey, selectDate, selectOccurrence, null, selectedClassName);
    } catch (error) {
      if (error instanceof BookingWidgetRequestError && [401, 403].includes(error.status)) {
        ui.ineligible(error.message);
      } else {
        ui.error("Live Class times could not be loaded safely.", error?.retryable === true);
      }
    } finally {
      requestActive = false;
      dateInput.disabled = false;
    }
  }

  function selectDate(dateKey) {
    if (requestActive || !selectedClassKey) return;
    selectedDateKey = dateKey;
    selectedOccurrence = null;
    quote = null;
    ui.clearSelection();
    ui.times(selectedClassOccurrences, selectedDateKey, selectDate, selectOccurrence, null, selectedClassName);
    ui.selectedDate(selectedDateKey, selectedClassOccurrences[0]?.timezone, selectedClassName);
  }

  function selectOccurrence(occurrence) {
    if (requestActive) return;
    selectedOccurrence = occurrence;
    root.dataset.selectedClassId = occurrence.classId;
    root.dataset.selectedClassTime = occurrence.startAt;
    ui.selected(occurrence);
  }

  async function continueToQuote() {
    if (requestActive || !selectedOccurrence) return;
    requestActive = true;
    dateInput.disabled = true;
    ui.loadingQuote();
    try {
      const providerQuote = exactQuote(
        await api.quote(
          authorization,
          context.offerId,
          selectedOccurrence.classId,
          selectedOccurrence.classFamilyId,
        ),
        selectedOccurrence,
      );
      quote = {
        ...providerQuote,
        occurrence: { ...providerQuote.occurrence, timezone: selectedOccurrence.timezone },
      };
      ui.quote(quote);
    } catch (error) {
      quote = null;
      if (error instanceof BookingWidgetRequestError && STALE_CODES.has(error.code)) {
        root.dataset.selectedClassId = selectedOccurrence.classId;
        root.dataset.selectedClassTime = selectedOccurrence.startAt;
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
      announce("revvi:availability-loaded", {
        business: data.business,
        offer: data.offer,
        classFamilies: Array.isArray(data?.classFamilies) ? data.classFamilies : [],
        occurrences,
      });
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
        const confirmed = { ...booking, timezone: quote.occurrence?.timezone ?? selectedOccurrence?.timezone };
        ui.success(confirmed);
        announce("revvi:booking-confirmed", { booking: confirmed });
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
      const cleaned = { ...booking, timezone: quote?.occurrence?.timezone ?? selectedOccurrence?.timezone };
      ui.success(cleaned);
      announce("revvi:booking-cleaned", { booking: cleaned });
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
        const confirmed = { ...booking, timezone: root.dataset.locationTimezone };
        ui.success(confirmed);
        announce("revvi:booking-confirmed", { booking: confirmed });
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
  ui.classContinueButton.addEventListener("click", continueToTimes);
  ui.continueButton.addEventListener("click", continueToQuote);
  ui.demoCleanupButton.addEventListener("click", cleanupDemoBooking);
  function resetSelection() {
    selectedClassKey = null;
    selectedClassFamilyId = null;
    selectedClassOccurrences = [];
    selectedClassName = null;
    selectedDateKey = null;
    selectedOccurrence = null;
    quote = null;
    dateInput.disabled = false;
    delete root.dataset.selectedClassId;
    delete root.dataset.selectedClassTime;
    ui.clearSelection();
  }
  ui.backButton.addEventListener("click", () => {
    if (!requestActive && selectedClassOccurrences.length > 0) {
      selectedOccurrence = null;
      quote = null;
      dateInput.disabled = false;
      ui.clearSelection();
      ui.times(selectedClassOccurrences, selectedDateKey, selectDate, selectOccurrence, null, selectedClassName);
    }
  });
  ui.backToClassesButton.addEventListener("click", () => {
    if (!requestActive) {
      resetSelection();
      ui.classChoices(occurrences, selectClass, families);
    }
  });
  ui.changeLocationButton.addEventListener("click", () => {
    if (root.dataset.changeLocationUrl) browser.location.assign(root.dataset.changeLocationUrl);
    else browser.history?.back?.();
  });
  ui.stepOneButton.addEventListener("click", () => {
    if (!requestActive) {
      resetSelection();
      ui.classChoices(occurrences, selectClass, families);
    }
  });
  ui.stepTwoButton.addEventListener("click", () => {
    if (!requestActive && selectedClassOccurrences.length > 0) {
      ui.times(selectedClassOccurrences, selectedDateKey, selectDate, selectOccurrence, selectedOccurrence, selectedClassName);
    }
  });
  ui.refreshButton.addEventListener("click", () => {
    if (!requestActive) {
      resetSelection();
      void loadAvailability();
    }
  });
  dateInput.addEventListener("change", () => {
    if (!requestActive) {
      resetSelection();
      void loadAvailability();
    }
  });
  void (async () => {
    if (!await completeReturnedPayment()) await loadAvailability();
  })();
  return Object.freeze({ refresh: loadAvailability });
}

const VIEW_SELECTORS = Object.freeze({
  loading: "[data-booking-loading]",
  ineligible: "[data-booking-ineligible]",
  error: "[data-booking-error]",
  empty: "[data-booking-empty]",
  stale: "[data-booking-stale]",
  occurrences: "[data-booking-class-choices]",
  times: "[data-booking-time-options]",
  quote: "[data-booking-quote]",
  submitting: "[data-booking-submitting]",
  paymentAction: "[data-booking-payment-action]",
  reconciliation: "[data-booking-reconciliation]",
  confirmation: "[data-booking-confirmation]",
});

function element(root, selector) {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`Revvi Booking markup is missing ${selector}.`);
  return found;
}

function setText(root, selector, value) {
  element(root, selector).textContent = value ?? "";
}

function formatDateTime(value, timezone, options = {}) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
      ...options,
    }).format(new Date(value));
  } catch {
    return "Time to be confirmed";
  }
}

function formatMoney(amount, currency) {
  if (!Number.isFinite(amount) || typeof currency !== "string") return "Price confirmed before Booking";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function dateKey(value, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value));
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  } catch {
    return null;
  }
}

function dateLabel(value, timezone) {
  try {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: timezone })
      .format(new Date(Date.UTC(year, month - 1, day, 12)));
  } catch {
    return value;
  }
}

function timeLabel(occurrence) {
  return formatDateTime(occurrence.startAt, occurrence.timezone, { dateStyle: undefined, timeStyle: "short" });
}

function classKey(occurrence) {
  return occurrence.classFamilyId
    ? `family:${occurrence.classFamilyId}`
    : `name:${occurrence.name ?? "class"}`;
}

function classDuration(occurrences) {
  const start = Date.parse(occurrences[0]?.startAt ?? "");
  const end = Date.parse(occurrences[0]?.endAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 60_000);
}

function availabilityPresentation(occurrence) {
  switch (occurrence.availabilityState) {
    case "available": return { label: "Available", bookable: true };
    case "waitlist_available": return { label: "Waitlist available", bookable: true };
    case "full": return { label: "Class is full", bookable: false };
    case "outside_booking_window": return { label: "Booking window closed", bookable: false };
    case "client_ineligible": return { label: "Not available for this Customer", bookable: false };
    default: return { label: "Availability to be confirmed", bookable: false };
  }
}

export function bookingConfirmationText(booking, fallbackLocationName) {
  const locationName = booking.locationName ?? fallbackLocationName;
  const references = booking?.sandboxDemo?.references;
  const searchableReferences = references
    && typeof references.clientId === "string"
    && typeof references.clientName === "string"
    && typeof references.saleId === "string"
    && typeof references.visitId === "string";
  if (booking?.sandboxDemo?.cleanupStatus === "pending" && searchableReferences) {
    const automaticCleanup = booking.sandboxDemo.autoCleanupAt
      ? `; otherwise it will be automatically cleaned at ${formatDateTime(booking.sandboxDemo.autoCleanupAt, booking.timezone)}`
      : "";
    return `Sandbox Booking is active for inspection: ${booking.className} at ${formatDateTime(booking.startAt, booking.timezone)} — ${locationName}. In Mindbody Business, search Clients for ${references.clientName} (Client ${references.clientId}) and open the Client schedule or visits. Cash Sale ${references.saleId} and Visit ${references.visitId} are the exact evidence. Use Clean up demo Booking when finished${automaticCleanup}.`;
  }
  if (booking?.sandboxDemo?.cleanupStatus === "confirmed" && searchableReferences) {
    const restoration = booking.sandboxDemo.entitlementRestorationObserved === true
      ? "Entitlement restoration was confirmed."
      : booking.sandboxDemo.entitlementRestorationObserved === false
        ? "Entitlement restoration was not observed."
        : "Entitlement restoration remains unknown.";
    return `Sandbox Booking verified and removed safely: ${booking.className} at ${formatDateTime(booking.startAt, booking.timezone)} — ${locationName}. Search Mindbody for ${references.clientName} (Client ${references.clientId}); the retained Cash Sale is ${references.saleId}, and Visit ${references.visitId} was removed. ${restoration}`;
  }
  return `Booking confirmed: ${booking.className} at ${formatDateTime(booking.startAt, booking.timezone)} — ${locationName}.`;
}

export function createBookingWidgetUi(root) {
  const views = Object.fromEntries(
    Object.entries(VIEW_SELECTORS).map(([name, selector]) => [name, element(root, selector)]),
  );
  const classTemplate = element(root, "[data-booking-class-template]");
  const timeTemplate = element(root, "[data-booking-time-template]");
  const selection = element(root, "[data-booking-selection]");
  const stepPanels = [...root.querySelectorAll("[data-booking-step-panel]")];
  const stepLinks = [...root.querySelectorAll("[data-booking-step-link]")];
  const continueButton = element(root, "[data-booking-continue]");

  setText(root, "[data-booking-location-copy]", root.dataset.locationName);
  setText(root, "[data-booking-location]", root.dataset.locationName);
  setText(root, "[data-booking-offer]", root.dataset.offerName);

  function setStep(step) {
    const current = String(step);
    root.dataset.bookingStep = current;
    for (const panel of stepPanels) panel.hidden = panel.dataset.bookingStepPanel !== current;
    for (const link of stepLinks) {
      const isCurrent = link.dataset.bookingStepLink === current;
      link.toggleAttribute("aria-current", isCurrent);
      link.disabled = Number(link.dataset.bookingStepLink) > Number(step);
    }
  }

  function show(status, viewName) {
    root.dataset.bookingState = status;
    root.setAttribute("aria-busy", String(status.startsWith("loading-") || status === "submitting"));
    for (const [name, view] of Object.entries(views)) view.hidden = name !== viewName;
    const step = viewName === "occurrences" ? 1 : viewName === "times" ? 2 : ["quote", "confirmation"].includes(viewName) ? 3 : null;
    if (step) setStep(step);
    else stepPanels.forEach((panel) => { panel.hidden = true; });
  }

  function renderClassChoices(occurrences, onSelect, families = []) {
    views.occurrences.replaceChildren();
    const familyNames = new Map(families.map((family) => [String(family.id), family.displayName ?? family.name]));
    const groups = new Map();
    for (const occurrence of occurrences) {
      const key = classKey(occurrence);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(occurrence);
    }
    for (const [key, classOccurrences] of groups) {
      classOccurrences.sort((left, right) => String(left.startAt).localeCompare(String(right.startAt)));
      const first = classOccurrences[0];
      const fragment = classTemplate.content.cloneNode(true);
      const card = fragment.querySelector("[data-booking-class-choice]");
      const button = element(fragment, "[data-class-select]");
      const presentation = classOccurrences.map(availabilityPresentation);
      const bookable = presentation.some(({ bookable: canBook }) => canBook);
      card.dataset.classKey = key;
      card.dataset.classId = String(first.classId);
      setText(fragment, "[data-class-name]", familyNames.get(String(first.classFamilyId)) ?? first.name ?? "Class");
      const instructor = first.staffName ?? "Instructor to be confirmed";
      const duration = classDuration(classOccurrences);
      const next = `Next: ${formatDateTime(first.startAt, first.timezone)}`;
      setText(fragment, "[data-class-meta]", `${instructor}${duration ? ` · ${duration} min` : ""} · ${next}`);
      button.disabled = !bookable;
      button.textContent = presentation.some(({ label }) => label === "Waitlist available") && !presentation.some(({ label }) => label === "Available")
        ? "View waitlist"
        : "Select";
      if (bookable) button.addEventListener("click", () => onSelect(key, classOccurrences));
      views.occurrences.append(fragment);
    }
    show("showing-classes", "occurrences");
  }

  function renderTimes(occurrences, selectedDate, onSelectDate, onSelectTime, selectedOccurrence = null, className = null) {
    const dates = [...new Set(occurrences
      .map((occurrence) => dateKey(occurrence.startAt, occurrence.timezone))
      .filter(Boolean))].sort();
    const activeDate = dates.includes(selectedDate) ? selectedDate : dates[0];
    const timezone = occurrences[0]?.timezone;
    const dateOptions = element(root, "[data-booking-date-options]");
    dateOptions.replaceChildren();
    for (const date of dates) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "revvi-booking-day-button";
      button.dataset.bookingDateOption = date;
      button.textContent = dateLabel(date, timezone);
      button.classList.toggle("active", date === activeDate);
      button.addEventListener("click", () => onSelectDate(date));
      dateOptions.append(button);
    }
    const timeOptions = element(root, "[data-booking-time-options]");
    timeOptions.replaceChildren();
    for (const occurrence of occurrences.filter((candidate) => dateKey(candidate.startAt, candidate.timezone) === activeDate)) {
      const fragment = timeTemplate.content.cloneNode(true);
      const button = element(fragment, "[data-time-select]");
      const presentation = availabilityPresentation(occurrence);
      button.dataset.classId = String(occurrence.classId);
      button.dataset.bookingOccurrence = "true";
      button.textContent = timeLabel(occurrence);
      button.classList.toggle("active", occurrence.classId === selectedOccurrence?.classId);
      button.disabled = !presentation.bookable;
      if (presentation.bookable) button.addEventListener("click", () => onSelectTime(occurrence));
      timeOptions.append(fragment);
    }
    setText(root, "[data-booking-time-context]", `${className ?? occurrences[0]?.name ?? "Class"} · ${root.dataset.locationName}`);
    show("showing-times", "times");
    return activeDate;
  }

  return Object.freeze({
    loadingEligibility() {
      views.loading.textContent = "Checking your Revvi access…";
      show("loading-eligibility", "loading");
    },
    loadingAvailability() {
      views.loading.textContent = "Loading live Class times…";
      show("loading-availability", "loading");
    },
    classChoices: renderClassChoices,
    times: renderTimes,
    enableContinue(enabled) {
      continueButton.disabled = !enabled;
    },
    loadingQuote() {
      views.loading.textContent = "Checking this Class and your Revvi terms…";
      show("loading-quote", "loading");
    },
    ineligible(message) {
      views.ineligible.textContent = message;
      show("ineligible", "ineligible");
    },
    empty() { show("empty", "empty"); },
    selected(occurrence) {
      selection.textContent = `${occurrence.name} — ${formatDateTime(occurrence.startAt, occurrence.timezone)}`;
      selection.hidden = false;
      continueButton.disabled = false;
      for (const button of root.querySelectorAll("[data-time-select]")) {
        button.classList.toggle("active", button.dataset.classId === String(occurrence.classId));
      }
    },
    clearSelection() {
      selection.textContent = "";
      selection.hidden = true;
      continueButton.disabled = true;
    },
    quote(quote) {
      setText(root, "[data-quote-class]", quote.occurrence?.name);
      setText(root, "[data-quote-time]", formatDateTime(quote.occurrence?.startAt, quote.occurrence?.timezone));
      setText(root, "[data-quote-location]", quote.occurrence?.locationName ?? root.dataset.locationName);
      setText(root, "[data-booking-review-price]", formatMoney(quote.price?.grandTotal, quote.price?.currency));
      setText(root, "[data-quote-expiry]", quote.expiresAt ? `Quote expires ${formatDateTime(quote.expiresAt, quote.occurrence?.timezone)}` : "");
      setText(root, "[data-quote-policy]", quote.cancellationPolicy?.displayText ?? "Cancellation terms will be confirmed by the Business.");
      show("confirming", "quote");
    },
    submitting() { show("submitting", "submitting"); },
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
      freshness.textContent = "Refreshing Class times after this Booking attempt…";
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
      setText(root, "[data-booking-confirmation-message]", bookingConfirmationText(booking, root.dataset.locationName));
      const cleanupButton = element(root, "[data-booking-demo-cleanup]");
      const cleanupMessage = element(root, "[data-booking-demo-cleanup-message]");
      const cleanupStatus = booking?.sandboxDemo?.cleanupStatus;
      root.dataset.demoCleanupStatus = cleanupStatus ?? "not-applicable";
      cleanupButton.hidden = cleanupStatus !== "pending";
      cleanupButton.disabled = false;
      cleanupButton.textContent = "Clean up demo Booking";
      cleanupMessage.hidden = true;
      cleanupMessage.textContent = "";
      show("success", "confirmation");
    },
    cleaningDemoBooking() {
      const cleanupButton = element(root, "[data-booking-demo-cleanup]");
      const cleanupMessage = element(root, "[data-booking-demo-cleanup-message]");
      cleanupButton.disabled = true;
      cleanupButton.textContent = "Cleaning up…";
      cleanupMessage.hidden = false;
      cleanupMessage.textContent = "Removing the exact sandbox Booking from Mindbody…";
    },
    demoCleanupFailed() {
      const cleanupButton = element(root, "[data-booking-demo-cleanup]");
      const cleanupMessage = element(root, "[data-booking-demo-cleanup-message]");
      cleanupButton.disabled = false;
      cleanupButton.textContent = "Retry demo cleanup";
      cleanupMessage.hidden = false;
      cleanupMessage.textContent = "Cleanup is not yet confirmed. Retry before closing this demo.";
    },
    error(message, retryable = false) {
      views.error.textContent = retryable ? `${message} Please try again.` : message;
      show("error", "error");
    },
    confirmButton: element(root, "[data-quote-confirm]"),
    backButton: element(root, "[data-quote-back]"),
    backToClassesButton: element(root, "[data-booking-back-to-classes]"),
    refreshButton: element(root, "[data-booking-refresh]"),
    continueButton,
    stepOneButton: element(root, "[data-booking-step-link=\"1\"]"),
    stepTwoButton: element(root, "[data-booking-step-link=\"2\"]"),
    demoCleanupButton: element(root, "[data-booking-demo-cleanup]"),
    changeLocationButton: element(root, "[data-booking-change-location]"),
  });
}

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

function dateParts(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    ? { year, month, day }
    : null;
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
  const externalConfirmation = root.previousElementSibling;
  if (!externalConfirmation?.matches?.("[data-booking-confirmation]")) {
    throw new Error("Revvi Booking markup is missing external confirmation.");
  }
  const views = Object.fromEntries(
    Object.entries(VIEW_SELECTORS).map(([name, selector]) => [
      name,
      name === "confirmation" ? externalConfirmation : element(root, selector),
    ]),
  );
  const classTemplate = element(root, "[data-booking-class-template]");
  const timeTemplate = element(root, "[data-booking-time-template]");
  const selection = element(root, "[data-booking-selection]");
  const stepPanels = [...root.querySelectorAll("[data-booking-step-panel]")];
  const stepLinks = [...root.querySelectorAll("[data-booking-step-link]")];
  const classContinueButton = element(root, "[data-booking-class-continue]");
  const continueButton = element(root, "[data-booking-continue]");
  const calendar = element(root, "[data-booking-calendar]");
  const calendarGrid = element(root, "[data-booking-calendar-grid]");
  const calendarMonthLabel = element(root, "[data-booking-calendar-month]");
  const calendarPrevious = element(root, "[data-booking-calendar-previous]");
  const calendarNext = element(root, "[data-booking-calendar-next]");
  let calendarMonth = null;
  let calendarDates = [];
  let calendarSelectedDate = null;
  let calendarSelectDate = null;

  setText(root, "[data-booking-location]", root.dataset.locationName);
  setText(root, "[data-booking-business]", root.dataset.offerName);
  setText(root, "[data-booking-business-copy]", root.dataset.offerName);

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
    root.hidden = viewName === "confirmation";
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
    const choices = families.map((family) => ({
      key: `family:${family.id}`,
      family,
      classOccurrences: groups.get(`family:${family.id}`) ?? [],
    }));
    const configuredKeys = new Set(choices.map(({ key }) => key));
    for (const [key, classOccurrences] of groups) {
      if (!configuredKeys.has(key)) choices.push({ key, family: null, classOccurrences });
    }
    for (const { key, family, classOccurrences } of choices) {
      classOccurrences.sort((left, right) => String(left.startAt).localeCompare(String(right.startAt)));
      const first = classOccurrences[0];
      const preview = first ?? family?.nextOccurrence ?? null;
      const fragment = classTemplate.content.cloneNode(true);
      const card = fragment.querySelector("[data-booking-class-choice]");
      const button = element(fragment, "[data-class-select]");
      const presentation = classOccurrences.map(availabilityPresentation);
      const bookable = presentation.some(({ bookable: canBook }) => canBook);
      const familyPreview = classOccurrences.length === 0
        && family?.availabilityState === "available"
        && preview !== null;
      const selectable = bookable || familyPreview;
      card.dataset.classKey = key;
      card.dataset.classAvailabilityState = family?.availabilityState ?? (bookable ? "available" : "unavailable");
      if (preview) card.dataset.classId = String(preview.classId);
      setText(fragment, "[data-class-name]", familyNames.get(String(family?.id ?? first?.classFamilyId)) ?? first?.name ?? "Class");
      if (preview) {
        const instructor = preview.staffName ?? "Instructor to be confirmed";
        const duration = classDuration(first ? classOccurrences : [preview]);
        const next = `Next: ${formatDateTime(preview.startAt, preview.timezone)}`;
        setText(fragment, "[data-class-meta]", `${instructor}${duration ? ` · ${duration} min` : ""} · ${next}`);
      } else {
        setText(fragment, "[data-class-meta]", family?.availabilityState === "cancelled"
          ? "Cancelled"
          : "Currently unavailable");
      }
      const previewPrices = familyPreview ? [family?.provisionalPrice] : [];
      const prices = [...new Map([...classOccurrences.map((occurrence) => occurrence?.provisionalPrice), ...previewPrices]
        .filter((price) => Number.isFinite(price?.amount)
          && typeof price?.currency === "string")
        .map((price) => {
          const label = formatMoney(price.amount, price.currency);
          return [label, label];
        })).values()];
      const priceLabel = prices.length === 1 ? prices[0]
        : prices.length > 1 ? `From ${prices[0]}`
          : preview ? "Price at review" : "No bookable times";
      setText(fragment, "[data-class-price]", priceLabel);
      button.disabled = !selectable;
      button.setAttribute("aria-pressed", "false");
      if (selectable) button.addEventListener("click", () => onSelect(key, classOccurrences, priceLabel, family));
      views.occurrences.append(fragment);
    }
    classContinueButton.disabled = true;
    setText(root, "[data-booking-class-hint]", "Select a class to continue");
    delete root.dataset.selectedClassKey;
    show("showing-classes", "occurrences");
  }

  function selectClassChoice(classKey, className, priceLabel) {
    root.dataset.selectedClassKey = classKey;
    for (const choice of root.querySelectorAll("[data-booking-class-choice]")) {
      const selected = choice.dataset.classKey === classKey;
      choice.classList.toggle("active", selected);
      choice.setAttribute("aria-pressed", String(selected));
      const tag = choice.querySelector("[data-class-selected]");
      if (tag) tag.hidden = !selected;
    }
    classContinueButton.disabled = false;
    setText(root, "[data-booking-class-hint]", `${className}${priceLabel ? ` · ${priceLabel}` : ""}`);
  }

  function renderCalendar() {
    if (!calendarMonth || calendarDates.length === 0) return;
    const available = new Set(calendarDates);
    const [year, month] = calendarMonth.split("-").map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mondayOffset = (first.getUTCDay() + 6) % 7;
    calendarMonthLabel.textContent = new Intl.DateTimeFormat(undefined, {
      month: "long", year: "numeric", timeZone: "UTC",
    }).format(first);
    calendarGrid.replaceChildren();
    for (const label of ["M", "T", "W", "T", "F", "S", "S"]) {
      const heading = document.createElement("span");
      heading.className = "revvi-booking-calendar-weekday";
      heading.textContent = label;
      calendarGrid.append(heading);
    }
    for (let index = 0; index < mondayOffset; index += 1) {
      const blank = document.createElement("span");
      blank.className = "revvi-booking-calendar-blank";
      calendarGrid.append(blank);
    }
    for (let day = 1; day <= lastDay; day += 1) {
      const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.bookingCalendarDate = value;
      button.textContent = String(day);
      button.disabled = !available.has(value);
      button.classList.toggle("active", value === calendarSelectedDate);
      if (!button.disabled) button.addEventListener("click", () => calendarSelectDate?.(value));
      calendarGrid.append(button);
    }
    const monthKeys = calendarDates.map((date) => date.slice(0, 7));
    calendarPrevious.disabled = calendarMonth <= monthKeys[0];
    calendarNext.disabled = calendarMonth >= monthKeys.at(-1);
  }

  function shiftCalendarMonth(offset) {
    const [year, month] = calendarMonth.split("-").map(Number);
    const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
    calendarMonth = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
    renderCalendar();
  }

  calendarPrevious.addEventListener("click", () => shiftCalendarMonth(-1));
  calendarNext.addEventListener("click", () => shiftCalendarMonth(1));

  function renderTimes(occurrences, selectedDate, onSelectDate, onSelectTime, selectedOccurrence = null, className = null) {
    const dates = [...new Set(occurrences
      .filter((occurrence) => availabilityPresentation(occurrence).bookable)
      .map((occurrence) => dateKey(occurrence.startAt, occurrence.timezone))
      .filter(Boolean))].sort();
    const activeDate = dates.includes(selectedDate) ? selectedDate : dates[0];
    const timezone = occurrences[0]?.timezone;
    const dateOptions = element(root, "[data-booking-date-options]");
    dateOptions.replaceChildren();
    for (const date of dates.slice(0, 3)) {
      const button = document.createElement("button");
      const parts = dateParts(date);
      const dateValue = parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)) : null;
      const weekday = document.createElement("span");
      const day = document.createElement("span");
      button.type = "button";
      button.className = "revvi-booking-day-button";
      button.dataset.bookingDateOption = date;
      button.setAttribute("aria-label", dateLabel(date, timezone));
      weekday.textContent = dateValue
        ? new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(dateValue)
        : date;
      day.textContent = parts ? String(parts.day) : date;
      button.append(weekday, day);
      button.classList.toggle("active", date === activeDate);
      button.addEventListener("click", () => onSelectDate(date));
      dateOptions.append(button);
    }
    calendar.hidden = true;
    if (dates.length > 3) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.dataset.bookingCalendarToggle = "";
      toggle.className = "revvi-booking-calendar-toggle";
      toggle.setAttribute("aria-label", "Show more available dates");
      toggle.setAttribute("aria-expanded", "false");
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("class", "revvi-booking-calendar-icon");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("width", "20");
      icon.setAttribute("height", "20");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("focusable", "false");
      icon.innerHTML = `
        <rect x="3.5" y="5.5" width="17" height="15" rx="2"></rect>
        <path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17"></path>
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01M16 17h.01"></path>
      `;
      toggle.append(icon);
      toggle.addEventListener("click", () => {
        calendar.hidden = !calendar.hidden;
        toggle.classList.toggle("active", !calendar.hidden);
        toggle.setAttribute("aria-expanded", String(!calendar.hidden));
      });
      dateOptions.append(toggle);
      calendarDates = dates;
      calendarSelectedDate = activeDate;
      calendarSelectDate = onSelectDate;
      calendarMonth = activeDate.slice(0, 7);
      renderCalendar();
    }
    const timeOptions = element(root, "[data-booking-time-options]");
    timeOptions.replaceChildren();
    const activeOccurrences = occurrences.filter((candidate) => dateKey(candidate.startAt, candidate.timezone) === activeDate);
    const timeCounts = new Map();
    for (const occurrence of activeOccurrences) {
      const label = timeLabel(occurrence);
      timeCounts.set(label, (timeCounts.get(label) ?? 0) + 1);
    }
    for (const occurrence of activeOccurrences) {
      const fragment = timeTemplate.content.cloneNode(true);
      const button = element(fragment, "[data-time-select]");
      const presentation = availabilityPresentation(occurrence);
      const label = timeLabel(occurrence);
      button.dataset.classId = String(occurrence.classId);
      button.dataset.bookingOccurrence = "true";
      button.textContent = timeCounts.get(label) > 1
        ? `${label} · ${occurrence.staffName ?? "Instructor to be confirmed"}`
        : label;
      button.classList.toggle("active", occurrence.classId === selectedOccurrence?.classId);
      button.disabled = !presentation.bookable;
      if (presentation.bookable) button.addEventListener("click", () => onSelectTime(occurrence));
      timeOptions.append(fragment);
    }
    const openCount = activeOccurrences.filter((occurrence) => availabilityPresentation(occurrence).bookable).length;
    setText(root, "[data-booking-times-count]", `${openCount} of ${activeOccurrences.length} open`);
    const duration = classDuration(occurrences);
    const instructor = occurrences[0]?.staffName ?? "Instructor to be confirmed";
    setText(root, "[data-booking-time-context]", `${className ?? occurrences[0]?.name ?? "Class"} · ${instructor}${duration ? ` · ${duration} min` : ""}`);
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
    businessName(name) {
      const label = typeof name === "string" && name.trim() ? name.trim() : root.dataset.offerName;
      setText(root, "[data-booking-business]", label);
      setText(root, "[data-booking-business-copy]", label);
    },
    selectedClass: selectClassChoice,
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
      setText(root, "[data-booking-time-hint]", `${dateLabel(dateKey(occurrence.startAt, occurrence.timezone), occurrence.timezone)} · ${timeLabel(occurrence)}`);
      for (const button of root.querySelectorAll("[data-time-select]")) {
        button.classList.toggle("active", button.dataset.classId === String(occurrence.classId));
      }
    },
    selectedDate(date, timezone, className = "Class") {
      selection.textContent = `${className} — ${dateLabel(date, timezone)}`;
      selection.hidden = false;
    },
    clearSelection() {
      selection.textContent = "";
      selection.hidden = true;
      continueButton.disabled = true;
      setText(root, "[data-booking-time-hint]", "Pick a time to continue");
    },
    quote(quote) {
      setText(root, "[data-quote-class]", quote.occurrence?.name);
      setText(root, "[data-quote-time]", formatDateTime(quote.occurrence?.startAt, quote.occurrence?.timezone));
      setText(root, "[data-quote-location]", quote.occurrence?.locationName ?? root.dataset.locationName);
      const priceLabel = formatMoney(quote.price?.grandTotal, quote.price?.currency);
      setText(root, "[data-booking-review-price]", priceLabel);
      element(root, "[data-quote-confirm]").textContent = Number(quote.price?.grandTotal) > 0
        ? `Reserve my spot · ${priceLabel}`
        : "Reserve my spot";
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
      setText(views.confirmation, "[data-booking-confirmation-message]", bookingConfirmationText(booking, root.dataset.locationName));
      const cleanupButton = element(views.confirmation, "[data-booking-demo-cleanup]");
      const cleanupMessage = element(views.confirmation, "[data-booking-demo-cleanup-message]");
      const cleanupStatus = booking?.sandboxDemo?.cleanupStatus;
      const references = booking?.sandboxDemo?.references;
      const providerEvidence = element(views.confirmation, "[data-booking-provider-evidence]");
      const hasProviderEvidence = typeof booking?.classId === "string"
        && typeof references?.clientId === "string"
        && typeof references?.clientName === "string"
        && typeof references?.saleId === "string"
        && typeof references?.paymentId === "string"
        && typeof references?.visitId === "string";
      providerEvidence.hidden = !hasProviderEvidence;
      if (hasProviderEvidence) {
        setText(providerEvidence, "[data-booking-evidence-status]", cleanupStatus === "pending"
          ? "Active in Mindbody now. Keep this page open while you verify the Client schedule or Class roster."
          : "Cancellation confirmed. The Cash Sale remains available as retained sandbox evidence.");
        setText(providerEvidence, "[data-booking-evidence-class-id]", booking.classId);
        setText(providerEvidence, "[data-booking-evidence-client-name]", references.clientName);
        setText(providerEvidence, "[data-booking-evidence-client-id]", references.clientId);
        setText(providerEvidence, "[data-booking-evidence-sale-id]", references.saleId);
        setText(providerEvidence, "[data-booking-evidence-payment-id]", references.paymentId);
        setText(providerEvidence, "[data-booking-evidence-visit-id]", references.visitId);
      }
      root.dataset.demoCleanupStatus = cleanupStatus ?? "not-applicable";
      cleanupButton.hidden = cleanupStatus !== "pending";
      cleanupButton.disabled = false;
      cleanupButton.textContent = "Clean up demo Booking";
      cleanupMessage.hidden = true;
      cleanupMessage.textContent = "";
      show("success", "confirmation");
    },
    cleaningDemoBooking() {
      const cleanupButton = element(views.confirmation, "[data-booking-demo-cleanup]");
      const cleanupMessage = element(views.confirmation, "[data-booking-demo-cleanup-message]");
      cleanupButton.disabled = true;
      cleanupButton.textContent = "Cleaning up…";
      cleanupMessage.hidden = false;
      cleanupMessage.textContent = "Removing the exact sandbox Booking from Mindbody…";
    },
    demoCleanupFailed() {
      const cleanupButton = element(views.confirmation, "[data-booking-demo-cleanup]");
      const cleanupMessage = element(views.confirmation, "[data-booking-demo-cleanup-message]");
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
    classContinueButton,
    backButton: element(root, "[data-quote-back]"),
    backToClassesButton: element(root, "[data-booking-back-to-classes]"),
    refreshButton: element(root, "[data-booking-refresh]"),
    continueButton,
    stepOneButton: element(root, "[data-booking-step-link=\"1\"]"),
    stepTwoButton: element(root, "[data-booking-step-link=\"2\"]"),
    demoCleanupButton: element(views.confirmation, "[data-booking-demo-cleanup]"),
    changeLocationButton: element(root, "[data-booking-change-location]"),
  });
}

const VIEW_SELECTORS = Object.freeze({
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

function formatDateTime(value, timezone) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
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

export function createBookingWidgetUi(root) {
  const views = Object.fromEntries(
    Object.entries(VIEW_SELECTORS).map(([name, selector]) => [name, element(root, selector)]),
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
        occurrence.provisionalPrice
          ? `Estimated ${formatMoney(occurrence.provisionalPrice.amount, occurrence.provisionalPrice.currency)} — confirmed before Booking`
          : "Terms confirmed before Booking",
      );
      setText(
        fragment,
        "[data-occurrence-capacity]",
        Number.isSafeInteger(occurrence.estimatedAvailableSlots) && occurrence.estimatedAvailableSlots > 0
          ? `${occurrence.estimatedAvailableSlots} spots left`
          : "",
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
      views.loading.textContent = "Checking your Revvi access…";
      show("loading-eligibility", "loading");
    },
    loadingAvailability() {
      views.loading.textContent = "Loading live Class times…";
      show("loading-availability", "loading");
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
    occurrences: renderOccurrences,
    selected(occurrence) {
      selection.textContent = `${occurrence.name} — ${formatDateTime(occurrence.startAt, occurrence.timezone)}`;
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
    refreshButton: element(root, "[data-booking-refresh]"),
    demoCleanupButton: element(root, "[data-booking-demo-cleanup]"),
  });
}

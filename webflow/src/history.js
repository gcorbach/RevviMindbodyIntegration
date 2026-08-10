import { BookingWidgetRequestError, createBookingWidgetApi } from "./api.js";
import {
  createMemberstackAuthorizationHeader,
  MemberstackBrowserAuthenticationError,
} from "./customer.js";

function element(root, selector) {
  const value = root.querySelector(selector);
  if (!value) throw new Error(`Revvi Booking history markup is missing ${selector}.`);
  return value;
}

function formatDateTime(value, timezone) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short", timeZone: timezone,
    }).format(new Date(value));
  } catch { return "Time to be confirmed"; }
}

function cancellationLabel(booking) {
  if (booking.cancellationState === "requestable") return "Cancellation available";
  if (booking.cancellationState === "pending") return "Cancellation is being reconciled";
  if (booking.cancellationState === "unsupported") return "Contact Revvi support to cancel";
  return "Cancellation unavailable";
}

export function mountBookingHistory(root, dependencies = {}) {
  const browser = dependencies.browser ?? window;
  const list = element(root, "[data-history-bookings]");
  const template = element(root, "[data-history-booking-template]");
  const loading = element(root, "[data-history-loading]");
  const errorView = element(root, "[data-history-error]");
  const empty = element(root, "[data-history-empty]");
  const resultView = element(root, "[data-history-result]");
  const api = dependencies.api ?? createBookingWidgetApi({
    fetcher: dependencies.fetcher ?? browser.fetch.bind(browser),
    upcomingEndpoint: root.dataset.upcomingEndpoint,
    cancellationEndpoint: root.dataset.cancellationEndpoint,
  });
  const authenticate = dependencies.authenticate
    ?? (() => createMemberstackAuthorizationHeader(browser));
  let authorization;
  const activeCancellations = new Set();

  function show(view) {
    loading.hidden = view !== "loading";
    errorView.hidden = view !== "error";
    empty.hidden = view !== "empty";
  }

  function result(message, state) {
    resultView.hidden = false;
    resultView.dataset.historyResult = state;
    resultView.textContent = message;
  }

  async function cancel(booking, button) {
    if (activeCancellations.has(booking.id)) return;
    if (!browser.confirm("Request cancellation of this Class Booking? Refund and pass restoration are handled separately.")) return;
    activeCancellations.add(booking.id);
    button.disabled = true;
    button.textContent = "Requesting cancellationâ€¦";
    try {
      const cancellation = await api.cancelBooking(
        authorization,
        booking.id,
        "Revvi Customer requested cancellation",
      );
      if (cancellation.status === "cancelled") {
        result(
          `Cancellation confirmed. Refund: ${cancellation.refund ?? "not requested"}. Pass restoration: ${cancellation.passRestoration ?? "unknown"}.`,
          "cancelled",
        );
      } else if (cancellation.status === "unknown") {
        result(
          "Cancellation outcome is unknown. Do not submit it again; Revvi support is reconciling it. Refund and pass restoration remain unconfirmed.",
          "unknown",
        );
      } else {
        result(
          "Mindbody did not confirm cancellation. The Booking remains active; no refund or pass restoration is claimed.",
          "failed",
        );
      }
      await load();
    } catch (error) {
      result(
        error instanceof BookingWidgetRequestError
          ? error.message
          : "Revvi could not request cancellation safely.",
        "failed",
      );
      button.disabled = false;
      button.textContent = "Request cancellation";
    } finally {
      activeCancellations.delete(booking.id);
    }
  }

  function render(bookings) {
    list.replaceChildren();
    for (const booking of bookings) {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector("[data-history-booking]");
      card.dataset.bookingId = booking.id;
      element(fragment, "[data-history-class]").textContent = booking.className ?? "Class";
      element(fragment, "[data-history-business]").textContent = booking.businessName ?? "";
      element(fragment, "[data-history-time]").textContent = formatDateTime(booking.startAt, booking.timezone);
      element(fragment, "[data-history-location]").textContent = booking.locationName ?? "";
      element(fragment, "[data-history-status]").textContent = cancellationLabel(booking);
      const button = element(fragment, "[data-history-cancel]");
      button.disabled = booking.cancellationState !== "requestable";
      if (!button.disabled) button.addEventListener("click", () => cancel(booking, button));
      list.append(fragment);
    }
  }

  async function load() {
    show("loading");
    try {
      authorization = authorization ?? await authenticate();
      if (!authorization) throw new MemberstackBrowserAuthenticationError("MEMBERSTACK_TOKEN_MISSING");
      const data = await api.upcomingBookings(authorization, 20);
      const bookings = Array.isArray(data?.bookings) ? data.bookings : [];
      render(bookings);
      show(bookings.length === 0 ? "empty" : "bookings");
      root.dataset.historyState = bookings.length === 0 ? "empty" : "ready";
    } catch (error) {
      errorView.textContent = error instanceof BookingWidgetRequestError
        ? error.message
        : "Sign in to Revvi to view your upcoming Class Bookings.";
      show("error");
      root.dataset.historyState = "error";
    }
  }

  void load();
  return Object.freeze({ reload: load });
}

export function mountBookingHistoryWidgets(documentRoot = document) {
  return [...documentRoot.querySelectorAll("[data-revvi-booking-history]")]
    .filter((root) => root.dataset.historyMounted !== "true")
    .map((root) => {
      root.dataset.historyMounted = "true";
      return mountBookingHistory(root);
    });
}

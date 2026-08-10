import { mountBookingWidget } from "./widget.js";
import { mountBookingHistoryWidgets } from "./history.js";

export { mountBookingWidget } from "./widget.js";
export { mountBookingHistory, mountBookingHistoryWidgets } from "./history.js";

export function mountBookingWidgets(documentRoot = document) {
  return [...documentRoot.querySelectorAll("[data-revvi-booking]")]
    .filter((root) => root.dataset.bookingMounted !== "true")
    .map((root) => {
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
    })
    .filter(Boolean);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    mountBookingWidgets();
    mountBookingHistoryWidgets();
  }, { once: true });
} else {
  mountBookingWidgets();
  mountBookingHistoryWidgets();
}

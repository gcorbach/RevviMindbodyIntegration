const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELDS = ["businessSlug", "locationId", "offerId"];
const STORAGE_KEY = "revvi.pending-booking-context.v1";
const MAX_AGE = 30 * 60 * 1000;

export class BookingContextError extends Error {}

function validated(values) {
  if (!SLUG.test(values.businessSlug ?? "")
    || !UUID.test(values.locationId ?? "") || !UUID.test(values.offerId ?? "")) {
    throw new BookingContextError("Open a complete booking link from the partner page.");
  }
  return Object.freeze({ businessSlug: values.businessSlug,
    locationId: values.locationId.toLowerCase(), offerId: values.offerId.toLowerCase() });
}

// A URL is one complete context. Never combine it with an embed or an old login.
export function resolveBookingContext(dataset, browser, now = Date.now()) {
  const url = new URL(browser.location.href);
  const hasParameters = FIELDS.some((key) => url.searchParams.has(key));
  const dynamic = hasParameters || dataset.bookingContext === "url"
    || /^\/book\/?$/.test(url.pathname);
  const clearPending = () => {
    try { browser.sessionStorage?.removeItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
  };
  if (!dynamic) return { context: validated(dataset), dynamic: false, clearPending };

  let context;
  if (hasParameters) {
    clearPending();
    if (FIELDS.some((key) => url.searchParams.getAll(key).length !== 1)) {
      throw new BookingContextError("Open a complete booking link from the partner page.");
    }
    context = validated(Object.fromEntries(FIELDS.map((key) => [key, url.searchParams.get(key)])));
  } else {
    let saved;
    try { saved = JSON.parse(browser.sessionStorage?.getItem(STORAGE_KEY) ?? "null"); } catch { /* No saved context. */ }
    clearPending();
    if (!saved || saved.path !== url.pathname || !Number.isFinite(saved.savedAt)
      || now - saved.savedAt < 0 || now - saved.savedAt > MAX_AGE) {
      throw new BookingContextError("Choose an Offer on the partner page before booking.");
    }
    context = validated(saved.context ?? {});
    for (const key of FIELDS) url.searchParams.set(key, context[key]);
    browser.history.replaceState(browser.history.state, "", url.href);
  }
  try {
    browser.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify({
      context, path: url.pathname, savedAt: now,
    }));
  } catch { /* The complete URL still supports login and reload without storage. */ }
  return { context, dynamic: true, clearPending };
}

export function applyAvailabilityLocation(root, data, context, required = false) {
  if (!data.location && !required) return;
  if (data.location?.id !== context.locationId || typeof data.location?.name !== "string"
    || !data.location.name || typeof data.location?.timezone !== "string") {
    throw new Error("The live Location did not match this booking link.");
  }
  new Intl.DateTimeFormat("en", { timeZone: data.location.timezone }).format();
  root.dataset.locationName = data.location.name;
  root.dataset.locationTimezone = data.location.timezone;
  root.dataset.offerName = data.offer?.title ?? data.offer?.name ?? "";
  for (const element of root.querySelectorAll("[data-booking-location]")) {
    element.textContent = data.location.name;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 31;

export class ClassAvailabilityRequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ClassAvailabilityRequestError";
    this.code = code;
    this.status = status;
  }
}

function parseDate(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ClassAvailabilityRequestError("INVALID_DATE", `${fieldName} must be a calendar date.`);
  }
  const match = DATE.exec(value);
  if (!match) throw new ClassAvailabilityRequestError("INVALID_DATE", `${fieldName} must use YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() + 1 !== month || instant.getUTCDate() !== day) {
    throw new ClassAvailabilityRequestError("INVALID_DATE", `${fieldName} is not a valid calendar date.`);
  }
  return value;
}

function dateParts(value) {
  const [, year, month, day] = DATE.exec(value);
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function addDays(value, days) {
  const parts = dateParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * DAY_MS)
    .toISOString().slice(0, 10);
}

function localParts(instant, timezone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new ClassAvailabilityRequestError("INVALID_TIMEZONE", "The configured Location timezone is invalid.", 409);
  }
  const result = {};
  for (const part of formatter.formatToParts(instant)) {
    if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) {
      result[part.type] = Number(part.value);
    }
  }
  return result;
}

function offsetMilliseconds(instantMs, timezone) {
  const roundedMs = Math.floor(instantMs / 1000) * 1000;
  const parts = localParts(new Date(roundedMs), timezone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - roundedMs;
}

function localBoundaryToInstant(date, timezone, endOfDay) {
  const parts = dateParts(date);
  const hour = endOfDay ? 23 : 0;
  const minute = endOfDay ? 59 : 0;
  const second = endOfDay ? 59 : 0;
  const millisecond = endOfDay ? 999 : 0;
  return localDateTimePartsToInstant({ ...parts, hour, minute, second, millisecond }, timezone);
}

function localDateTimePartsToInstant(parts, timezone) {
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let instantMs = wallAsUtc - offsetMilliseconds(wallAsUtc, timezone);
  instantMs = wallAsUtc - offsetMilliseconds(instantMs, timezone);
  const roundTrip = localParts(new Date(instantMs), timezone);
  if (roundTrip.year !== parts.year || roundTrip.month !== parts.month || roundTrip.day !== parts.day
    || roundTrip.hour !== parts.hour || roundTrip.minute !== parts.minute || roundTrip.second !== parts.second) {
    throw new ClassAvailabilityRequestError(
      "INVALID_LOCAL_DATE_BOUNDARY",
      "A configured Location date/time could not be resolved safely.",
      409,
    );
  }
  return new Date(instantMs).toISOString();
}

function localToday(now, timezone) {
  const parts = localParts(now, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function localTimeSecondsAt(instant, timezone) {
  const parts = localParts(instant, timezone);
  return (parts.hour * 60 * 60) + (parts.minute * 60) + parts.second;
}

export function parseClassAvailabilityRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ClassAvailabilityRequestError("INVALID_REQUEST", "A Class availability request is required.");
  }
  const businessSlug = typeof value.businessSlug === "string" ? value.businessSlug.trim() : "";
  if (!SLUG.test(businessSlug)) {
    throw new ClassAvailabilityRequestError("INVALID_BUSINESS", "A valid Business slug is required.");
  }
  if (typeof value.offerId !== "string" || !UUID.test(value.offerId)) {
    throw new ClassAvailabilityRequestError("INVALID_OFFER", "A valid Revvi Offer ID is required.");
  }
  if (typeof value.locationId !== "string" || !UUID.test(value.locationId)) {
    throw new ClassAvailabilityRequestError("INVALID_LOCATION", "A valid Location ID is required.");
  }
  if (value.classFamilyId !== undefined
    && (typeof value.classFamilyId !== "string" || !UUID.test(value.classFamilyId))) {
    throw new ClassAvailabilityRequestError("INVALID_CLASS_FAMILY", "A valid Class family ID is required.");
  }
  const startDate = parseDate(value.startDate, "startDate");
  const endDate = parseDate(value.endDate, "endDate");
  if (!startDate && endDate) {
    throw new ClassAvailabilityRequestError("INVALID_DATE_RANGE", "startDate is required when endDate is supplied.");
  }
  return {
    businessSlug,
    offerId: value.offerId,
    locationId: value.locationId,
    ...(value.classFamilyId !== undefined ? { classFamilyId: value.classFamilyId } : {}),
    startDate,
    endDate,
  };
}

export function resolveClassAvailabilityDateRange({ startDate, endDate, timezone, now }) {
  const resolvedStart = startDate ?? localToday(now, timezone);
  const resolvedEnd = endDate ?? addDays(resolvedStart, DEFAULT_DAYS - 1);
  const startParts = dateParts(resolvedStart);
  const endParts = dateParts(resolvedEnd);
  const startDay = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
  const endDay = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  if (endDay < startDay) {
    throw new ClassAvailabilityRequestError("INVALID_DATE_RANGE", "endDate must not precede startDate.");
  }
  if (((endDay - startDay) / DAY_MS) + 1 > MAX_DAYS) {
    throw new ClassAvailabilityRequestError("DATE_RANGE_TOO_LONG", `Class availability is limited to ${MAX_DAYS} days.`);
  }
  return {
    startDate: resolvedStart,
    endDate: resolvedEnd,
    startAt: localBoundaryToInstant(resolvedStart, timezone, false),
    endAt: localBoundaryToInstant(resolvedEnd, timezone, true),
  };
}

export function normalizeMindbodyDateTime(value, timezone) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const normalized = value.trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
    const instant = new Date(normalized);
    return Number.isNaN(instant.valueOf()) ? null : instant.toISOString();
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    millisecond: Number((match[7] ?? "0").padEnd(3, "0")),
  };
  const validation = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  ));
  if (validation.getUTCFullYear() !== parts.year || validation.getUTCMonth() + 1 !== parts.month
    || validation.getUTCDate() !== parts.day || validation.getUTCHours() !== parts.hour
    || validation.getUTCMinutes() !== parts.minute || validation.getUTCSeconds() !== parts.second) return null;
  return localDateTimePartsToInstant(parts, timezone);
}

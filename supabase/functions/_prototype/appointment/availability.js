export function dateRange(selectedDate) {
  const lookaheadDays = Number(Deno.env.get("MINDBODY_AVAILABILITY_LOOKAHEAD_DAYS") ?? 365);
  const start = new Date(`${selectedDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (Number.isInteger(lookaheadDays) && lookaheadDays > 0 ? lookaheadDays : 30));
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

export function localDate(isoDateTime, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoDateTime));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function serviceResponse(service) {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    durationMinutes: service.durationMinutes,
    price: service.price,
  };
}

export function slotResponse(item, service) {
  const durationMinutes = item.durationMinutes ?? service.durationMinutes;
  const endTime = item.endTime ?? (durationMinutes
    ? new Date(new Date(item.startTime).getTime() + durationMinutes * 60_000).toISOString()
    : null);
  return {
    id: `slot-${item.startTime}`,
    startTime: item.startTime,
    endTime,
    durationMinutes,
    price: item.price ?? service.price,
  };
}

export function availabilityResponse({ items, service, selectedDate, timezone, locationProviderId }) {
  const slots = items
    .filter((item) => !item.locationProviderId || item.locationProviderId === String(locationProviderId))
    .map((item) => slotResponse(item, service))
    .sort((left, right) => left.startTime.localeCompare(right.startTime));
  const selectedDateSlots = slots.filter((slot) => localDate(slot.startTime, timezone) === selectedDate);
  const nextSlot = slots.find((slot) => localDate(slot.startTime, timezone) > selectedDate);
  return {
    state: selectedDateSlots.length > 0 ? "available" : "empty",
    selectedDate,
    slots: selectedDateSlots,
    earliestNextAvailability: nextSlot
      ? { date: localDate(nextSlot.startTime, timezone), startTime: nextSlot.startTime }
      : null,
  };
}

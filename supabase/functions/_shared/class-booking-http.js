export function requestId(request) {
  const supplied = request.headers.get("x-request-id");
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export function headers(origin, id) {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
    "X-Request-Id": id,
  };
}

export function json(body, status, origin, id) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin, id) });
}

export function failure(code, message, status, origin, id) {
  return json({
    ok: false,
    error: { code, message, retryable: status >= 500 },
    requestId: id,
  }, status, origin, id);
}

export function publicBooking(value, options = {}) {
  const references = {
    ...(value.providerClassId ? { classId: value.providerClassId } : {}),
    ...(value.providerVisitId ? { visitId: value.providerVisitId } : {}),
    ...(value.providerRosterBookingId ? { rosterBookingId: value.providerRosterBookingId } : {}),
    ...(value.providerWaitlistEntryId ? { waitlistEntryId: value.providerWaitlistEntryId } : {}),
    ...(value.providerClientServiceId ? { clientServiceId: value.providerClientServiceId } : {}),
    ...(value.providerServiceProductId ? { serviceProductId: value.providerServiceProductId } : {}),
    ...(value.providerSaleId ? { saleId: value.providerSaleId } : {}),
    ...(value.providerCartId ? { cartId: value.providerCartId } : {}),
    ...(value.providerTransactionId ? { transactionId: value.providerTransactionId } : {}),
    ...(value.providerPaymentId ? { paymentId: value.providerPaymentId } : {}),
  };
  let redirectUrl = null;
  if (options.includeRedirect !== false
    && value.status === "requires_action"
    && typeof value.redirectUrl === "string") {
    try {
      const parsed = new URL(value.redirectUrl);
      if (parsed.protocol === "https:") redirectUrl = parsed.toString();
    } catch {
      redirectUrl = null;
    }
  }
  const hasPrice = options.optionalPrice !== true || value.priceAmount != null;
  return {
    id: value.id,
    status: value.status === "pending" ? "unknown" : value.status,
    ...(options.includePaymentStatus ? { paymentStatus: value.paymentStatus ?? "unknown" } : {}),
    providerReferences: references,
    ...(value.className ? { className: value.className } : {}),
    ...(value.startAt ? { startAt: value.startAt } : {}),
    ...(value.locationName ? { locationName: value.locationName } : {}),
    ...(hasPrice ? { price: { amount: Number(value.priceAmount ?? 0), currency: value.currency } } : {}),
    ...(redirectUrl ? { redirectUrl } : {}),
  };
}

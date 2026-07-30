create unique index booking_support_items_attempt_reason_idx
  on public.booking_support_items (booking_attempt_id, reason);

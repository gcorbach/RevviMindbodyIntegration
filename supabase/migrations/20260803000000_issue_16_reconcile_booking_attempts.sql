alter type public.booking_attempt_state add value if not exists 'payment_needs_attention';

alter table public.booking_attempts
  add column reconciliation_attempts integer not null default 0 check (reconciliation_attempts >= 0),
  add column reconciliation_last_attempted_at timestamptz;

create index booking_attempts_unknown_reconciliation_idx
  on public.booking_attempts (business_id, state, reconciliation_last_attempted_at)
  where state = 'unknown';

create or replace function public.validate_booking_attempt_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = new.state then return new; end if;
  if old.state = 'expired' then
    raise exception 'an expired booking attempt cannot be revived';
  end if;
  if not (
    (old.state = 'created' and new.state in ('pending_checkout', 'failed', 'expired'))
    or (old.state = 'pending_checkout' and new.state in ('payment_needs_attention', 'confirmed', 'unknown', 'failed', 'expired'))
    or (old.state = 'payment_needs_attention' and new.state in ('pending_checkout', 'confirmed', 'unknown', 'failed', 'expired'))
    or (old.state = 'unknown' and new.state in ('confirmed', 'failed', 'expired'))
  ) then
    raise exception 'invalid booking attempt state transition from % to %', old.state, new.state;
  end if;
  return new;
end;
$$;

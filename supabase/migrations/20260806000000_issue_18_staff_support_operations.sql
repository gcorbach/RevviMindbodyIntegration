create or replace function public.booking_support_exception_category(reason text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when upper(reason) in ('CLIENT_MATCH_AMBIGUOUS', 'CLIENT_MAPPING_CONFLICT', 'CLIENT_RESOLUTION_STALE', 'CLIENT_RESOLUTION_UNKNOWN')
      then 'ambiguous_client'
    when upper(reason) = 'RECONCILIATION_EXHAUSTED'
      then 'reconciliation_failure'
    when upper(reason) = 'EXPIRED_REQUIRES_ATTENTION'
      then 'expired_attempt'
    else 'unknown_outcome'
  end;
$$;

alter table public.booking_support_items
  add column exception_category text,
  add column resolution_summary text,
  add column resolved_by uuid references auth.users(id);

update public.booking_support_items
set exception_category = public.booking_support_exception_category(reason);

alter table public.booking_support_items
  alter column exception_category set not null,
  add constraint booking_support_items_exception_category_check
    check (exception_category in ('ambiguous_client', 'unknown_outcome', 'reconciliation_failure', 'expired_attempt')),
  add constraint booking_support_items_resolution_check
    check (
      (status = 'open' and resolved_at is null and resolved_by is null and resolution_summary is null)
      or
      (status = 'resolved' and resolved_at is not null and resolved_by is not null and length(trim(resolution_summary)) between 10 and 1000)
    );

create or replace function public.prepare_booking_support_item()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.exception_category = public.booking_support_exception_category(new.reason);
    return new;
  end if;

  if old.business_id is distinct from new.business_id
    or old.booking_attempt_id is distinct from new.booking_attempt_id
    or old.correlation_id is distinct from new.correlation_id
    or old.reason is distinct from new.reason
    or old.exception_category is distinct from new.exception_category
    or old.created_at is distinct from new.created_at
  then
    raise exception 'booking support item facts are immutable';
  end if;
  if old.status = 'resolved' and row(new.status, new.resolved_at, new.resolved_by, new.resolution_summary)
    is distinct from row(old.status, old.resolved_at, old.resolved_by, old.resolution_summary)
  then
    raise exception 'resolved booking support items are immutable';
  end if;
  return new;
end;
$$;

create trigger booking_support_items_prepare
before insert or update on public.booking_support_items
for each row execute function public.prepare_booking_support_item();

create table public.booking_support_actions (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_support_item_id uuid not null references public.booking_support_items(id) on delete cascade,
  booking_attempt_id uuid references public.booking_attempts(id) on delete set null,
  correlation_id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action = 'resolve'),
  resolution text not null check (length(trim(resolution)) between 10 and 1000),
  created_at timestamptz not null default now()
);

create index booking_support_actions_item_idx
  on public.booking_support_actions (booking_support_item_id, created_at);

create or replace function public.prevent_booking_support_action_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'booking support actions are append-only';
end;
$$;

create trigger booking_support_actions_append_only
before update or delete on public.booking_support_actions
for each row execute function public.prevent_booking_support_action_mutation();

create table public.booking_support_alerts (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_support_item_id uuid not null references public.booking_support_items(id) on delete cascade,
  booking_attempt_id uuid references public.booking_attempts(id) on delete set null,
  correlation_id uuid not null,
  exception_category text not null check (exception_category = 'unknown_outcome'),
  status text not null default 'open' check (status in ('open', 'acknowledged')),
  created_at timestamptz not null default now(),
  unique (booking_support_item_id)
);

create index booking_support_alerts_business_idx
  on public.booking_support_alerts (business_id, status, created_at);

create or replace function public.alert_unknown_booking_support_item()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.exception_category = 'unknown_outcome' then
    insert into public.booking_support_alerts (
      business_id,
      booking_support_item_id,
      booking_attempt_id,
      correlation_id,
      exception_category
    ) values (
      new.business_id,
      new.id,
      new.booking_attempt_id,
      new.correlation_id,
      new.exception_category
    ) on conflict (booking_support_item_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger booking_support_items_unknown_alert
after insert on public.booking_support_items
for each row execute function public.alert_unknown_booking_support_item();

insert into public.booking_support_alerts (
  business_id,
  booking_support_item_id,
  booking_attempt_id,
  correlation_id,
  exception_category,
  created_at
)
select
  business_id,
  id,
  booking_attempt_id,
  correlation_id,
  exception_category,
  created_at
from public.booking_support_items
where exception_category = 'unknown_outcome'
on conflict (booking_support_item_id) do nothing;

create or replace function public.has_platform_operations_access()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'platform_operations')::boolean, false);
$$;

create or replace function public.has_booking_support_access(candidate_business_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.has_business_staff_access(candidate_business_id)
    or public.has_platform_operations_access();
$$;

create policy booking_support_items_staff_select
on public.booking_support_items for select to authenticated
using (
  public.has_booking_support_access(business_id)
);

alter table public.booking_support_actions enable row level security;
alter table public.booking_support_alerts enable row level security;

create policy booking_support_actions_staff_select
on public.booking_support_actions for select to authenticated
using (
  public.has_booking_support_access(business_id)
);

create policy booking_support_alerts_staff_select
on public.booking_support_alerts for select to authenticated
using (
  public.has_booking_support_access(business_id)
);

grant select on public.booking_support_items to authenticated;
grant select on public.booking_support_actions to authenticated;
grant select on public.booking_support_alerts to authenticated;
grant select on public.business_staff_access to service_role;
grant all on public.booking_support_actions to service_role;
grant all on public.booking_support_alerts to service_role;
grant usage, select on sequence public.booking_support_actions_id_seq to service_role;
grant usage, select on sequence public.booking_support_alerts_id_seq to service_role;

create or replace function public.resolve_booking_support_item(
  candidate_item_id uuid,
  candidate_resolution text
)
returns public.booking_support_items
language plpgsql
security definer
set search_path = public
as $$
declare
  support_item public.booking_support_items;
  authoritative_result_established boolean := false;
  resolved_item public.booking_support_items;
begin
  if auth.uid() is null then
    raise insufficient_privilege using message = 'staff authentication is required';
  end if;
  if candidate_resolution is null or length(trim(candidate_resolution)) not between 10 and 1000 then
    raise exception 'resolution must be between 10 and 1000 characters';
  end if;

  select * into support_item
  from public.booking_support_items
  where id = candidate_item_id
  for update;

  if support_item.id is null then
    raise no_data_found using message = 'booking support item was not found';
  end if;
  if not public.has_booking_support_access(support_item.business_id) then
    raise insufficient_privilege using message = 'staff is not authorised for this Business';
  end if;
  if support_item.status = 'resolved' then
    return support_item;
  end if;

  if support_item.booking_attempt_id is not null then
    select exists (
      select 1
      from public.booking_attempt_events
      where booking_attempt_id = support_item.booking_attempt_id
        and (
          (event_type = 'reconciliation_confirmed' and error_category = 'authoritative_success')
          or (event_type = 'reconciliation_absent' and error_category = 'authoritative_absence')
        )
    ) into authoritative_result_established;
  end if;
  if support_item.exception_category = 'unknown_outcome' and not authoritative_result_established then
    raise exception 'authoritative_evidence_required';
  end if;

  insert into public.booking_support_actions (
    business_id,
    booking_support_item_id,
    booking_attempt_id,
    correlation_id,
    actor_user_id,
    action,
    resolution
  ) values (
    support_item.business_id,
    support_item.id,
    support_item.booking_attempt_id,
    support_item.correlation_id,
    auth.uid(),
    'resolve',
    trim(candidate_resolution)
  );

  update public.booking_support_items
  set
    status = 'resolved',
    resolved_at = now(),
    resolved_by = auth.uid(),
    resolution_summary = trim(candidate_resolution)
  where id = support_item.id
  returning * into resolved_item;

  return resolved_item;
end;
$$;

revoke all on function public.resolve_booking_support_item(uuid, text) from public, anon;
grant execute on function public.resolve_booking_support_item(uuid, text) to authenticated;

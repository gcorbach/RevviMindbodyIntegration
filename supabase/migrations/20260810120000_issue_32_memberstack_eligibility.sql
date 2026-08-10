create type public.class_memberstack_snapshot_status as enum ('active', 'inactive', 'unknown');
create type public.class_memberstack_event_type as enum (
  'member.created',
  'member.updated',
  'member.deleted',
  'member.plan.added',
  'member.plan.updated',
  'member.plan.canceled',
  'unknown'
);
create type public.class_memberstack_event_status as enum ('received', 'processed', 'ignored', 'failed');
create type public.class_authorization_purpose as enum ('availability', 'provider_write');

alter table public.class_revvi_customers
  alter column auth_user_id drop not null,
  add column email text,
  add column first_name text,
  add column last_name text,
  add column subscription_status public.class_memberstack_snapshot_status not null default 'unknown',
  add column memberstack_plan_ids text[] not null default '{}',
  add column eligibility_override boolean,
  add column memberstack_last_synced_at timestamptz,
  add column memberstack_snapshot_event_id text,
  add check (array_position(memberstack_plan_ids, null) is null),
  add check (not public.class_array_has_empty_text(memberstack_plan_ids));

comment on column public.class_revvi_customers.subscription_status is
  'Non-authoritative Memberstack snapshot for display/revocation. Provider writes always use a fresh Admin API read.';
comment on column public.class_revvi_customers.eligibility_override is
  'Nullable pilot control. False explicitly blocks Offer eligibility; true never bypasses current Memberstack checks.';

create or replace function public.class_memberstack_summary_is_allowlisted(candidate jsonb)
returns boolean
language sql
immutable
strict
as $$
  select jsonb_typeof(candidate) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(candidate) as key(name)
      where key.name not in (
        'memberId', 'planId', 'planConnectionId', 'status', 'active', 'shapeCode'
      )
    );
$$;

create table public.class_memberstack_webhook_events (
  id uuid primary key default gen_random_uuid(),
  svix_id text not null unique check (length(trim(svix_id)) > 0),
  event_type public.class_memberstack_event_type not null,
  external_event_type text not null check (length(trim(external_event_type)) > 0),
  memberstack_member_id text not null check (length(trim(memberstack_member_id)) > 0),
  status public.class_memberstack_event_status not null default 'received',
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{1,128}$'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('processed', 'ignored', 'failed')) = (processed_at is not null)),
  check (event_type = 'unknown' or external_event_type = event_type::text)
);

create table public.class_memberstack_webhook_diagnostics (
  id uuid primary key default gen_random_uuid(),
  webhook_event_id uuid not null unique references public.class_memberstack_webhook_events(id) on delete cascade,
  redacted_summary jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '48 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (public.class_memberstack_summary_is_allowlisted(redacted_summary)),
  check (pg_column_size(redacted_summary) <= 8192),
  check (expires_at > created_at and expires_at <= created_at + interval '48 hours')
);

create table public.class_memberstack_admin_admissions (
  id bigint generated always as identity primary key,
  admitted_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > admitted_at and expires_at <= admitted_at + interval '1 second')
);

comment on table public.class_memberstack_admin_admissions is
  'Global one-second admission window. It contains no Customer or request data and is bounded to 20 live rows.';

create table public.class_offer_authorization_checks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  location_id uuid not null,
  offer_id uuid not null,
  customer_id uuid not null references public.class_revvi_customers(id) on delete restrict,
  purpose public.class_authorization_purpose not null,
  memberstack_member_id text not null check (length(trim(memberstack_member_id)) > 0),
  memberstack_plan_id text not null check (length(trim(memberstack_plan_id)) > 0),
  memberstack_plan_connection_id text not null check (length(trim(memberstack_plan_connection_id)) > 0),
  memberstack_plan_status text not null check (memberstack_plan_status in ('ACTIVE', 'TRIALING')),
  checked_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (business_id, location_id)
    references public.class_business_locations(business_id, id)
    on delete restrict,
  foreign key (business_id, offer_id, location_id)
    references public.class_revvi_offers(business_id, id, location_id)
    on delete restrict,
  check (checked_at <= created_at + interval '1 minute'),
  check (checked_at >= created_at - interval '5 minutes')
);

comment on table public.class_offer_authorization_checks is
  'Minimal redacted evidence of a fresh Memberstack Admin read. Tokens and full member payloads are prohibited.';

create index class_memberstack_events_member_idx
on public.class_memberstack_webhook_events (memberstack_member_id, received_at desc);
create index class_memberstack_diagnostics_expiry_idx
on public.class_memberstack_webhook_diagnostics (expires_at);
create index class_offer_authorization_checks_customer_idx
on public.class_offer_authorization_checks (customer_id, checked_at desc);

create trigger class_memberstack_events_set_updated_at
before update on public.class_memberstack_webhook_events
for each row execute function public.class_set_updated_at();
create trigger class_memberstack_diagnostics_set_updated_at
before update on public.class_memberstack_webhook_diagnostics
for each row execute function public.class_set_updated_at();

create or replace function public.class_authorization_checks_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Class Offer authorization evidence is append-only';
end;
$$;

create trigger class_authorization_checks_append_only
before update or delete on public.class_offer_authorization_checks
for each row execute function public.class_authorization_checks_append_only();

create or replace function public.resolve_class_revvi_customer(
  candidate_memberstack_member_id text
)
returns table (
  customer_id uuid,
  memberstack_member_id text,
  eligibility_override boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if candidate_memberstack_member_id is null
    or length(trim(candidate_memberstack_member_id)) = 0 then
    raise exception 'invalid Memberstack member ID';
  end if;

  insert into public.class_revvi_customers (memberstack_customer_id)
  values (candidate_memberstack_member_id)
  on conflict (memberstack_customer_id) do nothing;

  return query
  select customer.id, customer.memberstack_customer_id, customer.eligibility_override
  from public.class_revvi_customers customer
  where customer.memberstack_customer_id = candidate_memberstack_member_id;
end;
$$;

revoke all on function public.resolve_class_revvi_customer(text)
from public, anon, authenticated;
grant execute on function public.resolve_class_revvi_customer(text)
to service_role;

create or replace function public.claim_class_memberstack_admin_admission()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  admission_time timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('class-memberstack-admin-admission', 0));
  delete from public.class_memberstack_admin_admissions
  where expires_at <= admission_time;

  if (select count(*) from public.class_memberstack_admin_admissions) >= 20 then
    return false;
  end if;

  insert into public.class_memberstack_admin_admissions (admitted_at, expires_at)
  values (admission_time, admission_time + interval '1 second');
  return true;
end;
$$;

revoke all on function public.claim_class_memberstack_admin_admission()
from public, anon, authenticated;
grant execute on function public.claim_class_memberstack_admin_admission()
to service_role;

create or replace function public.receive_class_memberstack_webhook(
  candidate_svix_id text,
  candidate_event_type public.class_memberstack_event_type,
  candidate_external_event_type text,
  candidate_memberstack_member_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  if candidate_svix_id is null or length(trim(candidate_svix_id)) = 0
    or candidate_external_event_type is null or length(trim(candidate_external_event_type)) = 0
    or candidate_memberstack_member_id is null or length(trim(candidate_memberstack_member_id)) = 0 then
    raise exception 'invalid Memberstack webhook receipt';
  end if;

  insert into public.class_memberstack_webhook_events (
    svix_id, event_type, external_event_type, memberstack_member_id
  ) values (
    candidate_svix_id, candidate_event_type, candidate_external_event_type, candidate_memberstack_member_id
  )
  on conflict (svix_id) do nothing
  returning id into event_id;

  return event_id is not null;
end;
$$;

revoke all on function public.receive_class_memberstack_webhook(
  text,
  public.class_memberstack_event_type,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.receive_class_memberstack_webhook(
  text,
  public.class_memberstack_event_type,
  text,
  text
) to service_role;

create or replace function public.process_class_memberstack_webhook(
  candidate_svix_id text,
  candidate_subscription_status public.class_memberstack_snapshot_status,
  candidate_plan_ids text[],
  candidate_redacted_summary jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
  customer_id uuid;
  stored_event_type public.class_memberstack_event_type;
  stored_member_id text;
  stored_status public.class_memberstack_event_status;
  normalized_plan_ids text[];
begin
  if candidate_svix_id is null or length(trim(candidate_svix_id)) = 0
    or candidate_plan_ids is null
    or array_position(candidate_plan_ids, null) is not null
    or public.class_array_has_empty_text(candidate_plan_ids)
    or not public.class_memberstack_summary_is_allowlisted(candidate_redacted_summary) then
    raise exception 'invalid Memberstack webhook facts';
  end if;

  select event.id, event.event_type, event.memberstack_member_id, event.status
  into event_id, stored_event_type, stored_member_id, stored_status
  from public.class_memberstack_webhook_events event
  where event.svix_id = candidate_svix_id
  for update;

  if event_id is null then
    raise exception 'Memberstack webhook receipt not found';
  end if;
  if stored_status not in ('received', 'failed') then
    return false;
  end if;

  normalized_plan_ids := array(
    select distinct plan_id
    from unnest(candidate_plan_ids) as plan(plan_id)
    order by plan_id
  );

  if stored_event_type = 'unknown' then
    update public.class_memberstack_webhook_events
    set status = 'ignored', processed_at = now(), error_code = 'UNKNOWN_EVENT'
    where id = event_id;
  else
    select customer.id into customer_id
    from public.class_revvi_customers customer
    where customer.memberstack_customer_id = stored_member_id
    for update;

    if customer_id is null and stored_event_type = 'member.created' then
      select resolved.customer_id into customer_id
      from public.resolve_class_revvi_customer(stored_member_id) resolved;
    end if;

    if customer_id is null then
      update public.class_memberstack_webhook_events
      set status = 'ignored', processed_at = now(), error_code = 'CUSTOMER_NOT_FOUND'
      where id = event_id;
    else
      update public.class_revvi_customers
      set subscription_status = candidate_subscription_status,
          memberstack_plan_ids = normalized_plan_ids,
          memberstack_last_synced_at = now(),
          memberstack_snapshot_event_id = candidate_svix_id
      where id = customer_id;

      update public.class_memberstack_webhook_events
      set status = 'processed', processed_at = now()
      where id = event_id;
    end if;
  end if;

  insert into public.class_memberstack_webhook_diagnostics (
    webhook_event_id, redacted_summary
  ) values (
    event_id, candidate_redacted_summary
  );

  return true;
end;
$$;

revoke all on function public.process_class_memberstack_webhook(
  text,
  public.class_memberstack_snapshot_status,
  text[],
  jsonb
) from public, anon, authenticated;
grant execute on function public.process_class_memberstack_webhook(
  text,
  public.class_memberstack_snapshot_status,
  text[],
  jsonb
) to service_role;

create or replace function public.purge_expired_class_memberstack_diagnostics()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.class_memberstack_webhook_diagnostics
  where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_class_memberstack_diagnostics() from public, anon, authenticated;
grant execute on function public.purge_expired_class_memberstack_diagnostics() to service_role;

select cron.schedule(
  'class-memberstack-diagnostics-retention',
  '*/15 * * * *',
  'select public.purge_expired_class_memberstack_diagnostics();'
);

alter table public.class_memberstack_webhook_events enable row level security;
alter table public.class_memberstack_webhook_diagnostics enable row level security;
alter table public.class_memberstack_admin_admissions enable row level security;
alter table public.class_offer_authorization_checks enable row level security;

create policy class_memberstack_events_operations_select
on public.class_memberstack_webhook_events for select to authenticated
using (public.has_class_platform_operations_access());
create policy class_memberstack_diagnostics_operations_select
on public.class_memberstack_webhook_diagnostics for select to authenticated
using (public.has_class_platform_operations_access());
create policy class_authorization_checks_operations_select
on public.class_offer_authorization_checks for select to authenticated
using (public.has_class_operations_access(business_id));

grant select on public.class_memberstack_webhook_events to authenticated, service_role;
grant select on public.class_memberstack_webhook_diagnostics to authenticated, service_role;
grant select on public.class_offer_authorization_checks to authenticated, service_role;
grant insert on public.class_offer_authorization_checks to service_role;

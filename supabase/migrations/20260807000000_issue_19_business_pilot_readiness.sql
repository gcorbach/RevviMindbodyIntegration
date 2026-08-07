create table public.business_pilot_readiness (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  environment public.provider_environment not null default 'sandbox',
  status text not null default 'draft' check (status in ('draft', 'ready', 'active', 'disabled')),
  checkout_mode text check (checkout_mode in ('supported_checkout', 'approved_non_paid')),
  transactional_message_behavior text,
  accepted_limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(accepted_limitations) = 'array'),
  site_activation_fingerprint text,
  responsible_staff_actor uuid references auth.users(id),
  activated_at timestamptz,
  deactivated_at timestamptz,
  deactivation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'active' and activated_at is not null and responsible_staff_actor is not null)
    or status <> 'active'
  )
);

create table public.business_pilot_readiness_checks (
  business_id uuid not null references public.business_pilot_readiness(business_id) on delete cascade,
  check_name text not null check (check_name in (
    'site_activation',
    'sandbox_connectivity',
    'approved_locations',
    'approved_services',
    'live_availability',
    'client_mapping',
    'branding',
    'support_contact',
    'checkout_or_non_paid',
    'transactional_messages',
    'tenant_isolation',
    'booking_lifecycle',
    'controlled_booking'
  )),
  passed boolean not null,
  verified_at timestamptz not null,
  evidence_ref text not null check (length(trim(evidence_ref)) > 0),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  verified_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (business_id, check_name)
);

create table public.business_pilot_readiness_actions (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null check (action in ('check_recorded', 'activated', 'deactivated', 'site_activation_changed', 'provider_environment_changed')),
  check_name text,
  from_status text,
  to_status text not null,
  reason text,
  evidence_ref text,
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now()
);

create index business_pilot_readiness_actions_business_idx
  on public.business_pilot_readiness_actions (business_id, created_at);

create trigger business_pilot_readiness_set_updated_at
before update on public.business_pilot_readiness
for each row execute function public.set_updated_at();

create trigger business_pilot_readiness_checks_set_updated_at
before update on public.business_pilot_readiness_checks
for each row execute function public.set_updated_at();

create or replace function public.create_business_pilot_readiness()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.business_pilot_readiness (business_id, environment)
  values (new.id, new.provider_environment)
  on conflict (business_id) do nothing;
  return new;
end;
$$;

create trigger businesses_create_pilot_readiness
after insert on public.businesses
for each row execute function public.create_business_pilot_readiness();

insert into public.business_pilot_readiness (business_id, environment)
select id, provider_environment
from public.businesses
on conflict (business_id) do nothing;

create or replace function public.prevent_business_pilot_readiness_action_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'business pilot readiness actions are append-only';
end;
$$;

create trigger business_pilot_readiness_actions_append_only
before update or delete on public.business_pilot_readiness_actions
for each row execute function public.prevent_business_pilot_readiness_action_mutation();

alter table public.business_pilot_readiness enable row level security;
alter table public.business_pilot_readiness_checks enable row level security;
alter table public.business_pilot_readiness_actions enable row level security;

create policy business_pilot_readiness_platform_select
on public.business_pilot_readiness for select to authenticated
using (public.has_platform_operations_access());

create policy business_pilot_readiness_checks_platform_select
on public.business_pilot_readiness_checks for select to authenticated
using (public.has_platform_operations_access());

create policy business_pilot_readiness_actions_platform_select
on public.business_pilot_readiness_actions for select to authenticated
using (public.has_platform_operations_access());

grant select on public.business_pilot_readiness to authenticated, service_role;
grant select on public.business_pilot_readiness_checks to authenticated, service_role;
grant select on public.business_pilot_readiness_actions to authenticated, service_role;
grant all on public.business_pilot_readiness to service_role;
grant all on public.business_pilot_readiness_checks to service_role;
grant all on public.business_pilot_readiness_actions to service_role;
grant usage, select on sequence public.business_pilot_readiness_actions_id_seq to service_role;

create or replace function public.activate_business_pilot(candidate_business_id uuid)
returns public.business_pilot_readiness
language plpgsql
security definer
set search_path = public
as $$
declare
  readiness public.business_pilot_readiness;
  business public.businesses;
  missing_checks text[];
  current_site_fingerprint text;
  previous_status text;
  required_checks constant text[] := array[
    'site_activation', 'sandbox_connectivity', 'approved_locations', 'approved_services',
    'live_availability', 'client_mapping', 'branding', 'support_contact',
    'checkout_or_non_paid', 'transactional_messages', 'tenant_isolation',
    'booking_lifecycle', 'controlled_booking'
  ];
begin
  if auth.uid() is null or not public.has_platform_operations_access() then
    raise insufficient_privilege using message = 'platform operations access is required';
  end if;

  select * into business from public.businesses where id = candidate_business_id for update;
  select * into readiness from public.business_pilot_readiness where business_id = candidate_business_id for update;
  if business.id is null or readiness.business_id is null then
    raise no_data_found using message = 'business readiness was not found';
  end if;
  previous_status := readiness.status;

  select array_agg(required_check order by required_check)
  into missing_checks
  from unnest(required_checks) required_check
  where not exists (
    select 1
    from public.business_pilot_readiness_checks readiness_check
    where readiness_check.business_id = candidate_business_id
      and readiness_check.check_name = required_check
      and readiness_check.passed
      and (readiness.deactivated_at is null or readiness_check.verified_at > readiness.deactivated_at)
  );
  if coalesce(array_length(missing_checks, 1), 0) > 0 then
    raise exception 'readiness_gates_incomplete:%', array_to_string(missing_checks, ',');
  end if;
  if business.provider_environment <> 'sandbox' or readiness.environment <> 'sandbox' then
    raise exception 'sandbox_pilot_environment_required';
  end if;
  select encode(extensions.digest(mindbody_site_id, 'sha256'), 'hex')
  into current_site_fingerprint
  from public.business_provider_config
  where business_id = candidate_business_id;
  if current_site_fingerprint is null or readiness.site_activation_fingerprint is distinct from current_site_fingerprint then
    raise exception 'site_activation_reverification_required';
  end if;
  if readiness.transactional_message_behavior is null then raise exception 'transactional_message_behavior_required'; end if;
  if (business.completion_mode = 'free_unpaid' and readiness.checkout_mode <> 'approved_non_paid')
    or (business.completion_mode = 'mindbody_checkout' and readiness.checkout_mode <> 'supported_checkout')
    or business.completion_mode = 'disabled'
  then
    raise exception 'checkout_readiness_mismatch';
  end if;
  if business.support_email is null or length(trim(business.support_email)) = 0 then raise exception 'support_contact_required'; end if;
  if not exists (select 1 from public.business_locations where business_id = candidate_business_id and enabled) then raise exception 'approved_location_required'; end if;
  if not exists (select 1 from public.business_services where business_id = candidate_business_id and enabled) then raise exception 'approved_service_required'; end if;
  if exists (select 1 from public.booking_attempts where business_id = candidate_business_id and state = 'unknown')
    or exists (select 1 from public.booking_support_items where business_id = candidate_business_id and status = 'open' and exception_category = 'unknown_outcome')
  then
    raise exception 'unresolved_booking_outcomes';
  end if;

  update public.businesses
  set status = 'active', booking_enabled = true
  where id = candidate_business_id;

  update public.business_pilot_readiness
  set
    status = 'active',
    responsible_staff_actor = auth.uid(),
    activated_at = now(),
    deactivation_reason = null
  where business_id = candidate_business_id
  returning * into readiness;

  insert into public.business_pilot_readiness_actions (
    business_id, actor_user_id, action, from_status, to_status, snapshot
  ) values (
    candidate_business_id, auth.uid(), 'activated', previous_status, 'active',
    jsonb_build_object('environment', readiness.environment, 'activated_at', readiness.activated_at)
  );
  return readiness;
end;
$$;

revoke all on function public.activate_business_pilot(uuid) from public, anon;
grant execute on function public.activate_business_pilot(uuid) to authenticated;

create or replace function public.record_business_pilot_readiness_check(
  candidate_business_id uuid,
  candidate_check_name text,
  candidate_passed boolean,
  candidate_verified_at timestamptz,
  candidate_evidence_ref text,
  candidate_details jsonb,
  candidate_checkout_mode text,
  candidate_transactional_message_behavior text,
  candidate_accepted_limitations jsonb
)
returns public.business_pilot_readiness
language plpgsql
security definer
set search_path = public
as $$
declare
  readiness public.business_pilot_readiness;
  previous_status text;
  provider_site_id text;
  business_completion_mode public.booking_completion_mode;
  next_status text;
  passed_check_count integer;
begin
  if auth.uid() is null or not public.has_platform_operations_access() then
    raise insufficient_privilege using message = 'platform operations access is required';
  end if;
  if candidate_check_name is null or candidate_check_name not in (
    'site_activation', 'sandbox_connectivity', 'approved_locations', 'approved_services',
    'live_availability', 'client_mapping', 'branding', 'support_contact',
    'checkout_or_non_paid', 'transactional_messages', 'tenant_isolation',
    'booking_lifecycle', 'controlled_booking'
  ) then
    raise exception 'invalid_readiness_check';
  end if;
  if candidate_passed is null or candidate_verified_at is null or candidate_verified_at > now() + interval '5 minutes' then
    raise exception 'invalid_readiness_verification';
  end if;
  if candidate_evidence_ref is null or length(trim(candidate_evidence_ref)) not between 3 and 500 then
    raise exception 'invalid_readiness_evidence';
  end if;
  if candidate_details is null or jsonb_typeof(candidate_details) <> 'object' then
    raise exception 'invalid_readiness_details';
  end if;
  if candidate_accepted_limitations is not null and jsonb_typeof(candidate_accepted_limitations) <> 'array' then
    raise exception 'invalid_accepted_limitations';
  end if;

  select * into readiness
  from public.business_pilot_readiness
  where business_id = candidate_business_id
  for update;
  if readiness.business_id is null then
    raise no_data_found using message = 'business readiness was not found';
  end if;
  previous_status := readiness.status;

  select completion_mode into business_completion_mode
  from public.businesses
  where id = candidate_business_id;

  if candidate_check_name = 'checkout_or_non_paid' and candidate_passed and not coalesce((
    (business_completion_mode = 'free_unpaid' and candidate_checkout_mode = 'approved_non_paid')
    or (business_completion_mode = 'mindbody_checkout' and candidate_checkout_mode = 'supported_checkout')
  ), false) then
    raise exception 'checkout_readiness_mismatch';
  end if;
  if candidate_check_name = 'transactional_messages' and candidate_passed
    and (candidate_transactional_message_behavior is null or length(trim(candidate_transactional_message_behavior)) = 0)
  then
    raise exception 'transactional_message_behavior_required';
  end if;

  if candidate_check_name = 'site_activation' then
    select mindbody_site_id into provider_site_id
    from public.business_provider_config
    where business_id = candidate_business_id;
    if provider_site_id is null then raise exception 'site_activation_configuration_missing'; end if;
  end if;

  if candidate_check_name = 'controlled_booking' and candidate_passed then
    if not exists (
      select 1 from public.booking_attempts controlled_attempt
      where controlled_attempt.id = nullif(candidate_details ->> 'bookingAttemptId', '')::uuid
        and controlled_attempt.business_id = candidate_business_id
        and controlled_attempt.state = 'confirmed'
        and controlled_attempt.mindbody_appointment_id is not null
        and 4 = (
          select count(distinct controlled_event.event_type)
          from public.booking_attempt_events controlled_event
          where controlled_event.business_id = candidate_business_id
            and controlled_event.booking_attempt_id = controlled_attempt.id
            and controlled_event.event_type in (
              'attempt_created', 'provider_revalidation_succeeded',
              'provider_write_started', 'attempt_confirmed'
            )
        )
    ) then
      raise exception 'controlled_booking_evidence_invalid';
    end if;
  end if;

  insert into public.business_pilot_readiness_checks (
    business_id, check_name, passed, verified_at, evidence_ref, details, verified_by
  ) values (
    candidate_business_id, candidate_check_name, candidate_passed, candidate_verified_at,
    trim(candidate_evidence_ref), candidate_details, auth.uid()
  )
  on conflict (business_id, check_name) do update set
    passed = excluded.passed,
    verified_at = excluded.verified_at,
    evidence_ref = excluded.evidence_ref,
    details = excluded.details,
    verified_by = excluded.verified_by;

  select count(*) into passed_check_count
  from public.business_pilot_readiness_checks
  where business_id = candidate_business_id
    and passed
    and (readiness.deactivated_at is null or verified_at > readiness.deactivated_at);

  next_status := case
    when not candidate_passed and readiness.status = 'active' then 'disabled'
    when readiness.status = 'active' then 'active'
    when passed_check_count = 13 then 'ready'
    when readiness.status = 'disabled' then 'disabled'
    else 'draft'
  end;

  update public.business_pilot_readiness
  set
    status = next_status,
    checkout_mode = case when candidate_check_name = 'checkout_or_non_paid' then candidate_checkout_mode else checkout_mode end,
    transactional_message_behavior = case when candidate_check_name = 'transactional_messages' then nullif(trim(candidate_transactional_message_behavior), '') else transactional_message_behavior end,
    accepted_limitations = case
      when candidate_accepted_limitations is null then accepted_limitations
      else accepted_limitations || candidate_accepted_limitations
    end,
    site_activation_fingerprint = case
      when candidate_check_name = 'site_activation' and candidate_passed then encode(extensions.digest(provider_site_id, 'sha256'), 'hex')
      when candidate_check_name = 'site_activation' then null
      else site_activation_fingerprint
    end,
    responsible_staff_actor = auth.uid(),
    deactivated_at = case when next_status = 'disabled' and previous_status = 'active' then now() else deactivated_at end,
    deactivation_reason = case when next_status = 'disabled' and previous_status = 'active' then 'readiness_check_failed:' || candidate_check_name else deactivation_reason end
  where business_id = candidate_business_id
  returning * into readiness;

  if next_status = 'disabled' and previous_status = 'active' then
    update public.businesses set booking_enabled = false where id = candidate_business_id;
  end if;

  insert into public.business_pilot_readiness_actions (
    business_id, actor_user_id, action, check_name, from_status, to_status,
    reason, evidence_ref, snapshot
  ) values (
    candidate_business_id, auth.uid(), 'check_recorded', candidate_check_name,
    previous_status, next_status,
    case when candidate_passed then null else 'check_failed' end,
    trim(candidate_evidence_ref),
    jsonb_build_object(
      'passed', candidate_passed,
      'verified_at', candidate_verified_at,
      'details', candidate_details,
      'checkout_mode', candidate_checkout_mode,
      'transactional_message_behavior', candidate_transactional_message_behavior,
      'accepted_limitations', candidate_accepted_limitations
    )
  );
  return readiness;
exception
  when invalid_text_representation then
    raise exception 'controlled_booking_evidence_invalid';
end;
$$;

revoke all on function public.record_business_pilot_readiness_check(uuid, text, boolean, timestamptz, text, jsonb, text, text, jsonb) from public, anon;
grant execute on function public.record_business_pilot_readiness_check(uuid, text, boolean, timestamptz, text, jsonb, text, text, jsonb) to authenticated;

create or replace function public.deactivate_business_pilot(
  candidate_business_id uuid,
  candidate_reason text
)
returns public.business_pilot_readiness
language plpgsql
security definer
set search_path = public
as $$
declare
  readiness public.business_pilot_readiness;
  previous_status text;
begin
  if auth.uid() is null or not public.has_platform_operations_access() then
    raise insufficient_privilege using message = 'platform operations access is required';
  end if;
  if candidate_reason is null or length(trim(candidate_reason)) not between 10 and 500 then
    raise exception 'deactivation_reason_required';
  end if;
  select * into readiness
  from public.business_pilot_readiness
  where business_id = candidate_business_id
  for update;
  if readiness.business_id is null then raise no_data_found using message = 'business readiness was not found'; end if;
  previous_status := readiness.status;

  update public.businesses set booking_enabled = false where id = candidate_business_id;
  update public.business_pilot_readiness
  set
    status = 'disabled',
    responsible_staff_actor = auth.uid(),
    deactivated_at = now(),
    deactivation_reason = trim(candidate_reason)
  where business_id = candidate_business_id
  returning * into readiness;

  insert into public.business_pilot_readiness_actions (
    business_id, actor_user_id, action, from_status, to_status, reason, snapshot
  ) values (
    candidate_business_id, auth.uid(), 'deactivated', previous_status, 'disabled',
    trim(candidate_reason), jsonb_build_object('deactivated_at', readiness.deactivated_at)
  );
  return readiness;
end;
$$;

revoke all on function public.deactivate_business_pilot(uuid, text) from public, anon;
grant execute on function public.deactivate_business_pilot(uuid, text) to authenticated;

create or replace function public.disable_pilot_on_site_activation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_status text;
  changed_at timestamptz := now();
begin
  if old.mindbody_site_id is not distinct from new.mindbody_site_id then return new; end if;
  select status into previous_status
  from public.business_pilot_readiness
  where business_id = new.business_id
  for update;
  if previous_status is null then return new; end if;

  update public.businesses set booking_enabled = false where id = new.business_id;
  update public.business_pilot_readiness
  set
    status = 'disabled',
    site_activation_fingerprint = null,
    deactivated_at = changed_at,
    deactivation_reason = 'site_activation_changed'
  where business_id = new.business_id;
  insert into public.business_pilot_readiness_actions (
    business_id, actor_user_id, action, from_status, to_status, reason, snapshot
  ) values (
    new.business_id, null, 'site_activation_changed', previous_status, 'disabled',
    'site_activation_changed', jsonb_build_object('deactivated_at', changed_at)
  );
  return new;
end;
$$;

create trigger business_provider_config_disable_changed_pilot
after update of mindbody_site_id on public.business_provider_config
for each row execute function public.disable_pilot_on_site_activation_change();

create or replace function public.disable_pilot_on_provider_environment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_status text;
  changed_at timestamptz := now();
begin
  if old.provider_environment is not distinct from new.provider_environment then return new; end if;
  select status into previous_status
  from public.business_pilot_readiness
  where business_id = new.id
  for update;
  if previous_status is null then return new; end if;

  new.booking_enabled := false;
  update public.business_pilot_readiness
  set
    status = 'disabled',
    deactivated_at = changed_at,
    deactivation_reason = 'provider_environment_changed'
  where business_id = new.id;
  insert into public.business_pilot_readiness_actions (
    business_id, actor_user_id, action, from_status, to_status, reason, snapshot
  ) values (
    new.id, null, 'provider_environment_changed', previous_status, 'disabled',
    'provider_environment_changed', jsonb_build_object('deactivated_at', changed_at, 'new_environment', new.provider_environment)
  );
  return new;
end;
$$;

create trigger businesses_disable_changed_provider_environment
before update of provider_environment on public.businesses
for each row execute function public.disable_pilot_on_provider_environment_change();

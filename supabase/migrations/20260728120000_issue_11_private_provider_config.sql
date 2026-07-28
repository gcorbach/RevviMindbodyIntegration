-- Provider identifiers are server-side configuration. Keep them out of the
-- RLS-protected customer tables, which are reachable by authenticated clients.
create table public.business_provider_config (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  mindbody_site_id text not null check (length(trim(mindbody_site_id)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_location_provider_config (
  business_id uuid not null,
  location_id uuid not null,
  mindbody_location_id text not null check (length(trim(mindbody_location_id)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, location_id),
  foreign key (business_id, location_id)
    references public.business_locations (business_id, id)
    on delete cascade
);

alter table public.business_services
  add constraint business_services_business_id_id_key unique (business_id, id);

create table public.business_service_provider_config (
  business_id uuid not null,
  service_id uuid not null,
  mindbody_session_type_id text not null check (length(trim(mindbody_session_type_id)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, service_id),
  foreign key (business_id, service_id)
    references public.business_services (business_id, id)
    on delete cascade
);

insert into public.business_provider_config (business_id, mindbody_site_id)
select id, mindbody_site_id from public.businesses;

insert into public.business_location_provider_config (business_id, location_id, mindbody_location_id)
select business_id, id, mindbody_location_id from public.business_locations;

insert into public.business_service_provider_config (business_id, service_id, mindbody_session_type_id)
select business_id, id, mindbody_session_type_id from public.business_services;

drop view if exists public.admin_business_catalogue;

alter table public.businesses drop column mindbody_site_id;
alter table public.business_locations drop constraint business_locations_business_id_mindbody_location_id_key;
alter table public.business_locations drop column mindbody_location_id;
alter table public.business_services drop constraint business_services_location_id_mindbody_session_type_id_key;
alter table public.business_services drop column mindbody_session_type_id;

create or replace function public.set_provider_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger business_provider_config_set_updated_at
before update on public.business_provider_config
for each row execute function public.set_provider_updated_at();

create trigger business_location_provider_config_set_updated_at
before update on public.business_location_provider_config
for each row execute function public.set_provider_updated_at();

create trigger business_service_provider_config_set_updated_at
before update on public.business_service_provider_config
for each row execute function public.set_provider_updated_at();

create trigger business_provider_config_immutable_owner
before update on public.business_provider_config
for each row execute function public.prevent_business_reassignment();

create trigger business_location_provider_config_immutable_owner
before update on public.business_location_provider_config
for each row execute function public.prevent_business_reassignment();

create trigger business_service_provider_config_immutable_owner
before update on public.business_service_provider_config
for each row execute function public.prevent_business_reassignment();

alter table public.business_provider_config enable row level security;
alter table public.business_location_provider_config enable row level security;
alter table public.business_service_provider_config enable row level security;

-- No browser role can read provider identifiers. Edge Functions use the
-- service-role key only after validating the caller's Revvi identity.
revoke all on public.business_provider_config from anon, authenticated;
revoke all on public.business_location_provider_config from anon, authenticated;
revoke all on public.business_service_provider_config from anon, authenticated;
grant select on public.business_provider_config to service_role;
grant select on public.business_location_provider_config to service_role;
grant select on public.business_service_provider_config to service_role;
grant select on public.businesses to service_role;
grant select on public.business_locations to service_role;
grant select on public.business_services to service_role;
grant select on public.business_customer_access to service_role;

create table public.memberstack_identity_allowlist (
  memberstack_id text primary key check (length(trim(memberstack_id)) > 0),
  source text not null check (source in ('sandbox_allowlist', 'signed_webhook')),
  verified_at timestamptz not null default now()
);

alter table public.memberstack_identity_allowlist enable row level security;
revoke all on public.memberstack_identity_allowlist from anon, authenticated;
grant select on public.memberstack_identity_allowlist to service_role;

create or replace function public.jwt_memberstack_id()
returns text
language sql
stable
as $$
  select case
    when auth.jwt() -> 'app_metadata' ->> 'identity_provider' = 'memberstack'
      and auth.jwt() -> 'app_metadata' ->> 'memberstack_verified' = 'true'
    then nullif(auth.jwt() -> 'app_metadata' ->> 'memberstack_id', '')
    else null
  end;
$$;

create or replace view public.admin_business_catalogue
with (security_invoker = true)
as
select
  b.id as business_id,
  b.slug as business_slug,
  b.display_name,
  b.status,
  b.booking_enabled,
  b.provider_environment,
  l.id as location_id,
  l.slug as location_slug,
  l.display_name as location_name,
  s.id as service_id,
  s.display_name_override,
  s.enabled as service_enabled
from public.businesses b
join public.business_locations l on l.business_id = b.id
join public.business_services s on s.location_id = l.id and s.business_id = b.id;

comment on view public.admin_business_catalogue is
  'Supabase-dashboard-oriented configuration view without provider identifiers.';

create extension if not exists pgcrypto;

create type public.business_status as enum ('pending', 'active', 'disabled');
create type public.provider_environment as enum ('sandbox', 'production');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  logo_url text,
  brand_primary text not null default '#126a47',
  brand_accent text not null default '#dff4e9',
  support_email text,
  location_browser_path text not null default '/locations',
  status public.business_status not null default 'pending',
  booking_enabled boolean not null default false,
  provider_environment public.provider_environment not null default 'sandbox',
  mindbody_site_id text not null check (length(trim(mindbody_site_id)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.businesses is
  'Revvi tenant configuration. The Mindbody Site ID is never supplied by browser code.';
comment on column public.businesses.mindbody_site_id is
  'Server-side Site ID authorised for this Business. The development seed marker is resolved from MINDBODY_SANDBOX_SITE_ID only in local sandbox execution.';

create table public.business_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  timezone text not null default 'UTC',
  mindbody_location_id text not null check (length(trim(mindbody_location_id)) > 0),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, slug),
  unique (business_id, mindbody_location_id)
);

create table public.business_services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  mindbody_session_type_id text not null check (length(trim(mindbody_session_type_id)) > 0),
  display_name_override text,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, mindbody_session_type_id),
  foreign key (business_id, location_id)
    references public.business_locations (business_id, id)
    on delete cascade
);

create table public.business_customer_access (
  business_id uuid not null references public.businesses(id) on delete cascade,
  memberstack_id text not null check (length(trim(memberstack_id)) > 0),
  created_at timestamptz not null default now(),
  primary key (business_id, memberstack_id)
);

create table public.business_staff_access (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index business_locations_business_idx on public.business_locations (business_id);
create index business_services_location_idx on public.business_services (location_id);
create index business_customer_access_member_idx on public.business_customer_access (memberstack_id);
create index business_staff_access_user_idx on public.business_staff_access (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger businesses_set_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

create trigger business_locations_set_updated_at
before update on public.business_locations
for each row execute function public.set_updated_at();

create trigger business_services_set_updated_at
before update on public.business_services
for each row execute function public.set_updated_at();

create or replace function public.prevent_business_reassignment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.business_id is distinct from new.business_id then
    raise exception 'business ownership is immutable';
  end if;
  return new;
end;
$$;

create trigger business_locations_immutable_owner
before update on public.business_locations
for each row execute function public.prevent_business_reassignment();

create trigger business_services_immutable_owner
before update on public.business_services
for each row execute function public.prevent_business_reassignment();

create trigger business_customer_access_immutable_owner
before update on public.business_customer_access
for each row execute function public.prevent_business_reassignment();

create trigger business_staff_access_immutable_owner
before update on public.business_staff_access
for each row execute function public.prevent_business_reassignment();

create or replace function public.jwt_memberstack_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'memberstack_id', '');
$$;

create or replace function public.has_business_customer_access(candidate_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_customer_access access
    where access.business_id = candidate_business_id
      and access.memberstack_id = public.jwt_memberstack_id()
  );
$$;

create or replace function public.has_business_staff_access(candidate_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_staff_access access
    where access.business_id = candidate_business_id
      and access.user_id = auth.uid()
  );
$$;

alter table public.businesses enable row level security;
alter table public.business_locations enable row level security;
alter table public.business_services enable row level security;
alter table public.business_customer_access enable row level security;
alter table public.business_staff_access enable row level security;

create policy businesses_select_in_scope
on public.businesses for select to authenticated
using (
  public.has_business_customer_access(id)
  or public.has_business_staff_access(id)
);

create policy business_locations_select_in_scope
on public.business_locations for select to authenticated
using (
  public.has_business_customer_access(business_id)
  or public.has_business_staff_access(business_id)
);

create policy business_services_select_in_scope
on public.business_services for select to authenticated
using (
  public.has_business_customer_access(business_id)
  or public.has_business_staff_access(business_id)
);

create policy business_customer_access_select_own
on public.business_customer_access for select to authenticated
using (memberstack_id = public.jwt_memberstack_id());

create policy business_staff_access_select_own
on public.business_staff_access for select to authenticated
using (user_id = auth.uid());

grant select on public.businesses to authenticated;
grant select on public.business_locations to authenticated;
grant select on public.business_services to authenticated;
grant select on public.business_customer_access to authenticated;
grant select on public.business_staff_access to authenticated;

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
  b.mindbody_site_id,
  l.id as location_id,
  l.slug as location_slug,
  l.display_name as location_name,
  l.mindbody_location_id,
  s.id as service_id,
  s.mindbody_session_type_id,
  s.display_name_override,
  s.enabled as service_enabled
from public.businesses b
join public.business_locations l on l.business_id = b.id
join public.business_services s on s.location_id = l.id and s.business_id = b.id;

comment on view public.admin_business_catalogue is
  'Supabase-dashboard-oriented configuration view; it is not a customer API response.';

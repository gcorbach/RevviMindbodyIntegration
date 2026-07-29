create table public.mindbody_client_resolution_locks (
  business_id uuid not null references public.businesses(id) on delete cascade,
  memberstack_id text not null check (length(trim(memberstack_id)) > 0),
  owner_id uuid not null,
  acquired_at timestamptz not null default now(),
  primary key (business_id, memberstack_id)
);

create index mindbody_client_resolution_locks_age_idx
  on public.mindbody_client_resolution_locks (acquired_at);

alter table public.mindbody_client_resolution_locks enable row level security;
revoke all on public.mindbody_client_resolution_locks from anon, authenticated;
grant all on public.mindbody_client_resolution_locks to service_role;

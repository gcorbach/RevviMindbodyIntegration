create table public.class_site_99_staff_operation_leases (
  site_id text primary key check (site_id = '-99'),
  holder_token_hash text not null check (holder_token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.class_site_99_staff_operation_leases enable row level security;
revoke all on public.class_site_99_staff_operation_leases from public, anon, authenticated;
grant select, insert, update, delete on public.class_site_99_staff_operation_leases to service_role;

create or replace function public.claim_site_99_staff_operation_lease(
  candidate_holder_token uuid,
  candidate_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  acquired boolean := false;
  token_hash text := encode(digest(candidate_holder_token::text, 'sha256'), 'hex');
  observed_at timestamptz := clock_timestamp();
begin
  if candidate_ttl_seconds < 30 or candidate_ttl_seconds > 300 then
    raise exception 'invalid Site -99 staff lease TTL';
  end if;

  insert into public.class_site_99_staff_operation_leases (
    site_id, holder_token_hash, expires_at, updated_at
  ) values (
    '-99', token_hash, observed_at + make_interval(secs => candidate_ttl_seconds), observed_at
  )
  on conflict (site_id) do update
  set holder_token_hash = excluded.holder_token_hash,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  where class_site_99_staff_operation_leases.expires_at <= observed_at
     or class_site_99_staff_operation_leases.holder_token_hash = token_hash
  returning true into acquired;

  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_site_99_staff_operation_lease(candidate_holder_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  released boolean := false;
begin
  delete from public.class_site_99_staff_operation_leases
  where site_id = '-99'
    and holder_token_hash = encode(digest(candidate_holder_token::text, 'sha256'), 'hex')
  returning true into released;
  return coalesce(released, false);
end;
$$;

revoke all on function public.claim_site_99_staff_operation_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_site_99_staff_operation_lease(uuid) from public, anon, authenticated;
grant execute on function public.claim_site_99_staff_operation_lease(uuid, integer) to service_role;
grant execute on function public.release_site_99_staff_operation_lease(uuid) to service_role;

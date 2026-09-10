-- Preserve the original verified identity without storing names or email addresses.
alter table public.class_customer_provider_profiles
  add column identity_evidence_digest text
    check (identity_evidence_digest is null or identity_evidence_digest ~ '^[a-f0-9]{64}$');

create or replace function public.persist_class_customer_provider_profile_with_identity(
  candidate_business_id uuid, candidate_customer_id uuid, candidate_integration_id uuid,
  candidate_provider_site_id text, candidate_provider_client_id text,
  candidate_provider_client_unique_id text, candidate_identity_digest text
) returns table (profile_id uuid, provider_client_id text, provider_client_unique_id text)
language plpgsql security definer set search_path = public
as $$
declare saved record;
begin
  if candidate_identity_digest is null or candidate_identity_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'verified Client identity digest required';
  end if;
  select * into strict saved from public.persist_class_customer_provider_profile(
    candidate_business_id, candidate_customer_id, candidate_integration_id,
    candidate_provider_site_id, candidate_provider_client_id, candidate_provider_client_unique_id);
  update public.class_customer_provider_profiles
    set identity_evidence_digest = candidate_identity_digest
    where id = saved.profile_id and identity_evidence_digest is null;
  return query select saved.profile_id, saved.provider_client_id, saved.provider_client_unique_id;
end;
$$;
revoke all on function public.persist_class_customer_provider_profile_with_identity(uuid,uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.persist_class_customer_provider_profile_with_identity(uuid,uuid,uuid,text,text,text,text)
  to service_role;

create or replace function public.recover_site_99_client_profile(
  candidate_profile_id uuid, candidate_business_id uuid, candidate_customer_id uuid,
  candidate_integration_id uuid, candidate_provider_client_id text,
  candidate_provider_client_unique_id text, candidate_reason text,
  candidate_identity_digest text, candidate_evidence_digest text
) returns void
language plpgsql security definer set search_path = public
as $$
declare stored public.class_customer_provider_profiles%rowtype;
begin
  if candidate_reason is null or candidate_reason not in ('missing','reused')
    or candidate_identity_digest is null or candidate_identity_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'complete sandbox reset evidence required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    candidate_customer_id::text || ':' || candidate_integration_id::text, 0));
  select * into strict stored from public.class_customer_provider_profiles
    where id = candidate_profile_id for update;
  if stored.business_id is distinct from candidate_business_id
    or stored.customer_id is distinct from candidate_customer_id
    or stored.integration_id is distinct from candidate_integration_id
    or (candidate_reason = 'reused'
      and stored.identity_evidence_digest is distinct from candidate_identity_digest) then
    raise exception 'sandbox reset must match the exact owner and original verified identity';
  end if;
  -- Retains the enabled sandbox Site/Location/payment-route and exact-ID guards,
  -- historical profiles and Bookings. Already-retired/concurrent calls fail closed.
  perform public.retire_missing_site_99_client_profile(stored.id,
    candidate_provider_client_id, candidate_provider_client_unique_id, candidate_evidence_digest);
end;
$$;
revoke all on function public.recover_site_99_client_profile(uuid,uuid,uuid,uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.recover_site_99_client_profile(uuid,uuid,uuid,uuid,text,text,text,text,text)
  to service_role;
comment on function public.recover_site_99_client_profile(uuid,uuid,uuid,uuid,text,text,text,text,text) is
  'Server-only quote-time recovery after complete exact-ID lookup and no identity candidates. Reused IDs additionally require the unchanged original identity digest. Never cancels or retries a Booking.';

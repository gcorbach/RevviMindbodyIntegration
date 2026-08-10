-- Issue #37: make existing-entitlement activation depend on explicit controlled evidence.

create type public.class_existing_entitlement_evidence_kind as enum (
  'explicit_client_service_selection',
  'pass_deduction',
  'booking_reconciliation'
);

create type public.class_mode_evidence_status as enum ('verified', 'revoked');

alter table public.class_offer_provider_mappings
add column inventory_revision bigint not null default 0 check (inventory_revision >= 0);

create table public.class_existing_entitlement_evidence (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  mapping_id uuid not null,
  mapping_version bigint not null check (mapping_version > 0),
  evidence_kind public.class_existing_entitlement_evidence_kind not null,
  evidence_environment public.class_provider_environment not null
    default 'sandbox',
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  status public.class_mode_evidence_status not null default 'verified',
  verified_at timestamptz not null,
  verified_by uuid references auth.users(id) on delete restrict,
  source_evidence_id uuid references public.class_existing_entitlement_evidence(id) on delete restrict,
  production_equivalence_digest text check (
    production_equivalence_digest is null or production_equivalence_digest ~ '^[0-9a-f]{64}$'
  ),
  revoked_at timestamptz,
  revocation_reason text check (
    revocation_reason is null or revocation_reason ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  created_at timestamptz not null default now(),
  foreign key (business_id, mapping_id)
    references public.class_offer_provider_mappings(business_id, id) on delete restrict,
  check (
    (status = 'verified' and revoked_at is null and revocation_reason is null)
    or (status = 'revoked' and revoked_at is not null and revocation_reason is not null)
  ),
  check (
    (source_evidence_id is null and production_equivalence_digest is null)
    or (source_evidence_id is not null and production_equivalence_digest is not null)
  ),
  check (source_evidence_id is null or source_evidence_id <> id)
);

comment on table public.class_existing_entitlement_evidence is
  'Digest-only controlled mode proof and reviewed sandbox-to-production promotion for explicit ClientService selection, pass deduction, and reconciliation. Raw provider evidence is prohibited.';

create unique index class_existing_entitlement_one_active_evidence_kind
on public.class_existing_entitlement_evidence (mapping_id, mapping_version, evidence_kind)
where status = 'verified';

create index class_existing_entitlement_evidence_scope_idx
on public.class_existing_entitlement_evidence (business_id, mapping_id, mapping_version, status);

-- Only material binding changes create a new mapping version. Recording or clearing
-- evidence must not silently move the evidence to a version it did not verify.
create or replace function public.class_bump_mapping_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.offer_id, old.integration_id, old.location_id, old.fulfilment_mode,
      old.provider_service_product_id, old.inventory_revision, old.validation_evidence_digest)
    is distinct from
    (new.offer_id, new.integration_id, new.location_id, new.fulfilment_mode,
     new.provider_service_product_id, new.inventory_revision, new.validation_evidence_digest)
    or (old.status = 'active' and new.status <> 'active') then
    new.mode_verified_at := null;
    new.mode_evidence_digest := null;
    new.mapping_version := old.mapping_version + 1;
  else
    new.mapping_version := old.mapping_version;
  end if;
  return new;
end;
$$;

create or replace function public.class_bump_mapping_for_inventory_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_mapping_id uuid;
  new_mapping_id uuid;
begin
  if tg_op <> 'INSERT' then old_mapping_id := old.mapping_id; end if;
  if tg_op <> 'DELETE' then new_mapping_id := new.mapping_id; end if;

  if old_mapping_id is not null then
    update public.class_offer_provider_mappings
    set inventory_revision = inventory_revision + 1
    where id = old_mapping_id;
  end if;
  if new_mapping_id is not null and new_mapping_id is distinct from old_mapping_id then
    update public.class_offer_provider_mappings
    set inventory_revision = inventory_revision + 1
    where id = new_mapping_id;
  end if;
  return null;
end;
$$;

create trigger class_inventory_bump_mapping_version
after insert or update or delete on public.class_offer_inventory_allowlist
for each row execute function public.class_bump_mapping_for_inventory_change();

create or replace function public.class_validate_existing_entitlement_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mapping_row public.class_offer_provider_mappings%rowtype;
  integration_environment public.class_provider_environment;
  source_row public.class_existing_entitlement_evidence%rowtype;
  source_integration_environment public.class_provider_environment;
begin
  select mapping.* into mapping_row
  from public.class_offer_provider_mappings mapping
  where mapping.business_id = new.business_id and mapping.id = new.mapping_id
  for key share;

  select integration.environment into integration_environment
  from public.class_business_integrations integration
  where integration.business_id = mapping_row.business_id
    and integration.id = mapping_row.integration_id;

  if mapping_row.id is null
    or mapping_row.fulfilment_mode <> 'existing_entitlement'
    or mapping_row.mapping_version <> new.mapping_version
    or mapping_row.status <> 'active'
    or mapping_row.validated_at is null
    or mapping_row.validation_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'existing-entitlement evidence requires the current active validated mapping';
  end if;
  if new.evidence_environment is distinct from integration_environment then
    raise exception 'evidence environment must match the mapping integration';
  end if;
  if integration_environment = 'sandbox' then
    if new.source_evidence_id is not null or new.production_equivalence_digest is not null then
      raise exception 'sandbox evidence cannot claim a production promotion';
    end if;
  elsif integration_environment = 'production' then
    if new.source_evidence_id is null or new.production_equivalence_digest is null then
      raise exception 'production existing-entitlement evidence requires reviewed sandbox promotion';
    end if;
    select evidence.* into source_row
    from public.class_existing_entitlement_evidence evidence
    where evidence.id = new.source_evidence_id
    for share;
    if source_row.id is not null then
      select integration.environment into source_integration_environment
      from public.class_offer_provider_mappings source_mapping
      join public.class_business_integrations integration
        on integration.business_id = source_mapping.business_id
       and integration.id = source_mapping.integration_id
      where source_mapping.business_id = source_row.business_id
        and source_mapping.id = source_row.mapping_id;
    end if;
    if source_row.id is null
      or source_row.business_id <> new.business_id
      or source_row.evidence_kind <> new.evidence_kind
      or source_row.status <> 'verified'
      or source_row.evidence_environment <> 'sandbox'
      or source_integration_environment <> 'sandbox'
      or new.verified_at < source_row.verified_at then
      raise exception 'production existing-entitlement promotion requires matching current sandbox proof';
    end if;
  else
    raise exception 'existing-entitlement evidence requires a known provider environment';
  end if;
  if new.verified_at > now() then
    raise exception 'existing-entitlement evidence cannot be verified in the future';
  end if;
  return new;
end;
$$;

create trigger class_existing_entitlement_evidence_validate
before insert on public.class_existing_entitlement_evidence
for each row execute function public.class_validate_existing_entitlement_evidence();

create or replace function public.class_protect_existing_entitlement_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'verified'
    and new.status = 'revoked'
    and new.revoked_at is not null
    and new.revocation_reason is not null
    and (old.id, old.business_id, old.mapping_id, old.mapping_version,
         old.evidence_kind, old.evidence_environment, old.evidence_digest,
         old.verified_at, old.verified_by, old.source_evidence_id,
         old.production_equivalence_digest, old.created_at)
      is not distinct from
        (new.id, new.business_id, new.mapping_id, new.mapping_version,
         new.evidence_kind, new.evidence_environment, new.evidence_digest,
         new.verified_at, new.verified_by, new.source_evidence_id,
         new.production_equivalence_digest, new.created_at) then
    return new;
  end if;
  raise exception 'controlled existing-entitlement evidence is append-only except for revocation';
end;
$$;

create trigger class_existing_entitlement_evidence_protect
before update or delete on public.class_existing_entitlement_evidence
for each row execute function public.class_protect_existing_entitlement_evidence();

create or replace function public.class_require_existing_entitlement_activation_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  evidence_missing boolean;
  integration_environment public.class_provider_environment;
begin
  if new.fulfilment_mode <> 'existing_entitlement'
    or new.mode_verified_at is null
    or new.mode_evidence_digest is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'existing-entitlement mappings must be created inactive before evidence is recorded';
  end if;

  select integration.environment into integration_environment
  from public.class_business_integrations integration
  where integration.business_id = new.business_id
    and integration.id = new.integration_id;

  if integration_environment = 'production' then
    -- Serialize activation with source revocation and revalidate the source at
    -- the boundary that opens the production write path.
    perform source.id
    from public.class_existing_entitlement_evidence target
    join public.class_existing_entitlement_evidence source
      on source.id = target.source_evidence_id
    where target.business_id = new.business_id
      and target.mapping_id = new.id
      and target.mapping_version = new.mapping_version
      and target.status = 'verified'
      and source.status = 'verified'
      and source.evidence_environment = 'sandbox'
      and source.business_id = target.business_id
      and source.evidence_kind = target.evidence_kind
    for share of source;
  end if;

  select exists (
    select required.kind
    from unnest(enum_range(null::public.class_existing_entitlement_evidence_kind)) required(kind)
    except
    select target.evidence_kind
    from public.class_existing_entitlement_evidence target
    left join public.class_existing_entitlement_evidence source
      on source.id = target.source_evidence_id
    where target.business_id = new.business_id
      and target.mapping_id = new.id
      and target.mapping_version = new.mapping_version
      and target.status = 'verified'
      and (
        (
          integration_environment = 'sandbox'
          and target.evidence_environment = 'sandbox'
          and target.source_evidence_id is null
        )
        or (
          integration_environment = 'production'
          and target.evidence_environment = 'production'
          and source.status = 'verified'
          and source.evidence_environment = 'sandbox'
          and source.business_id = target.business_id
          and source.evidence_kind = target.evidence_kind
        )
      )
  ) into evidence_missing;

  if evidence_missing then
    raise exception 'explicit selection, pass deduction, and reconciliation evidence are required';
  end if;
  return new;
end;
$$;

create trigger class_mappings_require_existing_entitlement_evidence
before insert or update on public.class_offer_provider_mappings
for each row execute function public.class_require_existing_entitlement_activation_evidence();

create or replace function public.class_disable_revoked_existing_entitlement_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'verified' and new.status = 'revoked' then
    update public.class_existing_entitlement_evidence
    set status = 'revoked', revoked_at = now(), revocation_reason = 'SOURCE_EVIDENCE_REVOKED'
    where source_evidence_id = new.id and status = 'verified';
    update public.class_offer_provider_mappings
    set mode_verified_at = null, mode_evidence_digest = null
    where business_id = new.business_id
      and id = new.mapping_id
      and mapping_version = new.mapping_version;
  end if;
  return null;
end;
$$;

create trigger class_existing_entitlement_evidence_disable_on_revoke
after update on public.class_existing_entitlement_evidence
for each row execute function public.class_disable_revoked_existing_entitlement_mode();

-- Pre-existing generic evidence did not prove the three required behaviors.
update public.class_offer_provider_mappings
set mode_verified_at = null, mode_evidence_digest = null
where fulfilment_mode = 'existing_entitlement'
  and (mode_verified_at is not null or mode_evidence_digest is not null);

alter table public.class_existing_entitlement_evidence enable row level security;

create policy class_existing_entitlement_evidence_operations_select
on public.class_existing_entitlement_evidence for select to authenticated
using (public.has_class_operations_access(business_id));

grant select on public.class_existing_entitlement_evidence to authenticated, service_role;
grant insert, update on public.class_existing_entitlement_evidence to service_role;

revoke all on function public.class_validate_existing_entitlement_evidence() from public;
revoke all on function public.class_protect_existing_entitlement_evidence() from public;
revoke all on function public.class_require_existing_entitlement_activation_evidence() from public;
revoke all on function public.class_disable_revoked_existing_entitlement_mode() from public;
revoke all on function public.class_bump_mapping_for_inventory_change() from public;

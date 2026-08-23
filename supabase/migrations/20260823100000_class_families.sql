create type public.class_offer_family_status as enum ('draft', 'active', 'inactive');
create type public.class_family_provider_mapping_status as enum ('draft', 'active', 'disabled');

create table public.class_offer_families (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  offer_id uuid not null,
  location_id uuid not null,
  mapping_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  display_name text not null check (length(trim(display_name)) > 0),
  description text,
  display_order integer not null default 0 check (display_order >= 0),
  status public.class_offer_family_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, offer_id, slug),
  unique (business_id, id, offer_id, mapping_id),
  foreign key (business_id, offer_id, location_id)
    references public.class_revvi_offers(business_id, id, location_id)
    on delete restrict,
  foreign key (business_id, mapping_id, offer_id)
    references public.class_offer_provider_mappings(business_id, id, offer_id)
    on delete restrict
);

comment on table public.class_offer_families is
  'Revvi-owned customer-facing Class family inside one Offer. It is separate from Business category and Mindbody taxonomy.';

create table public.class_family_provider_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  class_family_id uuid not null,
  provider_location_id text not null check (length(trim(provider_location_id)) > 0),
  provider_class_description_id text not null check (length(trim(provider_class_description_id)) > 0),
  provider_program_id text not null check (length(trim(provider_program_id)) > 0),
  provider_session_type_id text not null check (length(trim(provider_session_type_id)) > 0),
  provider_class_schedule_id text,
  status public.class_family_provider_mapping_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (
    class_family_id,
    provider_location_id,
    provider_class_description_id,
    provider_program_id,
    provider_session_type_id,
    provider_class_schedule_id
  ),
  foreign key (business_id, class_family_id)
    references public.class_offer_families(business_id, id)
    on delete restrict
);

comment on table public.class_family_provider_mappings is
  'Correlated Site-scoped Mindbody taxonomy tuple for one Revvi Class family. Independent allowlist cross-products are not used here.';

alter table public.class_booking_quotes
  add column class_family_id uuid;

alter table public.class_bookings
  add column class_family_id uuid;

alter table public.class_booking_quotes
  add constraint class_quotes_family_fk
  foreign key (business_id, class_family_id)
  references public.class_offer_families(business_id, id)
  on delete restrict;

alter table public.class_bookings
  add constraint class_bookings_family_fk
  foreign key (business_id, class_family_id)
  references public.class_offer_families(business_id, id)
  on delete restrict;

create index class_offer_families_offer_idx
on public.class_offer_families (business_id, offer_id, location_id, display_order);

create index class_family_provider_mappings_family_idx
on public.class_family_provider_mappings (business_id, class_family_id, status);

create index class_quotes_family_idx
on public.class_booking_quotes (business_id, class_family_id);

create index class_bookings_family_idx
on public.class_bookings (business_id, class_family_id);

create trigger class_offer_families_set_updated_at
before update on public.class_offer_families
for each row execute function public.class_set_updated_at();

create trigger class_family_provider_mappings_set_updated_at
before update on public.class_family_provider_mappings
for each row execute function public.class_set_updated_at();

create or replace function public.class_validate_family_configuration()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  family_status public.class_offer_family_status;
  offer_status public.class_offer_status;
  mapping_status public.class_offer_mapping_status;
  family_business_id uuid;
begin
  if tg_table_name = 'class_offer_families' then
    if new.status <> 'active' then
      return new;
    end if;

    select offer.status into offer_status
    from public.class_revvi_offers offer
    where offer.business_id = new.business_id
      and offer.id = new.offer_id
      and offer.location_id = new.location_id;

    select mapping.status into mapping_status
    from public.class_offer_provider_mappings mapping
    where mapping.business_id = new.business_id
      and mapping.id = new.mapping_id
      and mapping.offer_id = new.offer_id
      and mapping.location_id = new.location_id;

    if offer_status is distinct from 'active' or mapping_status is distinct from 'active' then
      raise exception 'an active Class family requires an active Offer and Class mapping';
    end if;

    if not exists (
      select 1 from public.class_family_provider_mappings provider_mapping
      where provider_mapping.business_id = new.business_id
        and provider_mapping.class_family_id = new.id
        and provider_mapping.status = 'active'
    ) then
      raise exception 'an active Class family requires an active provider mapping';
    end if;
    return new;
  end if;

  select family.status, family.business_id
  into family_status, family_business_id
  from public.class_offer_families family
  where family.id = new.class_family_id;

  if new.status = 'active'
    and family_status is not null
    and (family_status = 'inactive' or family_business_id is distinct from new.business_id) then
    raise exception 'an active provider mapping requires an active Class family';
  end if;
  return new;
end;
$$;

create trigger class_offer_families_validate_configuration
before insert or update on public.class_offer_families
for each row execute function public.class_validate_family_configuration();

create trigger class_family_provider_mappings_validate_configuration
before insert or update on public.class_family_provider_mappings
for each row execute function public.class_validate_family_configuration();

create or replace function public.class_copy_quote_family_to_booking()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.class_family_id is null and new.quote_id is not null then
    select quote.class_family_id into new.class_family_id
    from public.class_booking_quotes quote
    where quote.business_id = new.business_id
      and quote.id = new.quote_id;
  end if;
  return new;
end;
$$;

create trigger class_bookings_copy_quote_family
before insert on public.class_bookings
for each row execute function public.class_copy_quote_family_to_booking();

create or replace function public.resolve_class_availability_families(
  candidate_business_id uuid,
  candidate_location_id uuid,
  candidate_offer_id uuid
)
returns table (
  family_id uuid,
  family_slug text,
  family_name text,
  family_description text,
  family_display_order integer,
  provider_mappings jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    family.id,
    family.slug,
    family.display_name,
    family.description,
    family.display_order,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', provider_mapping.id,
        'providerLocationId', provider_mapping.provider_location_id,
        'providerClassDescriptionId', provider_mapping.provider_class_description_id,
        'providerProgramId', provider_mapping.provider_program_id,
        'providerSessionTypeId', provider_mapping.provider_session_type_id,
        'providerClassScheduleId', provider_mapping.provider_class_schedule_id
      ) order by provider_mapping.id
    ) filter (where provider_mapping.id is not null), '[]'::jsonb)
  from public.class_offer_families family
  join public.class_family_provider_mappings provider_mapping
    on provider_mapping.business_id = family.business_id
    and provider_mapping.class_family_id = family.id
    and provider_mapping.status = 'active'
  where family.business_id = candidate_business_id
    and family.location_id = candidate_location_id
    and family.offer_id = candidate_offer_id
    and family.status = 'active'
  group by family.id, family.slug, family.display_name, family.description, family.display_order
  order by family.display_order, family.id;
$$;

comment on function public.resolve_class_availability_families(uuid, uuid, uuid) is
  'Returns active server-owned Class families and correlated Mindbody mappings for an already authorized Offer context.';

revoke all on function public.resolve_class_availability_families(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.resolve_class_availability_families(uuid, uuid, uuid)
to service_role;

alter table public.class_offer_families enable row level security;
alter table public.class_family_provider_mappings enable row level security;

create policy class_offer_families_operations_select
on public.class_offer_families for select to authenticated
using (public.has_class_operations_access(business_id));

create policy class_family_provider_mappings_operations_select
on public.class_family_provider_mappings for select to authenticated
using (public.has_class_operations_access(business_id));

grant select on public.class_offer_families to authenticated, service_role;
grant select on public.class_family_provider_mappings to authenticated, service_role;
grant insert, update, delete on public.class_offer_families to service_role;
grant insert, update, delete on public.class_family_provider_mappings to service_role;

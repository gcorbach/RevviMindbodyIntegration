-- A paid Class Offer may be backed by one or more approved Mindbody Products.
-- The legacy mapping column remains as a compatibility projection for existing
-- ledgers and quote persistence; runtime catalogue reads use this child set.

create table public.class_offer_pricing_options (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.class_businesses(id) on delete restrict,
  mapping_id uuid not null,
  provider_service_product_id text not null check (length(trim(provider_service_product_id)) > 0),
  status public.class_offer_mapping_status not null default 'draft',
  validated_at timestamptz,
  validation_evidence_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, mapping_id, provider_service_product_id),
  foreign key (business_id, mapping_id)
    references public.class_offer_provider_mappings(business_id, id)
    on delete restrict,
  check (
    (status = 'active' and validated_at is not null and validation_evidence_digest ~ '^[0-9a-f]{64}$')
    or status <> 'active'
  )
);

comment on table public.class_offer_pricing_options is
  'Approved Mindbody Product set for a paid Class Offer mapping. A Product is a pricing option, not a Class or Class family.';

comment on column public.class_offer_provider_mappings.provider_service_product_id is
  'Legacy single-Product compatibility projection. New paid configuration is represented by class_offer_pricing_options.';

create index class_offer_pricing_options_mapping_idx
on public.class_offer_pricing_options (business_id, mapping_id, status);

create trigger class_offer_pricing_options_set_updated_at
before update on public.class_offer_pricing_options
for each row execute function public.class_set_updated_at();

create trigger class_offer_pricing_options_immutable_owner
before update on public.class_offer_pricing_options
for each row execute function public.class_prevent_business_reassignment();

create or replace function public.class_validate_pricing_option_mapping()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  mapping_row public.class_offer_provider_mappings%rowtype;
begin
  select * into mapping_row
  from public.class_offer_provider_mappings mapping
  where mapping.business_id = new.business_id
    and mapping.id = new.mapping_id;

  if mapping_row.id is null then
    raise exception 'Pricing option mapping does not exist in the same Business';
  end if;
  if mapping_row.fulfilment_mode <> 'purchase_pricing_option' then
    raise exception 'Only paid Class Offer mappings may have Product pricing options';
  end if;
  return new;
end;
$$;

create trigger class_offer_pricing_options_validate_mapping
before insert or update on public.class_offer_pricing_options
for each row execute function public.class_validate_pricing_option_mapping();

insert into public.class_offer_pricing_options (
  business_id,
  mapping_id,
  provider_service_product_id,
  status,
  validated_at,
  validation_evidence_digest
)
select
  mapping.business_id,
  mapping.id,
  mapping.provider_service_product_id,
  mapping.status,
  mapping.validated_at,
  mapping.validation_evidence_digest
from public.class_offer_provider_mappings mapping
where mapping.fulfilment_mode = 'purchase_pricing_option'
  and mapping.provider_service_product_id is not null
on conflict (business_id, mapping_id, provider_service_product_id) do nothing;

alter table public.class_offer_pricing_options enable row level security;

create policy class_pricing_options_operations_select
on public.class_offer_pricing_options
for select to authenticated
using (public.has_class_operations_access(business_id));

grant select on public.class_offer_pricing_options to authenticated, service_role;
grant insert, update, delete on public.class_offer_pricing_options to service_role;

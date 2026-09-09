-- Bind quotes to the approved Product set, retaining historical Product identities.
alter table public.class_booking_quotes
  drop constraint class_booking_quotes_business_id_mapping_id_offer_id_inte_fkey2;
alter table public.class_booking_quotes
  add constraint class_quotes_approved_pricing_option_fk
  foreign key (business_id, mapping_id, provider_service_product_id)
  references public.class_offer_pricing_options(business_id, mapping_id, provider_service_product_id)
  on delete restrict;

create or replace function public.class_validate_quote_pricing_option()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.fulfilment_mode = 'purchase_pricing_option' and not exists (
    select 1 from public.class_offer_pricing_options option
    where option.business_id = new.business_id and option.mapping_id = new.mapping_id
      and option.provider_service_product_id = new.provider_service_product_id
      and option.status = 'active'
  ) then
    raise exception 'new paid quotes require an active approved pricing option';
  end if;
  return new;
end;
$$;
create trigger class_quotes_validate_pricing_option
before insert on public.class_booking_quotes
for each row execute function public.class_validate_quote_pricing_option();

create or replace function public.register_site_99_quote_pricing_option(
  candidate_business_id uuid, candidate_mapping_id uuid, candidate_customer_id uuid,
  candidate_product_id text, candidate_evidence_digest text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if candidate_product_id is null or length(trim(candidate_product_id)) = 0
    or candidate_evidence_digest is null or candidate_evidence_digest !~ '^[a-f0-9]{64}$'
    or not exists (
      select 1 from public.class_offer_provider_mappings mapping
      join public.class_business_integrations integration on integration.id = mapping.integration_id
      join public.class_business_locations location on location.id = mapping.location_id
      where mapping.id = candidate_mapping_id and mapping.business_id = candidate_business_id
        and integration.environment = 'sandbox' and integration.provider_site_id = '-99'
        and integration.status = 'active' and location.provider_location_id = '1'
        and mapping.status = 'active' and mapping.fulfilment_mode = 'purchase_pricing_option'
        and mapping.paid_payment_route = 'mindbody_sandbox_cash'
        and mapping.sandbox_demo_write_enabled and mapping.paid_pricing_option_enabled
        and mapping.sandbox_demo_customer_id = candidate_customer_id
    ) then
    raise exception 'only the enabled Site -99 quote lane may register discovered pricing options';
  end if;
  insert into public.class_offer_pricing_options (
    business_id, mapping_id, provider_service_product_id, status, validated_at, validation_evidence_digest
  ) values (
    candidate_business_id, candidate_mapping_id, trim(candidate_product_id), 'active', now(), candidate_evidence_digest
  ) on conflict (business_id, mapping_id, provider_service_product_id) do update
    set status = 'active', validated_at = excluded.validated_at,
        validation_evidence_digest = excluded.validation_evidence_digest;
end;
$$;
revoke all on function public.register_site_99_quote_pricing_option(uuid,uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.register_site_99_quote_pricing_option(uuid,uuid,uuid,text,text)
  to service_role;
comment on function public.register_site_99_quote_pricing_option(uuid,uuid,uuid,text,text) is
 'Server-only Site -99 reset support after exact family-name Product selection and provider Test checkout; production approval is never inferred.';

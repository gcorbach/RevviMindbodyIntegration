-- Older callers configure the approved scalar Product without a child row.
-- Preserve that contract while keeping explicit inactive options disabled.
create or replace function public.class_validate_quote_pricing_option()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.fulfilment_mode = 'purchase_pricing_option' then
    insert into public.class_offer_pricing_options (
      business_id, mapping_id, provider_service_product_id, status, validated_at, validation_evidence_digest
    ) select mapping.business_id, mapping.id, mapping.provider_service_product_id,
      mapping.status, mapping.validated_at, mapping.validation_evidence_digest
    from public.class_offer_provider_mappings mapping
    where mapping.business_id = new.business_id and mapping.id = new.mapping_id
      and mapping.status = 'active' and mapping.fulfilment_mode = 'purchase_pricing_option'
      and mapping.provider_service_product_id = new.provider_service_product_id
    on conflict (business_id, mapping_id, provider_service_product_id) do nothing;
    if not exists (
      select 1 from public.class_offer_pricing_options option
      where option.business_id = new.business_id and option.mapping_id = new.mapping_id
        and option.provider_service_product_id = new.provider_service_product_id
        and option.status = 'active'
    ) then
      raise exception 'new paid quotes require an active approved pricing option';
    end if;
  end if;
  return new;
end;
$$;

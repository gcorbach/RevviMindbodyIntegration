-- Seed the customer-facing families for the exact hosted Site -99 demo Offer.
-- These provider IDs are initial evidence observed on 2026-09-01. The hosted
-- runtime re-resolves them from the stable-name manifest before every journey.

do $$
declare
  target_business_id uuid;
  target_location_id constant uuid := 'df893f87-6ca7-4417-88e9-25067b42ee37';
  target_offer_id constant uuid := '0b3e181e-a718-4098-aa58-9275763f4419';
  target_mapping_id constant uuid := '68fb8c91-41f8-49ec-ab77-1d4c478ee64d';
begin
  select business.id into target_business_id
  from public.class_businesses business
  join public.class_revvi_offers offer
    on offer.business_id = business.id
    and offer.id = target_offer_id
    and offer.location_id = target_location_id
  join public.class_offer_provider_mappings mapping
    on mapping.business_id = business.id
    and mapping.id = target_mapping_id
    and mapping.offer_id = offer.id
    and mapping.location_id = offer.location_id
  where business.slug = 'lastspot-sandbox'
    and business.status = 'active'
    and offer.status = 'active'
    and mapping.status = 'active';

  if target_business_id is null then
    return;
  end if;

  insert into public.class_offer_families (
    id, business_id, offer_id, location_id, mapping_id,
    slug, display_name, display_order, status
  ) values
    ('00000000-0000-4000-8000-000000000101', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'yoga-program', 'Yoga', 10, 'draft'),
    ('00000000-0000-4000-8000-000000000102', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'daily-work-out', 'Daily Work Out', 20, 'draft'),
    ('00000000-0000-4000-8000-000000000103', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'pilates-101', 'Pilates 101', 30, 'draft'),
    ('00000000-0000-4000-8000-000000000104', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'zumba', 'Zumba', 40, 'draft'),
    ('00000000-0000-4000-8000-000000000105', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'level-5-bikram-yoga', 'Level 5 Bikram Yoga', 50, 'draft'),
    ('00000000-0000-4000-8000-000000000106', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'body-pump', 'Body Pump', 60, 'draft'),
    ('00000000-0000-4000-8000-000000000107', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'rpm-spinning', 'RPM Spinning', 70, 'draft'),
    ('00000000-0000-4000-8000-000000000108', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'sweat', 'Sweat', 80, 'draft'),
    ('00000000-0000-4000-8000-000000000109', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'power-yoga', 'Power Yoga', 90, 'draft'),
    ('00000000-0000-4000-8000-000000000110', target_business_id, target_offer_id, target_location_id, target_mapping_id, 'yoga-classes', 'Yoga', 100, 'draft')
  on conflict (business_id, id) do update set
    offer_id = excluded.offer_id,
    location_id = excluded.location_id,
    mapping_id = excluded.mapping_id,
    slug = excluded.slug,
    display_name = excluded.display_name,
    display_order = excluded.display_order,
    status = 'draft',
    updated_at = now();

  insert into public.class_family_provider_mappings (
    id, business_id, class_family_id, provider_location_id,
    provider_class_description_id, provider_program_id,
    provider_session_type_id, status
  ) values
    ('00000000-0000-4000-8000-000000000201', target_business_id, '00000000-0000-4000-8000-000000000101', '1', '223', '27', '250', 'active'),
    ('00000000-0000-4000-8000-000000000202', target_business_id, '00000000-0000-4000-8000-000000000102', '1', '301', '26', '251', 'active'),
    ('00000000-0000-4000-8000-000000000203', target_business_id, '00000000-0000-4000-8000-000000000103', '1', '345', '26', '70', 'active'),
    ('00000000-0000-4000-8000-000000000204', target_business_id, '00000000-0000-4000-8000-000000000104', '1', '295', '26', '207', 'active'),
    ('00000000-0000-4000-8000-000000000205', target_business_id, '00000000-0000-4000-8000-000000000105', '1', '342', '26', '68', 'active'),
    ('00000000-0000-4000-8000-000000000206', target_business_id, '00000000-0000-4000-8000-000000000106', '1', '170', '26', '206', 'active'),
    ('00000000-0000-4000-8000-000000000207', target_business_id, '00000000-0000-4000-8000-000000000107', '1', '177', '26', '207', 'active'),
    ('00000000-0000-4000-8000-000000000208', target_business_id, '00000000-0000-4000-8000-000000000108', '1', '168', '26', '251', 'active'),
    ('00000000-0000-4000-8000-000000000209', target_business_id, '00000000-0000-4000-8000-000000000109', '1', '69', '26', '68', 'active'),
    ('00000000-0000-4000-8000-000000000210', target_business_id, '00000000-0000-4000-8000-000000000110', '1', '211', '26', '68', 'active')
  on conflict (business_id, id) do update set
    class_family_id = excluded.class_family_id,
    provider_location_id = excluded.provider_location_id,
    provider_class_description_id = excluded.provider_class_description_id,
    provider_program_id = excluded.provider_program_id,
    provider_session_type_id = excluded.provider_session_type_id,
    provider_class_schedule_id = null,
    status = 'active',
    updated_at = now();

  update public.class_offer_families
  set status = 'active', updated_at = now()
  where business_id = target_business_id
    and offer_id = target_offer_id
    and id between '00000000-0000-4000-8000-000000000101'::uuid
      and '00000000-0000-4000-8000-000000000110'::uuid;
end;
$$;

-- A copyable link per Offer for staff working in the Supabase Table Editor.
create or replace view public.webflow_booking_links
with (security_invoker = true)
as
select
  business.display_name as partner_name,
  location.display_name as location_name,
  offer.display_name as offer_name,
  '/book?businessSlug=' || business.slug
    || '&locationId=' || location.id::text
    || '&offerId=' || offer.id::text as booking_path,
  'https://thes-fantabulous-site-e67dcc.webflow.io/book?businessSlug=' || business.slug
    || '&locationId=' || location.id::text
    || '&offerId=' || offer.id::text as booking_url,
  business.slug as business_slug,
  location.id as location_id,
  offer.id as offer_id,
  location.timezone as location_timezone,
  business.status as partner_status,
  location.enabled as location_enabled,
  offer.status as offer_status,
  integration.environment as provider_environment,
  integration.status as integration_status,
  (
    business.status = 'active' and location.enabled and offer.status = 'active'
    and integration.status = 'active'
    and exists (
      select 1 from public.class_offer_provider_mappings mapping
      where mapping.business_id = business.id and mapping.offer_id = offer.id
        and mapping.location_id = location.id and mapping.integration_id = integration.id
        and mapping.fulfilment_mode = offer.fulfilment_mode and mapping.status = 'active'
    )
  ) as booking_context_active
from public.class_revvi_offers offer
join public.class_businesses business on business.id = offer.business_id
join public.class_business_locations location
  on location.id = offer.location_id and location.business_id = business.id
join public.class_business_integrations integration
  on integration.id = location.integration_id and integration.business_id = business.id;

comment on view public.webflow_booking_links is
  'Staff copy links for the current Webflow site. Derived live from Offer configuration; booking_context_active describes configuration only, not Customer eligibility, pilot write readiness, or live inventory. /book must read the URL parameters before mounting its widget.';
comment on column public.webflow_booking_links.booking_path is
  'Relative link usable on another Webflow domain. Slugs are constrained URL-safe tokens; IDs are UUIDs.';
comment on column public.webflow_booking_links.booking_url is
  'Absolute link for the configured staging Webflow site. Update the view when the public booking domain changes.';
revoke all on public.webflow_booking_links from public, anon, authenticated;
grant select on public.webflow_booking_links to service_role;

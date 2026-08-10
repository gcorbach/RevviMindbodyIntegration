# Issue #11 retained Appointment prototype catalogue

Issue #11 is a historical Appointment prototype and is deliberately sandbox-only. It does not implement the production Class catalogue. The local seed creates two Revvi Businesses for tenant tests:

- `sandbox-wellness` is the active development Business.
- `sandbox-secondary` is disabled and exists to prove that customer context cannot cross tenants.

The seed resolves the Site ID from the local sandbox environment and uses the provided sandbox's known Location IDs (`1` / Clubville and `2` / Fitville). If Mindbody gives the project a different sandbox fixture, record the replacement values in the Supabase dashboard:

```sql
-- Provider identifiers are server-side configuration. Run this in the
-- Supabase SQL editor or a service-role migration, never from browser code.
update public.business_provider_config
set mindbody_site_id = '<provided sandbox Site ID>'
where business_id = (select id from public.businesses where slug = 'sandbox-wellness');

update public.business_location_provider_config config
set mindbody_location_id = '<provided sandbox Location ID>'
from public.business_locations location
where config.location_id = location.id
  and location.slug = 'sandbox-location';

```

The Edge Function still resolves `__MINDBODY_SANDBOX_SITE_ID__` from `MINDBODY_SANDBOX_SITE_ID` for a clean local reset. It rejects production Businesses because this slice has no production provider path.

The customer endpoint is:

```text
GET /functions/v1/prototype-appointment-catalogue?business=sandbox-wellness&location=sandbox-location
Authorization: Bearer <Supabase access token with app_metadata.identity_provider=memberstack, app_metadata.memberstack_id, and app_metadata.memberstack_verified=true>
```

The response contains only Revvi Business/Location fields and allowlisted live service fields. Mindbody credentials, Site IDs, provider session IDs, and raw provider payloads stay server-side.

Run the local database/RLS suite with `pnpm supabase test db`. After the local Supabase stack is up, run the explicit Appointment prototype suite; it discovers the local credentials and uses a local Mindbody double:

```powershell
pnpm test:prototype:appointment
```

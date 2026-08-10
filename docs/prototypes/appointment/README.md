# Retained Appointment prototype

The code and fixtures in the `prototype-appointment-*` namespace are the local sandbox/test prototype completed under historical GitHub issues #10–#19. They are retained to reuse lessons about tenant isolation, Client resolution, idempotency, reconciliation, support, and readiness; they do not implement production Class Booking.

Every callable route returns `404` when deployed and also requires `REVVI_APPOINTMENT_PROTOTYPE_ENABLED=true` locally. Run its explicit suite with:

```sh
pnpm test:prototype:appointment
```

The production Supabase configuration marks all prototype functions `enabled = false`. The explicit suite creates a temporary local-only configuration that enables them for the duration of the tests, then deletes it.

For an interactive local diagnostic session, populate `supabase/functions/.env.local` and run `pnpm prototype:appointment:functions`. The command serves the prototype through the same temporary configuration and removes it on exit.

The retained local browser fixtures are:

- [Appointment catalogue](../../catalogue/catalogue.html)
- [Appointment availability](../../catalogue/availability.html)
- [Appointment support operations](../../support/operations.html)

Production code must use a separate Class adapter and Class-specific ledger. The default `pnpm test` suite contains a boundary test that rejects Appointment operations or identifiers in production function sources.

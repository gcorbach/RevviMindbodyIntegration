# Hosted quote persistence — 2026-09-08

Request `f175c56a-bc82-49bd-8a6a-16a88209ee15` completed Client creation, Class validation, service discovery, Test checkout, and currency reads. The newly persisted Client is `100015645`. Failure occurred when storing the quote, before a committed checkout or booking.

A rolled-back quote insert against the hosted database reproduced SQLSTATE 23503 on `class_booking_quotes_business_id_mapping_id_offer_id_inte_fkey2`: Product `1300` did not match the legacy scalar Product on the Offer mapping. The provider already resolved reset-safe pricing-option names, but the database still required the old scalar Product.

Quotes now reference the approved pricing-option child table. New paid quotes require an active option; historical quotes retain their original Product references. Legacy callers retain support for the mapping's already-approved scalar Product, without reactivating an explicitly inactive child option.

After exact stable-name Product selection and successful provider Test checkout, the explicitly enabled Site -99 sandbox quote path registers the discovered Product with the quote fingerprint as its evidence digest before quote insertion. The registration RPC checks sandbox Site -99, Location 1, sandbox Cash, the enabled paid/demo flags, and the designated Customer. Browser callers have no execution permission. Production cannot use this registration path.

Verification:

- Failing persistence-order regression reproduced before the code fix.
- Full Node suite: 263 passed, 10 browser-dependent tests skipped.
- Hosted database transaction: approved reset Product inserted successfully; unknown Product, wrong Customer and browser access rejected; rolled back.
- Four pgTAP registration/persistence assertions passed against the hosted sandbox records in a rolled-back transaction.
- The local demo has no Supabase quote ledger, so this persistence repair has no local adapter mutation. Its stable-name Product selection remains unchanged; local demo and quote tests passed in the Node suite.

This verifies quote persistence, not a completed Webflow booking. A fresh authenticated quote and final booking remain to be confirmed through the published page.

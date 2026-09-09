# Hosted availability staged loading — 2026-09-07

The Webflow first step received two weeks of occurrences across all families. Hosted request `94af5ff1-e5d5-411a-b6f1-c7c521a5eaed` recorded 82 `sale/services` requests totaling 33,015 ms. Its `class/classes` read took 287 ms. The hosted adapter performed each pricing request sequentially; the local demo already used family previews.

The hosted discovery module now returns one next bookable preview and provisional price per available family, with an empty `sessions` array for the catalogue. The existing browser therefore requests the selected family's times on Continue. Pricing checks are limited to six concurrent calls. Full selected-family results still validate each occurrence's own pricing option. Cancelled and unavailable families remain visible and disabled. Legacy contexts without configured families retain their existing occurrence response.

This still reads live inventory to determine truthful next-occurrence previews. It defers the expensive per-occurrence pricing work and full time-slot response until a family is selected. It does not cache availability or relax authorization, quote, or booking checks.

## Verification

- Regression reproduced before the fix: the two-occurrence catalogue fixture priced both IDs instead of one.
- Full suite after implementation: 259 passed, 10 browser-dependent tests skipped. An additional disabled-family regression subsequently passed with all 19 availability tests.
- Live updated Supabase discovery module using actual hosted database context and live Mindbody reads: 2,481 ms including sandbox taxonomy refresh; 8 pricing calls, 10 family cards, zero sessions.
- Live selected Yoga family: 1,586 ms; 10 pricing calls, 10 sessions, all belonging to the selected family.
- Separate unchanged local demo live catalogue: 2,189 ms; 10 families, zero full fixtures.

The measured discovery timings exclude hosted HTTP authentication, database-context loading, and diagnostic writes. They are not a claim of measured browser-to-Edge-Function latency. The authenticated published-page timing and full booking journey remain to be verified after deployment.

Deployed `offer-class-availability` to sandbox project `hqjgsqlniuhphvhyeejm`; Management API subsequently reports version 25, ACTIVE. No Webflow asset change or republish is required for this server-side correction.

Browser verification: the existing Chrome `--dump-dom` launcher stalled in this environment. A Playwright-driven Chromium check against the same progressive-family fixture passed: two availability requests total, no family on the initial request, only the chosen Yoga family on Continue, and the widget reached `showing-times`. The stalled launcher was stopped.

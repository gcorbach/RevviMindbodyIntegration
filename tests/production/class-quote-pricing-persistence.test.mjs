import assert from 'node:assert/strict';
import test from 'node:test';
import { createClassBookingQuoteCatalogue } from '../../supabase/functions/_shared/class-booking-quote-catalogue.js';

test('a live sandbox Product is registered before its quote is inserted', async () => {
  const calls = [];
  const catalogue = createClassBookingQuoteCatalogue({
    rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; },
    from: () => ({ insert: (row) => { calls.push({ name: 'insert', row }); return { select: () => ({ single: async () => ({ data: { id: 'quote' } }) }) }; } }),
  });
  await catalogue.persistQuote({ sandboxPricingOptionDiscovered: true, businessId: 'business', mappingId: 'mapping',
    customerId: 'customer', providerServiceProductId: 'reset-product', quoteFingerprint: 'a'.repeat(64) });
  assert.deepEqual(calls.map(call => call.name), ['register_site_99_quote_pricing_option', 'insert']);
  assert.equal(calls[0].args.candidate_product_id, calls[1].row.provider_service_product_id);
});

test('ordinary quotes cannot use sandbox Product registration', async () => {
  const catalogue = createClassBookingQuoteCatalogue({
    rpc: async () => assert.fail('production must use existing approved Products'),
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'quote' } }) }) }) }),
  });
  assert.deepEqual(await catalogue.persistQuote({ providerServiceProductId: 'approved' }), { id: 'quote' });
});

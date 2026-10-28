import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CASES, makeRecommendation, canRefund } from '../lib/policy.mjs';
import { PayPalSandbox } from '../lib/paypal.mjs';

test('AI cannot invent incident evidence or set a refund amount', () => {
  const incident = SAMPLE_CASES[0];
  assert.throws(() => makeRecommendation(incident, { severity: 'critical', evidence: 'A completely invented outage', reason: 'The customer was fully blocked.' }), /exact quote/);
  const result = makeRecommendation(incident, { severity: 'major', evidence: 'sign-in was unavailable for 2 hours', reason: 'The customer could not access the core service.' , refundCents: 4900 });
  assert.equal(result.refundCents, 735);
  assert.equal(result.percent, 15);
});

test('refund is blocked until a real capture exists and only once per case', () => {
  const item = { ...SAMPLE_CASES[0], recommendation: { refundCents: 735 } };
  assert.match(canRefund(item), /payment first/);
  item.paypal = { captureId: 'SANDBOX-CAPTURE' };
  assert.equal(canRefund(item), null);
  item.refund = { id: 'SANDBOX-REFUND' };
  assert.match(canRefund(item), /already/);
});

test('PayPal adapter uses sandbox only, exact amount, and idempotency on money calls', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/v1/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'TEST', expires_in: 300 }) };
    if (url.endsWith('/v2/checkout/orders')) return { ok: true, json: async () => ({ id: 'ORDER1', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1' }] }) };
    if (url.endsWith('/refund')) return { ok: true, json: async () => ({ id: 'REFUND1', status: 'COMPLETED' }) };
    throw new Error(`Unexpected URL ${url}`);
  };
  const adapter = new PayPalSandbox({ clientId: 'TEST_ID', clientSecret: 'TEST_SECRET', fetchImpl: fakeFetch });
  const order = await adapter.createOrder(SAMPLE_CASES[0], 'http://127.0.0.1:4180/checkout/return', 'http://127.0.0.1:4180/checkout/cancel', 'ORDER-KEY');
  assert.equal(order.id, 'ORDER1');
  assert.equal(JSON.parse(calls[1].body).purchase_units[0].amount.value, '49.00');
  assert.equal(calls[1].headers['PayPal-Request-Id'], 'ORDER-KEY');
  await adapter.refund('CAPTURE1', 735, 'USD', 'REFUND-KEY');
  assert.equal(JSON.parse(calls[2].body).amount.value, '7.35');
  assert.equal(calls[2].headers['PayPal-Request-Id'], 'REFUND-KEY');
  assert.ok(calls.every(call => call.url.startsWith('https://api-m.sandbox.paypal.com/')));
});

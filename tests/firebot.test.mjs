import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Firebot, amountInCents } from '../lib/firebot.js';
import { createCheckout, verifyWebhook } from '../lib/checkout.js';
import { MemoryStore, customer, testEnv, fakeGateway } from './support.mjs';

const tx = { success: true, transactionId: 'fire_tx_test_123', amount: 297, status: 'PENDING', pixCopiaECola: 'TESTE LOCAL SEM VALOR. NAO E UM PIX REAL.' };
const sign = (raw, secret) => createHmac('sha256', secret).update(raw).digest('hex');

test('Firebot sends private key only to the official server and caches readiness', async () => {
  const calls = [], store = new MemoryStore();
  const gateway = new Firebot({ env: testEnv, store, fetcher: async (url, options) => {
    calls.push({ url, options }); return Response.json({ success: true });
  } });
  await gateway.prepare(); await gateway.prepare();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://firebotbr.com/api/v1/auth');
  assert.equal(calls[0].options.headers['x-api-key'], testEnv.FIREBOT_API_KEY);
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(!JSON.stringify([...store.records]).includes(testEnv.FIREBOT_API_KEY));
  const rotated = new Firebot({ env: { ...testEnv, FIREBOT_API_KEY: 'fire_sk_live_rotated' }, store, fetcher: gateway.fetcher });
  await rotated.prepare(); assert.equal(calls.length, 2);
});

test('Firebot uses reais, DIGITAL product, HTTPS store URL and documented buyer fields', async () => {
  let sent;
  const gateway = new Firebot({ env: testEnv, store: new MemoryStore(), fetcher: async (url, options) => {
    sent = { url, ...JSON.parse(options.body) }; return Response.json(tx);
  } });
  const result = await gateway.create({ ...customer, amount: 1 }, 'checkout-reference');
  assert.equal(sent.url, 'https://firebotbr.com/api/v1/pix/create');
  assert.equal(sent.amount, 297);
  assert.equal(sent.productType, 'DIGITAL');
  assert.equal(sent.storeUrl, 'https://black-microderme.vercel.app/checkout');
  assert.equal(sent.qrStyle, 'plain');
  assert.deepEqual(sent.customer, { name: customer.name, email: customer.email, cpf: customer.document, phone: customer.phone });
  assert.ok(sent.description.includes('checkout-reference'));
  assert.equal(result.id, tx.transactionId);
  assert.equal(result.pix.emv, tx.pixCopiaECola);
});

test('Firebot status normalizes documented uppercase states and verifies amount and ID', async () => {
  const statuses = { PENDING: 'pending', PAID: 'paid', REFUNDED: 'refunded', CANCELED: 'canceled', EXPIRED: 'expired', FAILED: 'failed' };
  for (const [input, expected] of Object.entries(statuses)) {
    const gateway = new Firebot({ env: testEnv, store: new MemoryStore(), fetcher: async url => {
      assert.equal(url, `https://firebotbr.com/api/v1/pix/${tx.transactionId}`);
      return Response.json({ ...tx, status: input });
    } });
    assert.deepEqual(await gateway.status(tx.transactionId), { id: tx.transactionId, amount: 29700, status: expected });
  }
  for (const wrong of [{ ...tx, amount: 2.97 }, { ...tx, amount: 29700 }, { ...tx, transactionId: 'fire_tx_wrong' }, { ...tx, status: 'UNKNOWN' }, { ...tx, amount: null }]) {
    const gateway = new Firebot({ env: testEnv, store: new MemoryStore(), fetcher: async () => Response.json(wrong) });
    await assert.rejects(() => gateway.status(tx.transactionId), /transaction_mismatch/);
  }
  assert.equal(amountInCents(297.001), null);
  assert.equal(amountInCents('297'), null);
});

test('bad charge response or timeout is uncertain and never retried by provider client', async () => {
  for (const response of [{ ...tx, pixCopiaECola: '' }, { ...tx, amount: 1 }, { ...tx, status: 'UNKNOWN' }]) {
    const gateway = new Firebot({ env: testEnv, store: new MemoryStore(), fetcher: async () => Response.json(response) });
    await assert.rejects(() => gateway.create(customer, 'ref'), e => e.uncertain === true);
  }
  let calls = 0;
  const gateway = new Firebot({ env: testEnv, store: new MemoryStore(), fetcher: async () => { calls++; throw new Error('timeout'); } });
  await assert.rejects(() => gateway.create(customer, 'ref'), e => e.code === 'provider_unavailable' && e.uncertain);
  assert.equal(calls, 1);
});

test('HTTP failures propagate without leaking provider response or credentials', async () => {
  for (const code of [400, 401, 403, 429, 500, 503]) {
    const gateway = new Firebot({ env: testEnv, store: new MemoryStore(), fetcher: async () => new Response('sensitive provider body', { status: code }) });
    await assert.rejects(() => gateway.create(customer, 'ref'), e => {
      assert.equal(e.code, `provider_${code}`);
      assert.equal(e.uncertain, code >= 500);
      assert.equal(e.status, code === 429 ? 429 : 502);
      assert.ok(!e.message.includes('sensitive'));
      return true;
    });
  }
});

const origin = 'https://checkout.example.com';
async function setup() {
  const env = { ...testEnv, FIREBOT_WEBHOOK_SECRET: 'test-webhook-secret' }, store = new MemoryStore(), gateway = fakeGateway();
  const handle = createCheckout({ env, store, gateway });
  const session = await handle(new Request(origin + '/api/session'));
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const request = (path, body, headers = {}) => handle(new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }));
  await request('/api/pix', customer);
  const event = (name = 'venda.paga', amount = 297) => {
    const body = { event: name, timestamp: new Date().toISOString(), data: { transactionId: 'fire_tx_local_test', amount, status: 'PAID', paymentMethod: 'PIX' } };
    return { body, headers: { 'x-signature': sign(JSON.stringify(body), env.FIREBOT_WEBHOOK_SECRET) } };
  };
  return { env, store, gateway, request, event, handle, cookie };
}

test('Firebot HMAC validates raw body and rejects invalid signatures', () => {
  const raw = '{ "event": "venda.paga" }', secret = 'secret', signature = sign(raw, secret);
  assert.equal(verifyWebhook(raw, signature, secret), true);
  assert.equal(verifyWebhook(raw, signature.toUpperCase(), secret), true);
  assert.equal(verifyWebhook(JSON.stringify(JSON.parse(raw)), signature, secret), false);
  assert.equal(verifyWebhook(raw, `t=123,v1=${signature}`, secret), false);
  assert.equal(verifyWebhook(raw, signature, 'wrong'), false);
});

test('signed webhook confirms with API; replay is deduplicated', async () => {
  const f = await setup(); f.gateway.paid = true;
  let checks = 0; const original = f.gateway.status;
  f.gateway.status = async id => { checks++; return original.call(f.gateway, id); };
  const { body, headers } = f.event();
  assert.equal((await f.request('/api/webhooks/firebot', body, headers)).status, 200);
  assert.equal((await f.request('/api/webhooks/firebot', body, headers)).status, 200);
  assert.equal(checks, 1);
  assert.equal((await (await f.request('/api/status')).json()).status, 'paid');
  assert.equal((await f.request('/api/webhooks/firebot', body)).status, 401);
});

test('paid event does not approve pending status and remains retryable', async () => {
  const f = await setup(), { body, headers } = f.event();
  assert.equal((await f.request('/api/webhooks/firebot', body, headers)).status, 503);
  assert.equal((await (await f.request('/api/status')).json()).status, 'pending');
  f.gateway.paid = true;
  assert.equal((await f.request('/api/webhooks/firebot', body, headers)).status, 200);
  assert.equal((await (await f.request('/api/status')).json()).status, 'paid');
});

test('wrong webhook amount or withdrawal event cannot approve a purchase', async () => {
  const f = await setup();
  const wrong = f.event('venda.paga', 1);
  assert.equal((await f.request('/api/webhooks/firebot', wrong.body, wrong.headers)).status, 400);
  const withdrawal = f.event('saque.concluido');
  assert.equal((await f.request('/api/webhooks/firebot', withdrawal.body, withdrawal.headers)).status, 200);
  assert.equal((await (await f.request('/api/status')).json()).status, 'pending');
});

test('checkout independently rejects wrong transaction amount from a provider', async () => {
  const f = await setup();
  f.gateway.status = async id => ({ id, amount: 1, status: 'paid' });
  assert.equal((await f.request('/api/status')).status, 502);
});

test('old pending order blocks silent replacement; old visitor without order can continue', async () => {
  const store = new MemoryStore(), gateway = fakeGateway(), id = '11111111-1111-4111-8111-111111111111';
  const handle = createCheckout({ env: testEnv, store, gateway });
  const request = () => new Request(origin + '/api/session', { headers: { cookie: `microderme_checkout=${id}.123.legacy` } });
  const fresh = await handle(request());
  assert.equal(fresh.status, 200);
  assert.match(fresh.headers.get('set-cookie'), /^microderme_checkout_firebot=/);
  await store.write(`orders/${id}`, { state: 'ready', status: 'pending', transactionId: 'old-provider-charge' });
  const blocked = await handle(request());
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).error, 'previous_provider_order');
  assert.equal(blocked.headers.get('set-cookie'), null);
  assert.equal(gateway.calls, 0);
});

test('public Firebot key cannot enable a checkout', async () => {
  const handle = createCheckout({ env: { ...testEnv, FIREBOT_API_KEY: 'fire_pk_live_public' }, store: new MemoryStore(), gateway: fakeGateway() });
  assert.equal((await handle(new Request(origin + '/api/session'))).status, 503);
});

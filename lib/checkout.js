import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { AMOUNT, PRODUCT, validateCustomer } from './validation.js';
import { PaymentError } from './quantumpay.js';

const COOKIE = 'microderme_checkout';
const SESSION_MS = 7 * 86400000;
const hash = (value, secret) => createHmac('sha256', secret).update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function verifyWebhook(raw, signature, secret, now = Date.now()) {
  if (!secret || typeof signature !== 'string') return false;
  const parts = signature.split(',').map(p => p.trim().split('='));
  const timestamp = parts.find(p => p[0] === 't')?.[1];
  if (!/^\d{13}$/.test(timestamp ?? '') || Math.abs(now - Number(timestamp)) > 300000) return false;
  const expected = hash(`${timestamp}.${raw}`, secret);
  return parts.some(([key,value]) => key === 'v1' && /^[a-f0-9]{64}$/i.test(value) && equal(value.toLowerCase(), expected));
}
export function createCheckout({ env, store, gateway, now = Date.now, makeId = randomUUID }) {
  const secret = () => env.CHECKOUT_SESSION_SECRET || (env.QUANTUMPAY_API_SECRET ? hash('microderme-session-v1', env.QUANTUMPAY_API_SECRET) : '');
  const ready = () => Boolean(env.QUANTUMPAY_API_KEY && env.QUANTUMPAY_API_SECRET && (env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID) && secret().length >= 32);
  const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store, private', 'Vary': 'Cookie', ...headers } });
  const session = request => {
    const cookie = request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
    if (!cookie) return null;
    const [id, expiry, signature] = cookie.split('.');
    if (!/^[a-f0-9-]{36}$/.test(id ?? '') || !/^\d+$/.test(expiry ?? '') || Number(expiry) <= now() || !equal(signature, hash(`${id}.${expiry}`,secret()))) return null;
    return id;
  };
  const sameOrigin = request => {
    const origin = request.headers.get('origin');
    const current = new URL(request.url).origin;
    return origin === current || Boolean(env.APP_URL && origin === new URL(env.APP_URL).origin);
  };
  async function readOrder(id) { return store.read(`orders/${id}`); }
  async function updateStatus(record, force = false) {
    if (!record?.value.transactionId) return record;
    if (!force && now() - (record.value.checkedAt || 0) < 15000) return record;
    const verified = await gateway.status(record.value.transactionId);
    const latest = await readOrder(record.value.sessionId);
    if (!latest || latest.value.transactionId !== verified.id) throw new PaymentError('transaction_mismatch');
    const next = { ...latest.value, status: verified.status, checkedAt: now() };
    return await store.write(`orders/${next.sessionId}`, next, latest.version) || await readOrder(next.sessionId);
  }
  async function publicOrder(record) {
    if (!record) return { order: null };
    const order = record.value;
    if (order.state === 'creating' || order.state === 'uncertain') return { order: { state: order.state, message: 'Estamos verificando a geração do seu Pix. Não gere outra cobrança. Se a espera continuar, entre em contato com o suporte.' } };
    if (order.state === 'failed') return { order: { state: 'failed', message: 'Não foi possível gerar o Pix. Confira os dados e tente novamente.' } };
    return { order: { state: 'ready', status: order.status, amount: AMOUNT, product: PRODUCT, reference: order.transactionId,
      emv: order.status === 'pending' ? order.emv : undefined,
      qrCode: order.status === 'pending' ? await QRCode.toDataURL(order.emv, { width: 288, margin: 2, errorCorrectionLevel: 'M' }) : undefined,
      expiresAt: order.expiresAt || null } };
  }
  async function rateLimit(request) {
    const ip = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'local';
    const key = `limits/${hash(ip.split(',')[0].trim(), secret()).slice(0,32)}-${Math.floor(now()/600000)}`;
    const record = await store.read(key);
    if ((record?.value.count || 0) >= 5) throw new PaymentError('rate_limited', 429);
    if (!await store.write(key, { count: (record?.value.count || 0)+1 }, record?.version ?? null)) throw new PaymentError('rate_limited', 429);
  }
  return async function handle(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/health') return json({ ok: true, paymentsConfigured: ready() });
      if (!ready()) return json({ error: 'checkout_unavailable', message: 'O pagamento está temporariamente indisponível. Tente novamente em instantes.' }, 503);
      if (path === '/api/session' && request.method === 'GET') {
        if (session(request)) return json({ ready: true });
        const id = makeId(), expiry = now()+SESSION_MS, payload = `${id}.${expiry}`;
        const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
        return json({ ready: true }, 200, { 'Set-Cookie': `${COOKIE}=${payload}.${hash(payload,secret())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}` });
      }
      if (path === '/api/reset' && request.method === 'POST') {
        if (!sameOrigin(request)) return json({error:'forbidden'},403);
        const id=session(request);
        if (!id) return json({error:'session_expired'},401);
        const existing=await updateStatus(await readOrder(id),true);
        if (!['expired','canceled'].includes(existing?.value.status)) return json({error:'active_order',message:'O pedido ainda está ativo. Aguarde a confirmação do pagamento.'},409);
        return json({reset:true},200,{'Set-Cookie':`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${new URL(request.url).protocol==='https:'?'; Secure':''}`});
      }
      if (path === '/api/webhooks/quantumpay' && request.method === 'POST') {
        const raw = await readBody(request, 65536);
        if (!env.QUANTUMPAY_WEBHOOK_SECRET) return json({ error: 'webhook_unconfigured' }, 503);
        if (!verifyWebhook(raw,request.headers.get('quantum-pay-signature'),env.QUANTUMPAY_WEBHOOK_SECRET,now())) return json({ error:'invalid_signature' },401);
        const event=JSON.parse(raw), tx=event.transaction ?? event.data;
        if (!['transaction_paid','transaction_refunded','transaction_updated'].includes(event.event)) return json({ received:true });
        if (!tx?.id || (tx.amountInCents ?? tx.amount) !== AMOUNT) return json({ error:'invalid_transaction' },400);
        const mapping = await store.read(`transactions/${hash(tx.id,secret())}`);
        if (!mapping) return json({ received:true, ignored:true });
        const eventKey = `events/${hash(event.id || `${tx.id}:${event.event}:${tx.status}`,secret())}`;
        if (await store.read(eventKey)) return json({ received:true });
        await updateStatus(await readOrder(mapping.value.sessionId),true);
        await store.write(eventKey,{ processedAt:now() });
        return json({ received:true });
      }
      if (path !== '/api/pix' && path !== '/api/status') return json({ error:'not_found' },404);
      if (!['GET','POST'].includes(request.method) || (path === '/api/status' && request.method !== 'GET')) return json({ error:'method_not_allowed' },405,{ Allow: path === '/api/status' ? 'GET' : 'GET, POST' });
      const id=session(request);
      if (!id) return json({ error:'session_expired', message:'Sua sessão expirou. Atualize a página para continuar.' },401);
      let record=await readOrder(id);
      if (request.method === 'GET') {
        if (record?.value.state === 'ready') record=await updateStatus(record);
        if (path === '/api/status') return json({ status:record?.value.status || 'none', state:record?.value.state || 'none', amount:AMOUNT, reference:record?.value.transactionId || null });
        return json(await publicOrder(record));
      }
      if (!sameOrigin(request)) return json({ error:'forbidden' },403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error:'invalid_content_type' },415);
      const {customer,errors}=validateCustomer(JSON.parse(await readBody(request,8192)));
      if (Object.keys(errors).length) return json({ error:'invalid_customer', errors, message:'Confira os dados destacados abaixo.' },422);
      const customerHash=hash(JSON.stringify(customer),secret());
      if (record && record.value.state !== 'failed') {
        if (record.value.customerHash !== customerHash) return json({ error:'existing_order',message:'Já existe um Pix nesta sessão. Recarregue a página para acompanhar o pagamento.' },409);
        return json(await publicOrder(await updateStatus(record)));
      }
      await rateLimit(request);
      const token=await gateway.token(); // Authenticate before claiming the order.
      const initial={ sessionId:id, customerHash, state:'creating', createdAt:now() };
      const claim=await store.write(`orders/${id}`,initial,record?.version ?? null);
      if (!claim) return json({ error:'in_progress',message:'Seu Pix já está sendo gerado. Aguarde alguns instantes.' },409);
      let transaction;
      try {
        transaction=await gateway.create(customer,id,token);
      } catch(error) {
        await store.write(`orders/${id}`, { ...initial,state:error.uncertain ? 'uncertain':'failed' },claim.version);
        throw error;
      }
      // Persist BEFORE returning the QR; repeating the request never creates a second Pix.
      const saved=await store.write(`orders/${id}`,{ ...initial,state:'ready',transactionId:transaction.id,status:'pending',emv:transaction.pix.emv,checkedAt:0,
        expiresAt:transaction.expiresAt || transaction.pix.expiresAt || null },claim.version);
      if (!saved) throw new PaymentError('order_persistence_failed',503,true);
      await store.write(`transactions/${hash(transaction.id,secret())}`,{sessionId:id});
      return json(await publicOrder(saved),201);
    } catch(error) {
      if (error instanceof SyntaxError) return json({error:'invalid_json',message:'Não foi possível ler os dados enviados.'},400);
      const status=error.status || 503;
      // Never log customer details, API responses, keys, EMV or request bodies.
      console.error(JSON.stringify({event:'checkout_error',code:error.code || 'internal_error',status}));
      return json({error:error.code || 'service_unavailable',message:error.uncertain ? 'Não foi possível confirmar a geração do Pix. Aguarde e recarregue a página; não gere uma segunda cobrança.' : status===429 ? 'Muitas tentativas. Aguarde um minuto antes de tentar novamente.' : 'Não foi possível concluir agora. Tente novamente em instantes.'},status,{'Retry-After':status===429?'60':'15'});
    }
  };
}
async function readBody(request,limit) {
  if (Number(request.headers.get('content-length') || 0)>limit) throw new PaymentError('body_too_large',413);
  const reader=request.body?.getReader(); if (!reader) return '';
  const chunks=[]; let size=0;
  while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>limit){await reader.cancel();throw new PaymentError('body_too_large',413);} chunks.push(Buffer.from(value)); }
  return Buffer.concat(chunks).toString('utf8');
}

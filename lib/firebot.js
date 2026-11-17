import { createHash } from 'node:crypto';
import { AMOUNT, PRODUCT } from './validation.js';
import { PaymentError } from './payment-error.js';

const BASE_URL = 'https://firebotbr.com/api/v1';
const STATUSES = Object.freeze({
  PENDING: 'pending', PAID: 'paid', REFUNDED: 'refunded',
  CANCELED: 'canceled', CANCELLED: 'canceled', EXPIRED: 'expired', FAILED: 'failed',
});

export function amountInCents(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && Math.abs(amount * 100 - cents) < 0.000001 ? cents : null;
}

export function validTransactionId(id) {
  return typeof id === 'string' && /^fire_tx_[A-Za-z0-9_-]{1,180}$/.test(id);
}

export class Firebot {
  constructor({ env, store, fetcher = fetch, now = Date.now }) {
    Object.assign(this, { env, store, fetcher, now });
  }

  async request(path, options = {}) {
    const creating = options.method === 'POST';
    try {
      const response = await this.fetcher(`${BASE_URL}${path}`, {
        ...options,
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json',
          'x-api-key': this.env.FIREBOT_API_KEY?.trim(),
        },
        redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      // Never print provider bodies: they may contain customer data or secrets.
      if (!response.ok) {
        throw new PaymentError(`provider_${response.status}`, response.status === 429 ? 429 : 502,
          creating && (response.status >= 500 || response.status === 408));
      }
      let data;
      try { data = await response.json(); }
      catch { throw new PaymentError('provider_invalid_response', 502, creating); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PaymentError('provider_invalid_response', 502, creating);
      if (data.success === false || data.error) throw new PaymentError('provider_rejected', 502, creating);
      return data;
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      throw new PaymentError('provider_unavailable', 502, creating);
    }
  }

  async prepare() {
    // A private, short-lived readiness cache, separated by API key, stores no key.
    const keyId = createHash('sha256').update(this.env.FIREBOT_API_KEY?.trim() || '').digest('hex');
    const cacheKey = `auth/firebot-${keyId}`;
    const cached = await this.store.read(cacheKey);
    if (cached?.value.expiresAt > this.now()) return;
    await this.request('/auth');
    await this.store.write(cacheKey, { expiresAt: this.now() + 300000 }, cached?.version ?? null);
  }

  async create(customer, reference) {
    const source = new URL(this.env.APP_URL || 'https://black-microderme.vercel.app');
    if (source.protocol !== 'https:' || source.username || source.password) throw new PaymentError('invalid_store_url', 503);
    const result = await this.request('/pix/create', {
      method: 'POST',
      body: JSON.stringify({
        amount: AMOUNT / 100, productType: 'DIGITAL',
        description: `${PRODUCT} - ${reference}`, storeUrl: new URL('/checkout', source).href,
        customer: { name: customer.name, email: customer.email, cpf: customer.document, phone: customer.phone },
        qrStyle: 'plain',
      }),
    });
    const tx = result.data ?? result;
    if (!validTransactionId(tx.transactionId) || amountInCents(tx.amount) !== AMOUNT ||
      !['PENDING', 'PAID'].includes(tx.status) || typeof tx.pixCopiaECola !== 'string' ||
      !tx.pixCopiaECola.trim() || tx.pixCopiaECola.length > 8192) {
      throw new PaymentError('provider_invalid_charge', 502, true);
    }
    return { id: tx.transactionId, status: STATUSES[tx.status], pix: { emv: tx.pixCopiaECola }, expiresAt: tx.expiresAt || null };
  }

  async status(id) {
    if (!validTransactionId(id)) throw new PaymentError('transaction_mismatch');
    const result = await this.request(`/pix/${encodeURIComponent(id)}`);
    const tx = result.data ?? result;
    const amount = amountInCents(tx.amount);
    const status = Object.hasOwn(STATUSES, tx.status) ? STATUSES[tx.status] : undefined;
    if (tx.transactionId !== id || amount !== AMOUNT || !status) throw new PaymentError('transaction_mismatch');
    return { id: tx.transactionId, amount, status };
  }
}

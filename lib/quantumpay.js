import { AMOUNT, PRODUCT } from './validation.js';

export class PaymentError extends Error {
  constructor(code, status = 502, uncertain = false) { super(code); this.code = code; this.status = status; this.uncertain = uncertain; }
}
export class QuantumPay {
  constructor({ env, store, fetcher = fetch, now = Date.now }) { Object.assign(this, { env, store, fetcher, now }); }
  async request(path, options) {
    try {
      const response = await this.fetcher(`https://api.quantumpay.com.br${path}`, { ...options, signal: AbortSignal.timeout(20000) });
      let data;
      try { data = await response.json(); } catch { throw new PaymentError('provider_invalid_response', 502, true); }
      if (!response.ok || data.success === false) throw new PaymentError(`provider_${response.status}`, response.status === 429 ? 429 : 502, response.status >= 500 || response.status === 408);
      return data;
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      throw new PaymentError('provider_unavailable', 502, true);
    }
  }
  async token() {
    const cached = await this.store.read('auth/token');
    if (cached?.value.token && cached.value.expiresAt > this.now()) return cached.value.token;
    const lock = await this.store.read('auth/lock');
    if (lock && lock.value.until > this.now()) throw new PaymentError('authentication_busy', 503);
    if (!await this.store.write('auth/lock', { until: this.now() + 25000 }, lock?.version ?? null)) throw new PaymentError('authentication_busy', 503);
    try {
      const auth = Buffer.from(`${this.env.QUANTUMPAY_API_KEY}:${this.env.QUANTUMPAY_API_SECRET}`).toString('base64');
      const result = await this.request('/api/auth', { method: 'POST', headers: { Authorization: `Basic ${auth}` } });
      if (!result.token || !Number.isFinite(result.expiresIn)) throw new PaymentError('authentication_invalid');
      const fresh = await this.store.read('auth/token');
      await this.store.write('auth/token', { token: result.token, expiresAt: this.now() + Math.min(result.expiresIn, 1800000) - 60000 }, fresh?.version ?? null);
      return result.token;
    } finally {
      const current = await this.store.read('auth/lock');
      if (current) await this.store.write('auth/lock', { until: 0 }, current.version);
    }
  }
  async authenticated(path, { token, ...options }) {
    return this.request(path, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  }
  async create(customer, reference, token) {
    const data = { amountInCents: AMOUNT, description: `${PRODUCT} - ${reference}`, customer,
      items: [{ title: PRODUCT, tangible: false, quantity: 1, amountInCents: AMOUNT }] };
    if (this.env.QUANTUMPAY_POSTBACK_URL) data.postbackUrl = this.env.QUANTUMPAY_POSTBACK_URL;
    const result = await this.authenticated('/api/v1/pix/in/qrcode', { method: 'POST', token, body: JSON.stringify(data) });
    const transaction = result.data;
    if (!transaction?.id || !transaction.pix?.emv || !['pending','paid'].includes(transaction.status)) throw new PaymentError('provider_invalid_charge', 502, true);
    return transaction;
  }
  async status(id) {
    let token = await this.token();
    let result;
    try { result = await this.authenticated(`/api/v1/transactions/${encodeURIComponent(id)}`, { method: 'GET', token }); }
    catch (error) {
      if (error.code !== 'provider_401') throw error;
      const cached = await this.store.read('auth/token');
      if (cached) await this.store.write('auth/token', { expiresAt: 0 }, cached.version);
      token = await this.token();
      result = await this.authenticated(`/api/v1/transactions/${encodeURIComponent(id)}`, { method: 'GET', token });
    }
    const tx = result.data ?? result;
    // The overview uses amount; other examples use amountInCents. Both are cents.
    const amount = tx.amountInCents ?? tx.amount;
    if (tx.id !== id || amount !== AMOUNT || !['pending','paid','canceled','expired','refunded','failed'].includes(tx.status)) throw new PaymentError('transaction_mismatch');
    return { status: tx.status, amount, id: tx.id };
  }
}

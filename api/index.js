import { BlobStore } from '../lib/store.js';
import { QuantumPay } from '../lib/quantumpay.js';
import { createCheckout } from '../lib/checkout.js';

const store = new BlobStore();
const gateway = new QuantumPay({ env: process.env, store });
const handle = createCheckout({ env: process.env, store, gateway });
export const GET = handle;
export const POST = handle;

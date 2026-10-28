import { centsToAmount } from './policy.mjs';

const BASE = 'https://api-m.sandbox.paypal.com';

export class PayPalSandbox {
  constructor({ clientId = process.env.PAYPAL_CLIENT_ID, clientSecret = process.env.PAYPAL_CLIENT_SECRET, fetchImpl = fetch } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.cachedToken = null;
    this.expiresAt = 0;
  }
  get configured() { return Boolean(this.clientId && this.clientSecret); }
  async token() {
    if (!this.configured) throw new Error('PayPal Sandbox credentials are not configured');
    if (this.cachedToken && Date.now() < this.expiresAt - 60000) return this.cachedToken;
    const response = await this.fetch(`${BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new Error(`PayPal OAuth failed (${response.status})`);
    this.cachedToken = data.access_token;
    this.expiresAt = Date.now() + (data.expires_in || 300) * 1000;
    return this.cachedToken;
  }
  async request(method, path, body, requestId) {
    const headers = { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    if (requestId) headers['PayPal-Request-Id'] = requestId;
    const response = await this.fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`PayPal ${method} ${path} failed (${response.status}): ${data.name || data.message || 'Unknown error'}`);
    return data;
  }
  async createOrder(caseData, returnUrl, cancelUrl, requestId) {
    const data = await this.request('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: caseData.id, custom_id: `remedydesk-${caseData.id}`, description: `RemedyDesk sandbox service payment for ${caseData.plan}`, amount: { currency_code: caseData.currency, value: centsToAmount(caseData.priceCents) } }],
      payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: returnUrl, cancel_url: cancelUrl } } }
    }, requestId);
    const approveUrl = data.links?.find(link => link.rel === 'payer-action' || link.rel === 'approve')?.href;
    if (!data.id || !approveUrl) throw new Error('PayPal did not return an order and buyer approval URL');
    return { id: data.id, approveUrl };
  }
  async captureOrder(orderId, requestId) {
    const data = await this.request('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, requestId);
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    if (data.status !== 'COMPLETED' || capture?.status !== 'COMPLETED' || !capture.id) throw new Error('PayPal capture is not completed');
    return { orderId: data.id, captureId: capture.id, amount: capture.amount };
  }
  async getCapture(captureId) { return this.request('GET', `/v2/payments/captures/${encodeURIComponent(captureId)}`); }
  async refund(captureId, cents, currency, requestId) {
    return this.request('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      amount: { value: centsToAmount(cents), currency_code: currency },
      note_to_payer: 'Service recovery refund for a documented interruption.'
    }, requestId);
  }
}

/**
 * paypal.js — PayPal Orders API v2 integration (sandbox).
 *
 * Requires env: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE (default 'sandbox').
 *
 * Exports:
 *   - isConfigured()
 *   - createOrder(bookingId, amount, currency='USD', description)
 *   - captureOrder(orderId)
 */

'use strict';

// Proxy-aware fetch: route through the egress proxy when present (sandboxed runtimes).
let _proxyDispatcher = null;
function proxiedFetch(url, init) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxyUrl) {
    try {
      if (!_proxyDispatcher) {
        const { ProxyAgent, fetch: undiciFetch } = require('undici');
        _proxyDispatcher = { ProxyAgent, undiciFetch, dispatcher: new ProxyAgent(proxyUrl) };
      }
      return _proxyDispatcher.undiciFetch(url, { ...init, dispatcher: _proxyDispatcher.dispatcher });
    } catch {
      // fall through to default fetch
    }
  }
  return fetch(url, init);
}

function baseUrl() {
  const mode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
  return mode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

/** True when PayPal credentials are configured. */
function isConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
}

// ---------------------------------------------------------------------------
// OAuth2 client-credentials token (cached in memory until expiry)
// ---------------------------------------------------------------------------

let tokenCache = { token: null, expiresAt: 0 };

/**
 * Get a PayPal access token via client-credentials grant.
 * @returns {Promise<string>} access token
 */
async function getAccessToken() {
  if (!isConfigured()) {
    throw new Error('paypal_not_configured: set PAYPAL_CLIENT_ID and PAYPAL_SECRET in .env');
  }
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }
  const creds = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString('base64');

  const res = await proxiedFetch(`${baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`paypal_token_failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('paypal_token_failed: no access_token in response');
  }
  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

// ---------------------------------------------------------------------------
// Orders API v2
// ---------------------------------------------------------------------------

/**
 * Create a PayPal order (deposit) for a booking.
 *
 * @param {string} bookingId  — our booking reference id
 * @param {number} amount     — amount in major currency units (e.g. 25)
 * @param {string} [currency='USD']
 * @param {string} [description='Booking deposit']
 * @returns {Promise<{order_id:string,approval_url:string,status:string,mode:string}>}
 */
async function createOrder(bookingId, amount, currency = 'USD', description = 'Booking deposit') {
  const token = await getAccessToken();
  const value = Number(amount).toFixed(2);

  const res = await proxiedFetch(`${baseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: String(bookingId),
          description: String(description),
          amount: { currency_code: currency, value },
        },
      ],
      application_context: {
        return_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
        brand_name: 'Vidal Booking AI',
        user_action: 'PAY_NOW',
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data.details && data.details[0] && data.details[0].description) || data.message || '';
    throw new Error(`paypal_create_order_failed: HTTP ${res.status} ${detail}`.trim());
  }

  const approveLink = (data.links || []).find((l) => l.rel === 'approve');
  if (!approveLink || !approveLink.href) {
    throw new Error('paypal_create_order_failed: no approval URL in response');
  }

  return {
    order_id: data.id,
    approval_url: approveLink.href,
    status: data.status,
    mode: (process.env.PAYPAL_MODE || 'sandbox').toLowerCase(),
  };
}

/**
 * Capture a PayPal order after the customer approved it.
 *
 * @param {string} orderId — PayPal order id
 * @returns {Promise<{order_id:string,status:string,capture_id:string|null,raw:object}>}
 */
async function captureOrder(orderId) {
  if (!orderId) throw new Error('paypal_capture_failed: orderId is required');
  const token = await getAccessToken();

  const res = await proxiedFetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data.details && data.details[0] && data.details[0].description) || data.message || '';
    throw new Error(`paypal_capture_failed: HTTP ${res.status} ${detail}`.trim());
  }

  let captureId = null;
  try {
    const pu = (data.purchase_units || [])[0] || {};
    const cap = (pu.payments && pu.payments.captures && pu.payments.captures[0]) || {};
    captureId = cap.id || null;
  } catch {
    captureId = null;
  }

  return {
    order_id: data.id,
    status: data.status,
    capture_id: captureId,
    raw: data,
  };
}

module.exports = { createOrder, captureOrder, isConfigured, getAccessToken };

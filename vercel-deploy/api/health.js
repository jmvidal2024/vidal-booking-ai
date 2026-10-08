/**
 * api/health.js — Vercel serverless function.
 *
 * GET -> { ok, service, openai, paypal, paypal_mode }
 */

'use strict';

module.exports = async (req, res) => {
  return res.status(200).json({
    ok: true,
    service: 'vidal-booking-ai',
    openai: Boolean(process.env.OPENAI_API_KEY),
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET),
    paypal_mode: process.env.PAYPAL_MODE || 'sandbox',
  });
};

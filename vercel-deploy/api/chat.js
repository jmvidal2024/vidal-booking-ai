/**
 * api/chat.js — Vercel serverless function.
 *
 * POST { session_id?, message } -> { reply, session_id, paypal_url? }
 *
 * The conversational logic lives in ../lib/agent.js (OpenAI function calling
 * + booking engine + PayPal Orders API v2).
 */

'use strict';

const { chat } = require('../lib/agent');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const { session_id, message } = body;

  if (typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }

  // session_id is optional; generate one when missing.
  const sid =
    typeof session_id === 'string' && session_id.trim()
      ? session_id.trim()
      : `sess_${Date.now().toString(36)}`;

  try {
    const result = await chat(sid, message.trim());
    return res.status(200).json(result);
  } catch (err) {
    console.error('[chat] error:', err.message);
    return res.status(500).json({ error: 'agent_error', detail: err.message });
  }
};

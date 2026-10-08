/**
 * server.js — Express API for the Vidal Booking AI Agent.
 *
 * Endpoints:
 *   GET  /health          — liveness check
 *   POST /api/chat        — { session_id, message } -> { reply, session_id }
 *
 * Run:  npm install && cp .env.example .env && npm start
 */

'use strict';

require('dotenv').config();

const express = require('express');
const { chat } = require('./agent');

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Simple CORS (hackathon demo; tighten in production).
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '256kb' }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'vidal-booking-ai',
    openai: Boolean(process.env.OPENAI_API_KEY),
    paypal: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET),
    paypal_mode: process.env.PAYPAL_MODE || 'sandbox',
  });
});

app.post('/api/chat', async (req, res) => {
  const { session_id, message } = req.body || {};

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
    return res.json(result);
  } catch (err) {
    console.error('[chat] error:', err.message);
    return res.status(500).json({ error: 'agent_error', detail: err.message });
  }
});

// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Vidal Booking AI backend listening on http://localhost:${PORT}`);
  console.log(`  OpenAI: ${process.env.OPENAI_API_KEY ? 'configured' : 'MISSING (set OPENAI_API_KEY)'}`);
  console.log(`  PayPal: ${process.env.PAYPAL_CLIENT_ID ? 'configured' : 'stub mode (no credentials yet)'}`);
});

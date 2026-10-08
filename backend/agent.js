/**
 * agent.js — Conversational booking agent powered by OpenAI function calling.
 *
 * Flow:
 *   1. Client sends { session_id, message }.
 *   2. We keep a per-session message history.
 *   3. We run an OpenAI chat-completion loop: model may call tools,
 *      we execute them against booking.js / paypal.js, feed results back,
 *      and return the final assistant reply.
 *   4. Language: the system prompt tells the model to detect the user's
 *      language (Spanish or English) and reply in the same one.
 */

'use strict';

const openaiModule = require('openai');
const booking = require('./booking');
const paypal = require('./paypal');

/** Lazy OpenAI client: server boots without a key; chat() throws a clean error instead. */
let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    const opts = { apiKey: process.env.OPENAI_API_KEY };
    // Route through the egress proxy when present (sandboxed runtimes).
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
    if (proxyUrl) {
      try {
        const { ProxyAgent, fetch: undiciFetch } = require('undici');
        const dispatcher = new ProxyAgent(proxyUrl);
        opts.fetch = (url, init) => undiciFetch(url, { ...init, dispatcher });
      } catch {
        // undici not installed; fall back to default fetch.
      }
    }
    _client = new openaiModule.OpenAI(opts);
  }
  return _client;
}

const SYSTEM_PROMPT = `You are "Vidal", a friendly and efficient booking assistant for a barbershop.
Your job: help the customer pick a service, find an available slot, book it, and take a PayPal deposit.

RULES:
- Detect the user's language (Spanish or English) from their messages and ALWAYS reply in that same language.
- Collect information step by step; do not ask for everything at once. Order: 1) service, 2) date, 3) time, 4) name, 5) phone.
- When the user mentions a date in words ("tomorrow", "mañana", "Friday"), convert it to YYYY-MM-DD yourself using today's date.
- Before creating a booking, ALWAYS check availability first and offer the free slots.
- After creating the booking, ALWAYS create a PayPal order and give the customer the approval URL so they can pay the deposit.
- Keep replies short, warm and conversational. No bullet dumps unless listing services or slots.
- If a tool returns an error, explain it in plain language and suggest an alternative.
- Never invent prices or slots; only use what the tools return.
- Today's date is provided in the context of each message.

QUICK REPLIES (tappable buttons — the user taps instead of typing). MANDATORY RULE:
Every time you present the user with a choice, you MUST call show_quick_replies
in the SAME turn, BEFORE writing your text reply. Never present services, days,
or time slots as plain text only. Use ONLY data returned by the tools for
labels, names and prices — never invent them and never copy them from examples.
- After calling list_services: call show_quick_replies with one button per
  service. The LABEL is numbered for the user ("1. <name> ($<price>)"); the
  VALUE must be the real service_id from list_services (e.g. "svc_corte") so a
  tap works directly as a tool argument. Use the real names and prices from
  list_services, in the user's language.
- When asking which day: call show_quick_replies with Hoy (value "hoy"),
  Mañana (value "mañana"), Otro día (value "otro"). In English: Today ("today"),
  Tomorrow ("tomorrow"), Another day ("other"). ALWAYS ask the day explicitly
  after the service is chosen — never assume a date. NOTE: check_availability
  will refuse with day_not_selected until the user picks a day, so asking first
  is not optional.
- After calling check_availability: call show_quick_replies with the free
  slots: LABEL in 12h format ("10:30 AM"), VALUE in 24h format as returned by
  the tool ("10:30"), max 6 options.
- A tapped reply ("svc_corte", "mañana", "10:30") IS a valid selection for that
  step: use the service_id directly, convert the day word to YYYY-MM-DD using
  today's date, use the 24h time directly. Do NOT ask for it again.`;

// ---------------------------------------------------------------------------
// Tool definitions (OpenAI function calling)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_services',
      description: 'List the available barbershop services with id, name and price.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Check free time slots for a service on a date.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: 'Service id, e.g. svc_corte' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        },
        required: ['service_id', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_booking',
      description: 'Create a booking for a free slot. Call only after check_availability.',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM 24h format' },
          customer_name: { type: 'string' },
          customer_phone: { type: 'string' },
        },
        required: ['service_id', 'date', 'time', 'customer_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_paypal_order',
      description: 'Create a PayPal order (deposit) for an existing booking. Returns an approval URL for the customer to pay.',
      parameters: {
        type: 'object',
        properties: {
          booking_id: { type: 'string' },
          amount: { type: 'number', description: 'Amount in USD' },
        },
        required: ['booking_id', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_quick_replies',
      description: 'Show tappable quick-reply buttons to the user. Call after listing services (numbered options), when asking for the day, or after check_availability (free slots). Returns ok:true; the tapped value arrives as the next user message.',
      parameters: {
        type: 'object',
        properties: {
          options: {
            type: 'array',
            description: 'Up to 6 buttons.',
            maxItems: 6,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Text shown on the button' },
                value: { type: 'string', description: 'Text sent as the user message when tapped' },
              },
              required: ['label', 'value'],
            },
          },
        },
        required: ['options'],
      },
    },
  },
];

/**
 * Execute a tool call and return the JSON-serializable result.
 */
async function runTool(name, args) {
  switch (name) {
    case 'list_services':
      return { services: booking.listServices() };
    case 'check_availability':
      return booking.checkAvailability(args.service_id, args.date);
    case 'create_booking':
      return booking.createBooking({
        service_id: args.service_id,
        date: args.date,
        time: args.time,
        customer_name: args.customer_name,
        customer_phone: args.customer_phone || '',
      });
    case 'create_paypal_order': {
      const bk = booking.getBooking(args.booking_id);
      if (!bk) return { error: 'booking_not_found' };
      const order = await paypal.createOrder(args.booking_id, args.amount);
      return { booking_id: args.booking_id, ...order };
    }
    case 'show_quick_replies':
      return { ok: true };
    default:
      return { error: `unknown_tool:${name}` };
  }
}

// ---------------------------------------------------------------------------
// Session memory (in-memory; fine for demo/hackathon)
// ---------------------------------------------------------------------------

const sessions = new Map(); // session_id -> [{role, content}]

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

// ---------------------------------------------------------------------------
// Main entry: process one user message
// ---------------------------------------------------------------------------

const MAX_TOOL_ROUNDS = 6;

/**
 * @param {string} sessionId
 * @param {string} message
 * @returns {Promise<{reply:string,session_id:string,paypal_url?:string,quick_replies?:Array<{label:string,value:string}>}>}
 */
async function chat(sessionId, message) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const history = getHistory(sessionId);
  const today = new Date().toISOString().slice(0, 10);

  history.push({ role: 'user', content: message });

  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\nToday's date: ${today}.` },
    ...history.slice(-20), // keep the last 20 turns
  ];

  // Track the latest PayPal approval URL for the frontend button,
  // and the latest quick-reply options to render as tappable chips.
  let lastPaypalUrl = null;
  let lastQuickReplies = null;

  /**
   * Validate and normalize a show_quick_replies payload.
   * @returns {Array<{label:string,value:string}>|null}
   */
  function sanitizeQuickReplies(raw) {
    if (!raw || !Array.isArray(raw.options)) return null;
    const out = [];
    for (const opt of raw.options.slice(0, 6)) {
      if (!opt || typeof opt !== 'object') continue;
      const label = String(opt.label || '').trim().slice(0, 60);
      const value = String(opt.value != null ? opt.value : '').trim().slice(0, 200);
      if (!label || !value) continue;
      out.push({ label, value });
    }
    return out.length ? out : null;
  }

  /**
   * Heuristic: is this conversation in Spanish? Used for auto-generated
   * quick-reply labels when the model forgets show_quick_replies.
   */
  function looksSpanish(msgs) {
    const text = msgs
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => m.content)
      .join(' ')
      .toLowerCase();
    return /[áéíóúñ¿¡]|\b(hola|gracias|quiero|mañana|servicio|cita|reserva|barber|corte|por favor|qué|está|tienes|dime)\b/.test(text);
  }

  /** "14:30" -> "2:30 PM" for quick-reply labels. */
  function formatTime12h(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return String(hhmm);
    let h = parseInt(m[1], 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m[2]} ${ampm}`;
  }

  /**
   * Did the user explicitly choose a day? (hoy/mañana/day name/explicit date).
   * "otro día" alone does NOT count — a specific date is required.
   */
  function userChoseDay(msgs) {
    const re = /\b(hoy|mañana|manana|tomorrow|today|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/i;
    return msgs
      .filter(m => m.role === 'user' && typeof m.content === 'string')
      .slice(-4)
      .some(m => re.test(m.content));
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.4,
    });

    const choice = completion.choices[0];
    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      const reply = assistantMsg.content || '';
      history.push({ role: 'assistant', content: reply });
      const result = { reply, session_id: sessionId };
      if (lastPaypalUrl) result.paypal_url = lastPaypalUrl;
      if (lastQuickReplies) result.quick_replies = lastQuickReplies;
      return result;
    }

    // Execute tool calls and feed results back to the model.
    for (const call of assistantMsg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      let result;
      try {
        // Gate: never check availability until the user explicitly chose a day.
        if (call.function.name === 'check_availability' && !userChoseDay(messages)) {
          result = {
            error: 'day_not_selected',
            hint: 'The user has not chosen a day yet. Ask which day with show_quick_replies (Hoy/hoy, Mañana/mañana, Otro día/otro — or Today/Tomorrow/Another day in English) and only then call check_availability.',
          };
        } else {
          result = await runTool(call.function.name, args);
        }
      } catch (err) {
        result = { error: err.message || 'tool_failed' };
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
      // Capture PayPal approval URL for the frontend button.
      if (call.function.name === 'create_paypal_order' && result && result.approval_url) {
        lastPaypalUrl = result.approval_url;
      }
      // Capture quick-reply options for the frontend chips.
      if (call.function.name === 'show_quick_replies') {
        const clean = sanitizeQuickReplies(args);
        if (clean) lastQuickReplies = clean;
      }
      // Deterministic safety net: if the model forgot show_quick_replies
      // (or sent invalid options), auto-build the buttons from
      // list_services / check_availability data.
      if (result && result.error === 'day_not_selected') {
        const spanish = looksSpanish(messages);
        lastQuickReplies = spanish
          ? [{ label: 'Hoy', value: 'hoy' }, { label: 'Mañana', value: 'mañana' }, { label: 'Otro día', value: 'otro' }]
          : [{ label: 'Today', value: 'today' }, { label: 'Tomorrow', value: 'tomorrow' }, { label: 'Another day', value: 'other' }];
      }
      if (!lastQuickReplies && call.function.name === 'list_services' && result && Array.isArray(result.services) && result.services.length) {
        const spanish = looksSpanish(messages);
        lastQuickReplies = result.services.slice(0, 6).map((s, i) => ({
          label: `${i + 1}. ${spanish ? (s.name_es || s.name) : s.name} ($${s.price})`,
          value: s.id,
        }));
      }
      if (!lastQuickReplies && call.function.name === 'check_availability' && result && Array.isArray(result.slots) && result.slots.length) {
        lastQuickReplies = result.slots.slice(0, 6).map(t => ({
          label: formatTime12h(t),
          value: t,
        }));
      }
    }
  }

  const fallback = 'Sorry, I had trouble processing that. Could you try again?';
  history.push({ role: 'assistant', content: fallback });
  const fb = { reply: fallback, session_id: sessionId };
  if (lastPaypalUrl) fb.paypal_url = lastPaypalUrl;
  if (lastQuickReplies) fb.quick_replies = lastQuickReplies;
  return fb;
}

module.exports = { chat };

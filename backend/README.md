# Vidal Booking AI Agent — Backend

Conversational booking agent (Node.js + Express + OpenAI function calling) for the **PayPal AI Hackathon**.
The agent chats with the customer in Spanish or English, picks a service, finds a slot,
creates the booking, and generates a PayPal deposit order.

## Setup

```bash
cd backend
npm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY
npm start
```

Server runs on `http://localhost:3001`.

## API

### `GET /health`
Liveness + config status.

```bash
curl http://localhost:3001/health
```

### `POST /api/chat`
Chat with the agent. `session_id` is optional (generated when missing);
send the same `session_id` to keep conversation context.

```bash
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"demo1","message":"Hola, quiero un corte de cabello"}'
```

Full booking flow example (replace the date with a real upcoming one):

```bash
# 1. Ask for services
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"demo1","message":"what services do you have?"}'

# 2. Check a date
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"demo1","message":"I want a haircut tomorrow afternoon"}'

# 3. Give name + phone to confirm, the agent books and returns a PayPal link
curl -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"demo1","message":"My name is Juan Perez, phone 3055551234, book the 2pm slot"}'
```

## Tools (OpenAI function calling)

| Tool | What it does |
|---|---|
| `list_services` | Returns demo services (Corte $25, Afeitado $15, Corte+Barba $35) |
| `check_availability(service_id, date)` | Free 30-min slots 9am–6pm for a date (YYYY-MM-DD) |
| `create_booking(service_id, date, time, customer_name, customer_phone)` | Creates the booking, returns `booking_id` |
| `create_paypal_order(booking_id, amount)` | **STUB** — returns a fake sandbox approval URL until `PAYPAL_CLIENT_ID`/`PAYPAL_SECRET` are set |

## Files

- `server.js` — Express app, CORS, `/health` + `/api/chat`
- `agent.js` — OpenAI chat loop, tool definitions, per-session history
- `booking.js` — in-memory demo booking engine
- `paypal.js` — PayPal stub with TODO notes for the sandbox Orders API v2

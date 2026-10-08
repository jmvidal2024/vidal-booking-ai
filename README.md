# Vidal Booking AI Agent

AI-powered conversational booking agent with PayPal deposits.

Built for the **PayPal AI Hackathon 2026** — "Build What's Next with PayPal and AI".

## What it does

A customer chats with an AI agent in natural language (Spanish/English):
1. The agent understands what service they want and when
2. Checks real availability and offers slots
3. Creates the booking
4. Collects a deposit via PayPal

No forms, no calendars to navigate — just conversation.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ Chat Widget │────▶│  AI Agent    │────▶│   Booking   │
│ (frontend)  │◀────│  (Node.js +  │◀────│   Engine    │
└─────────────┘     │   OpenAI)    │     └─────────────┘
                    │              │
                    │              │     ┌─────────────┐
                    └──────────────┼────▶│   PayPal    │
                                   │     │  Orders API │
                                   │     └─────────────┘
```

## Tech

- **AI**: OpenAI function calling (GPT) — the agent uses tools to check availability, create bookings
- **PayPal**: Orders API v2 (sandbox) — deposit collection via PayPal Checkout
- **Backend**: Node.js + Express
- **Frontend**: Vanilla JS chat widget

## Status

🚧 In development for hackathon submission (deadline: Nov 12, 2026)

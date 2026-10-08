# Deploy — Vidal Booking AI Agent

## Backend (Node.js)

Requirements: Node 18+, env vars from `backend/.env.example`.

```bash
cd backend
npm install
cp .env.example .env   # fill in OPENAI_API_KEY, PAYPAL_CLIENT_ID, PAYPAL_SECRET
npm start              # listens on PORT (default 3001)
```

Docker:

```bash
cd backend
docker build -t vidal-booking-ai .
docker run -p 3001:3001 --env-file .env vidal-booking-ai
```

One-click options: Railway, Render, or Fly.io — all detect the Dockerfile
automatically. Set the env vars in the platform dashboard.

## Frontend (static)

`frontend/index.html` is fully self-contained (no build step).

1. Open it and set `API_URL` to your backend URL
   (default: `http://localhost:3001/api/chat`).
2. Deploy to Netlify, Vercel, GitHub Pages, or any static host —
   just upload the single file.

## Demo flow for the video

1. "Quiero un corte mañana a las 10am" → agent checks availability
2. Confirm name + phone → booking created
3. PayPal sandbox order created → "Pagar depósito con PayPal" button
4. Pay with a PayPal sandbox buyer account

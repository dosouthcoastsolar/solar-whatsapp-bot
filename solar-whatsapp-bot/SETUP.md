# D&O South Coast Solar — WhatsApp Lead Bot Setup

## How it works

When a lead comes in, you (or your website) trigger the bot with their number.
The bot sends them a WhatsApp message and guides them through four steps:

1. **Confirm property address**
2. **Energy consumption** (from their energy bill)
3. **Goals** (lower bills, battery, EV charging, etc.)
4. **Book their survey** — bot sends your Microsoft Bookings link so they self-book

All captured data is saved and viewable in the admin dashboard.

---

## Step 1 — Twilio account

1. Sign up at **twilio.com** (free trial gives you enough to test)
2. Go to **Console → Account Info** and copy:
   - Account SID
   - Auth Token
3. Go to **Messaging → Senders → WhatsApp Senders**
4. For testing: use the **Sandbox** (instant, no approval needed)
   - The sandbox number is `+1 415 523 8886`
   - Customers text `join <your-keyword>` to that number to opt in
5. For live use: click **Request Access** to get an approved WhatsApp number (takes 1–3 days, requires a Facebook Business account)

---

## Step 2 — Microsoft Bookings link

1. In Outlook/Microsoft 365, open **Bookings**
2. Create a service called "Free Solar Survey" with your available times
3. Go to **Settings → Bookings page** and copy the public booking URL
4. Paste it into your `.env` file as `BOOKING_LINK`

---

## Step 3 — Install and configure

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file
cp .env.example .env

# 3. Edit .env with your real values
#    - TWILIO_ACCOUNT_SID
#    - TWILIO_AUTH_TOKEN
#    - TWILIO_WHATSAPP_NUMBER  (+14155238886 for sandbox)
#    - BOOKING_LINK            (your Microsoft Bookings URL)
#    - ADMIN_PASSWORD          (any password you choose)
```

---

## Step 4 — Run the server

```bash
node server.js
```

---

## Step 5 — Expose to the internet (for Twilio webhook)

Twilio needs to reach your server. The easiest option during testing:

```bash
# Install ngrok (one-time)
npm install -g ngrok

# In a second terminal
ngrok http 3000
```

Copy the `https://xxxx.ngrok.io` URL.

In **Twilio Console → Messaging → Sandbox Settings** (or your WhatsApp sender settings),
set the **"When a message comes in"** webhook to:

```
https://xxxx.ngrok.io/webhook
```

Method: **HTTP POST**

For permanent hosting, deploy to **Railway**, **Render**, or **Heroku** and use the live URL as the webhook.

---

## Step 6 — Admin dashboard

Open your browser and go to:

```
http://localhost:3000/admin.html
```

Enter your `ADMIN_PASSWORD` to unlock. From here you can:
- **Trigger the flow** for a new lead by entering their phone number
- **View all captured leads** — address, energy usage, goals, date

---

## Triggering the flow from your website

If you want your website's contact form to auto-trigger the bot, send a POST request:

```js
fetch('https://your-server.com/trigger', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    to: '+447700900000',   // customer's mobile (with country code)
    name: 'Sarah'          // optional, used in the opening message
  })
});
```

---

## Conversation flow

```
YOU  →  "Hi Sarah! 👋 This is D&O South Coast Solar..."
THEM →  [gives address]
YOU  →  "Thanks! ✅ Could you tell us your annual energy usage?"
THEM →  [gives usage or "not sure"]
YOU  →  "Got it! ⚡ What are your main goals with solar?"
THEM →  [lists goals]
YOU  →  "Brilliant! 🌞 Book your free survey here: [BOOKING_LINK]"
```

---

## Files

| File | Purpose |
|------|---------|
| `server.js` | Main webhook server |
| `public/admin.html` | Admin dashboard |
| `leads.json` | Auto-created, stores all captured lead data |
| `.env` | Your credentials (never commit this to git) |

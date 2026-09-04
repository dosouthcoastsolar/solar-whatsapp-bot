require('dotenv').config();
const express    = require('express');
const bodyParser = require('body-parser');
const twilio     = require('twilio');
const fs         = require('fs');
const path       = require('path');

const app    = express();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Config ──────────────────────────────────────────────────────────────────
const WHATSAPP_FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
const BOOKING_LINK  = process.env.BOOKING_LINK || 'https://outlook.office.com/bookings/';
const LEADS_FILE    = path.join(__dirname, 'leads.json');

// ─── State machine ────────────────────────────────────────────────────────────
const STATE = {
  AWAITING_ADDRESS : 'AWAITING_ADDRESS',
  AWAITING_ENERGY  : 'AWAITING_ENERGY',
  AWAITING_GOALS   : 'AWAITING_GOALS',
  COMPLETE         : 'COMPLETE',
};

// In-memory sessions — survives restarts via leads.json restore, fine for small volume
const sessions = {};

// ─── Message templates ────────────────────────────────────────────────────────
function greetingMessage(name) {
  const nameStr = name ? ` ${name}` : '';
  return (
    `Hi${nameStr}! 👋 This is *D&O South Coast Solar*.\n\n` +
    `Thanks for your enquiry — we're looking forward to helping you go solar! ☀️\n\n` +
    `To get started, could you confirm the full property address where you'd like the panels installed?`
  );
}

function energyMessage(address) {
  return (
    `Thanks! ✅ Property address noted:\n*${address}*\n\n` +
    `Next, roughly how much electricity does your home use per year?\n\n` +
    `You can usually find this on a recent energy bill — it shows as something like *"3,500 kWh"*. ` +
    `If you're not sure, just reply *"not sure"* and we'll check on-site.`
  );
}

function goalsMessage() {
  return (
    `Got it! ⚡\n\n` +
    `Almost done — what are your main goals with solar? For example:\n` +
    `• Lower energy bills\n` +
    `• Battery storage\n` +
    `• EV charging\n` +
    `• Export to the grid\n\n` +
    `Feel free to list as many as apply.`
  );
}

function bookingMessage() {
  return (
    `Brilliant, we have everything we need! 🌞\n\n` +
    `The last step is booking your *free no-obligation survey*. ` +
    `Click below to pick a date and time that suits you:\n\n` +
    `📅 *${BOOKING_LINK}*\n\n` +
    `One of our MCS-certified engineers will visit to assess your property and put together a detailed proposal. ` +
    `Any questions in the meantime, just reply here!`
  );
}

function completeMessage() {
  return (
    `Thanks again for choosing D&O South Coast Solar! ☀️\n\n` +
    `If anything comes up before your survey, just message us here. We look forward to meeting you!`
  );
}

// ─── Leads persistence ────────────────────────────────────────────────────────
function loadLeads() {
  try {
    if (fs.existsSync(LEADS_FILE)) {
      return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function saveLead(lead) {
  const leads = loadLeads();
  // Update if exists, otherwise append
  const idx = leads.findIndex(l => l.phone === lead.phone);
  if (idx >= 0) leads[idx] = lead;
  else leads.push(lead);
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// ─── Incoming WhatsApp webhook ────────────────────────────────────────────────
app.post('/webhook', (req, res) => {
  const from = req.body.From;   // e.g. "whatsapp:+447700900000"
  const body = (req.body.Body || '').trim();

  if (!from) return res.sendStatus(400);

  // Initialise session if first message from this number
  if (!sessions[from]) {
    sessions[from] = {
      phone     : from,
      state     : STATE.AWAITING_ADDRESS,
      data      : {},
      startedAt : new Date().toISOString(),
    };
  }

  const session = sessions[from];
  const twiml   = new twilio.twiml.MessagingResponse();
  let reply;

  switch (session.state) {

    case STATE.AWAITING_ADDRESS:
      session.data.address = body;
      reply = energyMessage(body);
      session.state = STATE.AWAITING_ENERGY;
      break;

    case STATE.AWAITING_ENERGY:
      session.data.energyUsage = body;
      reply = goalsMessage();
      session.state = STATE.AWAITING_GOALS;
      break;

    case STATE.AWAITING_GOALS:
      session.data.goals = body;
      session.data.completedAt = new Date().toISOString();
      session.state = STATE.COMPLETE;
      reply = bookingMessage();
      // Persist the completed lead
      saveLead({ phone: from, ...session.data });
      console.log('[LEAD COMPLETE]', { phone: from, ...session.data });
      break;

    case STATE.COMPLETE:
    default:
      reply = completeMessage();
      break;
  }

  twiml.message(reply);
  res.type('text/xml').send(twiml.toString());
});

// ─── Trigger endpoint — fire the opener for a new lead ────────────────────────
// POST /trigger  { "to": "+447700900000", "name": "Sarah" }
app.post('/trigger', async (req, res) => {
  const { to, name } = req.body;
  if (!to) return res.status(400).json({ error: 'Phone number (to) is required' });

  const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  // Reset session for this number
  sessions[formattedTo] = {
    phone     : formattedTo,
    name      : name || null,
    state     : STATE.AWAITING_ADDRESS,
    data      : {},
    startedAt : new Date().toISOString(),
  };

  try {
    await client.messages.create({
      from : WHATSAPP_FROM,
      to   : formattedTo,
      body : greetingMessage(name),
    });
    res.json({ success: true, message: `Flow triggered for ${to}` });
  } catch (err) {
    console.error('[TRIGGER ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Leads API — used by admin dashboard ──────────────────────────────────────
app.get('/leads', (req, res) => {
  const auth = req.headers['x-admin-password'];
  if (auth !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  res.json(loadLeads());
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌞 D&O South Coast Solar — WhatsApp Bot`);
  console.log(`   Running on http://localhost:${PORT}`);
  console.log(`   Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`   Admin dashboard: http://localhost:${PORT}/admin.html\n`);
});

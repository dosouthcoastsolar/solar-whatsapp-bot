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

// â”€â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const WHATSAPP_FROM = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
const BOOKING_LINK  = process.env.BOOKING_LINK || 'https://outlook.office.com/bookings/';
const LEADS_FILE    = path.join(__dirname, 'leads.json');

// â”€â”€â”€ State machine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const STATE = {
  AWAITING_ADDRESS  : 'AWAITING_ADDRESS',
  AWAITING_LOCATION : 'AWAITING_LOCATION',
  AWAITING_ENERGY   : 'AWAITING_ENERGY',
  AWAITING_GOALS    : 'AWAITING_GOALS',
  COMPLETE          : 'COMPLETE',
};

// In-memory sessions â€” survives restarts via leads.json restore, fine for small volume
const sessions = {};

// â”€â”€â”€ Message templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function greetingMessage(name) {
  const nameStr = name ? ` ${name}` : '';
  return (
    `Hi${nameStr}! ðŸ‘‹ This is *D&O South Coast Solar*.\n\n` +
    `Thanks for your enquiry â€” we're looking forward to helping you go solar! â˜€ï¸\n\n` +
    `To get started, could you confirm the full property address where you'd like the panels installed?`
  );
}

function locationRequestMessage(address) {
  return (
    `Thanks! ðŸ“ Could you confirm the property address by dropping a *location pin*?\n\n` +
    `In WhatsApp, tap the *paperclip/attachment icon* â†’ *Location* â†’ *Send your current location* ` +
    `(or search for the address).\n\n` +
    `This helps our engineer find the property easily on survey day.`
  );
}

function locationConfirmedMessage(label, address) {
  const place = label || address || 'your property';
  return (
    `Perfect, location confirmed! âœ… *${place}*\n\n` +
    `Next, roughly how much electricity does your home use per year?\n\n` +
    `You can usually find this on a recent energy bill â€” it shows as something like *"3,500 kWh"*. ` +
    `If you're not sure, just reply *"not sure"* and we'll check on-site.`
  );
}

function energyMessage() {
  return (
    `Next, roughly how much electricity does your home use per year?\n\n` +
    `You can usually find this on a recent energy bill â€” it shows as something like *"3,500 kWh"*. ` +
    `If you're not sure, just reply *"not sure"* and we'll check on-site.`
  );
}

function goalsMessage() {
  return (
    `Got it! âš¡\n\n` +
    `Almost done â€” what are your main goals with solar? For example:\n` +
    `â€¢ Lower energy bills\n` +
    `â€¢ Battery storage\n` +
    `â€¢ EV charging\n` +
    `â€¢ Export to the grid\n\n` +
    `Feel free to list as many as apply.`
  );
}

function bookingMessage() {
  return (
    `Brilliant, we have everything we need! ðŸŒž\n\n` +
    `The last step is booking your *free no-obligation survey*. ` +
    `Click below to pick a date and time that suits you:\n\n` +
    `ðŸ“… *${BOOKING_LINK}*\n\n` +
    `One of our MCS-certified engineers will visit to assess your property and put together a detailed proposal. ` +
    `Any questions in the meantime, just reply here!`
  );
}

function completeMessage() {
  return (
    `Thanks again for choosing D&O South Coast Solar! â˜€ï¸\n\n` +
    `If anything comes up before your survey, just message us here. We look forward to meeting you!`
  );
}

// â”€â”€â”€ Leads persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Incoming WhatsApp webhook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/webhook', (req, res) => {
  const from     = req.body.From;   // e.g. "whatsapp:+447700900000"
  const body     = (req.body.Body || '').trim();
  const latitude  = req.body.Latitude;
  const longitude = req.body.Longitude;
  const locLabel  = req.body.Label   || '';
  const locAddr   = req.body.Address || '';

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
      // Save the typed address and ask for a location pin
      session.data.address = body;
      reply = locationRequestMessage(body);
      session.state = STATE.AWAITING_LOCATION;
      break;

    case STATE.AWAITING_LOCATION:
      if (latitude && longitude) {
        // They dropped a pin â€” capture coordinates and confirmed address
        session.data.latitude  = latitude;
        session.data.longitude = longitude;
        session.data.locationLabel   = locLabel || locAddr || session.data.address;
        session.data.googleMapsLink  = `https://www.google.com/maps?q=${latitude},${longitude}`;
        reply = locationConfirmedMessage(locLabel, locAddr);
        session.state = STATE.AWAITING_ENERGY;
      } else {
        // They sent text instead of a pin â€” remind them
        reply =
          `ðŸ“ We need a location pin to confirm the address.\n\n` +
          `In WhatsApp, tap the *paperclip/attachment icon* â†’ *Location* â†’ ` +
          `*Send your current location* or search for your address. ` +
          `If you're having trouble, reply *"skip"* and we'll confirm on the day.`;
        // Allow "skip" or "confirm" to bypass pin requirement
        if (['skip','confirm','yes','ok'].includes(body.toLowerCase())) {
          session.data.locationLabel  = session.data.address;
          session.data.googleMapsLink = null;
          reply = locationConfirmedMessage(session.data.address, '');
          session.state = STATE.AWAITING_ENERGY;
        }
      }
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

// â”€â”€â”€ Trigger endpoint â€” fire the opener for a new lead â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /trigger  { "to": "+447700900000", "name": "Sarah", "address": "Orchard Cottage", "postcode": "TA3 5LJ", ... }
app.post('/trigger', async (req, res) => {
  const { to, name, address, postcode, email, propertyType, service } = req.body;
  if (!to) return res.status(400).json({ error: 'Phone number (to) is required' });

  const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const knownAddress = [address, postcode].filter(Boolean).join(', ');

  // If we have address data from the lead, skip straight to pin confirmation
  const initialState = knownAddress ? STATE.AWAITING_LOCATION : STATE.AWAITING_ADDRESS;

  sessions[formattedTo] = {
    phone     : formattedTo,
    name      : name || null,
    state     : initialState,
    data      : {
      address      : knownAddress || null,
      email        : email        || null,
      propertyType : propertyType || null,
      service      : service      || null,
    },
    startedAt : new Date().toISOString(),
  };

  // Build opening message based on whether we have address data
  let openingMsg;
  if (knownAddress) {
    const nameStr = name ? ` ${name}` : '';
    openingMsg =
      `Hi${nameStr}! ðŸ‘‹ This is *D&O South Coast Solar*.\n\n` +
      `Thanks for your enquiry about solar â€” we'd love to help! â˜€ï¸\n\n` +
      `We have your property address as:\n*${knownAddress}*\n\n` +
      `Could you confirm this is correct by dropping a *ðŸ“ location pin* for us?\n\n` +
      `In WhatsApp, tap the *paperclip/attachment icon* â†’ *Location* â†’ search for your address or send your current location. ` +
      `This helps our engineer find you easily on survey day.\n\n` +
      `_(If you can't send a pin, just reply *"confirm"* to continue.)_`;
  } else {
    openingMsg = greetingMessage(name);
  }

  try {
    await client.messages.create({
      from : WHATSAPP_FROM,
      to   : formattedTo,
      body : openingMsg,
    });
    res.json({ success: true, message: `Flow triggered for ${to}` });
  } catch (err) {
    console.error('[TRIGGER ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€â”€ Leads API â€” used by admin dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/leads', (req, res) => {
  const auth = req.headers['x-admin-password'];
  if (auth !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  res.json(loadLeads());
});

// â”€â”€â”€ Start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nðŸŒž D&O South Coast Solar â€” WhatsApp Bot`);
  console.log(`   Running on http://localhost:${PORT}`);
  console.log(`   Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`   Admin dashboard: http://localhost:${PORT}/admin.html\n`);
});

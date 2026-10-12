const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const SALON_NAME = process.env.SALON_NAME || 'Kelvin Corex';
const OWNER_WHATSAPP = String(process.env.OWNER_WHATSAPP || '918287139492').replace(/\D/g, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const OPEN_HOUR = Number(process.env.OPEN_HOUR || 10);
const CLOSE_HOUR = Number(process.env.CLOSE_HOUR || 20);
const SHEETS_WEB_APP_URL = process.env.SHEETS_WEB_APP_URL || '';
const SHEETS_API_KEY = process.env.SHEETS_API_KEY || '';
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || '';

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const json = (res, status, body) => res.status(status).json(body);
function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
function normalizePhone(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.length === 10) p = '91' + p;
  return p;
}
function isDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
  const d = new Date(`${date}T00:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}
function isTime(time) {
  if (!/^\d{2}:\d{2}$/.test(String(time || ''))) return false;
  const [h, m] = time.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}
function waLink(phone, message) {
  return `https://wa.me/${encodeURIComponent(phone)}?text=${encodeURIComponent(message)}`;
}
function adminOnly(req, res) {
  if (!ADMIN_PASSWORD) {
    json(res, 503, { error: 'Owner login is not configured. Add ADMIN_PASSWORD in Vercel Environment Variables.' });
    return false;
  }
  if (req.get('x-admin-password') !== ADMIN_PASSWORD) {
    json(res, 401, { error: 'Incorrect owner password. Please try again.' });
    return false;
  }
  return true;
}
async function sheets(action, payload = {}) {
  if (!SHEETS_WEB_APP_URL || !SHEETS_API_KEY) {
    const e = new Error('Booking storage is not configured. Add SHEETS_WEB_APP_URL and SHEETS_API_KEY in Vercel Environment Variables.');
    e.status = 503; throw e;
  }
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(SHEETS_WEB_APP_URL)) {
    const e = new Error('SHEETS_WEB_APP_URL must be the deployed Google Apps Script Web App URL ending in /exec.');
    e.status = 503; throw e;
  }
  const response = await fetch(SHEETS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, key: SHEETS_API_KEY, ...payload }),
    redirect: 'follow'
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch (_) {
    const e = new Error('Google Sheets returned a non-JSON response. Check Apps Script deployment access and the /exec URL.');
    e.status = 502; throw e;
  }
  if (data.error) {
    const e = new Error(data.error);
    e.status = /unauthorized/i.test(data.error) ? 401 : 400;
    throw e;
  }
  if (!response.ok) {
    const e = new Error(`Google Sheets request failed (${response.status}).`);
    e.status = 502; throw e;
  }
  return data;
}
function errorResponse(res, err) {
  console.error('[Kelvin Corex API]', err && err.stack ? err.stack : err);
  return json(res, err.status || 500, { error: err.message || 'Something went wrong. Please try again.' });
}

app.get('/api/health', (_req, res) => json(res, 200, {
  ok: true, salon: SALON_NAME,
  storageConfigured: Boolean(SHEETS_WEB_APP_URL && SHEETS_API_KEY),
  adminConfigured: Boolean(ADMIN_PASSWORD)
}));
app.get('/api/config', (_req, res) => json(res, 200, {
  salonName: SALON_NAME, openHour: OPEN_HOUR, closeHour: CLOSE_HOUR
}));

app.get('/api/appointments', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const result = await sheets('list');
    const items = Array.isArray(result.appointments) ? result.appointments : [];
    items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return json(res, 200, items);
  } catch (err) { return errorResponse(res, err); }
});

app.post('/api/appointments', async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 80);
    const service = String(body.service || '').trim().slice(0, 80);
    const date = String(body.date || '');
    const time = String(body.time || '');
    const phone = normalizePhone(body.phone);
    if (!name || !service || !date || !time || !body.phone) return json(res, 400, { error: 'Please complete every field.' });
    if (!isDate(date) || !isTime(time)) return json(res, 400, { error: 'Please choose a valid date and time.' });
    if (phone.length !== 12 || !phone.startsWith('91')) return json(res, 400, { error: 'Enter a valid 10-digit Indian WhatsApp number.' });
    const [hour, minute] = time.split(':').map(Number);
    if (hour < OPEN_HOUR || hour > CLOSE_HOUR || (hour === CLOSE_HOUR && minute > 0)) {
      return json(res, 400, { error: `Appointments are available from ${String(OPEN_HOUR).padStart(2,'0')}:00 to ${String(CLOSE_HOUR).padStart(2,'0')}:00.` });
    }
    const today = new Date();
    const chosen = new Date(`${date}T${time}:00+05:30`);
    if (chosen.getTime() < Date.now() - 60000) return json(res, 400, { error: 'Please choose a future date and time.' });
    const appointment = {
      id: makeId(), name, phone, service, date, time,
      status: 'pending', createdAt: new Date().toISOString()
    };
    const result = await sheets('create', { appointment });
    const saved = result.appointment || appointment;
    const ownerMessage = `New appointment request — ${SALON_NAME}\nName: ${saved.name}\nService: ${saved.service}\nDate: ${saved.date}\nTime: ${saved.time}\nWhatsApp: +${saved.phone}\nDashboard: ${PUBLIC_SITE_URL}/owner.html`;
    return json(res, 201, { success: true, appointment: saved, ownerWhatsAppLink: waLink(OWNER_WHATSAPP, ownerMessage) });
  } catch (err) { return errorResponse(res, err); }
});

app.post('/api/appointments/:id/:action', async (req, res) => {
  if (!adminOnly(req, res)) return;
  const action = req.params.action;
  if (!['approve', 'reject'].includes(action)) return json(res, 404, { error: 'Action not found.' });
  try {
    const result = await sheets(action, { id: req.params.id });
    if (!result.appointment) return json(res, 404, { error: 'Appointment not found.' });
    const a = result.appointment;
    const message = action === 'approve'
      ? `Hi ${a.name}, your appointment at ${SALON_NAME} is CONFIRMED.\n\nService: ${a.service}\nDate: ${a.date}\nTime: ${a.time}\n\nThank you!`
      : `Hi ${a.name}, unfortunately your appointment request at ${SALON_NAME} could not be confirmed.\n\nRequested: ${a.date} at ${a.time}\nPlease message us to choose another time.`;
    return json(res, 200, { success: true, appointment: a, whatsappLink: waLink(a.phone, message) });
  } catch (err) { return errorResponse(res, err); }
});

app.delete('/api/appointments/:id', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    await sheets('delete', { id: req.params.id });
    return json(res, 200, { success: true });
  } catch (err) { return errorResponse(res, err); }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return json(res, 404, { error: 'API route not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => err && next(err));
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`${SALON_NAME} running at http://localhost:${port}`));
}
module.exports = app;

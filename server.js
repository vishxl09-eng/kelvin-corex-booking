
'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;
const SALON_NAME = process.env.SALON_NAME || 'Kelvin Corex';
const OWNER_WHATSAPP = (process.env.OWNER_WHATSAPP || '8860947068')
  .replace(/\D/g, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SHEETS_WEB_APP_URL = process.env.SHEETS_WEB_APP_URL || '';
const SHEETS_API_KEY = process.env.SHEETS_API_KEY || '';
const OPEN_HOUR = Number(process.env.OPEN_HOUR || 10);
const CLOSE_HOUR = Number(process.env.CLOSE_HOUR || 20);
const PUBLIC_SITE_URL =
  process.env.PUBLIC_SITE_URL || 'https://kelvin-corex-booking.vercel.app';

const TIMEZONE = 'Asia/Kolkata';

// In-memory login tokens. On serverless hosting, sessions may reset
// when an instance restarts; log in again if that happens.
const ownerTokens = new Set();

app.disable('x-powered-by');
app.use(express.json({ limit: '30kb' }));
app.use(express.urlencoded({ extended: false, limit: '30kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function requireOwner(req, res, next) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!token || !ownerTokens.has(token)) {
    return res.status(401).json({
      success: false,
      error: 'Please log in as the salon owner.'
    });
  }

  next();
}

function normalizeDate(value) {
  if (value == null) return '';

  const str = String(value).trim();

  // The HTML date input sends YYYY-MM-DD. Preserve it as-is.
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const check = new Date(Date.UTC(year, month - 1, day));

    if (
      check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day
    ) {
      return str;
    }
    return '';
  }

  // For ISO timestamps, keep the date portion rather than shifting
  // the calendar date through the server's local timezone.
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (iso) return normalizeDate(iso[1]);

  // Handle legacy Google Sheets date serialization.
  const legacy = str.match(/^(\d{4})-(\d{2})-(\d{2})\s/);
  if (legacy) return normalizeDate(
    `${legacy[1]}-${legacy[2]}-${legacy[3]}`
  );

  return '';
}

function normalizeTime(value) {
  if (value == null) return '';

  const str = String(value).trim();

  // Preferred storage format: 14:00, 09:30, etc.
  const twentyFour = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return '';
    }

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // Handle legacy Sheets values such as 1899-12-30T14:00:00.000Z.
  // This reads the clock portion only; it does not convert timezones.
  const legacy = str.match(/^1899-12-30T(\d{2}):(\d{2})/);
  if (legacy) return `${legacy[1]}:${legacy[2]}`;

  // Handle strings such as 2:00 PM.
  const twelve = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (twelve) {
    let hour = Number(twelve[1]);
    const minute = Number(twelve[2]);
    const meridiem = twelve[3].toUpperCase();

    if (hour < 1 || hour > 12 || minute > 59) return '';

    if (meridiem === 'AM' && hour === 12) hour = 0;
    if (meridiem === 'PM' && hour !== 12) hour += 12;

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  return '';
}

function displayDate(value) {
  const dateStr = normalizeDate(value);
  if (!dateStr) return 'Date unavailable';

  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

function displayTime(value) {
  const time = normalizeTime(value);
  if (!time) return 'Time unavailable';

  const [hour, minute] = time.split(':').map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute));

  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC'
  }).format(date).toLowerCase();
}

function normalizeAppointment(appointment) {
  const a = appointment || {};

  return {
    ...a,
    date: normalizeDate(a.date),
    time: normalizeTime(a.time)
  };
}

function makeWhatsAppLink(phone, message) {
  const number = String(phone || '').replace(/\D/g, '');
  if (!number) return '';

  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function appointmentMessage(appointment, approved = true) {
  const a = normalizeAppointment(appointment);

  if (approved) {
    return [
      `Hi ${a.name || 'there'},`,
      '',
      `Your appointment at *${SALON_NAME}* is *CONFIRMED!* ✅`,
      '',
      `*Service:* ${a.service || 'Salon service'}`,
      `*Date:* ${displayDate(a.date)}`,
      `*Time:* ${displayTime(a.time)}`,
      '',
      `Thank you for choosing ${SALON_NAME}. We look forward to seeing you!`,
      '',
      `*Team ${SALON_NAME}*`
    ].join('\n');
  }

  return [
    `Hi ${a.name || 'there'},`,
    '',
    `Unfortunately, your appointment request at *${SALON_NAME}* could not be approved.`,
    '',
    `*Service:* ${a.service || 'Salon service'}`,
    `*Date:* ${displayDate(a.date)}`,
    `*Time:* ${displayTime(a.time)}`,
    '',
    'Please contact the salon to choose another available time.',
    '',
    `*Team ${SALON_NAME}*`
  ].join('\n');
}

function ownerNotificationMessage(appointment) {
  const a = normalizeAppointment(appointment);

  return [
    `New appointment request — ${SALON_NAME}`,
    '',
    `Name: ${a.name || ''}`,
    `Phone: ${a.phone || ''}`,
    `Service: ${a.service || ''}`,
    `Date: ${displayDate(a.date)}`,
    `Time: ${displayTime(a.time)}`,
    '',
    `Manage appointments: ${PUBLIC_SITE_URL}/owner.html`
  ].join('\n');
}

async function sheetsRequest(action, data = {}) {
  if (!SHEETS_WEB_APP_URL || !SHEETS_API_KEY) {
    throw new Error('Google Sheets connection is not configured.');
  }

  const response = await fetch(SHEETS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      key: SHEETS_API_KEY,
      action,
      ...data
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Google Sheets returned HTTP ${response.status}.`);
  }

  const result = await response.json();

  if (result.error) throw new Error(result.error);

  return result;
}

function publicError(res, error, status = 500) {
  console.error(error);
  return res.status(status).json({
    success: false,
    error: status === 500
      ? 'Something went wrong. Please try again later.'
      : String(error.message || error)
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    salon: SALON_NAME,
    timezone: TIMEZONE
  });
});

// Public salon settings
app.get('/api/config', (req, res) => {
  res.json({
    salonName: SALON_NAME,
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR,
    timezone: TIMEZONE
  });
});

// Create a booking request
app.post('/api/appointments', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    const service = String(req.body.service || '').trim();
    const date = normalizeDate(req.body.date);
    const time = normalizeTime(req.body.time);

    if (!name || name.length > 80) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid name.'
      });
    }

    if (!/^(91)?[6-9]\d{9}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid Indian mobile number.'
      });
    }

    const allowedServices = [
      'Haircut',
      'Beard styling',
      'Haircut + Beard',
      'Hair styling',
      'Other / consultation'
    ];

    if (!allowedServices.includes(service)) {
      return res.status(400).json({
        success: false,
        error: 'Please select a valid service.'
      });
    }

    if (!date || !time) {
      return res.status(400).json({
        success: false,
        error: 'Please select a valid date and time.'
      });
    }

    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const requested = new Date(year, month - 1, day, hour, minute);
    const now = new Date();

    if (requested.getTime() < now.getTime()) {
      return res.status(400).json({
        success: false,
        error: 'Please select a future date and time.'
      });
    }

    if (hour < OPEN_HOUR || hour > CLOSE_HOUR ||
        (hour === CLOSE_HOUR && minute > 0)) {
      return res.status(400).json({
        success: false,
        error: `Appointments are available from ${displayTime(`${String(OPEN_HOUR).padStart(2, '0')}:00`)} to ${displayTime(`${String(CLOSE_HOUR).padStart(2, '0')}:00`)}.`
      });
    }

    const appointment = {
      id: crypto.randomUUID(),
      name,
      phone: phone.length === 10 ? `91${phone}` : phone,
      service,
      date,
      time,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: ''
    };

    await sheetsRequest('create', { appointment });

    const ownerLink = makeWhatsAppLink(
      OWNER_WHATSAPP,
      ownerNotificationMessage(appointment)
    );

    return res.status(201).json({
      success: true,
      appointment: {
        ...appointment,
        dateText: displayDate(date),
        timeText: displayTime(time)
      },
      ownerWhatsAppLink: ownerLink
    });
  } catch (error) {
    return publicError(res, error);
  }
});

// Owner login
app.post('/api/owner/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({
      success: false,
      error: 'Owner login is not configured.'
    });
  }

  const password = String(req.body.password || '');

  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({
      success: false,
      error: 'Incorrect password.'
    });
  }

  const token = crypto.randomBytes(32).toString('hex');
  ownerTokens.add(token);

  res.json({ success: true, token });
});

// List appointments for owner dashboard
app.get('/api/owner/appointments', requireOwner, async (req, res) => {
  try {
    const result = await sheetsRequest('list');
    const appointments = (result.appointments || []).map(a => {
      const normalized = normalizeAppointment(a);

      return {
        ...normalized,
        dateText: displayDate(normalized.date),
        timeText: displayTime(normalized.time)
      };
    });

    res.json({ success: true, appointments });
  } catch (error) {
    publicError(res, error);
  }
});

// Approve or reject an appointment.
// Response returns a WhatsApp link; it does not send a message automatically.
async function updateAppointment(req, res, action) {
  try {
    const id = String(req.params.id || req.body.id || '').trim();

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Appointment ID is required.'
      });
    }

    const result = await sheetsRequest(action, { id });

    const appointment = normalizeAppointment(result.appointment || {});

    const message = appointmentMessage(
      appointment,
      action === 'approve'
    );

    const customerWhatsAppLink = makeWhatsAppLink(
      appointment.phone,
      message
    );

    res.json({
      success: true,
      appointment: {
        ...appointment,
        dateText: displayDate(appointment.date),
        timeText: displayTime(appointment.time)
      },
      customerWhatsAppLink,
      whatsappLink: customerWhatsAppLink
    });
  } catch (error) {
    publicError(res, error);
  }
}

app.post('/api/owner/appointments/:id/approve', requireOwner,
  (req, res) => updateAppointment(req, res, 'approve'));

app.post('/api/owner/appointments/:id/reject', requireOwner,
  (req, res) => updateAppointment(req, res, 'reject'));

// Also support clients that send the ID in the request body.
app.post('/api/owner/approve', requireOwner,
  (req, res) => updateAppointment(req, res, 'approve'));

app.post('/api/owner/reject', requireOwner,
  (req, res) => updateAppointment(req, res, 'reject'));

// Delete an appointment
app.delete('/api/owner/appointments/:id', requireOwner, async (req, res) => {
  try {
    const result = await sheetsRequest('delete', { id: req.params.id });
    res.json({ success: true, ...result });
  } catch (error) {
    publicError(res, error);
  }
});

app.post('/api/owner/appointments/:id/delete', requireOwner, async (req, res) => {
  try {
    const result = await sheetsRequest('delete', { id: req.params.id });
    res.json({ success: true, ...result });
  } catch (error) {
    publicError(res, error);
  }
});

// Log out an owner session
app.post('/api/owner/logout', requireOwner, (req, res) => {
  const token = String(req.headers.authorization || '').slice(7);
  ownerTokens.delete(token);
  res.json({ success: true });
});

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) return next(err);

  res.status(500).json({
    success: false,
    error: 'Unexpected server error.'
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`${SALON_NAME} server running on port ${PORT}`);
  });
}

module.exports = app;

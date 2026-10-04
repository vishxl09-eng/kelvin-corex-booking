
const express = require("express");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();

const PORT = Number(process.env.PORT || 3000);
const SALON_NAME = process.env.SALON_NAME || "Kelvin Corex";
const OWNER_WHATSAPP = (process.env.OWNER_WHATSAPP || "918287139492").replace(/\D/g, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "kelvin123";
const OPEN_HOUR = Number(process.env.OPEN_HOUR || 10);
const CLOSE_HOUR = Number(process.env.CLOSE_HOUR || 20);
const DATA_FILE = path.join(__dirname, "appointments.json");

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readAppointments() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAppointments(items) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), "utf8");
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePhone(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.length === 10) p = "91" + p;
  return p;
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function validTime(time) {
  return /^\d{2}:\d{2}$/.test(time);
}

function whatsappLink(phone, message) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => {
  res.json({
    salonName: SALON_NAME,
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR
  });
});

app.get("/api/appointments", (req, res) => {
  const password = req.headers["x-admin-password"];
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const items = readAppointments().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(items);
});

app.post("/api/appointments", (req, res) => {
  const { name, phone, service, date, time } = req.body;

  if (!name || !phone || !service || !date || !time) {
    return res.status(400).json({ error: "Please fill all fields." });
  }

  if (!validDate(date) || !validTime(time)) {
    return res.status(400).json({ error: "Invalid date or time." });
  }

  const hour = Number(time.split(":")[0]);
  const minute = Number(time.split(":")[1]);
  if (hour < OPEN_HOUR || hour > CLOSE_HOUR || (hour === CLOSE_HOUR && minute > 0)) {
    return res.status(400).json({
      error: `Appointments are available from ${OPEN_HOUR}:00 to ${CLOSE_HOUR}:00.`
    });
  }

  const normalized = normalizePhone(phone);
  if (normalized.length < 12) {
    return res.status(400).json({ error: "Please enter a valid WhatsApp number." });
  }

  const appointments = readAppointments();

  const duplicate = appointments.find(
    a => a.date === date && a.time === time && a.status === "approved"
  );

  if (duplicate) {
    return res.status(409).json({ error: "This time slot is already booked. Please choose another time." });
  }

  const appointment = {
    id: makeId(),
    name: String(name).trim(),
    phone: normalized,
    service: String(service).trim(),
    date,
    time,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  appointments.push(appointment);
  writeAppointments(appointments);

  const ownerMessage =
    `New appointment request - ${SALON_NAME}\n` +
    `Name: ${appointment.name}\n` +
    `Service: ${appointment.service}\n` +
    `Date: ${appointment.date}\n` +
    `Time: ${appointment.time}\n` +
    `WhatsApp: +${appointment.phone}\n` +
    `Open owner dashboard: http://localhost:${PORT}/owner.html`;

  res.json({
    success: true,
    appointment,
    ownerWhatsAppLink: whatsappLink(OWNER_WHATSAPP, ownerMessage)
  });
});

app.post("/api/appointments/:id/approve", (req, res) => {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const appointments = readAppointments();
  const index = appointments.findIndex(a => a.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: "Appointment not found." });

  const current = appointments[index];

  const conflict = appointments.find(
    a => a.id !== current.id &&
      a.date === current.date &&
      a.time === current.time &&
      a.status === "approved"
  );

  if (conflict) {
    return res.status(409).json({ error: "That time slot is already approved for another customer." });
  }

  current.status = "approved";
  current.updatedAt = new Date().toISOString();
  writeAppointments(appointments);

  const message =
    `Hi ${current.name}, your appointment at ${SALON_NAME} is CONFIRMED.\n\n` +
    `Service: ${current.service}\n` +
    `Date: ${current.date}\n` +
    `Time: ${current.time}\n\n` +
    `Thank you!`;

  res.json({
    success: true,
    appointment: current,
    whatsappLink: whatsappLink(current.phone, message)
  });
});

app.post("/api/appointments/:id/reject", (req, res) => {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const appointments = readAppointments();
  const index = appointments.findIndex(a => a.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: "Appointment not found." });

  const current = appointments[index];
  current.status = "rejected";
  current.updatedAt = new Date().toISOString();
  writeAppointments(appointments);

  const message =
    `Hi ${current.name}, unfortunately your appointment request at ${SALON_NAME} could not be confirmed.\n\n` +
    `Requested: ${current.date} at ${current.time}\n` +
    `Please message us on WhatsApp to choose another time.`;

  res.json({
    success: true,
    appointment: current,
    whatsappLink: whatsappLink(current.phone, message)
  });
});

app.delete("/api/appointments/:id", (req, res) => {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const appointments = readAppointments();
  const next = appointments.filter(a => a.id !== req.params.id);

  if (next.length === appointments.length) {
    return res.status(404).json({ error: "Appointment not found." });
  }

  writeAppointments(next);
  res.json({ success: true });
});

app.get("/api/health", (req, res) => res.json({ ok: true, salon: SALON_NAME }));

app.listen(PORT, () => {
  console.log("");
  console.log(`=======================================`);
  console.log(` ${SALON_NAME} Appointment System`);
  console.log(` Customer: http://localhost:${PORT}`);
  console.log(` Owner:    http://localhost:${PORT}/owner.html`);
  console.log(`=======================================`);
  console.log("");
});

const express = require('express');
const Booking = require('../models/Booking');
const { sendEmail } = require('../email');

const router = express.Router();

const ALLOWED_DURATIONS = new Set([15, 30, 45, 60]);
const ALLOWED_SERVICES = new Set(['UI/UX', 'MERN', 'Java Full Stack', 'Python', 'Client Meeting']);

const BOOKING_START_HOUR = Number(process.env.BOOKING_START_HOUR || 10);
const BOOKING_END_HOUR = Number(process.env.BOOKING_END_HOUR || 18);
const BOOKING_BUFFER_MIN = Number(process.env.BOOKING_BUFFER_MIN || 15);
const BOOKING_DAYS_AHEAD = Number(process.env.BOOKING_DAYS_AHEAD || 14);
const BOOKING_ALLOW_WEEKENDS = String(process.env.BOOKING_ALLOW_WEEKENDS || 'false') === 'true';
const BOOKING_BLACKOUT_DATES = String(process.env.BOOKING_BLACKOUT_DATES || '')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

function getDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWithinHours(start, end) {
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const open = BOOKING_START_HOUR * 60;
  const close = BOOKING_END_HOUR * 60;
  return startMinutes >= open && endMinutes <= close;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

router.get('/config', (req, res) => {
  return res.json({
    startHour: BOOKING_START_HOUR,
    endHour: BOOKING_END_HOUR,
    bufferMinutes: BOOKING_BUFFER_MIN,
    daysAhead: BOOKING_DAYS_AHEAD,
    allowWeekends: BOOKING_ALLOW_WEEKENDS,
    blackoutDates: BOOKING_BLACKOUT_DATES
  });
});

router.get('/availability', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required.' });
    }

    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date range.' });
    }

    const bookings = await Booking.find({
      startAt: { $lt: end },
      endAt: { $gt: start }
    })
      .select('startAt endAt')
      .lean();

    return res.json({
      bookings: bookings.map((b) => ({
        startAt: b.startAt,
        endAt: b.endAt
      }))
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, email, phone, service, durationMinutes, startAt, notes } = req.body;

    if (!name || !email || !phone || !service || !durationMinutes || !startAt) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    const duration = Number(durationMinutes);
    if (!ALLOWED_DURATIONS.has(duration)) {
      return res.status(400).json({ error: 'Invalid duration.' });
    }

    if (!ALLOWED_SERVICES.has(String(service))) {
      return res.status(400).json({ error: 'Invalid service.' });
    }

    const emailStr = String(email).trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailStr)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const phoneStr = String(phone).trim();
    const phoneRegex = /^[0-9+()\-\s]{7,}$/;
    if (!phoneRegex.test(phoneStr)) {
      return res.status(400).json({ error: 'Invalid phone number.' });
    }

    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: 'Invalid start time.' });
    }

    const now = new Date();
    if (start <= now) {
      return res.status(400).json({ error: 'Please choose a future time.' });
    }

    const latest = new Date(now.getTime() + BOOKING_DAYS_AHEAD * 24 * 60 * 60 * 1000);
    if (start > latest) {
      return res.status(400).json({ error: 'Selected date is too far in the future.' });
    }

    const end = new Date(start.getTime() + duration * 60 * 1000);

    if (!BOOKING_ALLOW_WEEKENDS && isWeekend(start)) {
      return res.status(400).json({ error: 'Weekends are not available.' });
    }
    if (!isWithinHours(start, end)) {
      return res.status(400).json({ error: 'Selected time is outside business hours.' });
    }
    const dayKey = getDayKey(start);
    if (BOOKING_BLACKOUT_DATES.includes(dayKey)) {
      return res.status(400).json({ error: 'Selected date is not available.' });
    }

    const bufferMs = BOOKING_BUFFER_MIN * 60 * 1000;
    const startBuffered = new Date(start.getTime() - bufferMs);
    const endBuffered = new Date(end.getTime() + bufferMs);

    const conflict = await Booking.findOne({
      startAt: { $lt: endBuffered },
      endAt: { $gt: startBuffered }
    }).lean();

    if (conflict) {
      return res.status(409).json({ error: 'That slot is already booked. Choose another time.' });
    }

    const booking = await Booking.create({
      name,
      email: emailStr,
      phone: phoneStr,
      service,
      durationMinutes: duration,
      startAt: start,
      endAt: end,
      notes
    });

    const notify = process.env.NOTIFY_EMAIL;
    const when = start.toLocaleString();
    if (notify) {
      await sendEmail({
        to: notify,
        subject: `New Booking: ${service}`,
        text: `Name: ${name}\nEmail: ${emailStr}\nPhone: ${phoneStr}\nService: ${service}\nWhen: ${when}\nDuration: ${duration} min\nNotes: ${notes || ''}`
      });
    }
    await sendEmail({
      to: emailStr,
      subject: 'Booking confirmed',
      text: `Hi ${name},\n\nYour booking is confirmed.\nService: ${service}\nWhen: ${when}\nDuration: ${duration} min\n\nI will contact you soon.\n`
    });

    return res.status(201).json({ ok: true, id: booking._id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

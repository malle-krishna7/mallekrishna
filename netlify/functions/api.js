const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const connectDb = require('../../db');
const contactRoutes = require('../../routes/contact');
const bookingRoutes = require('../../routes/booking');
const proposalRoutes = require('../../routes/proposal');
const Contact = require('../../models/Contact');
const Booking = require('../../models/Booking');
const VisitDay = require('../../models/VisitDay');
const Proposal = require('../../models/Proposal');
const { sendEmail } = require('../../email');

dotenv.config();

let dbConnected = false;

async function ensureDB() {
  if (!dbConnected) {
    await connectDb();
    dbConnected = true;
  }
}

const BOOKING_START_HOUR = Number(process.env.BOOKING_START_HOUR || 10);
const BOOKING_END_HOUR = Number(process.env.BOOKING_END_HOUR || 18);
const BOOKING_BUFFER_MIN = Number(process.env.BOOKING_BUFFER_MIN || 15);
const BOOKING_DAYS_AHEAD = Number(process.env.BOOKING_DAYS_AHEAD || 14);
const BOOKING_ALLOW_WEEKENDS = String(process.env.BOOKING_ALLOW_WEEKENDS || 'false') === 'true';
const BOOKING_BLACKOUT_DATES = String(process.env.BOOKING_BLACKOUT_DATES || '')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

const ALLOWED_DURATIONS = new Set([15, 30, 45, 60]);
const ALLOWED_SERVICES = new Set(['UI/UX', 'MERN', 'Java Full Stack', 'Python']);

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

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

async function trackVisit(req) {
  try {
    const day = getDayKey(new Date());
    await VisitDay.updateOne({ day }, { $inc: { count: 1 } }, { upsert: true });
  } catch (err) {
    console.error('Error tracking visit:', err.message);
  }
}

function basicAuth(req) {
  const auth = req.headers['authorization'] || '';
  const decoded = Buffer.from(auth.split(' ')[1] || '', 'base64').toString();
  const [user, pass] = decoded.split(':');
  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPass = process.env.ADMIN_PASS || 'changeme';
  return user === expectedUser && pass === expectedPass;
}

function requireAuth(req, res) {
  if (!basicAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return null;
}

exports.handler = async (event, context) => {
  // Set response headers
  const headers = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };

  try {
    await ensureDB();
    await trackVisit({ 
      headers: event.headers,
      ip: event.requestContext?.identity?.sourceIp
    });

    const method = event.httpMethod;
    const path = event.path;
    const body = event.body ? JSON.parse(event.body) : {};

    // Contact API
    if (path === '/api/contact' && method === 'POST') {
      const { name, email, subject, message } = body;

      if (!name || !email || !subject || !message) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing required fields' }),
        };
      }

      const contact = new Contact({ name, email, subject, message });
      await contact.save();

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, id: contact._id }),
      };
    }

    // Booking Config API
    if (path === '/api/booking/config' && method === 'GET') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          startHour: BOOKING_START_HOUR,
          endHour: BOOKING_END_HOUR,
          bufferMinutes: BOOKING_BUFFER_MIN,
          daysAhead: BOOKING_DAYS_AHEAD,
          allowWeekends: BOOKING_ALLOW_WEEKENDS,
          blackoutDates: BOOKING_BLACKOUT_DATES,
        }),
      };
    }

    // Booking Availability API
    if (path === '/api/booking/availability' && method === 'GET') {
      const { from, to } = event.queryStringParameters || {};

      if (!from || !to) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'from and to are required' }),
        };
      }

      const start = new Date(`${from}T00:00:00`);
      const end = new Date(`${to}T23:59:59.999`);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid date range' }),
        };
      }

      const bookings = await Booking.find({
        startAt: { $lt: end },
        endAt: { $gt: start },
      }).select('startAt endAt').lean();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          bookings: bookings.map((b) => ({
            startAt: b.startAt,
            endAt: b.endAt,
          })),
        }),
      };
    }

    // Booking API
    if (path === '/api/booking' && method === 'POST') {
      const { name, email, phone, startAt, durationMinutes, service, notes } = body;

      if (!name || !email || !phone || !startAt || !durationMinutes) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing required fields' }),
        };
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(String(email).trim())) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid email address' }),
        };
      }

      const phoneRegex = /^[0-9+()\-\s]{7,}$/;
      if (!phoneRegex.test(String(phone).trim())) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid phone number' }),
        };
      }

      const duration = Number(durationMinutes);
      if (!ALLOWED_DURATIONS.has(duration)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid duration' }),
        };
      }

      if (!ALLOWED_SERVICES.has(String(service))) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid service' }),
        };
      }

      const start = new Date(startAt);
      if (Number.isNaN(start.getTime())) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid start time' }),
        };
      }

      const now = new Date();
      if (start <= now) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Please choose a future time' }),
        };
      }

      const latest = new Date(now.getTime() + BOOKING_DAYS_AHEAD * 24 * 60 * 60 * 1000);
      if (start > latest) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Selected date is too far in the future' }),
        };
      }

      if (!BOOKING_ALLOW_WEEKENDS && isWeekend(start)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Weekends are not available' }),
        };
      }

      const end = new Date(start.getTime() + duration * 60 * 1000);
      if (!isWithinHours(start, end)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Selected time is outside business hours' }),
        };
      }

      const dayKey = getDayKey(start);
      if (BOOKING_BLACKOUT_DATES.includes(dayKey)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Selected date is not available' }),
        };
      }

      const bufferMs = BOOKING_BUFFER_MIN * 60 * 1000;
      const startBuffered = new Date(start.getTime() - bufferMs);
      const endBuffered = new Date(end.getTime() + bufferMs);

      const conflict = await Booking.findOne({
        startAt: { $lt: endBuffered },
        endAt: { $gt: startBuffered },
      }).lean();

      if (conflict) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: 'That slot is already booked. Choose another time.' }),
        };
      }

      const booking = new Booking({
        name,
        email,
        phone,
        startAt: start,
        endAt: end,
        durationMinutes: duration,
        service: service || 'General',
        notes: notes || '',
      });

      await booking.save();

      // Send emails
      const when = start.toLocaleString();
      const notifyEmail = process.env.NOTIFY_EMAIL;
      if (notifyEmail) {
        await sendEmail({
          to: notifyEmail,
          subject: `New Booking: ${service}`,
          text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nService: ${service}\nWhen: ${when}\nDuration: ${duration} min\nNotes: ${notes || 'N/A'}`,
        }).catch((err) => console.error('Failed to send notification email:', err.message));
      }

      await sendEmail({
        to: email,
        subject: 'Booking confirmed',
        text: `Hi ${name},\n\nYour booking is confirmed.\nService: ${service}\nWhen: ${when}\nDuration: ${duration} min\n\nI will contact you soon.\n`,
      }).catch((err) => console.error('Failed to send confirmation email:', err.message));

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, id: booking._id }),
      };
    }

    // Proposal API
    if (path === '/api/proposal' && method === 'POST') {
      const { name, email, company, projectType, timeline, budgetRange, details } = body;

      if (!name || !email || !projectType) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing required fields' }),
        };
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(String(email).trim())) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid email address' }),
        };
      }

      const proposal = new Proposal({
        name,
        email,
        company: company || '',
        projectType,
        timeline: timeline || '',
        budgetRange: budgetRange || '',
        details: details || '',
      });

      await proposal.save();

      // Send notification email
      const notifyEmail = process.env.NOTIFY_EMAIL;
      if (notifyEmail) {
        await sendEmail({
          to: notifyEmail,
          subject: `New Proposal Request: ${projectType}`,
          text: `Name: ${name}\nEmail: ${email}\nCompany: ${company || 'N/A'}\nProject Type: ${projectType}\nTimeline: ${timeline || 'N/A'}\nBudget: ${budgetRange || 'N/A'}\nDetails: ${details || 'N/A'}`,
        }).catch((err) => console.error('Failed to send proposal notification:', err.message));
      }

      // Send confirmation to user
      await sendEmail({
        to: email,
        subject: 'Proposal received',
        text: `Hi ${name},\n\nThank you for your interest. I have received your proposal request for a ${projectType} project.\n\nI will review your details and get back to you soon.\n\nBest regards,\nMalle Krishna`,
      }).catch((err) => console.error('Failed to send proposal confirmation:', err.message));

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, id: proposal._id }),
      };
    }

    // Default 404
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not Found' }),
    };

  } catch (err) {
    console.error('API Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', message: err.message }),
    };
  }
};

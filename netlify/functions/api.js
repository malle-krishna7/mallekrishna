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

dotenv.config();

let dbConnected = false;

async function ensureDB() {
  if (!dbConnected) {
    await connectDb();
    dbConnected = true;
  }
}

function getDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

      const start = new Date(startAt);
      const end = new Date(start.getTime() + durationMinutes * 60000);

      const booking = new Booking({
        name,
        email,
        phone,
        startAt: start,
        endAt: end,
        durationMinutes,
        service: service || 'General',
        notes: notes || '',
      });

      await booking.save();

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

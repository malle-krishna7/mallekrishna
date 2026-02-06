const express = require('express');
const Contact = require('../models/Contact');
const { sendEmail } = require('../email');

const router = express.Router();

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimitBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  rateLimitBuckets.set(ip, bucket);
  return bucket.count > RATE_LIMIT_MAX;
}

router.post('/', async (req, res) => {
  try {
    const ip =
      (req.headers['x-forwarded-for'] && String(req.headers['x-forwarded-for']).split(',')[0].trim()) ||
      req.socket.remoteAddress ||
      'unknown';

    if (isRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many requests. Please try again in a minute.' });
    }

    const { name, email, subject, message, company } = req.body;
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    // Honeypot: real users won't fill this hidden field.
    if (company && String(company).trim().length > 0) {
      return res.status(400).json({ error: 'Invalid submission.' });
    }

    const emailStr = String(email).trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailStr)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const doc = await Contact.create({ name, email, subject, message });

    const notify = process.env.NOTIFY_EMAIL;
    if (notify) {
      await sendEmail({
        to: notify,
        subject: `New Contact: ${subject}`,
        text: `Name: ${name}\nEmail: ${email}\nSubject: ${subject}\n\n${message}`
      });
    }
    return res.status(201).json({ ok: true, id: doc._id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

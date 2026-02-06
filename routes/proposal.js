const express = require('express');
const Proposal = require('../models/Proposal');
const { sendEmail } = require('../email');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { name, email, company, projectType, timeline, budgetRange, details } = req.body;
    if (!name || !email || !projectType || !timeline || !details) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    const emailStr = String(email).trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailStr)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    const doc = await Proposal.create({
      name,
      email: emailStr,
      company,
      projectType,
      timeline,
      budgetRange,
      details
    });

    const notify = process.env.NOTIFY_EMAIL;
    if (notify) {
      await sendEmail({
        to: notify,
        subject: `New Proposal: ${projectType}`,
        text: `Name: ${name}\nEmail: ${emailStr}\nCompany: ${company || ''}\nType: ${projectType}\nTimeline: ${timeline}\nBudget: ${budgetRange || ''}\n\n${details}`
      });
    }
    return res.status(201).json({ ok: true, id: doc._id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

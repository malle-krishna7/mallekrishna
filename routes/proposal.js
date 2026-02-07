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

    let score = 0;
    const timelineScore = {
      'ASAP': 30,
      '2-4 weeks': 25,
      '1-2 months': 15,
      '3+ months': 5
    };
    const budgetScore = {
      '$30k+': 30,
      '$15k - $30k': 22,
      '$5k - $15k': 12,
      '$1k - $5k': 5
    };
    score += timelineScore[timeline] || 0;
    score += budgetScore[budgetRange] || 0;
    score += projectType === 'Web App' ? 10 : 0;
    score += projectType === 'Mobile App' ? 8 : 0;
    score += company ? 5 : 0;

    const doc = await Proposal.create({
      name,
      email: emailStr,
      company,
      projectType,
      timeline,
      budgetRange,
      details,
      score
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

const mongoose = require('mongoose');

const proposalSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, maxlength: 200 },
  company: { type: String, trim: true, maxlength: 200 },
  projectType: { type: String, required: true, trim: true, maxlength: 100 },
  timeline: { type: String, required: true, trim: true, maxlength: 100 },
  budgetRange: { type: String, trim: true, maxlength: 100 },
  details: { type: String, required: true, trim: true, maxlength: 4000 },
  status: { type: String, enum: ['New', 'In Progress', 'Done'], default: 'New' },
  adminNote: { type: String, trim: true, maxlength: 2000 },
  score: { type: Number, default: 0 },
  paymentStatus: { type: String, enum: ['Unpaid', 'Paid'], default: 'Unpaid' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Proposal || mongoose.model('Proposal', proposalSchema);

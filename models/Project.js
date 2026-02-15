const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    dueDate: { type: String, trim: true, maxlength: 20 },
    status: { type: String, trim: true, maxlength: 40 },
    approved: { type: Boolean, default: false },
    approvedAt: { type: Date },
    approvedBy: { type: String, trim: true, maxlength: 120 }
  },
  { _id: false }
);

const linkSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 100 },
    url: { type: String, trim: true, maxlength: 500 }
  },
  { _id: false }
);

const updateSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 200 },
    body: { type: String, trim: true, maxlength: 2000 },
    author: { type: String, trim: true, maxlength: 120 },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const fileSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 200 },
    url: { type: String, trim: true, maxlength: 800 },
    note: { type: String, trim: true, maxlength: 500 },
    uploadedBy: { type: String, trim: true, maxlength: 120 },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const contractSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 200 },
    url: { type: String, trim: true, maxlength: 800 },
    status: { type: String, trim: true, maxlength: 40, default: 'Pending' },
    requestedAt: { type: Date, default: Date.now },
    signedAt: { type: Date }
  },
  { _id: false }
);

const feedbackSchema = new mongoose.Schema(
  {
    author: { type: String, trim: true, maxlength: 120 },
    message: { type: String, trim: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  status: { type: String, enum: ['Planned', 'In Progress', 'Review', 'Done'], default: 'Planned' },
  summary: { type: String, trim: true, maxlength: 1200 },
  milestones: [milestoneSchema],
  links: [linkSchema],
  updates: [updateSchema],
  files: [fileSchema],
  contracts: [contractSchema],
  feedback: [feedbackSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Project || mongoose.model('Project', projectSchema);

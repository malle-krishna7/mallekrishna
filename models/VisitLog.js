const mongoose = require('mongoose');

const visitLogSchema = new mongoose.Schema({
  path: { type: String, required: true },
  ip: { type: String, required: true },
  userAgent: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

visitLogSchema.index({ createdAt: -1 });

module.exports = mongoose.models.VisitLog || mongoose.model('VisitLog', visitLogSchema);


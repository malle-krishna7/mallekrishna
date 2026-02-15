const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, maxlength: 200, unique: true },
  company: { type: String, trim: true, maxlength: 200 },
  logoUrl: { type: String, trim: true, maxlength: 800 },
  accentColor: { type: String, trim: true, maxlength: 40 },
  schedulingUrl: { type: String, trim: true, maxlength: 800 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Client || mongoose.model('Client', clientSchema);

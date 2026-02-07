const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, maxlength: 200, unique: true },
  company: { type: String, trim: true, maxlength: 200 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Client || mongoose.model('Client', clientSchema);


const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, maxlength: 200 },
  subject: { type: String, required: true, trim: true, maxlength: 200 },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Contact || mongoose.model('Contact', contactSchema);


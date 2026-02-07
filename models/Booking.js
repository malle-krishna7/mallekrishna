const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, maxlength: 200 },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  service: { type: String, required: true, trim: true, maxlength: 100 },
  durationMinutes: { type: Number, required: true, min: 15, max: 180 },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  notes: { type: String, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['New', 'In Progress', 'Done'], default: 'New' },
  adminNote: { type: String, trim: true, maxlength: 2000 },
  paymentStatus: { type: String, enum: ['Unpaid', 'Paid'], default: 'Unpaid' },
  createdAt: { type: Date, default: Date.now }
});

bookingSchema.index({ startAt: 1, endAt: 1 });

module.exports = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);

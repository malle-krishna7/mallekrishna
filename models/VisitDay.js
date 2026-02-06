const mongoose = require('mongoose');

const visitDaySchema = new mongoose.Schema({
  day: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 }
});

module.exports = mongoose.models.VisitDay || mongoose.model('VisitDay', visitDaySchema);


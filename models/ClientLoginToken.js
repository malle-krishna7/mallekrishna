const mongoose = require('mongoose');

const clientLoginTokenSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  tokenHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

clientLoginTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.ClientLoginToken || mongoose.model('ClientLoginToken', clientLoginTokenSchema);


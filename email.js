const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

async function sendEmail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transport.sendMail({ from, to, subject, text, html });
  return true;
}

module.exports = { sendEmail };


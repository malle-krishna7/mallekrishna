const dotenv = require('dotenv');
const Contact = require('../../models/Contact');
const Booking = require('../../models/Booking');
const Proposal = require('../../models/Proposal');
const VisitDay = require('../../models/VisitDay');
const connectDb = require('../../db');

dotenv.config();

let dbConnected = false;

async function ensureDB() {
  if (!dbConnected) {
    await connectDb();
    dbConnected = true;
  }
}

function basicAuth(req) {
  const auth = req.headers?.authorization || '';
  const decoded = Buffer.from(auth.split(' ')[1] || '', 'base64').toString();
  const [user, pass] = decoded.split(':');
  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPass = process.env.ADMIN_PASS || 'changeme';
  return user === expectedUser && pass === expectedPass;
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };

  try {
    await ensureDB();

    const path = event.path;
    const method = event.httpMethod;

    // Login page
    if (path === '/admin/login' || path === '/admin') {
      if (basicAuth(event)) {
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
          body: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Admin Dashboard</title>
  <style>
    :root { --bg: #0b1410; --text: #e0e0e0; --border: #3a4a42; --panel: #1a2520; --accent: #caa65a; }
    body { font-family: ui-sans-serif, system-ui; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(11,20,16,0.9); }
    main { padding: 24px; max-width: 1200px; }
    .card { border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: var(--panel); margin-bottom: 12px; }
    .stat { font-size: 28px; font-weight: 700; color: var(--accent); margin: 8px 0; }
    .btn { display: inline-block; padding: 8px 12px; border-radius: 10px; background: #caa65a; color: #0b1410; text-decoration: none; font-weight: 700; margin-right: 8px; }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <div>Admin Dashboard</div>
    <div>
      <a href="/admin/exports">Exports</a>&nbsp;&nbsp;
      <a href="/admin/logout">Logout</a>
    </div>
  </header>
  <main>
    <div class="card">
      <div><strong>📧 Contacts Received</strong></div>
      <div class="stat" id="contact-count">Loading...</div>
      <a class="btn" href="/admin/export/contacts">Export</a>
    </div>
    <div class="card">
      <div><strong>📅 Bookings</strong></div>
      <div class="stat" id="booking-count">Loading...</div>
      <a class="btn" href="/admin/export/bookings">Export</a>
    </div>
    <div class="card">
      <div><strong>💼 Proposals</strong></div>
      <div class="stat" id="proposal-count">Loading...</div>
      <a class="btn" href="/admin/export/proposals">Export</a>
    </div>
    <div class="card">
      <div><strong>👥 Site Visits</strong></div>
      <div class="stat" id="visit-count">Loading...</div>
    </div>
  </main>
  <script>
    fetch('/admin/stats', { headers: { 'Authorization': 'Basic ' + btoa('${process.env.ADMIN_USER}:${process.env.ADMIN_PASS}') } })
      .then(r => r.json())
      .then(d => {
        document.getElementById('contact-count').textContent = d.contacts || 0;
        document.getElementById('booking-count').textContent = d.bookings || 0;
        document.getElementById('proposal-count').textContent = d.proposals || 0;
        document.getElementById('visit-count').textContent = d.visits || 0;
      })
      .catch(e => console.error(e));
  </script>
</body>
</html>
          `,
        };
      }

      return {
        statusCode: 401,
        headers: { ...headers, 'WWW-Authenticate': 'Basic realm="Admin"' },
        body: `
<!DOCTYPE html>
<html>
<head>
  <title>Admin Login</title>
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; background: #0b1410; color: #e0e0e0; }
    .login-box { border: 1px solid #3a4a42; border-radius: 14px; padding: 32px; width: 300px; background: #1a2520; }
    input { width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box; background: #0b1410; color: #e0e0e0; border: 1px solid #3a4a42; border-radius: 6px; }
    button { width: 100%; padding: 10px; margin-top: 16px; background: #caa65a; color: #0b1410; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <div class="login-box">
    <h2>Admin Login</h2>
    <form onsubmit="login(event)">
      <input type="text" id="user" placeholder="Username" required>
      <input type="password" id="pass" placeholder="Password" required>
      <button type="submit">Login</button>
    </form>
  </div>
  <script>
    function login(e) {
      e.preventDefault();
      const user = document.getElementById('user').value;
      const pass = document.getElementById('pass').value;
      const auth = 'Basic ' + btoa(user + ':' + pass);
      fetch('/admin', { headers: { 'Authorization': auth } })
        .then(r => r.ok ? (localStorage.setItem('auth', auth), window.location.reload()) : alert('Invalid credentials'))
        .catch(alert);
    }
  </script>
</body>
</html>
        `,
      };
    }

    // Stats endpoint
    if (path === '/admin/stats' && method === 'GET') {
      if (!basicAuth(event)) {
        return {
          statusCode: 401,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Unauthorized' }),
        };
      }

      const contacts = await Contact.countDocuments();
      const bookings = await Booking.countDocuments();
      const proposals = await Proposal.countDocuments();
      const visits = await VisitDay.aggregate([{ $group: { _id: null, total: { $sum: '$count' } } }]);

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts,
          bookings,
          proposals,
          visits: visits[0]?.total || 0,
        }),
      };
    }

    // Export endpoints
    if (path === '/admin/export/contacts' && method === 'GET') {
      if (!basicAuth(event)) {
        return { statusCode: 401, headers, body: 'Unauthorized' };
      }

      const rows = await Contact.find().sort({ createdAt: -1 }).lean();
      const header = ['createdAt', 'name', 'email', 'subject', 'message'];
      const lines = rows.map((r) =>
        [
          r.createdAt ? new Date(r.createdAt).toISOString() : '',
          r.name,
          r.email,
          r.subject,
          r.message
        ].map(csvEscape).join(',')
      );

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="contacts.csv"' },
        body: [header.join(','), ...lines].join('\n'),
      };
    }

    if (path === '/admin/export/bookings' && method === 'GET') {
      if (!basicAuth(event)) {
        return { statusCode: 401, headers, body: 'Unauthorized' };
      }

      const rows = await Booking.find().sort({ startAt: 1 }).lean();
      const header = ['startAt', 'endAt', 'name', 'email', 'phone', 'service', 'durationMinutes', 'notes'];
      const lines = rows.map((r) =>
        [
          r.startAt ? new Date(r.startAt).toISOString() : '',
          r.endAt ? new Date(r.endAt).toISOString() : '',
          r.name,
          r.email,
          r.phone,
          r.service,
          r.durationMinutes,
          r.notes
        ].map(csvEscape).join(',')
      );

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="bookings.csv"' },
        body: [header.join(','), ...lines].join('\n'),
      };
    }

    if (path === '/admin/export/proposals' && method === 'GET') {
      if (!basicAuth(event)) {
        return { statusCode: 401, headers, body: 'Unauthorized' };
      }

      const rows = await Proposal.find().sort({ createdAt: -1 }).lean();
      const header = ['createdAt', 'name', 'email', 'company', 'projectType', 'timeline', 'budgetRange', 'details'];
      const lines = rows.map((r) =>
        [
          r.createdAt ? new Date(r.createdAt).toISOString() : '',
          r.name,
          r.email,
          r.company,
          r.projectType,
          r.timeline,
          r.budgetRange,
          r.details
        ].map(csvEscape).join(',')
      );

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="proposals.csv"' },
        body: [header.join(','), ...lines].join('\n'),
      };
    }

    return {
      statusCode: 404,
      headers,
      body: 'Not Found',
    };

  } catch (err) {
    console.error('Admin Error:', err);
    return {
      statusCode: 500,
      headers,
      body: 'Internal Server Error: ' + err.message,
    };
  }
};

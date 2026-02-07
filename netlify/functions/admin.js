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

// Logout
    if (path === '/admin/logout' && method === 'GET') {
      return {
        statusCode: 401,
        headers: { ...headers, 'WWW-Authenticate': 'Basic realm="Admin"' },
        body: 'Logged out.',
      };
    }

    // Login page and Dashboard
    if (path === '/admin' || path === '/admin/') {
      if (basicAuth(event)) {
        // Dashboard
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
          body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard</title>
  <style>
    :root { --bg: #0b1410; --text: #e0e0e0; --border: #3a4a42; --panel: #1a2520; --accent: #caa65a; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); }
    header { padding: 20px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(11,20,16,0.95); position: sticky; top: 0; }
    header h1 { font-size: 18px; font-weight: 600; }
    .header-actions { display: flex; gap: 16px; }
    .header-actions a { color: var(--accent); text-decoration: none; font-size: 14px; }
    .header-actions a:hover { opacity: 0.7; }
    main { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .card { border: 1px solid var(--border); border-radius: 12px; padding: 20px; background: var(--panel); }
    .card h3 { font-size: 14px; font-weight: 600; margin-bottom: 12px; opacity: 0.8; }
    .stat { font-size: 32px; font-weight: 700; color: var(--accent); margin: 8px 0; }
    .stat-label { font-size: 12px; color: var(--text); opacity: 0.6; margin-top: 8px; }
    .btn { display: inline-block; padding: 8px 16px; border-radius: 8px; background: var(--accent); color: #0b1410; text-decoration: none; font-weight: 600; font-size: 13px; margin-top: 12px; border: none; cursor: pointer; }
    .btn:hover { opacity: 0.9; }
    .btn.secondary { background: transparent; border: 1px solid var(--border); color: var(--accent); }
    .loading { opacity: 0.5; }
    .error { color: #ff6b6b; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>📊 Admin Dashboard</h1>
    <div class="header-actions">
      <a href="/admin/exports">📥 Exports</a>
      <a href="/admin/logout">🚪 Logout</a>
    </div>
  </header>
  <main>
    <div class="grid">
      <div class="card">
        <h3>💌 Contacts</h3>
        <div class="stat loading" id="contact-count">—</div>
        <div class="stat-label">total received</div>
        <a class="btn" href="/admin/export/contacts">Download CSV</a>
      </div>
      <div class="card">
        <h3>📅 Bookings</h3>
        <div class="stat loading" id="booking-count">—</div>
        <div class="stat-label">total bookings</div>
        <a class="btn" href="/admin/export/bookings">Download CSV</a>
      </div>
      <div class="card">
        <h3>💼 Proposals</h3>
        <div class="stat loading" id="proposal-count">—</div>
        <div class="stat-label">total requests</div>
        <a class="btn" href="/admin/export/proposals">Download CSV</a>
      </div>
      <div class="card">
        <h3>👥 Site Visits</h3>
        <div class="stat loading" id="visit-count">—</div>
        <div class="stat-label">last 90 days</div>
      </div>
    </div>
  </main>
  <script>
    const apiUrl = '/admin/stats';
    const headers = new Headers({
      'Authorization': 'Basic ' + btoa('${process.env.ADMIN_USER}:${process.env.ADMIN_PASS}')
    });

    fetch(apiUrl, { headers })
      .then(r => {
        if (!r.ok) throw new Error('Failed to load stats');
        return r.json();
      })
      .then(data => {
        document.getElementById('contact-count').textContent = data.contacts || 0;
        document.getElementById('contact-count').classList.remove('loading');
        
        document.getElementById('booking-count').textContent = data.bookings || 0;
        document.getElementById('booking-count').classList.remove('loading');
        
        document.getElementById('proposal-count').textContent = data.proposals || 0;
        document.getElementById('proposal-count').classList.remove('loading');
        
        document.getElementById('visit-count').textContent = data.visits || 0;
        document.getElementById('visit-count').classList.remove('loading');
      })
      .catch(err => {
        console.error('Error loading stats:', err);
        document.querySelectorAll('.stat').forEach(stat => {
          stat.textContent = 'Error';
          stat.classList.add('error');
          stat.classList.remove('loading');
        });
      });
  </script>
</body>
</html>`,
        };
      }

      // Login form
      return {
        statusCode: 401,
        headers: { ...headers, 'WWW-Authenticate': 'Basic realm="Admin"', 'Content-Type': 'text/html; charset=utf-8' },
        body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login</title>
  <style>
    :root { --bg: #0b1410; --text: #e0e0e0; --border: #3a4a42; --panel: #1a2520; --accent: #caa65a; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: linear-gradient(135deg, var(--bg), #141614); color: var(--text); }
    .login-container { width: 100%; max-width: 400px; padding: 20px; }
    .login-box { border: 1px solid var(--border); border-radius: 12px; padding: 40px; background: var(--panel); box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
    .login-box h2 { font-size: 24px; margin-bottom: 8px; font-weight: 600; }
    .login-box p { font-size: 13px; opacity: 0.6; margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; opacity: 0.8; }
    input { width: 100%; padding: 10px; background: rgba(255,255,255,0.05); color: var(--text); border: 1px solid var(--border); border-radius: 8px; font-size: 14px; }
    input:focus { outline: none; border-color: var(--accent); background: rgba(255,255,255,0.08); }
    button { width: 100%; padding: 10px; margin-top: 16px; background: var(--accent); color: #0b1410; border: none; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; }
    button:hover { opacity: 0.9; }
    .error { color: #ff6b6b; font-size: 12px; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-box">
      <h2>Admin Login</h2>
      <p>Enter your credentials to access the dashboard</p>
      <form onsubmit="handleLogin(event)">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" placeholder="admin" required autofocus>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" placeholder="••••••••" required>
        </div>
        <button type="submit">Sign In</button>
        <div class="error" id="error-msg"></div>
      </form>
    </div>
  </div>
  <script>
    function handleLogin(e) {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const auth = 'Basic ' + btoa(username + ':' + password);
      
      fetch('/admin', { 
        headers: { 'Authorization': auth } 
      })
      .then(r => {
        if (r.ok) {
          sessionStorage.setItem('adminAuth', auth);
          window.location.href = '/admin';
        } else {
          document.getElementById('error-msg').textContent = 'Invalid credentials';
          document.getElementById('error-msg').style.display = 'block';
        }
      })
      .catch(err => {
        console.error(err);
        document.getElementById('error-msg').textContent = 'Connection error';
        document.getElementById('error-msg').style.display = 'block';
      });
    }
  </script>
</body>
</html>`,
      };
    }

    // Exports page
    if (path === '/admin/exports' && method === 'GET') {
      if (!basicAuth(event)) {
        return {
          statusCode: 401,
          headers: { ...headers, 'WWW-Authenticate': 'Basic realm="Admin"' },
          body: 'Unauthorized',
        };
      }

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
        body: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Exports</title>
  <style>
    :root { --bg: #0b1410; --text: #e0e0e0; --border: #3a4a42; --panel: #1a2520; --accent: #caa65a; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); }
    header { padding: 20px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(11,20,16,0.95); }
    header h1 { font-size: 18px; font-weight: 600; }
    .header-actions a { color: var(--accent); text-decoration: none; font-size: 14px; margin-left: 16px; }
    main { padding: 24px; max-width: 600px; margin: 0 auto; }
    .export-item { border: 1px solid var(--border); border-radius: 12px; padding: 20px; background: var(--panel); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    .export-item h3 { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .export-item p { font-size: 12px; opacity: 0.6; }
    .btn { padding: 8px 16px; border-radius: 8px; background: var(--accent); color: #0b1410; text-decoration: none; font-weight: 600; font-size: 13px; border: none; cursor: pointer; }
    .btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <header>
    <h1>📥 Export Data</h1>
    <a href="/admin">← Back to Dashboard</a>
  </header>
  <main>
    <div class="export-item">
      <div>
        <h3>💌 Contacts</h3>
        <p>Download all contact form submissions</p>
      </div>
      <a class="btn" href="/admin/export/contacts" download>CSV</a>
    </div>
    <div class="export-item">
      <div>
        <h3>📅 Bookings</h3>
        <p>Download all booking requests</p>
      </div>
      <a class="btn" href="/admin/export/bookings" download>CSV</a>
    </div>
    <div class="export-item">
      <div>
        <h3>💼 Proposals</h3>
        <p>Download all proposal requests</p>
      </div>
      <a class="btn" href="/admin/export/proposals" download>CSV</a>
    </div>
  </main>
</body>
</html>`,
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

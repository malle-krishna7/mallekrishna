const path = require('path');
const crypto = require('crypto');
const express = require('express');
const dotenv = require('dotenv');
const connectDb = require('./db');
const contactRoutes = require('./routes/contact');
const bookingRoutes = require('./routes/booking');
const proposalRoutes = require('./routes/proposal');
const Contact = require('./models/Contact');
const Booking = require('./models/Booking');
const VisitDay = require('./models/VisitDay');
const VisitLog = require('./models/VisitLog');
const Proposal = require('./models/Proposal');

dotenv.config();

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function getDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

async function trackVisit(req) {
  const day = getDayKey(new Date());
  await VisitDay.updateOne({ day }, { $inc: { count: 1 } }, { upsert: true });
  await VisitLog.create({
    path: req.path,
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || 'unknown')
  });
}

const TRACK_PATHS = new Set([
  '/',
  '/projects/',
  '/projects/mentor-connect.html',
  '/projects/ai-xray-diagnosis.html',
  '/projects/ngo-food-donation.html'
]);

app.use(async (req, res, next) => {
  if (req.method === 'GET' && TRACK_PATHS.has(req.path)) {
    try {
      await trackVisit(req);
    } catch (err) {
      console.error('Visit tracking error:', err.message);
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/contact', contactRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/proposal', proposalRoutes);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

function getAdminSecret() {
  return process.env.ADMIN_SECRET || process.env.ADMIN_PASS || 'change_me';
}

function signToken(payload) {
  const secret = getAdminSecret();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', getAdminSecret()).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function adminAuth(req, res, next) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    return res.status(500).send('Admin auth is not configured.');
  }

  const cookies = parseCookies(req);
  const token = cookies.admin_session;
  const payload = verifyToken(token);
  if (payload && payload.user === user) {
    return next();
  }
  // Hide admin routes unless authenticated
  return res.status(404).send('Not found');
}

app.get('/admin/login', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Login</title>
  <style>
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: radial-gradient(circle at 10% 10%, rgba(30,107,78,0.35), transparent 45%), var(--bg); color: var(--text); }
    .wrap { max-width: 460px; margin: 10vh auto; padding: 28px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .subtitle { color: var(--muted); margin-bottom: 18px; }
    label { display: block; margin: 12px 0 6px; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
    input { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--border); background: #0f1812; color: var(--text); }
    button { margin-top: 16px; width: 100%; padding: 12px; border: 0; border-radius: 10px; background: linear-gradient(135deg, var(--accent), #e2c27c); color: #0b1410; font-weight: 700; cursor: pointer; letter-spacing: 1px; text-transform: uppercase; }
    .note { margin-top: 10px; color: var(--muted); font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Admin Login</h1>
    <div class="subtitle">Secure access for portfolio management</div>
    <form method="post" action="/admin/login">
      <label for="user">Admin ID</label>
      <input id="user" name="user" required />
      <label for="pass">Password</label>
      <input id="pass" name="pass" type="password" required />
      <button type="submit">Sign In</button>
    </form>
    <div class="note">Use the credentials from your .env</div>
  </div>
</body>
</html>`);
});

const loginBuckets = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX = 5;

function isLoginRateLimited(ip) {
  const now = Date.now();
  const bucket = loginBuckets.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + LOGIN_WINDOW_MS;
  }
  bucket.count += 1;
  loginBuckets.set(ip, bucket);
  return bucket.count > LOGIN_MAX;
}

app.post('/admin/login', (req, res) => {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    return res.status(500).send('Admin auth is not configured.');
  }
  const ip = getClientIp(req);
  if (isLoginRateLimited(ip)) {
    return res.status(429).send('Too many attempts. Try again later.');
  }
  const { user: inputUser, pass: inputPass } = req.body;
  if (inputUser !== user || inputPass !== pass) {
    return res.status(401).send('Invalid credentials.');
  }
  const token = signToken({ user, exp: Date.now() + 1000 * 60 * 60 * 8 });
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader('Set-Cookie', `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/;${secure}`);
  return res.redirect('/admin');
});

app.get('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return res.redirect('/admin/login');
});

app.get('/admin/messages', adminAuth, async (req, res) => {
  try {
    const messages = await Contact.find().sort({ createdAt: -1 }).limit(200).lean();
    const rows = messages
      .map((m) => {
        const createdAt = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
        const esc = (s) =>
          String(s || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');

        return `<tr>
  <td>${esc(createdAt)}</td>
  <td>${esc(m.name)}</td>
  <td><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></td>
  <td>${esc(m.subject)}</td>
  <td style="white-space:pre-wrap">${esc(m.message)}</td>
</tr>`;
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Messages</title>
  <style>
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(11,20,16,0.9); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    h1 { margin: 0 0 10px; font-size: 26px; }
    .meta { color: var(--muted); margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: 10px; vertical-align: top; }
    th { background: #0f1812; text-align: left; position: sticky; top: 0; }
    tr:nth-child(even) td { background: #101a14; }
    .actions { display: flex; gap: 10px; margin-bottom: 14px; }
    .btn { display: inline-block; padding: 8px 12px; border-radius: 10px; background: #caa65a; color: #0b1410; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <header>
    <div>Admin Messages</div>
    <a href="/admin">Dashboard</a>
  </header>
  <main>
  <h1>Contact Messages</h1>
  <div class="meta">Showing latest ${messages.length} messages (max 200).</div>
  <div class="actions">
    <a class="btn" href="/admin/export/contacts">Download CSV</a>
  </div>
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Name</th>
        <th>Email</th>
        <th>Subject</th>
        <th>Message</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5">No messages yet.</td></tr>'}
    </tbody>
  </table>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

app.get('/admin', adminAuth, async (req, res) => {
  const now = new Date();
  const from = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);
  const visitTotal = await VisitLog.countDocuments({ createdAt: { $gte: from } });
  const visitAllTime = await VisitLog.countDocuments();
  const totalContacts = await Contact.countDocuments();
  const totalBookings = await Booking.countDocuments();
  const totalProposals = await Proposal.countDocuments();
  const upcomingBookings = await Booking.find({ startAt: { $gte: now } })
    .sort({ startAt: 1 })
    .limit(5)
    .lean();

  const upcomingHtml = upcomingBookings
    .map((b) => {
      const startAt = b.startAt ? new Date(b.startAt).toLocaleString() : '';
      return `<li>${startAt} — ${b.name} (${b.service})</li>`;
    })
    .join('');

  const days = 14;
  const fromChart = new Date(now.getTime() - 1000 * 60 * 60 * 24 * (days - 1));
  const dailyRaw = await VisitLog.aggregate([
    { $match: { createdAt: { $gte: fromChart } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
        },
        count: { $sum: 1 }
      }
    }
  ]);
  const dailyMap = new Map(dailyRaw.map((d) => [d._id, d.count]));
  const dailySeries = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(fromChart.getFullYear(), fromChart.getMonth(), fromChart.getDate() + i);
    const key = getDayKey(d);
    dailySeries.push({ day: key, count: dailyMap.get(key) || 0 });
  }

  const maxDaily = Math.max(1, ...dailySeries.map((d) => d.count));
  const barWidth = 16;
  const barGap = 8;
  const chartHeight = 120;
  const chartWidth = dailySeries.length * (barWidth + barGap);
  const bars = dailySeries
    .map((d, i) => {
      const h = Math.round((d.count / maxDaily) * chartHeight);
      const x = i * (barWidth + barGap);
      const y = chartHeight - h;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4" />`;
    })
    .join('');
  const labels = dailySeries
    .map((d, i) => {
      if (i % 3 !== 0) return '';
      const x = i * (barWidth + barGap);
      const short = d.day.slice(5);
      return `<text x="${x}" y="${chartHeight + 18}">${short}</text>`;
    })
    .join('');

  const pie = (value, total, label) => {
    const size = 120;
    const r = 48;
    const c = 2 * Math.PI * r;
    const pct = total ? value / total : 0;
    const dash = `${(pct * c).toFixed(2)} ${(c - pct * c).toFixed(2)}`;
    return `
      <div class="pie-card">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="pie-bg"></circle>
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="pie-fg" style="stroke-dasharray:${dash}"></circle>
        </svg>
        <div class="pie-meta">
          <div class="pie-value">${value}</div>
          <div class="pie-label">${label}</div>
        </div>
      </div>`;
  };

  const activityTotal = Math.max(1, totalContacts + totalBookings);
  const pieContacts = pie(totalContacts, activityTotal, 'Contacts');
  const pieBookings = pie(totalBookings, activityTotal, 'Bookings');

  const bookingsByService = await Booking.aggregate([
    {
      $group: {
        _id: '$service',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);
  const maxService = Math.max(1, ...bookingsByService.map((s) => s.count));
  const serviceBars = bookingsByService
    .map((s) => {
      const widthPct = Math.round((s.count / maxService) * 100);
      return `<div class="service-row">
        <div class="service-name">${s._id}</div>
        <div class="service-bar"><span style="width:${widthPct}%"></span></div>
        <div class="service-count">${s.count}</div>
      </div>`;
    })
    .join('');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Dashboard</title>
  <style>
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: radial-gradient(circle at 10% 10%, rgba(30,107,78,0.35), transparent 45%), var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(11,20,16,0.9); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    .sub { color: var(--muted); margin-bottom: 18px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 16px; }
    .card { border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: var(--panel); }
    .card a { display: inline-block; margin-top: 8px; color: var(--accent); }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
    .stat { border: 1px solid var(--border); border-radius: 12px; padding: 14px; background: var(--panel); }
    ul { padding-left: 18px; color: var(--muted); }
    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: 20px; }
    .chart-card { border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: var(--panel); }
    .bar-chart rect { fill: rgba(202,166,90,0.7); }
    .bar-chart text { fill: var(--muted); font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .pie-card { display: flex; gap: 12px; align-items: center; }
    .pie-bg { fill: none; stroke: rgba(202,166,90,0.2); stroke-width: 10; }
    .pie-fg { fill: none; stroke: #caa65a; stroke-width: 10; transform: rotate(-90deg); transform-origin: 50% 50%; }
    .pie-meta { display: grid; gap: 4px; }
    .pie-value { font-size: 22px; font-weight: 700; }
    .pie-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
    .service-row { display: grid; grid-template-columns: 110px 1fr 40px; gap: 10px; align-items: center; font-size: 12px; }
    .service-name { color: var(--muted); }
    .service-bar { height: 10px; background: rgba(202,166,90,0.15); border-radius: 999px; overflow: hidden; }
    .service-bar span { display: block; height: 100%; background: #caa65a; }
    .service-count { text-align: right; }
  </style>
</head>
<body>
  <header>
    <div>Admin Dashboard</div>
    <a href="/admin/logout">Sign out</a>
  </header>
  <main>
  <h1>Overview</h1>
  <div class="sub">Live metrics and quick access</div>
  <div class="stats">
    <div class="stat"><strong>Visits (30d)</strong><div>${visitTotal}</div></div>
    <div class="stat"><strong>Visits (All)</strong><div>${visitAllTime}</div></div>
    <div class="stat"><strong>Total Proposals</strong><div>${totalProposals}</div></div>
    <div class="stat"><strong>Total Contacts</strong><div>${totalContacts}</div></div>
    <div class="stat"><strong>Total Bookings</strong><div>${totalBookings}</div></div>
  </div>
  <div class="charts">
    <div class="chart-card">
      <div><strong>Visits (14 days)</strong></div>
      <svg class="bar-chart" viewBox="0 0 ${chartWidth} ${chartHeight + 24}" width="100%" height="160" preserveAspectRatio="xMinYMin">
        ${bars}
        ${labels}
      </svg>
    </div>
    <div class="chart-card">
      <div><strong>Contacts vs Bookings</strong></div>
      <div style="margin-top:12px; display:grid; gap:12px;">
        ${pieContacts}
        ${pieBookings}
      </div>
    </div>
    <div class="chart-card">
      <div><strong>Bookings by Service</strong></div>
      <div style="margin-top:12px; display:grid; gap:10px;">
        ${serviceBars || '<div>No bookings yet.</div>'}
      </div>
    </div>
  </div>
  <div>
    <strong>Upcoming Meetings</strong>
    <ul>${upcomingHtml || '<li>None yet</li>'}</ul>
  </div>
  <div class="cards">
    <div class="card">
      <div><strong>Contact Messages</strong></div>
      <div>View the latest messages.</div>
      <a href="/admin/messages">Open</a>
    </div>
    <div class="card">
      <div><strong>Proposals</strong></div>
      <div>Review proposal requests.</div>
      <a href="/admin/proposals">Open</a>
    </div>
    <div class="card">
      <div><strong>Bookings</strong></div>
      <div>View upcoming meetings.</div>
      <a href="/admin/bookings">Open</a>
    </div>
    <div class="card">
      <div><strong>Exports</strong></div>
      <div>Download CSV data.</div>
      <a href="/admin/exports">Open</a>
    </div>
  </div>
  </main>
</body>
</html>`);
});

app.get('/admin/bookings', adminAuth, async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ startAt: 1 }).limit(200).lean();
    const rows = bookings
      .map((b) => {
        const startAt = b.startAt ? new Date(b.startAt).toLocaleString() : '';
        const endAt = b.endAt ? new Date(b.endAt).toLocaleString() : '';
        const esc = (s) =>
          String(s || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');

        return `<tr>
  <td>${esc(startAt)}</td>
  <td>${esc(endAt)}</td>
  <td>${esc(b.name)}</td>
  <td><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></td>
  <td>${esc(b.phone)}</td>
  <td>${esc(b.service)}</td>
  <td>${esc(String(b.durationMinutes))} min</td>
  <td style="white-space:pre-wrap">${esc(b.notes)}</td>
</tr>`;
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Bookings</title>
  <style>
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(11,20,16,0.9); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    h1 { margin: 0 0 10px; font-size: 26px; }
    .meta { color: var(--muted); margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: 10px; vertical-align: top; }
    th { background: #0f1812; text-align: left; position: sticky; top: 0; }
    tr:nth-child(even) td { background: #101a14; }
    .actions { display: flex; gap: 10px; margin-bottom: 14px; }
    .btn { display: inline-block; padding: 8px 12px; border-radius: 10px; background: #caa65a; color: #0b1410; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <header>
    <div>Admin Bookings</div>
    <a href="/admin">Dashboard</a>
  </header>
  <main>
  <h1>Bookings</h1>
  <div class="meta">Showing next ${bookings.length} bookings (max 200).</div>
  <div class="actions">
    <a class="btn" href="/admin/export/bookings">Download CSV</a>
  </div>
  <table>
    <thead>
      <tr>
        <th>Start</th>
        <th>End</th>
        <th>Name</th>
        <th>Email</th>
        <th>Phone</th>
        <th>Service</th>
        <th>Duration</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="8">No bookings yet.</td></tr>'}
    </tbody>
  </table>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

app.get('/admin/proposals', adminAuth, async (req, res) => {
  try {
    const proposals = await Proposal.find().sort({ createdAt: -1 }).limit(200).lean();
    const rows = proposals
      .map((p) => {
        const createdAt = p.createdAt ? new Date(p.createdAt).toLocaleString() : '';
        const esc = (s) =>
          String(s || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');

        return `<tr>
  <td>${esc(createdAt)}</td>
  <td>${esc(p.name)}</td>
  <td><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></td>
  <td>${esc(p.company)}</td>
  <td>${esc(p.projectType)}</td>
  <td>${esc(p.timeline)}</td>
  <td>${esc(p.budgetRange)}</td>
  <td style="white-space:pre-wrap">${esc(p.details)}</td>
</tr>`;
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Proposals</title>
  <style>
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(11,20,16,0.9); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    h1 { margin: 0 0 10px; font-size: 26px; }
    .meta { color: var(--muted); margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: 10px; vertical-align: top; }
    th { background: #0f1812; text-align: left; position: sticky; top: 0; }
    tr:nth-child(even) td { background: #101a14; }
    .actions { display: flex; gap: 10px; margin-bottom: 14px; }
    .btn { display: inline-block; padding: 8px 12px; border-radius: 10px; background: #caa65a; color: #0b1410; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <header>
    <div>Admin Proposals</div>
    <a href="/admin">Dashboard</a>
  </header>
  <main>
  <h1>Proposals</h1>
  <div class="meta">Showing latest ${proposals.length} proposals (max 200).</div>
  <div class="actions">
    <a class="btn" href="/admin/export/proposals">Download CSV</a>
  </div>
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Name</th>
        <th>Email</th>
        <th>Company</th>
        <th>Project Type</th>
        <th>Timeline</th>
        <th>Budget</th>
        <th>Details</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="8">No proposals yet.</td></tr>'}
    </tbody>
  </table>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

app.get('/admin/exports', adminAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Exports</title>
  <style>
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: rgba(11,20,16,0.9); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    .card { border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: var(--panel); margin-bottom: 12px; }
    .btn { display: inline-block; padding: 8px 12px; border-radius: 10px; background: #caa65a; color: #0b1410; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <header>
    <div>Admin Exports</div>
    <a href="/admin">Dashboard</a>
  </header>
  <main>
    <div class="card">
      <div><strong>Contacts CSV</strong></div>
      <a class="btn" href="/admin/export/contacts">Download</a>
    </div>
    <div class="card">
      <div><strong>Bookings CSV</strong></div>
      <a class="btn" href="/admin/export/bookings">Download</a>
    </div>
    <div class="card">
      <div><strong>Proposals CSV</strong></div>
      <a class="btn" href="/admin/export/proposals">Download</a>
    </div>
  </main>
</body>
</html>`);
});

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

app.get('/admin/export/contacts', adminAuth, async (req, res) => {
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
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
  return res.send([header.join(','), ...lines].join('\n'));
});

app.get('/admin/export/bookings', adminAuth, async (req, res) => {
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
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
  return res.send([header.join(','), ...lines].join('\n'));
});

app.get('/admin/export/proposals', adminAuth, async (req, res) => {
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
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="proposals.csv"');
  return res.send([header.join(','), ...lines].join('\n'));
});

app.use((req, res) => {
  return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

const PORT = process.env.PORT || 3000;

connectDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

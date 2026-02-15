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
const Client = require('./models/Client');
const Project = require('./models/Project');
const ClientLoginToken = require('./models/ClientLoginToken');
const { sendEmail } = require('./email');

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

let dbConnected = false;

async function ensureDb(req, res, next) {
  if (dbConnected) return next();
  try {
    await connectDb();
    dbConnected = true;
    return next();
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    return res.status(500).send('Database connection error');
  }
}

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
app.use(['/api', '/admin', '/client', '/data'], ensureDb);

app.use('/api/contact', contactRoutes);
app.use('/api/booking', bookingRoutes);
app.use('/api/proposal', proposalRoutes);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

function getAdminSecret() {
  return process.env.ADMIN_SECRET || process.env.ADMIN_PASS || 'change_me';
}

function getClientSecret() {
  return process.env.CLIENT_SECRET || process.env.ADMIN_SECRET || 'change_me';
}

function signToken(payload) {
  const secret = getAdminSecret();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function signClientToken(payload) {
  const secret = getClientSecret();
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

function verifyClientToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', getClientSecret()).update(body).digest('base64url');
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

function clientAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies.client_session;
  const payload = verifyClientToken(token);
  if (payload && payload.clientId) {
    req.clientId = payload.clientId;
    return next();
  }
  return res.redirect('/client/login');
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
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); --header-bg: rgba(11,20,16,0.9); --table-head: #0f1812; --row-alt: #101a14; }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); --header-bg: rgba(247,244,239,0.9); --table-head: #f4efe9; --row-alt: #faf7f2; }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: radial-gradient(circle at 10% 10%, rgba(30,107,78,0.35), transparent 45%), var(--bg); color: var(--text); }
    .wrap { max-width: 460px; margin: 10vh auto; padding: 28px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .subtitle { color: var(--muted); margin-bottom: 18px; }
    label { display: block; margin: 12px 0 6px; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
      input { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--panel); color: var(--text); }
    button { margin-top: 16px; width: 100%; padding: 12px; border: 0; border-radius: 10px; background: linear-gradient(135deg, var(--accent), #e2c27c); color: #0b1410; font-weight: 700; cursor: pointer; letter-spacing: 1px; text-transform: uppercase; }
    .note { margin-top: 10px; color: var(--muted); font-size: 12px; }
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
  </style>
</head>
<body>
  <div class="wrap">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <h1>Admin Login</h1>
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" aria-pressed="false">
        <span class="theme-dot"></span>
        <span class="theme-label">Light</span>
      </button>
    </div>
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
  <script>
    (function() {
      const btn = document.getElementById('theme-toggle');
      const label = btn ? btn.querySelector('.theme-label') : null;
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const isLight = theme === 'light';
        if (btn) btn.setAttribute('aria-pressed', String(isLight));
        if (label) label.textContent = isLight ? 'Dark' : 'Light';
      }
      if (btn) {
        const saved = localStorage.getItem('theme');
        const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        applyTheme(initial);
        btn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme', next);
          applyTheme(next);
        });
      }
    })();
  </script>
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
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); --header-bg: rgba(11,20,16,0.9); --table-head: #0f1812; --row-alt: #101a14; }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); --header-bg: rgba(247,244,239,0.9); --table-head: #f4efe9; --row-alt: #faf7f2; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--header-bg); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    h1 { margin: 0 0 10px; font-size: 26px; }
    .meta { color: var(--muted); margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: 10px; vertical-align: top; }
    select, input[type="text"] { border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; background: var(--panel); color: var(--text); }
    th { background: var(--table-head); text-align: left; position: sticky; top: 0; }
    tr:nth-child(even) td { background: var(--row-alt); }
    .actions { display: flex; gap: 10px; margin-bottom: 14px; }
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
    .btn { display: inline-block; padding: 8px 12px; border-radius: 10px; background: #caa65a; color: #0b1410; text-decoration: none; font-weight: 700; }
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
  </style>
</head>
<body>
  <header>
    <div>Admin Messages</div>
    <div style="display:flex; align-items:center; gap:12px;">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" aria-pressed="false">
        <span class="theme-dot"></span>
        <span class="theme-label">Light</span>
      </button>
      <a href="/admin">Dashboard</a>
    </div>
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
  <script>
    (function() {
      const btn = document.getElementById('theme-toggle');
      const label = btn ? btn.querySelector('.theme-label') : null;
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const isLight = theme === 'light';
        if (btn) btn.setAttribute('aria-pressed', String(isLight));
        if (label) label.textContent = isLight ? 'Dark' : 'Light';
      }
      if (btn) {
        const saved = localStorage.getItem('theme');
        const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        applyTheme(initial);
        btn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme', next);
          applyTheme(next);
        });
      }
    })();
  </script>
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
  const uniqueVisitors30d = await VisitLog.aggregate([
    { $match: { createdAt: { $gte: from } } },
    { $group: { _id: '$ip' } },
    { $count: 'count' }
  ]);
  const uniqueVisitors = uniqueVisitors30d[0] ? uniqueVisitors30d[0].count : 0;
  const totalContacts = await Contact.countDocuments();
  const totalBookings = await Booking.countDocuments();
  const totalProposals = await Proposal.countDocuments();
  const conversionRate = visitTotal > 0 ? ((totalContacts + totalProposals) / visitTotal) * 100 : 0;
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
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); --header-bg: rgba(11,20,16,0.9); --table-head: #0f1812; --row-alt: #101a14; }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); --header-bg: rgba(247,244,239,0.9); --table-head: #f4efe9; --row-alt: #faf7f2; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: radial-gradient(circle at 10% 10%, rgba(30,107,78,0.35), transparent 45%), var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--header-bg); position: sticky; top: 0; }
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
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
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
    <div style="display:flex; align-items:center; gap:12px;">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" aria-pressed="false">
        <span class="theme-dot"></span>
        <span class="theme-label">Light</span>
      </button>
      <a href="/admin/logout">Sign out</a>
    </div>
  </header>
  <main>
  <h1>Overview</h1>
  <div class="sub">Live metrics and quick access</div>
  <div class="stats">
    <div class="stat"><strong>Visits (30d)</strong><div>${visitTotal}</div></div>
    <div class="stat"><strong>Unique (30d)</strong><div>${uniqueVisitors}</div></div>
    <div class="stat"><strong>Visits (All)</strong><div>${visitAllTime}</div></div>
    <div class="stat"><strong>Total Proposals</strong><div>${totalProposals}</div></div>
    <div class="stat"><strong>Total Contacts</strong><div>${totalContacts}</div></div>
    <div class="stat"><strong>Total Bookings</strong><div>${totalBookings}</div></div>
    <div class="stat"><strong>Lead Conversion</strong><div>${conversionRate.toFixed(1)}%</div></div>
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
      <div><strong>Clients</strong></div>
      <div>Manage client accounts.</div>
      <a href="/admin/clients">Open</a>
    </div>
    <div class="card">
      <div><strong>Projects</strong></div>
      <div>Manage client projects.</div>
      <a href="/admin/projects">Open</a>
    </div>
    <div class="card">
      <div><strong>Client Portal</strong></div>
      <div>Share portal with clients.</div>
      <a href="/client/login">Open</a>
    </div>
    <div class="card">
      <div><strong>Exports</strong></div>
      <div>Download CSV data.</div>
      <a href="/admin/exports">Open</a>
    </div>
  </div>
  </main>
  <script>
    (function() {
      const btn = document.getElementById('theme-toggle');
      const label = btn ? btn.querySelector('.theme-label') : null;
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const isLight = theme === 'light';
        if (btn) btn.setAttribute('aria-pressed', String(isLight));
        if (label) label.textContent = isLight ? 'Dark' : 'Light';
      }
      if (btn) {
        const saved = localStorage.getItem('theme');
        const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        applyTheme(initial);
        btn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme', next);
          applyTheme(next);
        });
      }
    })();
  </script>
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

        const statusOptions = ['New', 'In Progress', 'Done']
          .map((s) => `<option value="${s}" ${s === (b.status || 'New') ? 'selected' : ''}>${s}</option>`)
          .join('');
        const paymentOptions = ['Unpaid', 'Paid']
          .map((s) => `<option value="${s}" ${s === (b.paymentStatus || 'Unpaid') ? 'selected' : ''}>${s}</option>`)
          .join('');
        return `<tr>
  <td>${esc(startAt)}</td>
  <td>${esc(endAt)}</td>
  <td>${esc(b.name)}</td>
  <td><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></td>
  <td>${esc(b.phone)}</td>
  <td>${esc(b.service)}</td>
  <td>${esc(String(b.durationMinutes))} min</td>
  <td>
    <form method="post" action="/admin/bookings/${b._id}" style="display:flex; gap:8px; align-items:center;">
      <select name="status">
        ${statusOptions}
      </select>
      <select name="paymentStatus">
        ${paymentOptions}
      </select>
      <input type="text" name="adminNote" placeholder="Admin note" value="${esc(b.adminNote || '')}" />
      <button class="btn" type="submit">Save</button>
    </form>
  </td>
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
      :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); --header-bg: rgba(11,20,16,0.9); --table-head: #0f1812; --row-alt: #101a14; }
      [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); --header-bg: rgba(247,244,239,0.9); --table-head: #f4efe9; --row-alt: #faf7f2; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--header-bg); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    h1 { margin: 0 0 10px; font-size: 26px; }
    .meta { color: var(--muted); margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: 10px; vertical-align: top; }
      th { background: var(--table-head); text-align: left; position: sticky; top: 0; }
      tr:nth-child(even) td { background: var(--row-alt); }
      .actions { display: flex; gap: 10px; margin-bottom: 14px; }
      .btn { display: inline-block; padding: 8px 12px; border-radius: 10px; background: #caa65a; color: #0b1410; text-decoration: none; font-weight: 700; }
      .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
      .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
  </style>
</head>
<body>
  <header>
    <div>Admin Bookings</div>
    <div style="display:flex; align-items:center; gap:12px;">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" aria-pressed="false">
        <span class="theme-dot"></span>
        <span class="theme-label">Light</span>
      </button>
      <a href="/admin">Dashboard</a>
    </div>
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
        <th>Status</th>
        <th>Payment</th>
        <th>Admin Note</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="11">No bookings yet.</td></tr>'}
    </tbody>
  </table>
  </main>
  <script>
    (function() {
      const btn = document.getElementById('theme-toggle');
      const label = btn ? btn.querySelector('.theme-label') : null;
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const isLight = theme === 'light';
        if (btn) btn.setAttribute('aria-pressed', String(isLight));
        if (label) label.textContent = isLight ? 'Dark' : 'Light';
      }
      if (btn) {
        const saved = localStorage.getItem('theme');
        const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        applyTheme(initial);
        btn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme', next);
          applyTheme(next);
        });
      }
    })();
  </script>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

app.post('/admin/bookings/:id', adminAuth, async (req, res) => {
  try {
    const { status, adminNote, paymentStatus } = req.body;
    await Booking.updateOne(
      { _id: req.params.id },
      { $set: { status, adminNote, paymentStatus } }
    );
    return res.redirect('/admin/bookings');
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

        const statusOptions = ['New', 'In Progress', 'Done']
          .map((s) => `<option value="${s}" ${s === (p.status || 'New') ? 'selected' : ''}>${s}</option>`)
          .join('');
        const paymentOptions = ['Unpaid', 'Paid']
          .map((s) => `<option value="${s}" ${s === (p.paymentStatus || 'Unpaid') ? 'selected' : ''}>${s}</option>`)
          .join('');
        return `<tr>
  <td>${esc(createdAt)}</td>
  <td>${esc(p.name)}</td>
  <td><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></td>
  <td>${esc(p.company)}</td>
  <td>${esc(p.projectType)}</td>
  <td>${esc(p.timeline)}</td>
  <td>${esc(p.budgetRange)}</td>
  <td>${esc(String(p.score ?? 0))}</td>
  <td>
    <form method="post" action="/admin/proposals/${p._id}" style="display:flex; gap:8px; align-items:center;">
      <select name="status">
        ${statusOptions}
      </select>
      <select name="paymentStatus">
        ${paymentOptions}
      </select>
      <input type="text" name="adminNote" placeholder="Admin note" value="${esc(p.adminNote || '')}" />
      <button class="btn" type="submit">Save</button>
    </form>
  </td>
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
      :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); --header-bg: rgba(11,20,16,0.9); --table-head: #0f1812; --row-alt: #101a14; }
      [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); --header-bg: rgba(247,244,239,0.9); --table-head: #f4efe9; --row-alt: #faf7f2; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--header-bg); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    h1 { margin: 0 0 10px; font-size: 26px; }
    .meta { color: var(--muted); margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid var(--border); padding: 10px; vertical-align: top; }
    th { background: var(--table-head); text-align: left; position: sticky; top: 0; }
      tr:nth-child(even) td { background: var(--row-alt); }
      .actions { display: flex; gap: 10px; margin-bottom: 14px; }
      .btn { display: inline-block; padding: 8px 12px; border-radius: 10px; background: #caa65a; color: #0b1410; text-decoration: none; font-weight: 700; }
      .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
      .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
  </style>
</head>
<body>
  <header>
    <div>Admin Proposals</div>
    <div style="display:flex; align-items:center; gap:12px;">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" aria-pressed="false">
        <span class="theme-dot"></span>
        <span class="theme-label">Light</span>
      </button>
      <a href="/admin">Dashboard</a>
    </div>
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
        <th>Score</th>
        <th>Status</th>
        <th>Payment</th>
        <th>Details</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="11">No proposals yet.</td></tr>'}
    </tbody>
  </table>
  </main>
  <script>
    (function() {
      const btn = document.getElementById('theme-toggle');
      const label = btn ? btn.querySelector('.theme-label') : null;
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const isLight = theme === 'light';
        if (btn) btn.setAttribute('aria-pressed', String(isLight));
        if (label) label.textContent = isLight ? 'Dark' : 'Light';
      }
      if (btn) {
        const saved = localStorage.getItem('theme');
        const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        applyTheme(initial);
        btn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme', next);
          applyTheme(next);
        });
      }
    })();
  </script>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

app.post('/admin/proposals/:id', adminAuth, async (req, res) => {
  try {
    const { status, adminNote, paymentStatus } = req.body;
    await Proposal.updateOne(
      { _id: req.params.id },
      { $set: { status, adminNote, paymentStatus } }
    );
    return res.redirect('/admin/proposals');
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
    :root { --bg: #0b1410; --panel: #121f18; --text: #f4efe6; --muted: #c9bba4; --accent: #caa65a; --border: rgba(202,166,90,0.25); --header-bg: rgba(11,20,16,0.9); }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); --header-bg: rgba(247,244,239,0.9); }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--header-bg); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    .card { border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: var(--panel); margin-bottom: 12px; }
    .btn { display: inline-block; padding: 8px 12px; border-radius: 10px; background: #caa65a; color: #0b1410; text-decoration: none; font-weight: 700; }
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
  </style>
</head>
<body>
  <header>
    <div>Admin Exports</div>
    <div style="display:flex; align-items:center; gap:12px;">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" aria-pressed="false">
        <span class="theme-dot"></span>
        <span class="theme-label">Light</span>
      </button>
      <a href="/admin">Dashboard</a>
    </div>
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
  <script>
    (function() {
      const btn = document.getElementById('theme-toggle');
      const label = btn ? btn.querySelector('.theme-label') : null;
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const isLight = theme === 'light';
        if (btn) btn.setAttribute('aria-pressed', String(isLight));
        if (label) label.textContent = isLight ? 'Dark' : 'Light';
      }
      if (btn) {
        const saved = localStorage.getItem('theme');
        const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        applyTheme(initial);
        btn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme', next);
          applyTheme(next);
        });
      }
    })();
  </script>
</body>
</html>`);
});

app.get('/client/login', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Client Portal</title>
  <style>
    :root { --bg:#0b1410; --panel:#121f18; --text:#f4efe6; --muted:#c9bba4; --accent:#caa65a; --border:rgba(202,166,90,0.25); }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    .wrap { max-width: 520px; margin: 10vh auto; padding: 24px; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); }
    label { display:block; margin:12px 0 6px; color: var(--muted); font-size:12px; text-transform: uppercase; letter-spacing:1px; }
    input { width:100%; padding:10px; border-radius:10px; border:1px solid var(--border); background: var(--panel); color: var(--text); }
    button { margin-top: 16px; width:100%; padding: 12px; border:0; border-radius:10px; background: #caa65a; color:#0b1410; font-weight:700; cursor:pointer; }
    .note { color: var(--muted); font-size:12px; margin-top:10px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Client Portal</h1>
    <p class="note">Enter your email to receive a secure login link.</p>
    <form method="post" action="/client/login">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required />
      <button type="submit">Send Login Link</button>
    </form>
  </div>
</body>
</html>`);
});

app.post('/client/login', async (req, res) => {
  const { email } = req.body;
  const emailStr = String(email || '').trim();
  const client = await Client.findOne({ email: emailStr }).lean();
  if (!client) {
    return res.send('If this email exists, a login link was sent.');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await ClientLoginToken.create({ clientId: client._id, tokenHash, expiresAt, used: false });

  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const link = `${appUrl}/client/verify?token=${token}`;
  const sent = await sendEmail({
    to: emailStr,
    subject: 'Your client portal link',
    text: `Hi ${client.name},\n\nYour secure portal link:\n${link}\n\nThis link expires in 15 minutes.`
  });

  if (!sent) {
    return res.status(500).send('Email system is not configured.');
  }
  return res.send('Login link sent. Check your email.');
});

app.get('/client/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid token');
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const record = await ClientLoginToken.findOne({ tokenHash }).lean();
  if (!record || record.used || record.expiresAt < new Date()) {
    return res.status(400).send('Token expired or invalid.');
  }
  await ClientLoginToken.updateOne({ _id: record._id }, { $set: { used: true } });
  const hours = Number(process.env.CLIENT_SESSION_HOURS || 24);
  const sessionToken = signClientToken({ clientId: String(record.clientId), exp: Date.now() + hours * 60 * 60 * 1000 });
  res.setHeader('Set-Cookie', `client_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/`);
  return res.redirect('/client');
});

app.get('/client', clientAuth, async (req, res) => {
  const client = await Client.findById(req.clientId).lean();
  const projects = await Project.find({ clientId: req.clientId }).lean();
  const cards = projects
    .map((p) => {
      const milestones = (p.milestones || [])
        .map((m, index) => {
          const approved = m.approved ? '<span class="badge ok">Approved</span>' : '<span class="badge">Pending</span>';
          const due = m.dueDate ? `<span class="chip">${m.dueDate}</span>` : '';
          const status = m.status ? `<span class="chip">${m.status}</span>` : '';
          const approveForm = m.approved
            ? ''
            : `<form method="post" action="/client/projects/${p._id}/milestones/${index}/approve">
                <button class="btn ghost" type="submit">Approve</button>
              </form>`;
          return `<div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-body">
              <div class="timeline-title">${m.title}</div>
              <div class="timeline-meta">${due}${status}${approved}</div>
              ${approveForm}
            </div>
          </div>`;
        })
        .join('');
      const links = (p.links || [])
        .map((l) => `<a href="${l.url}" target="_blank" rel="noreferrer">${l.label || 'Link'}</a>`)
        .join(' · ');
      const feedbackList = (p.feedback || [])
        .slice()
        .reverse()
        .map((f) => `<div class="feedback-item"><div class="meta">${f.author || 'Client'} · ${new Date(f.createdAt).toLocaleString()}</div><div>${f.message || ''}</div></div>`)
        .join('');
      const updatesList = (p.updates || [])
        .slice()
        .reverse()
        .map((u) => `<div class="update-item"><div class="meta">${u.author || 'Admin'} · ${new Date(u.createdAt).toLocaleString()}</div><div class="update-title">${u.title || 'Update'}</div><div>${u.body || ''}</div></div>`)
        .join('');
      const filesList = (p.files || [])
        .slice()
        .reverse()
        .map((f) => `<div class="file-item"><a href="${f.url}" target="_blank" rel="noreferrer">${f.label || 'File'}</a><div class="meta">${f.uploadedBy || 'Shared'} · ${new Date(f.createdAt).toLocaleString()}</div><div class="muted">${f.note || ''}</div></div>`)
        .join('');
      const contractsList = (p.contracts || [])
        .slice()
        .reverse()
        .map((c, index) => {
          const status = c.status || 'Pending';
          const signedAt = c.signedAt ? new Date(c.signedAt).toLocaleString() : '';
          const markButton =
            status === 'Signed'
              ? ''
              : `<form method="post" action="/client/projects/${p._id}/contracts/${index}/confirm">
                  <button class="btn ghost" type="submit">Mark Signed</button>
                </form>`;
          return `<div class="contract-item">
            <div class="meta">Status: ${status}${signedAt ? ` · ${signedAt}` : ''}</div>
            <div class="update-title">${c.title || 'Agreement'}</div>
            <a href="${c.url}" target="_blank" rel="noreferrer">Open Agreement</a>
            ${markButton}
          </div>`;
        })
        .join('');
      return `<div class="card">
        <h3>${p.title}</h3>
        <div class="meta">Status: ${p.status}</div>
        <p>${p.summary || ''}</p>
        ${milestones ? `<div class="timeline">${milestones}</div>` : ''}
        ${links ? `<div class="links">${links}</div>` : ''}
        <div class="section">
          <div class="section-title">Request a meeting</div>
          ${client?.schedulingUrl ? `<div class="muted">Scheduling link:</div><a class="mono-link" href="${client.schedulingUrl}" target="_blank" rel="noreferrer">${client.schedulingUrl}</a>` : ''}
          <form class="meeting-form">
            <input name="name" value="${client?.name || ''}" readonly />
            <input name="email" value="${client?.email || ''}" readonly />
            <input name="phone" placeholder="Phone number" required />
            <div class="row">
              <input type="date" name="date" required />
              <input type="time" name="time" required />
              <select name="durationMinutes" required>
                <option value="15">15 min</option>
                <option value="30" selected>30 min</option>
                <option value="45">45 min</option>
                <option value="60">60 min</option>
              </select>
            </div>
            <textarea name="notes" placeholder="Meeting notes or agenda"></textarea>
            <button class="btn" type="submit">Book meeting</button>
            <div class="form-msg" aria-live="polite"></div>
          </form>
        </div>
        <div class="section">
          <div class="section-title">Project updates</div>
          ${updatesList || '<div class="muted">No updates yet.</div>'}
        </div>
        <div class="section">
          <div class="section-title">Agreements</div>
          ${contractsList || '<div class="muted">No agreements yet.</div>'}
        </div>
        <div class="section">
          <div class="section-title">Files</div>
          ${filesList || '<div class="muted">No files yet.</div>'}
          <form method="post" action="/client/projects/${p._id}/files" class="feedback-form">
            <input name="label" placeholder="File name" required />
            <input name="url" placeholder="File URL (Drive/Dropbox/etc.)" required />
            <input name="note" placeholder="Short note (optional)" />
            <button class="btn ghost" type="submit">Share file link</button>
          </form>
        </div>
        <div class="section">
          <div class="section-title">Feedback & approvals</div>
          ${feedbackList || '<div class="muted">No feedback yet.</div>'}
          <form method="post" action="/client/projects/${p._id}/feedback" class="feedback-form">
            <textarea name="message" placeholder="Share feedback or questions" required></textarea>
            <button class="btn ghost" type="submit">Send feedback</button>
          </form>
        </div>
      </div>`;
    })
    .join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Client Portal</title>
  <style>
    :root { --bg:#0b1410; --panel:#121f18; --text:#f4efe6; --muted:#c9bba4; --accent:${client?.accentColor || '#caa65a'}; --border:rgba(202,166,90,0.25); --good:#3ccf91; }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); --good:#1b8c5c; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center; background: var(--panel); }
    main { padding: 24px; }
    .cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:16px; }
    .card { border:1px solid var(--border); border-radius:14px; padding:16px; background: var(--panel); }
    .meta { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing:1px; }
    .links a { color: var(--accent); text-decoration: none; }
    .section { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
    .section-title { font-size: 13px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
    .timeline { display: grid; gap: 12px; margin-top: 12px; }
    .timeline-item { display:grid; grid-template-columns: 12px 1fr; gap: 10px; align-items: start; }
    .timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); margin-top: 6px; box-shadow: 0 0 0 3px rgba(202,166,90,0.2); }
    .timeline-title { font-weight: 600; }
    .timeline-meta { display:flex; gap:8px; flex-wrap: wrap; margin-top: 6px; }
    .chip { font-size: 11px; border:1px solid var(--border); padding:2px 8px; border-radius:999px; color: var(--muted); }
    .badge { font-size: 11px; padding:2px 8px; border-radius:999px; border:1px solid var(--border); color: var(--muted); }
    .badge.ok { color: var(--good); border-color: rgba(60,207,145,0.4); }
    .row { display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
    input, select, textarea { border:1px solid var(--border); border-radius:8px; padding:8px 10px; background: var(--bg); color: var(--text); width: 100%; }
    textarea { min-height: 90px; }
    .btn { display:inline-block; padding:8px 12px; border-radius:10px; background: var(--accent); color:#0b1410; text-decoration:none; font-weight:700; border:0; cursor:pointer; }
    .btn.ghost { background: transparent; color: var(--accent); border:1px solid var(--border); }
    .feedback-item { border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom: 8px; background: rgba(0,0,0,0.06); }
    .update-item { border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom: 8px; background: rgba(0,0,0,0.04); }
    .update-title { font-weight: 600; margin: 6px 0; }
    .file-item { border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom: 8px; background: rgba(0,0,0,0.04); }
    .file-item a { color: var(--accent); text-decoration: none; font-weight: 600; }
    .contract-item { border:1px solid var(--border); border-radius:10px; padding:10px; margin-bottom: 8px; background: rgba(0,0,0,0.04); display:grid; gap:6px; }
    .mono-link { color: var(--accent); text-decoration: none; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: 12px; }
    .muted { color: var(--muted); }
    .form-msg { margin-top: 8px; font-size: 12px; color: var(--muted); }
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
  </style>
</head>
<body>
  <header>
    <div style="display:flex; align-items:center; gap:12px;">
      ${client?.logoUrl ? `<img src="${client.logoUrl}" alt="Client logo" style="height:28px; width:auto; border-radius:6px;" />` : ''}
      <div>Client Portal - ${client?.name || ''}</div>
    </div>
    <div style="display:flex; align-items:center; gap:12px;">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" aria-pressed="false">
        <span class="theme-dot"></span><span class="theme-label">Light</span>
      </button>
      <a href="/client/logout" style="color: var(--accent); text-decoration:none;">Sign out</a>
    </div>
  </header>
  <main>
    <div class="cards">${cards || '<div>No projects yet.</div>'}</div>
  </main>
  <script>
    (function() {
      const btn = document.getElementById('theme-toggle');
      const label = btn ? btn.querySelector('.theme-label') : null;
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const isLight = theme === 'light';
        if (btn) btn.setAttribute('aria-pressed', String(isLight));
        if (label) label.textContent = isLight ? 'Dark' : 'Light';
      }
      if (btn) {
        const saved = localStorage.getItem('theme');
        const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        applyTheme(initial);
        btn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme', next);
          applyTheme(next);
        });
      }
      document.querySelectorAll('.meeting-form').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const msg = form.querySelector('.form-msg');
          if (msg) msg.textContent = 'Booking...';
          const formData = new FormData(form);
          const date = formData.get('date');
          const time = formData.get('time');
          const payload = {
            name: formData.get('name'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            service: 'Client Meeting',
            durationMinutes: formData.get('durationMinutes'),
            startAt: date + 'T' + time,
            notes: formData.get('notes')
          };
          try {
            const res = await fetch('/api/booking', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) {
              if (msg) msg.textContent = data.error || 'Unable to book slot.';
              return;
            }
            if (msg) msg.textContent = 'Booked. I will contact you soon.';
            form.reset();
            form.querySelector('[name="name"]').value = payload.name || '';
            form.querySelector('[name="email"]').value = payload.email || '';
          } catch (err) {
            if (msg) msg.textContent = 'Server error. Please try again.';
          }
        });
      });
    })();
  </script>
</body>
</html>`);
});

app.post('/client/projects/:id/feedback', clientAuth, async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) {
    return res.redirect('/client');
  }
  const client = await Client.findById(req.clientId).lean();
  await Project.updateOne(
    { _id: req.params.id, clientId: req.clientId },
    { $push: { feedback: { author: client?.name || client?.email || 'Client', message } } }
  );
  const notify = process.env.NOTIFY_EMAIL;
  if (notify) {
    await sendEmail({
      to: notify,
      subject: 'Client feedback received',
      text: `Client: ${client?.name || client?.email || 'Client'}\nMessage: ${message}`
    });
  }
  return res.redirect('/client');
});

app.post('/client/projects/:id/files', clientAuth, async (req, res) => {
  const label = String(req.body.label || '').trim();
  const url = String(req.body.url || '').trim();
  const note = String(req.body.note || '').trim();
  if (!label || !url) {
    return res.redirect('/client');
  }
  const client = await Client.findById(req.clientId).lean();
  await Project.updateOne(
    { _id: req.params.id, clientId: req.clientId },
    {
      $push: {
        files: {
          label,
          url,
          note,
          uploadedBy: client?.name || client?.email || 'Client'
        }
      }
    }
  );
  const notify = process.env.NOTIFY_EMAIL;
  if (notify) {
    await sendEmail({
      to: notify,
      subject: 'Client shared a file',
      text: `Client: ${client?.name || client?.email || 'Client'}\nFile: ${label}\nURL: ${url}\nNote: ${note || 'N/A'}`
    });
  }
  return res.redirect('/client');
});

app.post('/client/projects/:id/milestones/:index/approve', clientAuth, async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, clientId: req.clientId });
  if (!project) {
    return res.redirect('/client');
  }
  const index = Number(req.params.index);
  if (Number.isNaN(index) || index < 0 || index >= (project.milestones || []).length) {
    return res.redirect('/client');
  }
  const client = await Client.findById(req.clientId).lean();
  const milestone = project.milestones[index];
  milestone.approved = true;
  milestone.approvedAt = new Date();
  milestone.approvedBy = client?.name || client?.email || 'Client';
  await project.save();
  const notify = process.env.NOTIFY_EMAIL;
  if (notify) {
    await sendEmail({
      to: notify,
      subject: 'Milestone approved',
      text: `Client: ${client?.name || client?.email || 'Client'}\nProject: ${project.title}\nMilestone: ${milestone.title}`
    });
  }
  return res.redirect('/client');
});

app.post('/client/projects/:id/contracts/:index/confirm', clientAuth, async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, clientId: req.clientId });
  if (!project) {
    return res.redirect('/client');
  }
  const index = Number(req.params.index);
  if (Number.isNaN(index) || index < 0 || index >= (project.contracts || []).length) {
    return res.redirect('/client');
  }
  const client = await Client.findById(req.clientId).lean();
  const contract = project.contracts[index];
  contract.status = 'Signed';
  contract.signedAt = new Date();
  await project.save();
  const notify = process.env.NOTIFY_EMAIL;
  if (notify) {
    await sendEmail({
      to: notify,
      subject: 'Agreement marked signed',
      text: `Client: ${client?.name || client?.email || 'Client'}\nProject: ${project.title}\nAgreement: ${contract.title || 'Agreement'}`
    });
  }
  return res.redirect('/client');
});

app.get('/client/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'client_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return res.redirect('/client/login');
});

app.get('/admin/clients', adminAuth, async (req, res) => {
  const clients = await Client.find().sort({ createdAt: -1 }).lean();
  const rows = clients
    .map((c) => `<tr>
      <td>${c.name}</td>
      <td>${c.email}</td>
      <td>${c.company || ''}</td>
      <td>${c.accentColor || ''}</td>
      <td>${c.schedulingUrl ? `<a href="${c.schedulingUrl}" target="_blank" rel="noreferrer">Link</a>` : ''}</td>
      <td>
        <form method="post" action="/admin/clients/${c._id}/send-login">
          <button class="btn" type="submit">Send Login Link</button>
        </form>
      </td>
    </tr>`)
    .join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Clients</title>
  <style>
    :root { --bg:#0b1410; --panel:#121f18; --text:#f4efe6; --muted:#c9bba4; --accent:#caa65a; --border:rgba(202,166,90,0.25); --header-bg:rgba(11,20,16,0.9); --table-head:#0f1812; --row-alt:#101a14; }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); --header-bg:rgba(247,244,239,0.9); --table-head:#f4efe9; --row-alt:#faf7f2; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center; background: var(--header-bg); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { border: 1px solid var(--border); padding: 10px; vertical-align: top; }
    th { background: var(--table-head); text-align: left; position: sticky; top: 0; }
    tr:nth-child(even) td { background: var(--row-alt); }
    .form { display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
    input { border:1px solid var(--border); border-radius:8px; padding:8px 10px; background: var(--panel); color: var(--text); }
    .btn { display:inline-block; padding:8px 12px; border-radius:10px; background:#caa65a; color:#0b1410; text-decoration:none; font-weight:700; border:0; cursor:pointer; }
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
  </style>
</head>
<body>
  <header>
    <div>Admin Clients</div>
    <div style="display:flex; align-items:center; gap:12px;">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" aria-pressed="false">
        <span class="theme-dot"></span><span class="theme-label">Light</span>
      </button>
      <a href="/admin">Dashboard</a>
    </div>
  </header>
  <main>
    <form class="form" method="post" action="/admin/clients">
      <input name="name" placeholder="Client name" required />
      <input name="email" placeholder="Email" required />
      <input name="company" placeholder="Company (optional)" />
      <input name="logoUrl" placeholder="Logo URL (optional)" />
      <input name="accentColor" placeholder="Accent color (#caa65a)" />
      <input name="schedulingUrl" placeholder="Scheduling link (optional)" />
      <button class="btn" type="submit">Add Client</button>
    </form>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Accent</th><th>Calendar</th><th>Portal</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No clients yet.</td></tr>'}</tbody>
    </table>
  </main>
  <script>
    (function() {
      const btn = document.getElementById('theme-toggle');
      const label = btn ? btn.querySelector('.theme-label') : null;
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const isLight = theme === 'light';
        if (btn) btn.setAttribute('aria-pressed', String(isLight));
        if (label) label.textContent = isLight ? 'Dark' : 'Light';
      }
      if (btn) {
        const saved = localStorage.getItem('theme');
        const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        applyTheme(initial);
        btn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme', next);
          applyTheme(next);
        });
      }
    })();
  </script>
</body>
</html>`);
});

app.post('/admin/clients', adminAuth, async (req, res) => {
  const { name, email, company, logoUrl, accentColor, schedulingUrl } = req.body;
  await Client.create({
    name,
    email,
    company,
    logoUrl: String(logoUrl || '').trim(),
    accentColor: String(accentColor || '').trim(),
    schedulingUrl: String(schedulingUrl || '').trim()
  });
  return res.redirect('/admin/clients');
});

app.post('/admin/clients/:id/send-login', adminAuth, async (req, res) => {
  const client = await Client.findById(req.params.id).lean();
  if (!client) return res.redirect('/admin/clients');
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await ClientLoginToken.create({ clientId: client._id, tokenHash, expiresAt, used: false });
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const link = `${appUrl}/client/verify?token=${token}`;
  await sendEmail({
    to: client.email,
    subject: 'Your client portal link',
    text: `Hi ${client.name},\n\nYour secure portal link:\n${link}\n\nThis link expires in 15 minutes.`
  });
  return res.redirect('/admin/clients');
});

app.get('/admin/projects', adminAuth, async (req, res) => {
  const clients = await Client.find().sort({ createdAt: -1 }).lean();
  const projects = await Project.find().sort({ createdAt: -1 }).populate('clientId').lean();
  const clientOptions = clients
    .map((c) => `<option value="${c._id}">${c.name} (${c.email})</option>`)
    .join('');
  const projectOptions = projects
    .map((p) => `<option value="${p._id}">${p.title}</option>`)
    .join('');
  const rows = projects
    .map((p) => {
      const milestoneText = (p.milestones || [])
        .map((m) => `${m.title}${m.status ? ` (${m.status})` : ''}${m.approved ? ' ✓' : ''}`)
        .join('; ');
      const feedbackCount = (p.feedback || []).length;
      const updateCount = (p.updates || []).length;
      const fileCount = (p.files || []).length;
      const contractCount = (p.contracts || []).length;
      return `<tr><td>${p.title}</td><td>${p.clientId?.name || ''}</td><td>${p.status}</td><td>${p.summary || ''}</td><td>${milestoneText || ''}</td><td>${feedbackCount}</td><td>${updateCount}</td><td>${fileCount}</td><td>${contractCount}</td></tr>`;
    })
    .join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin Projects</title>
  <style>
    :root { --bg:#0b1410; --panel:#121f18; --text:#f4efe6; --muted:#c9bba4; --accent:#caa65a; --border:rgba(202,166,90,0.25); --header-bg:rgba(11,20,16,0.9); --table-head:#0f1812; --row-alt:#101a14; }
    [data-theme="light"] { --bg:#f7f4ef; --panel:#ffffff; --text:#1b1b1b; --muted:#6b645a; --accent:#b88a3d; --border:rgba(184,138,61,0.25); --header-bg:rgba(247,244,239,0.9); --table-head:#f4efe9; --row-alt:#faf7f2; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: var(--bg); color: var(--text); }
    header { padding: 22px 24px; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center; background: var(--header-bg); position: sticky; top: 0; }
    header a { color: var(--accent); text-decoration: none; font-weight: 600; }
    main { padding: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; }
    th, td { border: 1px solid var(--border); padding: 10px; vertical-align: top; }
    th { background: var(--table-head); text-align: left; position: sticky; top: 0; }
    tr:nth-child(even) td { background: var(--row-alt); }
    .form { display:grid; gap:10px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
    input, select, textarea { border:1px solid var(--border); border-radius:8px; padding:8px 10px; background: var(--panel); color: var(--text); }
    .btn { display:inline-block; padding:8px 12px; border-radius:10px; background:#caa65a; color:#0b1410; text-decoration:none; font-weight:700; border:0; cursor:pointer; }
    .theme-toggle { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--text); font-size:11px; text-transform:uppercase; letter-spacing:1px; cursor:pointer; }
    .theme-dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(202,166,90,0.2); }
  </style>
</head>
<body>
  <header>
    <div>Admin Projects</div>
    <div style="display:flex; align-items:center; gap:12px;">
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" aria-pressed="false">
        <span class="theme-dot"></span><span class="theme-label">Light</span>
      </button>
      <a href="/admin">Dashboard</a>
    </div>
  </header>
  <main>
    <form class="form" method="post" action="/admin/projects">
      <input name="title" placeholder="Project title" required />
      <select name="clientId" required>${clientOptions}</select>
      <select name="status">
        <option>Planned</option>
        <option>In Progress</option>
        <option>Review</option>
        <option>Done</option>
      </select>
      <input name="summary" placeholder="Short summary" />
      <textarea name="milestones" placeholder="Milestones: Title|YYYY-MM-DD|Status; ..."></textarea>
      <textarea name="links" placeholder="Links: Label|https://...; ..."></textarea>
      <button class="btn" type="submit">Add Project</button>
    </form>
    <form class="form" method="post" action="/admin/projects/updates">
      <select name="projectId" required>${projectOptions}</select>
      <input name="title" placeholder="Update title" required />
      <textarea name="body" placeholder="Update details" required></textarea>
      <button class="btn" type="submit">Post Update</button>
    </form>
    <form class="form" method="post" action="/admin/projects/files">
      <select name="projectId" required>${projectOptions}</select>
      <input name="label" placeholder="File name" required />
      <input name="url" placeholder="File URL (Drive/Dropbox/etc.)" required />
      <input name="note" placeholder="Short note (optional)" />
      <button class="btn" type="submit">Share File Link</button>
    </form>
    <form class="form" method="post" action="/admin/projects/contracts">
      <select name="projectId" required>${projectOptions}</select>
      <input name="title" placeholder="Agreement title" required />
      <input name="url" placeholder="Agreement URL (e-sign link)" required />
      <button class="btn" type="submit">Share Agreement</button>
    </form>
    <table>
      <thead><tr><th>Title</th><th>Client</th><th>Status</th><th>Summary</th><th>Milestones</th><th>Feedback</th><th>Updates</th><th>Files</th><th>Agreements</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9">No projects yet.</td></tr>'}</tbody>
    </table>
  </main>
  <script>
    (function() {
      const btn = document.getElementById('theme-toggle');
      const label = btn ? btn.querySelector('.theme-label') : null;
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const isLight = theme === 'light';
        if (btn) btn.setAttribute('aria-pressed', String(isLight));
        if (label) label.textContent = isLight ? 'Dark' : 'Light';
      }
      if (btn) {
        const saved = localStorage.getItem('theme');
        const initial = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        applyTheme(initial);
        btn.addEventListener('click', () => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          localStorage.setItem('theme', next);
          applyTheme(next);
        });
      }
    })();
  </script>
</body>
</html>`);
});

app.post('/admin/projects', adminAuth, async (req, res) => {
  const { title, clientId, status, summary, milestones, links } = req.body;
  const parseList = (raw) =>
    String(raw || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
  const milestoneList = parseList(milestones).map((item) => {
    const [mTitle, dueDate, mStatus] = item.split('|').map((s) => s.trim());
    return { title: mTitle, dueDate, status: mStatus };
  });
  const linkList = parseList(links).map((item) => {
    const [label, url] = item.split('|').map((s) => s.trim());
    return { label, url };
  });
  await Project.create({ title, clientId, status, summary, milestones: milestoneList, links: linkList });
  return res.redirect('/admin/projects');
});

app.post('/admin/projects/updates', adminAuth, async (req, res) => {
  const { projectId, title, body } = req.body;
  if (!projectId || !title || !body) {
    return res.redirect('/admin/projects');
  }
  const update = {
    title: String(title).trim(),
    body: String(body).trim(),
    author: 'Admin'
  };
  const project = await Project.findById(projectId).populate('clientId').lean();
  if (project) {
    await Project.updateOne({ _id: projectId }, { $push: { updates: update } });
    const clientEmail = project.clientId?.email;
    if (clientEmail) {
      await sendEmail({
        to: clientEmail,
        subject: `Project update: ${project.title}`,
        text: `Update: ${update.title}\n\n${update.body}`
      });
    }
  }
  return res.redirect('/admin/projects');
});

app.post('/admin/projects/files', adminAuth, async (req, res) => {
  const { projectId, label, url, note } = req.body;
  if (!projectId || !label || !url) {
    return res.redirect('/admin/projects');
  }
  const fileItem = {
    label: String(label).trim(),
    url: String(url).trim(),
    note: String(note || '').trim(),
    uploadedBy: 'Admin'
  };
  const project = await Project.findById(projectId).populate('clientId').lean();
  if (project) {
    await Project.updateOne({ _id: projectId }, { $push: { files: fileItem } });
    const clientEmail = project.clientId?.email;
    if (clientEmail) {
      await sendEmail({
        to: clientEmail,
        subject: `File shared: ${project.title}`,
        text: `File: ${fileItem.label}\n${fileItem.url}\n${fileItem.note || ''}`
      });
    }
  }
  return res.redirect('/admin/projects');
});

app.post('/admin/projects/contracts', adminAuth, async (req, res) => {
  const { projectId, title, url } = req.body;
  if (!projectId || !title || !url) {
    return res.redirect('/admin/projects');
  }
  const contract = {
    title: String(title).trim(),
    url: String(url).trim(),
    status: 'Pending'
  };
  const project = await Project.findById(projectId).populate('clientId').lean();
  if (project) {
    await Project.updateOne({ _id: projectId }, { $push: { contracts: contract } });
    const clientEmail = project.clientId?.email;
    if (clientEmail) {
      await sendEmail({
        to: clientEmail,
        subject: `Agreement ready: ${project.title}`,
        text: `Agreement: ${contract.title}\n${contract.url}`
      });
    }
  }
  return res.redirect('/admin/projects');
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

if (require.main === module) {
  connectDb()
    .then(() => {
      dbConnected = true;
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to connect to MongoDB:', err.message);
      process.exit(1);
    });
}

module.exports = app;

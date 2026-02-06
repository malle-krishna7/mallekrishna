# Deployment Guide (Hostinger)

This project is a Node.js + Express app with MongoDB Atlas, admin dashboard, and email notifications.

## 1) Prepare MongoDB Atlas

1. Create a MongoDB Atlas cluster.
2. Create a database user and password.
3. Add your server IP to the Network Access allowlist (or `0.0.0.0/0` during setup).
4. Copy the connection string and set it in `MONGODB_URI`.

## 2) Prepare Gmail SMTP (Optional, for notifications)

1. Enable 2‑Step Verification on your Google account.
2. Create an App Password (Google Account → Security → App Passwords → Mail).
3. Use that App Password for `SMTP_PASS`.

## 3) Upload Project to Hostinger

1. Open Hostinger → hPanel → Hosting → Manage.
2. Go to **File Manager**.
3. Upload your project files (do **not** upload `node_modules`).

## 4) Set Environment Variables

In Hostinger → hPanel → **Advanced** → **Environment Variables**, add:

- `MONGODB_URI`
- `ADMIN_USER`
- `ADMIN_PASS`
- `ADMIN_SECRET`
- `SMTP_HOST` (optional)
- `SMTP_PORT` (optional)
- `SMTP_USER` (optional)
- `SMTP_PASS` (optional)
- `SMTP_FROM` (optional)
- `NOTIFY_EMAIL` (optional)
- `BOOKING_START_HOUR`
- `BOOKING_END_HOUR`
- `BOOKING_BUFFER_MIN`
- `BOOKING_DAYS_AHEAD`
- `BOOKING_ALLOW_WEEKENDS`
- `BOOKING_BLACKOUT_DATES`

## 5) Install Dependencies

Open Hostinger **Terminal** (or SSH):

```
npm install
```

## 6) Run the App

Start the server:

```
npm start
```

Make sure your Node.js app is configured to use Hostinger’s `PORT` environment variable.

## 7) Verify

1. Visit your domain: `https://mallekrishna.in`
2. Submit a Contact / Booking / Proposal.
3. Check `/admin/login` to verify admin access.
4. Check email notifications if SMTP is set.

## 8) SEO Checklist

- `https://mallekrishna.in/sitemap.xml`
- `https://mallekrishna.in/robots.txt`
- Check page titles + meta descriptions
- Verify `og:image` renders

## 9) Troubleshooting

- **Mongo error**: Check IP allowlist and `MONGODB_URI`.
- **Admin 404**: Ensure `ADMIN_USER` and `ADMIN_PASS` are set.
- **Email error**: Use Gmail App Password, not normal password.


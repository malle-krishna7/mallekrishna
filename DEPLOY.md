# Deployment Guide (Netlify)

This project is a Node.js + Express app with MongoDB Atlas, admin dashboard, client portal, and email notifications, optimized for Netlify serverless deployment.

## Architecture

- Frontend: Static files served from `public/`
- Backend: One Netlify Function that serves API + admin + client portal
- Database: MongoDB Atlas
- Email: Gmail SMTP (optional)

## 1) Prepare MongoDB Atlas

1. Create a free cluster
2. Create a database user and password
3. Add `0.0.0.0/0` to Network Access (or restrict to Netlify IPs later)
4. Copy the connection string in this format:
   ```
   mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority
   ```

## 2) Prepare Gmail SMTP (Optional)

1. Enable 2-Step Verification on your Google account
2. Go to Google Account -> Security -> App Passwords
3. Select "Mail" and "Windows Computer" (or your device)
4. Generate a 16 character app password
5. Use this value for `SMTP_PASS`

## 3) Push Your Project to GitHub

1. Initialize git:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```
2. Create a repo on GitHub
3. Push:
   ```bash
   git remote add origin https://github.com/yourusername/your-repo.git
   git branch -M main
   git push -u origin main
   ```

## 4) Connect to Netlify

1. Go to Netlify and click "New site from Git"
2. Select your repository
3. Build settings:
   - Base directory: empty
   - Build command: `npm run build`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. Click "Deploy site"

## 5) Set Environment Variables

In Netlify -> Site settings -> Build & deploy -> Environment, add:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=strong_password_here
ADMIN_SECRET=random_secret_key_256chars
CLIENT_SECRET=change_me_long_random
CLIENT_SESSION_HOURS=24
APP_URL=https://mallekrishna.in
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password_16chars
SMTP_FROM=your_email@gmail.com
NOTIFY_EMAIL=your_email@gmail.com
BOOKING_START_HOUR=9
BOOKING_END_HOUR=18
BOOKING_BUFFER_MIN=30
BOOKING_DAYS_AHEAD=30
BOOKING_ALLOW_WEEKENDS=false
BOOKING_BLACKOUT_DATES=2024-12-25,2024-12-26
```

Netlify will redeploy automatically after you add variables.

## 6) Verify Deployment

1. Visit your Netlify URL
2. Test forms:
   - Contact: `/`
   - Booking: `/`
   - Proposal: `/`
3. Admin dashboard:
   - `/admin/login`
   - Use `ADMIN_EMAIL` and `ADMIN_PASSWORD`
4. Client portal:
   - Create a client at `/admin/clients`
   - Click "Send Login Link"
   - Client logs in at `/client/login`

## 7) Custom Domain

1. Netlify -> Site settings -> Domain management
2. Add your domain (e.g. `mallekrishna.in`)
3. Update DNS records at your registrar

## 8) HTTPS

Netlify provides free HTTPS by default.

## 9) SEO Checklist

- `https://your-site.netlify.app/sitemap.xml`
- `https://your-site.netlify.app/robots.txt`
- Titles and meta descriptions in `public/index.html`
- Open Graph images in all pages

## 10) Monitoring & Logs

1. Site settings -> Logs
2. Check Function logs for serverless errors
3. Check Build logs for deploy issues

## 11) Bing Webmaster + IndexNow

1. Keep verification file in repo:
   - `public/BingSiteAuth.xml`
2. After deploy, verify:
   - `https://mallekrishna.in/BingSiteAuth.xml`
3. In Bing Webmaster Tools:
   - Add sitemap: `https://mallekrishna.in/sitemap.xml`
4. IndexNow key file:
   - Keep `public/<your-indexnow-key>.txt` in repo root of `public/`
5. Submit URLs to IndexNow after deploy:
   ```bash
   npm run indexnow:submit
   ```

## 12) Troubleshooting

| Issue | Solution |
|-------|----------|
| Functions timeout | Add `serverSelectionTimeoutMS=5000` to Mongo connection string. |
| Env vars not loading | Trigger a redeploy: Deploys -> Trigger deploy. |
| Email not sending | Use Gmail App Password, not account password. |
| 404 on pages | Ensure files are in `public/` and redirects are correct. |
| Admin login fails | Verify `ADMIN_EMAIL` and `ADMIN_PASSWORD`. |

## 13) Local Development

```bash
npm install -g netlify-cli
netlify dev
```

This runs your site locally with Netlify Functions at `http://localhost:8888`.

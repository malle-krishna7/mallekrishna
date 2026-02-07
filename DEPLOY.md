# Deployment Guide (Netlify)

This project is a Node.js + Express app with MongoDB Atlas, admin dashboard, and email notifications, optimized for **Netlify** serverless deployment.

## Architecture

- **Frontend**: Static files served from `public/` directory
- **Backend API**: Netlify Functions (serverless) in `netlify/functions/`
- **Database**: MongoDB Atlas (cloud)
- **Email**: Gmail SMTP (optional)

## 1) Prepare MongoDB Atlas

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster
3. Create a database user with password
4. Add `0.0.0.0/0` to Network Access (or restrict to Netlify's IPs later)
5. Copy the connection string in the format:
   ```
   mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority
   ```

## 2) Prepare Gmail SMTP (Optional, for email notifications)

1. Enable 2-Step Verification on your Google account
2. Go to [Google Account → Security → App Passwords](https://myaccount.google.com/apppasswords)
3. Select "Mail" and "Windows Computer" (or your device)
4. Generate an app password (16 characters)
5. Copy this password for the `SMTP_PASS` environment variable

## 3) Push Your Project to GitHub

1. Initialize git (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. Create a repository on [GitHub](https://github.com)

3. Push your code:
   ```bash
   git remote add origin https://github.com/yourusername/your-repo.git
   git branch -M main
   git push -u origin main
   ```

4. Important: Make sure your `.gitignore` includes:
   ```
   node_modules/
   .env
   .env.local
   ```

## 4) Connect to Netlify

1. Go to [Netlify](https://netlify.com)
2. Sign up or log in with GitHub
3. Click **"New site from Git"**
4. Select your GitHub repository
5. Configure build settings:
   - **Base directory**: Leave empty
   - **Build command**: `npm run build`
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
6. Click **"Deploy site"**

## 5) Set Environment Variables

After your site is created in Netlify:

1. Go to **Site settings → Build & deploy → Environment**
2. Click **"Edit variables"**
3. Add the following variables:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority
ADMIN_USER=your_admin_username
ADMIN_PASS=your_admin_password
ADMIN_SECRET=random_secret_key_256chars
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

> **Note**: After adding environment variables, Netlify will automatically trigger a redeploy.

## 6) Verify Deployment

1. Once deployment is complete, visit your Netlify URL (e.g., `https://your-site.netlify.app`)
2. Test form submissions:
   - **Contact form**: `/` → Submit a contact
   - **Booking form**: `/` → Book a session
   - **Proposal form**: `/` → Submit a proposal
3. Visit admin dashboard:
   - URL: `https://your-site.netlify.app/admin`
   - Username: (your `ADMIN_USER`)
   - Password: (your `ADMIN_PASS`)
4. Export data: `/admin/export/contacts`, `/admin/export/bookings`, `/admin/export/proposals`

## 7) Setup Custom Domain (Optional)

1. In Netlify → **Site settings → Domain management**
2. Click **"Add custom domain"**
3. Enter your domain (e.g., `mallekrishna.in`)
4. Follow DNS configuration instructions from Netlify
5. Add DNS records provided by Netlify to your domain registrar

## 8) Enable HTTPS

Netlify automatically provides free HTTPS via Let's Encrypt:
- ✅ All connections are encrypted by default

## 9) SEO Checklist

- ✅ Sitemap: `https://your-site.netlify.app/sitemap.xml`
- ✅ Robots: `https://your-site.netlify.app/robots.txt`
- ✅ Check page titles & meta descriptions in `public/index.html`
- ✅ Verify Open Graph images in all pages

## 10) Monitoring & Logs

1. Go to **Site settings → Logs**
2. View **Function logs** to debug serverless function errors
3. Monitor **Build logs** for deployment issues

## 11) Cost Estimates

| Service      | Free Tier                    | Pricing                    |
|--------------|------------------------------|----------------------------|
| Netlify      | 300 build minutes/month      | $45/month for unlimited    |
| MongoDB      | 512 MB storage (shared cloud)| $57/month (dedicated, 2GB) |
| Gmail SMTP   | Unlimited                    | Free                       |
| Custom Domain| Free (bring your own)        | $12-15/year                |

**Total**: Approximately **$60-75/year** for full production setup.

## 12) Troubleshooting

| Issue | Solution |
|-------|----------|
| **Functions timeout** | MongoDB connection may be slow. Add `serverSelectionTimeoutMS=5000` to connection string. |
| **Environment variables not loading** | Trigger a redeploy after adding variables: **Deploys → Trigger deploy**. |
| **CORS errors** | Already handled in `public/script.js` with proper headers. |
| **Email not sending** | Verify Gmail App Password (16 chars), not regular password. Check **Function logs**. |
| **404 on static pages** | Ensure all files are in `public/` directory. Check `netlify.toml` redirects. |
| **Admin login fails** | Verify `ADMIN_USER` and `ADMIN_PASS` are set in environment variables. |

## 13) Rollback a Deployment

1. Go to **Deploys**
2. Find a previous successful deploy
3. Click the **three dots** → **Publish deploy**

## 14) Local Development (Optional)

To test locally before deploying:

```bash
npm install -g netlify-cli
netlify dev
```

This runs your site locally with simulated Netlify Functions at `http://localhost:8888`

---

**Questions?** Check [Netlify Docs](https://docs.netlify.com) or contact Netlify Support.


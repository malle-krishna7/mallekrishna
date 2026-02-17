const fs = require('fs');
const path = require('path');

async function main() {
  const publicDir = path.join(process.cwd(), 'public');
  const sitemapPath = path.join(publicDir, 'sitemap.xml');

  if (!fs.existsSync(sitemapPath)) {
    throw new Error('public/sitemap.xml not found');
  }

  const keyFromEnv = process.env.INDEXNOW_KEY || '';
  const txtKeys = fs
    .readdirSync(publicDir)
    .filter((name) => /^[A-Za-z0-9]{8,128}\.txt$/.test(name))
    .map((name) => name.replace(/\.txt$/, ''));

  const key = keyFromEnv || txtKeys[0];
  if (!key) {
    throw new Error('No IndexNow key found. Add INDEXNOW_KEY or place <key>.txt in public/.');
  }

  const keyLocation = process.env.INDEXNOW_KEY_LOCATION || `https://mallekrishna.in/${key}.txt`;
  const siteHost = process.env.INDEXNOW_HOST || 'mallekrishna.in';

  const sitemapXml = fs.readFileSync(sitemapPath, 'utf-8');
  const urls = Array.from(sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)).map((m) => m[1]).filter(Boolean);

  if (!urls.length) {
    throw new Error('No URLs found in sitemap.xml');
  }

  const payload = {
    host: siteHost,
    key,
    keyLocation,
    urlList: urls
  };

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`IndexNow failed (${res.status}): ${body}`);
  }

  console.log(`IndexNow submitted ${urls.length} URLs.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

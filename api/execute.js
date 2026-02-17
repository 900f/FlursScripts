// api/execute.js

const BLOB_BASE_URL     = 'https://anynovmwoyinocra.public.blob.vercel-storage.com';
const RATE_LIMIT_WINDOW = 15 * 1000;
const RATE_LIMIT_MAX    = 8;

const rateLimitStore = new Map();

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(req) {
  const ip    = getIP(req);
  const now   = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  rateLimitStore.set(ip, entry);
  return false;
}

const BROWSER_UA = ['mozilla', 'chrome', 'safari', 'firefox', 'edge', 'opera', 'curl', 'wget', 'python', 'postman'];
function isBrowser(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (!ua) return false;
  return BROWSER_UA.some(p => ua.includes(p));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') return res.status(405).end('-- Method Not Allowed');
  if (isBrowser(req))       return res.status(403).end('-- Forbidden');
  if (isRateLimited(req))   return res.status(429).end('-- Slow down');

  const match = (req.url || '').match(/\/api\/execute\/([a-f0-9]{32})\.lua$/i);
  if (!match) return res.status(400).end('-- Not found');

  const hash = match[1].toLowerCase();

  try {
    const url = `${BLOB_BASE_URL}/scripts/${hash}.lua`;
    const blobRes = await fetch(url);

    if (!blobRes.ok) return res.status(404).end('-- Not found');

    const content = await blobRes.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(content);

  } catch (err) {
    console.error('Execute error:', err);
    return res.status(500).end('-- Error');
  }
}

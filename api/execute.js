// api/execute.js

import { createDecipheriv } from 'crypto';

const ENCRYPTION_KEY    = process.env.ENCRYPTION_KEY;
const BLOB_BASE_URL     = process.env.BLOB_BASE_URL || 'https://anynovmwoyinocra.public.blob.vercel-storage.com';
const RATE_LIMIT_WINDOW = 15 * 1000;
const RATE_LIMIT_MAX    = 8;

const rateLimitStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.start > RATE_LIMIT_WINDOW * 4) rateLimitStore.delete(ip);
  }
}, 5 * 60 * 1000);

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

function decrypt(encryptedHex, ivHex) {
  const key      = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv       = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let out        = decipher.update(encryptedHex, 'hex', 'utf8');
  out           += decipher.final('utf8');
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') return res.status(405).end('-- Method Not Allowed');
  if (isBrowser(req))       return res.status(403).end('-- Forbidden');
  if (isRateLimited(req))   return res.status(429).end('-- Slow down');

  const match = (req.url || '').match(/\/api\/execute\/([a-f0-9]{32})\.lua$/i);
  if (!match) return res.status(400).end('-- Not found');

  const hash    = match[1].toLowerCase();
  const baseUrl = BLOB_BASE_URL;

  try {
    // Fetch directly by constructed URL — no list() needed
    const encUrl = `${baseUrl}/scripts/${hash}.enc`;
    const encRes = await fetch(encUrl);

    if (!encRes.ok) return res.status(404).end('-- Not found');

    const encData    = await encRes.json();
    const luaContent = decrypt(encData.encrypted, encData.iv);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(luaContent);

  } catch (err) {
    console.error('Execute error:', err);
    return res.status(500).end('-- Error');
  }
}

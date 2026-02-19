// api/files/v2/loader.js

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const RATE_LIMIT_WINDOW = 15 * 1000;
const RATE_LIMIT_MAX    = 8;
const rateLimitStore    = new Map();

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

const BROWSER_UA = ['mozilla','chrome','safari','firefox','edge','opera','wget','python','postman','curl','insomnia','httpie'];

function isBrowser(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('roblox') || ua.includes('wininet')) return false;
  if (BROWSER_UA.some(p => ua.includes(p))) return true;
  if (ua.length > 0) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') return res.status(405).end('-- Method Not Allowed');
  if (isBrowser(req))       return res.status(403).end('-- Forbidden');
  if (isRateLimited(req))   return res.status(429).end('-- Slow down');

  const urlMatch = (req.url || '').match(/([a-f0-9]{32})\.lua/i);
  const hash = urlMatch ? urlMatch[1].toLowerCase() : null;

  if (!hash) return res.status(400).end('-- Not found');

  try {
    const rows = await sql`SELECT content FROM scripts WHERE hash = ${hash}`;
    if (!rows.length) return res.status(404).end('-- Not found');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(rows[0].content);

  } catch (err) {
    console.error('Loader error:', err);
    return res.status(500).end('-- Error');
  }
}
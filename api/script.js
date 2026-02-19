// api/script.js
// Serves hosted Lua scripts at /api/<hash>.lua
// Blocks browser access, allows Roblox executors

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const BLOCKED_UA_PATTERNS = [
  'mozilla', 'chrome', 'safari', 'firefox', 'edge',
  'opera', 'brave', 'curl', 'wget', 'python',
  'axios', 'fetch', 'node', 'postman',
];

function isAllowedRequest(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (!ua) return true;
  for (const pattern of BLOCKED_UA_PATTERNS) {
    if (ua.includes(pattern)) return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).end('Method Not Allowed');
  }

  const url = req.url || '';
  const match = url.match(/\/api\/([a-z0-9]+)\.lua/i);
  if (!match) {
    return res.status(400).end('Bad Request');
  }

  const hash = match[1].toLowerCase();

  if (!isAllowedRequest(req)) {
    return res.status(403).setHeader('Content-Type', 'text/plain').end('403 Forbidden');
  }

  try {
    const rows = await sql`SELECT content FROM scripts WHERE hash = ${hash}`;
    if (!rows.length) return res.status(404).end('-- Script not found');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).end(rows[0].content);

  } catch (err) {
    console.error('Script serve error:', err);
    return res.status(500).end('Internal Server Error');
  }
}
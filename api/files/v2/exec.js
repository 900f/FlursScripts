// api/files/v2/exec/[hash].lua
// Internal endpoint — called by the bootstrapper Lua with username+hwid params
// No browser blocking, no rate limiting (already filtered by loader step)

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

async function writeLog({ hash, label, ip, ua, robloxUsername, hwid }) {
  try {
    await sql`
      INSERT INTO execution_logs (script_hash, script_label, script_type, ip, hwid, roblox_username, user_agent, executed_at)
      VALUES (${hash}, ${label || 'Unknown'}, 'v2', ${ip}, ${hwid || null}, ${robloxUsername || null}, ${ua}, ${Date.now()})
    `;
  } catch (e) {
    console.error('[v2 exec] log write failed:', e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') return res.status(405).end('-- Method Not Allowed');

  const urlMatch = (req.url || '').match(/([a-f0-9]{32})\.lua/i);
  const hash = urlMatch ? urlMatch[1].toLowerCase() : null;
  if (!hash) return res.status(400).end('-- Not found');

  const ip  = getIP(req);
  const ua  = req.headers['user-agent'] || 'unknown';

  const urlObj         = new URL(req.url, `https://api.flurs.xyz`);
  const robloxUsername = urlObj.searchParams.get('u')    || null;
  const hwid           = urlObj.searchParams.get('hwid') || null;

  try {
    const rows = await sql`SELECT content, label FROM scripts WHERE hash = ${hash}`;
    if (!rows.length) return res.status(404).end('-- Not found');

    // Log and serve
    writeLog({ hash, label: rows[0].label, ip, ua, robloxUsername, hwid });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(rows[0].content);

  } catch (err) {
    console.error('[v2 exec] error:', err);
    return res.status(500).end('-- Error');
  }
}
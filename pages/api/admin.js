// pages/api/admin.js
// Manages HOSTED scripts (Upload & Host tab) — NOT key scripts.
// All scripts saved here have is_key_script = false.

import { sql } from '../../lib/db.js';

const attempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const e = attempts.get(ip);
  if (!e || now > e.resetAt) { attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS }); return false; }
  return e.count >= MAX_ATTEMPTS;
}
function recordFailure(ip) {
  const now = Date.now();
  const e = attempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  e.count++; attempts.set(ip, e);
}
function clearFailures(ip) { attempts.delete(ip); }

async function getMeta(hash) {
  const rows = await sql`SELECT * FROM scripts WHERE hash = ${hash} AND (is_key_script = false OR is_key_script IS NULL)`;
  return rows[0] || null;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD not set' });

  // CORS — allow same origin and no-origin (Roblox)
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://www.flurs.xyz';
  const origin = req.headers.origin || '';
  if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden origin' });
  res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Rate limited' });

  const body = req.body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });

  const { action, password, hash, label, content } = body;

  // trackhosted is public (called by loader)
  if (action === 'trackhosted') {
    try {
      const { hash: h, username, gameId, gameName, serverId } = body;
      if (!h) return res.status(400).json({ error: 'Missing hash' });
      const newLog = { ts: Date.now(), username: username || 'unknown', ip, gameId: gameId || null, gameName: gameName || null, serverId: serverId || null };
      await sql`UPDATE scripts SET use_count = use_count + 1, usage_log = jsonb_insert(usage_log, '{0}', ${JSON.stringify(newLog)}::jsonb), last_used = ${Date.now()} WHERE hash = ${h}`;
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Track failed', detail: err.message });
    }
  }

  // All other actions require password
  if (!password || password !== ADMIN_PASSWORD) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  clearFailures(ip);

  try {
    if (action === 'save') {
      if (!hash || !content) return res.status(400).json({ error: 'Missing hash or content' });
      await sql`
        INSERT INTO scripts (hash, label, content, created_at, is_key_script)
        VALUES (${hash}, ${label || 'Unnamed'}, ${content}, ${Date.now()}, false)
        ON CONFLICT (hash) DO UPDATE SET
          label = EXCLUDED.label,
          content = EXCLUDED.content,
          is_key_script = false
      `;
      return res.status(200).json({ ok: true, hash });
    }

    if (action === 'delete') {
      if (!hash) return res.status(400).json({ error: 'Missing hash' });
      await sql`DELETE FROM scripts WHERE hash = ${hash} AND (is_key_script = false OR is_key_script IS NULL)`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'get') {
      if (!hash) return res.status(400).json({ error: 'Missing hash' });
      const meta = await getMeta(hash);
      if (!meta) return res.status(404).json({ error: 'Script not found' });
      return res.status(200).json({ ok: true, hash, label: meta.label || 'Unnamed', content: meta.content });
    }

    if (action === 'rename') {
      if (!hash || !label) return res.status(400).json({ error: 'Missing hash or label' });
      await sql`UPDATE scripts SET label = ${label.trim()} WHERE hash = ${hash} AND (is_key_script = false OR is_key_script IS NULL)`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'list') {
      const rows = await sql`
        SELECT hash, label, created_at, use_count, last_used, usage_log
        FROM scripts
        WHERE is_key_script = false OR is_key_script IS NULL
        ORDER BY created_at DESC
      `;
      const scripts = rows.map(r => ({
        hash: r.hash,
        label: r.label || 'Unnamed',
        created_at: r.created_at,
        use_count: r.use_count || 0,
        last_used: r.last_used,
        usageLog: (() => { try { return JSON.parse(r.usage_log || '[]'); } catch { return []; } })(),
      }));
      return res.status(200).json({ ok: true, scripts });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[admin]', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}

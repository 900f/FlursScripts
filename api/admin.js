// api/admin.js

import { sql } from '../../lib/db';  // Adjust path: e.g. '../../../lib/db' depending on your folder structure

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is not set');

const attempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS });
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  entry.count += 1;
  attempts.set(ip, entry);
}

function clearFailures(ip) {
  attempts.delete(ip);
}

function unauthorized(res) {
  return res.status(401).json({ error: 'Unauthorized' });
}

async function getMeta(hash) {
  const rows = await sql`SELECT * FROM scripts WHERE hash = ${hash}`;
  return rows[0] || null;
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://flurs.xyz';
  const origin = req.headers.origin || '';

  if (origin && origin !== allowedOrigin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const { action, password, hash, label, content } = req.body || {};

  if (action === 'trackhosted') {
    try {
      const { hash: h, username, gameId, gameName, serverId } = req.body || {};
      if (!h) return res.status(400).json({ error: 'Missing hash' });

      const existing = await getMeta(h);
      if (!existing) return res.status(404).json({ error: 'Script not found' });

      const newLog = {
        ts: Date.now(),
        username: username || 'unknown',
        ip,
        gameId: gameId || null,
        gameName: gameName || null,
        serverId: serverId || null,
      };

      await sql`
        UPDATE scripts
        SET 
          use_count = use_count + 1,
          usage_log = jsonb_insert(usage_log, '{0}', ${JSON.stringify(newLog)}::jsonb),
          last_used = ${Date.now()}
        WHERE hash = ${h}
      `;

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('trackhosted error:', e);
      return res.status(500).json({ error: 'Track failed' });
    }
  }

  if (!password || password !== ADMIN_PASSWORD) {
    recordFailure(ip);
    return unauthorized(res);
  }

  clearFailures(ip);

  try {
    if (action === 'save') {
      if (!hash || !content) return res.status(400).json({ error: 'Missing hash or content' });

      await sql`
        INSERT INTO scripts (hash, label, content, created_at)
        VALUES (${hash}, ${label || 'Unnamed'}, ${content}, ${Date.now()})
        ON CONFLICT (hash) DO UPDATE SET
          label = EXCLUDED.label,
          content = EXCLUDED.content
      `;

      return res.status(200).json({ ok: true, hash });
    }

    if (action === 'delete') {
      if (!hash) return res.status(400).json({ error: 'Missing hash' });
      await sql`DELETE FROM scripts WHERE hash = ${hash}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'get') {
      if (!hash) return res.status(400).json({ error: 'Missing hash' });

      const meta = await getMeta(hash);
      if (!meta) return res.status(404).json({ error: 'Script not found' });

      return res.status(200).json({
        ok: true,
        hash,
        label: meta.label || 'Unnamed',
        content: meta.content,
      });
    }

    if (action === 'rename') {
      if (!hash || !label) return res.status(400).json({ error: 'Missing hash or label' });
      const existing = await getMeta(hash);
      if (!existing) return res.status(404).json({ error: 'Script not found' });

      await sql`UPDATE scripts SET label = ${label.trim()} WHERE hash = ${hash}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'list') {
      const rows = await sql`
        SELECT hash, label, created_at, use_count, last_used
        FROM scripts
        ORDER BY created_at DESC
      `;
      return res.status(200).json({ ok: true, scripts: rows });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
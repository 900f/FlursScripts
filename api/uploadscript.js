// api/uploadscript.js
// Handles publishing new script cards (name, description, loadstring, tags, image)

import { neon } from '@neondatabase/serverless';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is not set');

const sql = neon(process.env.DATABASE_URL);

// ── Rate limiter ──────────────────────────────────────────────────────────
const attempts  = new Map();
const MAX_TRIES = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now(), e = attempts.get(ip);
  if (!e || now > e.resetAt) { attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS }); return false; }
  return e.count >= MAX_TRIES;
}
function recordFailure(ip) {
  const now = Date.now(), e = attempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  e.count++; attempts.set(ip, e);
}
function clearFailures(ip) { attempts.delete(ip); }

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://www.flurs.xyz';
  const origin = req.headers.origin || '';

  console.log('[uploadscript] origin:', origin, '| allowed:', allowedOrigin, '| method:', req.method);

  if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

  const { action, password, name, description, loadstring, tags, imageBase64, imageType } = req.body || {};

  console.log('[uploadscript] action:', action, '| hasPassword:', !!password, '| passwordMatch:', password === ADMIN_PASSWORD);

  const needsAuth = ['auth', 'publish', 'delete', 'getone', 'update'].includes(action);
  if (needsAuth) {
    if (!password || password !== ADMIN_PASSWORD) {
      console.log('[uploadscript] AUTH FAILED | received:', JSON.stringify(password), '| expected length:', ADMIN_PASSWORD.length);
      recordFailure(ip);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    clearFailures(ip);
  }

  try {

    if (action === 'auth') {
      return res.status(200).json({ ok: true });
    }

    if (action === 'publish') {
      if (!name || !loadstring || !imageBase64) {
        return res.status(400).json({ error: 'Missing required fields: name, loadstring, imageBase64' });
      }

      const id          = generateId();
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const imgType     = imageType || 'image/jpeg';

      await sql`
        INSERT INTO scriptcards (id, name, description, loadstring, tags, image_data, image_type, created_at)
        VALUES (
          ${id}, ${name}, ${description || ''}, ${loadstring},
          ${tags || []}, ${imageBuffer}, ${imgType}, ${Date.now()}
        )
      `;

      return res.status(200).json({ ok: true, id });
    }

    if (action === 'delete') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM scriptcards WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'getone') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const rows = await sql`
        SELECT id, name, description, loadstring, tags, image_type, created_at
        FROM scriptcards WHERE id = ${id}
      `;
      if (!rows.length) return res.status(404).json({ error: 'Script not found' });
      const r = rows[0];
      return res.status(200).json({ ok: true, script: {
        id: r.id, name: r.name, description: r.description,
        loadstring: r.loadstring, tags: r.tags,
        imageUrl: `/api/uploadscript/image/${r.id}`,
        createdAt: Number(r.created_at),
      }});
    }

    if (action === 'update') {
      const { id, name, description, loadstring, tags, imageBase64, imageType } = req.body || {};
      if (!id || !name || !loadstring) return res.status(400).json({ error: 'Missing required fields' });

      if (imageBase64) {
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        await sql`
          UPDATE scriptcards
          SET name=${name}, description=${description||''}, loadstring=${loadstring},
              tags=${tags||[]}, image_data=${imageBuffer}, image_type=${imageType||'image/jpeg'}
          WHERE id = ${id}
        `;
      } else {
        await sql`
          UPDATE scriptcards
          SET name=${name}, description=${description||''}, loadstring=${loadstring}, tags=${tags||[]}
          WHERE id = ${id}
        `;
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'list') {
      const rows = await sql`
        SELECT id, name, description, loadstring, tags, image_type, created_at
        FROM scriptcards ORDER BY created_at DESC
      `;
      const scripts = rows.map(r => ({
        id: r.id, name: r.name, description: r.description,
        loadstring: r.loadstring, tags: r.tags,
        imageUrl: `/api/uploadscript/image/${r.id}`,
        createdAt: Number(r.created_at),
      }));
      return res.status(200).json({ ok: true, scripts });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('[uploadscript] error:', err);
    return res.status(500).json({ error: 'Internal Server Error', detail: err.message });
  }
}
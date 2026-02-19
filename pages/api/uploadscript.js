// pages/api/uploadscript.js
// Manages PUBLIC SCRIPTS shown on the Scripts page.
import { sql } from '../../lib/db.js';

const attempts = new Map();
const MAX_TRIES = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const e = attempts.get(ip);
  if (!e || now > e.resetAt) { attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS }); return false; }
  return e.count >= MAX_TRIES;
}
function recordFailure(ip) {
  const now = Date.now();
  const e = attempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  e.count++; attempts.set(ip, e);
}
function clearFailures(ip) { attempts.delete(ip); }
function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD not set' });

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

  const { action, password, name, description, loadstring, tags, imageBase64, imageType, id } = body;

  // List is public
  if (action === 'list') {
    try {
      const rows = await sql`SELECT id, name, description, loadstring, tags, image_data, created_at, use_count, last_used FROM public_scripts ORDER BY created_at DESC`;
      return res.status(200).json({ ok: true, scripts: rows });
    } catch (err) {
      return res.status(500).json({ error: 'DB error', message: err.message });
    }
  }

  // Auth check for everything else
  if (!password || password !== ADMIN_PASSWORD) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  clearFailures(ip);

  try {
    if (action === 'auth') return res.status(200).json({ ok: true });

    if (action === 'publish') {
      if (!name || !loadstring) return res.status(400).json({ error: 'Missing name or loadstring' });
      const newId = generateId();
      const imageData = imageBase64 ? `data:${imageType || 'image/jpeg'};base64,${imageBase64}` : null;
      const tagsArr = Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []);
      await sql`
        INSERT INTO public_scripts (id, name, description, loadstring, tags, image_data, created_at, use_count, last_used, usage_log)
        VALUES (${newId}, ${name}, ${description || ''}, ${loadstring}, ${tagsArr}::text[], ${imageData}, ${Date.now()}, 0, NULL, '[]'::jsonb)
      `;
      return res.status(200).json({ ok: true, id: newId });
    }

    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM public_scripts WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'update') {
      if (!id || !name || !loadstring) return res.status(400).json({ error: 'Missing fields' });
      const existingRows = await sql`SELECT image_data, created_at, use_count, last_used, usage_log FROM public_scripts WHERE id = ${id}`;
      const ex = existingRows[0] || {};
      const imageData = imageBase64 ? `data:${imageType || 'image/jpeg'};base64,${imageBase64}` : (ex.image_data || null);
      const tagsArr = Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []);
      await sql`
        INSERT INTO public_scripts (id, name, description, loadstring, tags, image_data, created_at, use_count, last_used, usage_log)
        VALUES (${id}, ${name}, ${description || ''}, ${loadstring}, ${tagsArr}::text[], ${imageData}, ${ex.created_at || Date.now()}, ${ex.use_count || 0}, ${ex.last_used || null}, ${ex.usage_log || '[]'}::jsonb)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, loadstring = EXCLUDED.loadstring, tags = EXCLUDED.tags, image_data = EXCLUDED.image_data
      `;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[uploadscript]', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}

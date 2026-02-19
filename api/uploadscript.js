// api/uploadscript.js
import { sql } from '../../lib/db';
import { put, del } from '@vercel/blob';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD not set');

const attempts = new Map();
const MAX_TRIES = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const e = attempts.get(ip);
  if (!e || now > e.resetAt) {
    attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS });
    return false;
  }
  return e.count >= MAX_TRIES;
}

function recordFailure(ip) {
  const now = Date.now();
  const e = attempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  e.count++;
  attempts.set(ip, e);
}

function clearFailures(ip) {
  attempts.delete(ip);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://flurs.xyz';
  const origin = req.headers.origin || '';
  if (origin && origin !== allowedOrigin) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Rate limited' });

  let body;
  try {
    body = await req.json();
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { action, password, name, description, loadstring, tags, imageBase64, imageType } = body;

  const needsAuth = ['auth', 'publish', 'delete', 'getone', 'update'].includes(action);
  if (needsAuth) {
    if (!password || password !== ADMIN_PASSWORD) {
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
        return res.status(400).json({ error: 'Missing name, loadstring or imageBase64' });
      }

      const id = generateId();
      const ext = imageType === 'image/png' ? 'png' : 'jpg';

      const imageBuffer = Buffer.from(imageBase64, 'base64');
      const imageBlob = await put(`scriptcards/${id}.${ext}`, imageBuffer, {
        access: 'public',
        contentType: imageType || 'image/jpeg',
        addRandomSuffix: false,
      });

      await sql`
        INSERT INTO public_scripts (
          id, name, description, loadstring, tags, image_url, created_at,
          use_count, last_used, usage_log
        ) VALUES (
          ${id}, ${name}, ${description || ''}, ${loadstring},
          ${tags || []}::text[], ${imageBlob.url}, ${Date.now()},
          0, NULL, '[]'::jsonb
        )
      `;

      return res.status(200).json({ ok: true, id });
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const rows = await sql`SELECT image_url FROM public_scripts WHERE id = ${id}`;
      if (rows[0]?.image_url) await del(rows[0].image_url);

      await sql`DELETE FROM public_scripts WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'getone') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const rows = await sql`SELECT * FROM public_scripts WHERE id = ${id}`;
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });

      return res.status(200).json({ ok: true, script: rows[0] });
    }

    if (action === 'update') {
      const { id, name, description, loadstring, tags, imageBase64, imageType } = body;
      if (!id || !name || !loadstring) return res.status(400).json({ error: 'Missing required fields' });

      const exRows = await sql`SELECT image_url, created_at, use_count, last_used, usage_log FROM public_scripts WHERE id = ${id}`;
      const ex = exRows[0] || {};

      let imageUrl = ex.image_url;

      if (imageBase64) {
        if (ex.image_url) await del(ex.image_url);

        const ext = imageType === 'image/png' ? 'png' : 'jpg';
        const buf = Buffer.from(imageBase64, 'base64');
        const blob = await put(`scriptcards/${id}.${ext}`, buf, {
          access: 'public',
          contentType: imageType || 'image/jpeg',
          addRandomSuffix: false,
        });
        imageUrl = blob.url;
      }

      await sql`
        INSERT INTO public_scripts (
          id, name, description, loadstring, tags, image_url, created_at,
          use_count, last_used, usage_log
        ) VALUES (
          ${id}, ${name}, ${description || ''}, ${loadstring},
          ${tags || []}::text[], ${imageUrl},
          ${ex.created_at || Date.now()},
          ${ex.use_count || 0},
          ${ex.last_used},
          ${ex.usage_log || '[]'::jsonb}
        )
        ON CONFLICT (id) DO UPDATE SET
          name        = EXCLUDED.name,
          description = EXCLUDED.description,
          loadstring  = EXCLUDED.loadstring,
          tags        = EXCLUDED.tags,
          image_url   = EXCLUDED.image_url,
          created_at  = EXCLUDED.created_at
      `;

      return res.status(200).json({ ok: true });
    }

    if (action === 'trackpublic') {
      const { id, username, gameId, gameName, serverId } = body;
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const newLog = {
        ts: Date.now(),
        username: username || 'unknown',
        gameId: gameId || null,
        gameName: gameName || null,
        serverId: serverId || null,
      };

      await sql`
        UPDATE public_scripts
        SET 
          use_count = use_count + 1,
          usage_log = jsonb_insert(usage_log, '{0}', ${JSON.stringify(newLog)}::jsonb),
          last_used = ${Date.now()}
        WHERE id = ${id}
      `;

      return res.status(200).json({ ok: true });
    }

    if (action === 'publicanalytics') {
      if (!password || password !== ADMIN_PASSWORD) {
        recordFailure(ip);
        return res.status(401).json({ error: 'Unauthorized' });
      }
      clearFailures(ip);

      const rows = await sql`
        SELECT id, name, use_count, last_used, usage_log
        FROM public_scripts
        ORDER BY use_count DESC
      `;

      const summary = rows.map(r => ({
        id: r.id,
        name: r.name,
        useCount: r.use_count,
        lastUsed: r.last_used,
        recentUsers: JSON.parse(r.usage_log || '[]').slice(0, 5)
      }));

      return res.status(200).json({ ok: true, scripts: summary });
    }

    if (action === 'list') {
      const rows = await sql`
        SELECT * FROM public_scripts ORDER BY created_at DESC
      `;
      return res.status(200).json({ ok: true, scripts: rows });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[uploadscript]', err);
    return res.status(500).json({
      error: 'Server error',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
}
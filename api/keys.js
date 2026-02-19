// api/keys.js
// Full key-based loader system with GET + POST support for validation

import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is not set');

const sql = neon(process.env.DATABASE_URL);

// ── Rate limiter ─────────────────────────────────────────────────────────
const attempts = new Map();
const MAX_TRIES = 15;
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

// ── Helpers ───────────────────────────────────────────────────────────────
function generateKey() {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `FLURS-${seg()}-${seg()}-${seg()}-${seg()}`;
}
function generateHash() {
  return crypto.randomBytes(16).toString('hex');
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://flurs.xyz';
  const origin = req.headers.origin || '';
  if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden' });

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests.' });

  let params = {};
  if (req.method === 'POST') {
    params = req.body || {};
  } else if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    params = Object.fromEntries(url.searchParams.entries());
  } else {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, password } = params;

  // ── Public: validate ─────────────────────────────────────────────────
  if (action === 'validate') {
    return handleValidate(req, res, params, ip);
  }

  // ── Admin: POST + password ────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Admin actions require POST' });

  if (!password || password !== ADMIN_PASSWORD) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  clearFailures(ip);

  try {
    if (action === 'create')       return handleCreate(res, params);
    if (action === 'list')         return handleList(res);
    if (action === 'revoke')       return handleRevoke(res, params);
    if (action === 'unrevoke')     return handleUnrevoke(res, params);
    if (action === 'delete')       return handleDelete(res, params);
    if (action === 'update')       return handleUpdate(res, params);
    if (action === 'listscripts')  return handleListScripts(res);
    if (action === 'savescript')   return handleSaveScript(res, params);
    if (action === 'deletescript') return handleDeleteScript(res, params);
    if (action === 'getscript')    return handleGetScript(res, params);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('keys.js error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// ── VALIDATE ──────────────────────────────────────────────────────────────
async function handleValidate(req, res, params, ip) {
  const { key, hwid, scriptHash, robloxUsername } = params;
  if (!key)        return res.status(400).json({ ok: false, error: 'No key provided' });
  if (!scriptHash) return res.status(400).json({ ok: false, error: 'No scriptHash provided' });

  const rows = await sql`SELECT * FROM keys WHERE key = ${key}`;
  if (!rows.length) return res.status(403).json({ ok: false, error: 'Invalid key' });
  const keyData = rows[0];

  if (keyData.revoked)     return res.status(403).json({ ok: false, error: 'Key has been revoked' });
  if (keyData.blacklisted) return res.status(403).json({ ok: false, error: 'Key is blacklisted' });

  if (keyData.expires_at && Date.now() > Number(keyData.expires_at)) {
    return res.status(403).json({ ok: false, error: 'Key has expired' });
  }
  if (keyData.max_uses && (keyData.use_count || 0) >= keyData.max_uses) {
    return res.status(403).json({ ok: false, error: 'Key has reached its maximum uses' });
  }
  if (keyData.script_hash && keyData.script_hash !== scriptHash) {
    return res.status(403).json({ ok: false, error: 'Key is not valid for this script' });
  }

  // HWID logic
  let newHwid = keyData.hwid;
  if (hwid && hwid !== 'unknown') {
    if (!keyData.hwid) {
      newHwid = hwid;
    } else if (keyData.hwid !== hwid) {
      return res.status(403).json({ ok: false, error: 'HWID mismatch — wrong device' });
    }
  }

  // Log usage
  const now      = Date.now();
  const usageLog = Array.isArray(keyData.usage_log) ? keyData.usage_log : [];
  usageLog.push({ ts: now, ip, hwid: hwid || null });
  const trimmedLog = usageLog.slice(-50);

  await sql`
    UPDATE keys
    SET hwid       = ${newHwid},
        last_used  = ${now},
        use_count  = ${(keyData.use_count || 0) + 1},
        usage_log  = ${JSON.stringify(trimmedLog)}
    WHERE id = ${keyData.id}
  `;

  // Fetch script
  const scriptRows = await sql`SELECT content, label FROM keyscripts WHERE hash = ${scriptHash}`;
  if (!scriptRows.length) return res.status(404).json({ ok: false, error: 'Script not found on server' });

  // Write execution log (fire and forget)
  sql`
    INSERT INTO execution_logs (script_hash, script_label, script_type, ip, hwid, key_used, roblox_username, executed_at)
    VALUES (
      ${scriptHash},
      ${scriptRows[0].label || 'Unknown'},
      'v3',
      ${ip},
      ${newHwid || null},
      ${keyData.key},
      ${robloxUsername || null},
      ${now}
    )
  `.catch(e => console.error('[keys] log write failed:', e.message));

  return res.status(200).json({ ok: true, content: scriptRows[0].content });
}

// ── CREATE KEY ────────────────────────────────────────────────────────────
async function handleCreate(res, params) {
  const { note, expiresAt, scriptHash, maxUses } = params;
  const id  = generateHash();
  const key = generateKey();
  await sql`
    INSERT INTO keys (id, key, note, script_hash, hwid, revoked, blacklisted, expires_at, max_uses, use_count, usage_log, created_at, last_used)
    VALUES (
      ${id}, ${key}, ${note||''}, ${scriptHash||null}, null,
      false, false,
      ${expiresAt ? Number(expiresAt) : null},
      ${maxUses   ? Number(maxUses)   : null},
      0, '[]', ${Date.now()}, null
    )
  `;
  return res.status(200).json({ ok: true, key, id });
}

// ── LIST KEYS ─────────────────────────────────────────────────────────────
async function handleList(res) {
  const rows = await sql`SELECT * FROM keys ORDER BY created_at DESC`;
  const keys = rows.map(r => ({
    id: r.id, key: r.key, note: r.note, scriptHash: r.script_hash,
    hwid: r.hwid, revoked: r.revoked, blacklisted: r.blacklisted,
    expiresAt: r.expires_at ? Number(r.expires_at) : null,
    maxUses: r.max_uses, useCount: r.use_count,
    usageLog: r.usage_log, createdAt: Number(r.created_at),
    lastUsed: r.last_used ? Number(r.last_used) : null,
  }));
  return res.status(200).json({ ok: true, keys });
}

// ── REVOKE ────────────────────────────────────────────────────────────────
async function handleRevoke(res, params) {
  const { id } = params;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  await sql`UPDATE keys SET revoked = true WHERE id = ${id}`;
  return res.status(200).json({ ok: true });
}

// ── UNREVOKE ──────────────────────────────────────────────────────────────
async function handleUnrevoke(res, params) {
  const { id } = params;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  await sql`UPDATE keys SET revoked = false WHERE id = ${id}`;
  return res.status(200).json({ ok: true });
}

// ── DELETE KEY ────────────────────────────────────────────────────────────
async function handleDelete(res, params) {
  const { id } = params;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  await sql`DELETE FROM keys WHERE id = ${id}`;
  return res.status(200).json({ ok: true });
}

// ── UPDATE KEY ────────────────────────────────────────────────────────────
async function handleUpdate(res, params) {
  const { id, note, expiresAt, resetHwid, blacklisted, scriptHash, maxUses } = params;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const sets = [];
  if (note        !== undefined) sets.push(sql`note        = ${note}`);
  if (expiresAt   !== undefined) sets.push(sql`expires_at  = ${expiresAt ? Number(expiresAt) : null}`);
  if (blacklisted !== undefined) sets.push(sql`blacklisted = ${blacklisted}`);
  if (scriptHash  !== undefined) sets.push(sql`script_hash = ${scriptHash || null}`);
  if (maxUses     !== undefined) sets.push(sql`max_uses    = ${maxUses ? Number(maxUses) : null}`);
  if (resetHwid)                 sets.push(sql`hwid        = null`);

  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  // neon tagged template doesn't support dynamic SET easily, so use a direct approach:
  await sql`
    UPDATE keys SET
      note        = COALESCE(${note !== undefined ? note : null},        note),
      expires_at  = CASE WHEN ${expiresAt !== undefined}::bool  THEN ${expiresAt ? Number(expiresAt) : null}   ELSE expires_at  END,
      blacklisted = CASE WHEN ${blacklisted !== undefined}::bool THEN ${blacklisted ?? false}                  ELSE blacklisted END,
      script_hash = CASE WHEN ${scriptHash !== undefined}::bool  THEN ${scriptHash || null}                    ELSE script_hash END,
      max_uses    = CASE WHEN ${maxUses !== undefined}::bool     THEN ${maxUses ? Number(maxUses) : null}       ELSE max_uses    END,
      hwid        = CASE WHEN ${!!resetHwid}::bool               THEN null                                     ELSE hwid        END
    WHERE id = ${id}
  `;
  return res.status(200).json({ ok: true });
}

// ── LIST KEY SCRIPTS ──────────────────────────────────────────────────────
async function handleListScripts(res) {
  const rows = await sql`SELECT hash, label, created_at FROM keyscripts ORDER BY created_at DESC`;
  const scripts = rows.map(r => ({ hash: r.hash, label: r.label, createdAt: Number(r.created_at) }));
  return res.status(200).json({ ok: true, scripts });
}

// ── SAVE KEY SCRIPT ───────────────────────────────────────────────────────
async function handleSaveScript(res, params) {
  const { hash, label, content } = params;
  if (!content) return res.status(400).json({ error: 'Missing content' });
  const scriptHash = hash || generateHash();

  await sql`
    INSERT INTO keyscripts (hash, label, content, created_at)
    VALUES (${scriptHash}, ${label || 'Unnamed'}, ${content}, ${Date.now()})
    ON CONFLICT (hash) DO UPDATE
      SET content = EXCLUDED.content,
          label   = COALESCE(NULLIF(${label || ''}, ''), keyscripts.label)
  `;

  return res.status(200).json({ ok: true, hash: scriptHash });
}

// ── DELETE KEY SCRIPT ─────────────────────────────────────────────────────
async function handleDeleteScript(res, params) {
  const { hash } = params;
  if (!hash) return res.status(400).json({ error: 'Missing hash' });
  await sql`DELETE FROM keyscripts WHERE hash = ${hash}`;
  return res.status(200).json({ ok: true });
}

// ── GET KEY SCRIPT ────────────────────────────────────────────────────────
async function handleGetScript(res, params) {
  const { hash } = params;
  if (!hash) return res.status(400).json({ error: 'Missing hash' });
  const rows = await sql`SELECT hash, label, content FROM keyscripts WHERE hash = ${hash}`;
  if (!rows.length) return res.status(404).json({ error: 'Script not found' });
  return res.status(200).json({ ok: true, hash: rows[0].hash, label: rows[0].label, content: rows[0].content });
}
// pages/api/keys.js
// Manages KEY scripts (is_key_script = true) and access keys.

import { sql } from '../../lib/db.js';
import crypto from 'crypto';

const attempts = new Map();
const MAX_TRIES = 15;
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

function generateHash() { return crypto.randomBytes(16).toString('hex'); }

const SEC_LOG_MAX = 200;
async function logSecEvent(type, details) {
  try {
    await sql`INSERT INTO security_log (type, details) VALUES (${type}, ${JSON.stringify(details)}::jsonb)`;
    await sql`DELETE FROM security_log WHERE id NOT IN (SELECT id FROM security_log ORDER BY ts DESC LIMIT ${SEC_LOG_MAX})`;
  } catch {}
}

async function getKey(id) {
  const rows = await sql`SELECT * FROM script_keys WHERE id = ${id}`;
  return rows[0] || null;
}

async function saveKey(id, d) {
  await sql`
    INSERT INTO script_keys (id, note, expires_at, blacklisted, script_hash, max_uses, hwid, use_count, usage_log, known_usernames, created_at)
    VALUES (${id}, ${d.note??null}, ${d.expiresAt??null}, ${d.blacklisted??false}, ${d.scriptHash??null}, ${d.maxUses??null}, ${d.hwid??null}, ${d.useCount??0}, ${JSON.stringify(d.usageLog??[])}::jsonb, ${JSON.stringify(d.knownUsernames??[])}::jsonb, ${d.createdAt??Date.now()})
    ON CONFLICT (id) DO UPDATE SET
      note = EXCLUDED.note, expires_at = EXCLUDED.expires_at, blacklisted = EXCLUDED.blacklisted,
      script_hash = EXCLUDED.script_hash, max_uses = EXCLUDED.max_uses, hwid = EXCLUDED.hwid,
      use_count = EXCLUDED.use_count, usage_log = EXCLUDED.usage_log, known_usernames = EXCLUDED.known_usernames
  `;
}

function parseJson(val, fallback = []) {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val || JSON.stringify(fallback)); } catch { return fallback; }
}

function mapKey(k) {
  return {
    id: k.id, key: k.id, note: k.note,
    expiresAt: k.expires_at, blacklisted: k.blacklisted, revoked: k.blacklisted,
    scriptHash: k.script_hash, maxUses: k.max_uses, hwid: k.hwid,
    useCount: k.use_count || 0, lastUsed: k.last_used || null, createdAt: k.created_at,
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD not set' });

  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://www.flurs.xyz';
  const origin = req.headers.origin || '';
  if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Access-Control-Allow-Origin', origin || allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Rate limited' });

  const body = req.method === 'POST' ? req.body : req.query;
  const { action, password, ...params } = body || {};

  // ── PUBLIC: validate key (called by v3 loader) ──────────────────────────
  if (action === 'validate') {
    const { key, hwid, scriptHash, username } = params;
    if (!key || !scriptHash) {
      await logSecEvent('missing_params', { ip, key, scriptHash });
      return res.status(400).json({ error: 'Missing key or scriptHash' });
    }
    const keyData = await getKey(key);
    if (!keyData) { await logSecEvent('invalid_key', { ip, key }); return res.status(401).json({ error: 'Invalid key' }); }
    if (keyData.blacklisted) { await logSecEvent('blacklisted_key_used', { ip, key }); return res.status(403).json({ error: 'Key is blacklisted' }); }
    if (keyData.expires_at && Date.now() > keyData.expires_at) { await logSecEvent('expired_key_used', { ip, key }); return res.status(403).json({ error: 'Key expired' }); }
    if (keyData.max_uses && (keyData.use_count || 0) >= keyData.max_uses) { await logSecEvent('max_uses_reached', { ip, key }); return res.status(403).json({ error: 'Max uses reached' }); }
    if (keyData.script_hash && keyData.script_hash !== scriptHash) { await logSecEvent('wrong_script_key', { ip, key }); return res.status(403).json({ error: 'Key not valid for this script' }); }
    if (keyData.hwid && keyData.hwid !== hwid) { await logSecEvent('hwid_mismatch', { ip, key }); return res.status(403).json({ error: 'HWID mismatch' }); }

    // Bind HWID on first use
    if (!keyData.hwid && hwid) {
      await saveKey(key, {
        note: keyData.note, expiresAt: keyData.expires_at, blacklisted: keyData.blacklisted,
        scriptHash: keyData.script_hash, maxUses: keyData.max_uses, hwid,
        useCount: keyData.use_count, usageLog: parseJson(keyData.usage_log),
        knownUsernames: parseJson(keyData.known_usernames), createdAt: keyData.created_at,
      });
    }

    // Log usage
    const newLog = { ts: Date.now(), username: username || 'unknown', ip };
    await sql`
      UPDATE script_keys SET
        use_count = use_count + 1,
        usage_log = jsonb_insert(usage_log, '{0}', ${JSON.stringify(newLog)}::jsonb),
        known_usernames = CASE WHEN known_usernames @> ${JSON.stringify([username||'unknown'])}::jsonb THEN known_usernames ELSE jsonb_insert(known_usernames, '{0}', ${JSON.stringify(username||'unknown')}::jsonb) END
      WHERE id = ${key}
    `;

    const rows = await sql`SELECT content FROM scripts WHERE hash = ${scriptHash} AND is_key_script = true`;
    if (!rows.length || !rows[0].content) return res.status(404).json({ error: 'Script not found' });
    return res.status(200).json({ ok: true, content: rows[0].content });
  }

  // ── ADMIN ACTIONS ────────────────────────────────────────────────────────
  if (!password || password !== ADMIN_PASSWORD) {
    recordFailure(ip);
    await logSecEvent('bad_admin_password', { ip, action });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  clearFailures(ip);

  try {
    // List all keys
    if (action === 'list') {
      const rows = await sql`SELECT * FROM script_keys ORDER BY created_at DESC`;
      return res.status(200).json({ ok: true, keys: rows.map(mapKey) });
    }

    // Create new key
    if (action === 'create') {
      const { note, scriptHash, expiresAt, maxUses } = params;
      const newId = crypto.randomBytes(16).toString('hex');
      await saveKey(newId, {
        note: note || null, expiresAt: expiresAt ? Number(expiresAt) : null,
        blacklisted: false, scriptHash: scriptHash || null,
        maxUses: maxUses ? Number(maxUses) : null, hwid: null,
        useCount: 0, usageLog: [], knownUsernames: [], createdAt: Date.now(),
      });
      return res.status(200).json({ ok: true, key: newId });
    }

    // Update key (reset hwid, change note, etc)
    if (action === 'update') {
      const { id, note, expiresAt, blacklisted, scriptHash, maxUses, resetHwid } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const ex = await getKey(id) || {};
      await saveKey(id, {
        note: note !== undefined ? note : ex.note,
        expiresAt: expiresAt !== undefined ? (expiresAt ? Number(expiresAt) : null) : ex.expires_at,
        blacklisted: blacklisted !== undefined ? blacklisted : ex.blacklisted,
        scriptHash: scriptHash !== undefined ? (scriptHash || null) : ex.script_hash,
        maxUses: maxUses !== undefined ? (maxUses ? Number(maxUses) : null) : ex.max_uses,
        hwid: resetHwid ? null : ex.hwid,
        useCount: ex.use_count || 0, usageLog: parseJson(ex.usage_log),
        knownUsernames: parseJson(ex.known_usernames), createdAt: ex.created_at || Date.now(),
      });
      return res.status(200).json({ ok: true });
    }

    // Revoke (blacklist) key
    if (action === 'revoke') {
      const { id } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`UPDATE script_keys SET blacklisted = true WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    // Unrevoke key
    if (action === 'unrevoke') {
      const { id } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`UPDATE script_keys SET blacklisted = false WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    // Delete key
    if (action === 'delete') {
      const { id } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM script_keys WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    // List key scripts only
    if (action === 'listscripts') {
      const rows = await sql`SELECT hash, label, created_at, use_count, last_used FROM scripts WHERE is_key_script = true ORDER BY created_at DESC`;
      return res.status(200).json({ ok: true, scripts: rows });
    }

    // Save/update a key script
    if (action === 'savescript') {
      const { hash: providedHash, label, content } = params;
      if (!content) return res.status(400).json({ error: 'Missing content' });
      const scriptHash = providedHash || generateHash();
      await sql`
        INSERT INTO scripts (hash, label, content, created_at, is_key_script)
        VALUES (${scriptHash}, ${label || 'Unnamed'}, ${content}, ${Date.now()}, true)
        ON CONFLICT (hash) DO UPDATE SET
          label = EXCLUDED.label,
          content = EXCLUDED.content,
          is_key_script = true
      `;
      return res.status(200).json({ ok: true, hash: scriptHash });
    }

    // Delete a key script
    if (action === 'deletescript') {
      const { hash } = params;
      if (!hash) return res.status(400).json({ error: 'Missing hash' });
      await sql`DELETE FROM scripts WHERE hash = ${hash} AND is_key_script = true`;
      return res.status(200).json({ ok: true });
    }

    // Get a key script's content
    if (action === 'getscript') {
      const { hash } = params;
      if (!hash) return res.status(400).json({ error: 'Missing hash' });
      const rows = await sql`SELECT * FROM scripts WHERE hash = ${hash} AND is_key_script = true`;
      if (!rows.length) return res.status(404).json({ error: 'Key script not found' });
      return res.status(200).json({ ok: true, hash, label: rows[0].label, content: rows[0].content });
    }

    // Analytics for key scripts
    if (action === 'scriptanalytics') {
      const { hash } = params;
      if (hash) {
        const rows = await sql`SELECT * FROM scripts WHERE hash = ${hash} AND is_key_script = true`;
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json({ ok: true, analytics: { ...rows[0], usageLog: parseJson(rows[0].usage_log) } });
      }
      const rows = await sql`SELECT hash, label, use_count, last_used, usage_log FROM scripts WHERE is_key_script = true ORDER BY use_count DESC`;
      return res.status(200).json({ ok: true, scripts: rows.map(s => ({ id: s.hash, label: s.label, useCount: s.use_count || 0, lastUsed: s.last_used, _type: 'key', usageLog: parseJson(s.usage_log) })) });
    }

    // Usage log for a specific key
    if (action === 'keyusers') {
      const { id } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const data = await getKey(id);
      if (!data) return res.status(404).json({ error: 'Key not found' });
      return res.status(200).json({ ok: true, usageLog: parseJson(data.usage_log), knownUsernames: parseJson(data.known_usernames), useCount: data.use_count || 0 });
    }

    // Security log
    if (action === 'securitylog') {
      const rows = await sql`SELECT ts, type, details FROM security_log ORDER BY ts DESC LIMIT ${SEC_LOG_MAX}`;
      return res.status(200).json({ ok: true, events: rows });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[keys]', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}

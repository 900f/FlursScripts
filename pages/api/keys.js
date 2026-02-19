// pages/api/keys.js
import { sql } from '../../lib/db.js';
import crypto from 'crypto';

const attempts = new Map();
const MAX_TRIES = 15;
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

const SEC_LOG_MAX = 200;

async function logSecurityEvent(type, details) {
  try {
    await sql`
      INSERT INTO security_log (type, details)
      VALUES (${type}, ${JSON.stringify(details)}::jsonb)
    `;
    await sql`
      DELETE FROM security_log
      WHERE id NOT IN (
        SELECT id FROM security_log ORDER BY ts DESC LIMIT ${SEC_LOG_MAX}
      )
    `;
  } catch (e) {
    console.error('logSecurityEvent error:', e);
  }
}

async function getSecurityLog() {
  try {
    const rows = await sql`
      SELECT ts, type, details FROM security_log ORDER BY ts DESC LIMIT ${SEC_LOG_MAX}
    `;
    return rows;
  } catch {
    return [];
  }
}

function generateHash() {
  return crypto.randomBytes(16).toString('hex');
}

async function getKey(keyId) {
  const rows = await sql`SELECT * FROM script_keys WHERE id = ${keyId}`;
  return rows[0] || null;
}

async function saveKey(keyId, data) {
  await sql`
    INSERT INTO script_keys (
      id, note, expires_at, blacklisted, script_hash, max_uses, hwid,
      use_count, usage_log, known_usernames, created_at
    ) VALUES (
      ${keyId},
      ${data.note ?? null},
      ${data.expiresAt ?? null},
      ${data.blacklisted ?? false},
      ${data.scriptHash ?? null},
      ${data.maxUses ?? null},
      ${data.hwid ?? null},
      ${data.useCount ?? 0},
      ${JSON.stringify(data.usageLog ?? [])}::jsonb,
      ${JSON.stringify(data.knownUsernames ?? [])}::jsonb,
      ${data.createdAt ?? Date.now()}
    )
    ON CONFLICT (id) DO UPDATE SET
      note            = EXCLUDED.note,
      expires_at      = EXCLUDED.expires_at,
      blacklisted     = EXCLUDED.blacklisted,
      script_hash     = EXCLUDED.script_hash,
      max_uses        = EXCLUDED.max_uses,
      hwid            = EXCLUDED.hwid,
      use_count       = EXCLUDED.use_count,
      usage_log       = EXCLUDED.usage_log,
      known_usernames = EXCLUDED.known_usernames
  `;
}

async function getAllKeys() {
  return await sql`SELECT * FROM script_keys ORDER BY created_at DESC`;
}

async function getScriptMeta(hash) {
  const rows = await sql`SELECT * FROM scripts WHERE hash = ${hash}`;
  return rows[0] || null;
}

async function getAllScripts() {
  return await sql`SELECT * FROM scripts ORDER BY created_at DESC`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Server misconfiguration: ADMIN_PASSWORD not set' });
  }

  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://www.flurs.xyz';
  const origin = req.headers.origin || '';
  if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden' });

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }

  const body = req.method === 'POST' ? req.body : req.query;
  const { action, password, ...params } = body || {};

  // Public key validation
  if (action === 'validate') {
    const { key, hwid, scriptHash, username } = params;

    if (!key || !scriptHash) {
      await logSecurityEvent('missing_params', { ip, key, scriptHash });
      return res.status(400).json({ error: 'Missing key or scriptHash' });
    }

    const keyData = await getKey(key);
    if (!keyData) {
      await logSecurityEvent('invalid_key', { ip, key, scriptHash });
      return res.status(401).json({ error: 'Invalid key' });
    }

    if (keyData.blacklisted) {
      await logSecurityEvent('blacklisted_key_used', { ip, key, scriptHash });
      return res.status(403).json({ error: 'Key is blacklisted' });
    }

    if (keyData.expires_at && Date.now() > keyData.expires_at) {
      await logSecurityEvent('expired_key_used', { ip, key, scriptHash });
      return res.status(403).json({ error: 'Key has expired' });
    }

    if (keyData.max_uses && (keyData.use_count || 0) >= keyData.max_uses) {
      await logSecurityEvent('max_uses_reached', { ip, key, scriptHash });
      return res.status(403).json({ error: 'Key has reached maximum uses' });
    }

    if (keyData.script_hash && keyData.script_hash !== scriptHash) {
      await logSecurityEvent('wrong_script_key', { ip, key, scriptHash, expected: keyData.script_hash });
      return res.status(403).json({ error: 'Key is not valid for this script' });
    }

    if (keyData.hwid && keyData.hwid !== hwid) {
      await logSecurityEvent('hwid_mismatch', { ip, key, oldHwid: keyData.hwid, newHwid: hwid });
      return res.status(403).json({ error: 'HWID mismatch' });
    }

    if (!keyData.hwid && hwid) {
      await saveKey(key, {
        note: keyData.note,
        expiresAt: keyData.expires_at,
        blacklisted: keyData.blacklisted,
        scriptHash: keyData.script_hash,
        maxUses: keyData.max_uses,
        hwid,
        useCount: keyData.use_count,
        usageLog: JSON.parse(keyData.usage_log || '[]'),
        knownUsernames: JSON.parse(keyData.known_usernames || '[]'),
        createdAt: keyData.created_at,
      });
    }

    const newLog = { ts: Date.now(), username: username || 'unknown', ip };
    await sql`
      UPDATE script_keys
      SET
        use_count = use_count + 1,
        usage_log = jsonb_insert(usage_log, '{0}', ${JSON.stringify(newLog)}::jsonb),
        known_usernames = jsonb_insert(known_usernames, '{0}', ${username || 'unknown'}::text, true)
      WHERE id = ${key}
    `;

    const scriptMeta = await getScriptMeta(scriptHash);
    if (scriptMeta?.content) {
      return res.status(200).json({ ok: true, content: scriptMeta.content });
    } else {
      return res.status(404).json({ error: 'Script content not found' });
    }
  }

  // Admin actions
  if (!password || password !== ADMIN_PASSWORD) {
    recordFailure(ip);
    await logSecurityEvent('bad_admin_password', { ip, action });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  clearFailures(ip);

  try {
    if (action === 'list') {
      const keys = await getAllKeys();
      return res.status(200).json({ ok: true, keys });
    }

    if (action === 'savekey' || action === 'update') {
      const { id, note, expiresAt, blacklisted, scriptHash, maxUses, resetHwid } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const existing = await getKey(id) || {};
      const data = {
        note: note !== undefined ? note : existing.note,
        expiresAt: expiresAt !== undefined ? (expiresAt ? Number(expiresAt) : null) : existing.expires_at,
        blacklisted: blacklisted !== undefined ? blacklisted : existing.blacklisted,
        scriptHash: scriptHash !== undefined ? (scriptHash || null) : existing.script_hash,
        maxUses: maxUses !== undefined ? (maxUses ? Number(maxUses) : null) : existing.max_uses,
        hwid: resetHwid ? null : existing.hwid,
        useCount: existing.use_count || 0,
        usageLog: JSON.parse(existing.usage_log || '[]'),
        knownUsernames: JSON.parse(existing.known_usernames || '[]'),
        createdAt: existing.created_at || Date.now(),
      };

      await saveKey(id, data);
      return res.status(200).json({ ok: true });
    }

    if (action === 'listscripts') {
      const scripts = await getAllScripts();
      return res.status(200).json({ ok: true, scripts });
    }

    if (action === 'savescript') {
      const { hash: providedHash, label, content } = params;
      if (!content) return res.status(400).json({ error: 'Missing content' });
      const scriptHash = providedHash || generateHash();
      await sql`
        INSERT INTO scripts (hash, label, content, created_at)
        VALUES (${scriptHash}, ${label || 'Unnamed'}, ${content}, ${Date.now()})
        ON CONFLICT (hash) DO UPDATE SET
          label = EXCLUDED.label,
          content = EXCLUDED.content
      `;
      return res.status(200).json({ ok: true, hash: scriptHash });
    }

    if (action === 'deletescript') {
      const { hash } = params;
      if (!hash) return res.status(400).json({ error: 'Missing hash' });
      await sql`DELETE FROM scripts WHERE hash = ${hash}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'getscript') {
      const { hash } = params;
      if (!hash) return res.status(400).json({ error: 'Missing hash' });
      const meta = await getScriptMeta(hash);
      if (!meta) return res.status(404).json({ error: 'Script not found' });
      return res.status(200).json({ ok: true, hash, label: meta.label || 'Unnamed', content: meta.content });
    }

    if (action === 'scriptanalytics') {
      const { hash } = params;
      if (hash) {
        const meta = await getScriptMeta(hash);
        if (!meta) return res.status(404).json({ error: 'Script not found' });
        return res.status(200).json({ ok: true, analytics: meta });
      } else {
        const scripts = await getAllScripts();
        const summary = scripts.map(s => ({
          hash: s.hash, label: s.label, useCount: s.use_count, lastUsed: s.last_used,
          recentUsers: JSON.parse(s.usage_log || '[]').slice(0, 5).map(l => ({ username: l.username, ts: l.ts, ip: l.ip })),
        }));
        summary.sort((a, b) => b.useCount - a.useCount);
        return res.status(200).json({ ok: true, scripts: summary });
      }
    }

    if (action === 'securitylog') {
      const events = await getSecurityLog();
      return res.status(200).json({ ok: true, events });
    }

    if (action === 'keyusers') {
      const { id } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const data = await getKey(id);
      if (!data) return res.status(404).json({ error: 'Key not found' });
      return res.status(200).json({
        ok: true,
        usageLog: JSON.parse(data.usage_log || '[]'),
        knownUsernames: JSON.parse(data.known_usernames || '[]'),
        lastUsername: JSON.parse(data.known_usernames || '[]')[0] || null,
        useCount: data.use_count || 0,
      });
    }

    if (action === 'create') {
      const { note, scriptHash, expiresAt, maxUses } = params;
      const newId = crypto.randomBytes(16).toString('hex');
      await saveKey(newId, {
        note: note || null,
        expiresAt: expiresAt ? Number(expiresAt) : null,
        blacklisted: false,
        scriptHash: scriptHash || null,
        maxUses: maxUses ? Number(maxUses) : null,
        hwid: null,
        useCount: 0,
        usageLog: [],
        knownUsernames: [],
        createdAt: Date.now(),
      });
      return res.status(200).json({ ok: true, key: newId });
    }

    if (action === 'delete') {
      const { id } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM script_keys WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'revoke') {
      const { id } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`UPDATE script_keys SET blacklisted = true WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (action === 'unrevoke') {
      const { id } = params;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`UPDATE script_keys SET blacklisted = false WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Keys API error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}

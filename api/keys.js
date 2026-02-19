// api/keys.js
// Full key-based loader system with GET + POST support for validation
// Admin actions require POST + password
// v2: Tracks Roblox username, adds analytics + security log endpoints

import { put, list, del } from '@vercel/blob';
import crypto from 'crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is not set');

// ── Rate limiter ─────────────────────────────────────────────────────────
const attempts = new Map();
const MAX_TRIES = 15;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
    const now = Date.now(), e = attempts.get(ip);
    if (!e || now > e.resetAt) { 
        attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS }); 
        return false; 
    }
    return e.count >= MAX_TRIES;
}

function recordFailure(ip) {
    const now = Date.now(), e = attempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
    e.count++; 
    attempts.set(ip, e);
}

function clearFailures(ip) { 
    attempts.delete(ip); 
}

// ── Security event log (in-memory ring buffer, last 200 events) ──────────
const securityLog = [];
const SEC_LOG_MAX = 200;

function logSecurityEvent(type, details) {
    securityLog.unshift({ ts: Date.now(), type, ...details });
    if (securityLog.length > SEC_LOG_MAX) securityLog.pop();
}

// ── Helpers ───────────────────────────────────────────────────────────────
function generateKey() {
    const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    return `FLURS-${seg()}-${seg()}-${seg()}-${seg()}`;
}

function generateHash() {
    return crypto.randomBytes(16).toString('hex');
}

async function getKey(keyId) {
    const { blobs } = await list({ prefix: `keys/${keyId}.json` });
    const b = blobs.find(x => x.pathname === `keys/${keyId}.json`);
    if (!b) return null;
    return fetch(b.url).then(r => r.json());
}

async function saveKey(keyId, data) {
    await put(`keys/${keyId}.json`, JSON.stringify(data), {
        access: 'public', 
        contentType: 'application/json', 
        addRandomSuffix: false,
    });
}

async function getAllKeys() {
    const { blobs } = await list({ prefix: 'keys/' });
    const keyBlobs = blobs.filter(b => b.pathname.endsWith('.json') && !b.pathname.includes('.meta'));
    const keys = await Promise.all(keyBlobs.map(async b => {
        try { return await fetch(b.url).then(r => r.json()); } catch { return null; }
    }));
    return keys.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function getScriptMeta(hash) {
    const { blobs } = await list({ prefix: `keyscripts/${hash}.meta.json` });
    const b = blobs.find(x => x.pathname === `keyscripts/${hash}.meta.json`);
    if (!b) return null;
    return fetch(b.url).then(r => r.json());
}

async function saveScriptMeta(hash, meta) {
    await put(`keyscripts/${hash}.meta.json`, JSON.stringify(meta), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false,
    });
}

async function getAllScripts() {
    const { blobs } = await list({ prefix: 'keyscripts/' });
    const metaBlobs = blobs.filter(b => b.pathname.endsWith('.meta.json'));
    const scripts = await Promise.all(metaBlobs.map(async b => {
        try { return await fetch(b.url).then(r => r.json()); } catch { return null; }
    }));
    return scripts.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ── Analytics: increment script use count ────────────────────────────────
async function trackScriptUse(hash, username, ip) {
    try {
        const meta = await getScriptMeta(hash);
        if (!meta) return;
        meta.useCount = (meta.useCount || 0) + 1;
        meta.usageLog = meta.usageLog || [];
        meta.usageLog.unshift({ ts: Date.now(), username: username || 'unknown', ip });
        if (meta.usageLog.length > 100) meta.usageLog = meta.usageLog.slice(0, 100);
        meta.lastUsed = Date.now();
        await saveScriptMeta(hash, meta);
    } catch (e) {
        // Non-critical — don't fail the request
        console.error('trackScriptUse error:', e);
    }
}

export default async function handler(req, res) {
    // ── CORS ──────────────────────────────────────────────────────────────
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://flurs.xyz';
    const origin = req.headers.origin || '';
    if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden' });

    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── Rate limiting ────────────────────────────────────────────────────
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (isRateLimited(ip)) {
        logSecurityEvent('rate_limited', { ip });
        return res.status(429).json({ error: 'Too many requests.' });
    }

    // ── Parse params (GET query or POST body) ────────────────────────────
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

    // ── Public action: validate (GET or POST allowed) ────────────────────
    if (action === 'validate') {
        return handleValidate(req, res, params, ip);
    }

    // ── Admin actions: POST + password only ──────────────────────────────
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Admin actions require POST' });
    }

    if (!password || password !== ADMIN_PASSWORD) {
        recordFailure(ip);
        logSecurityEvent('bad_admin_password', { ip });
        return res.status(401).json({ error: 'Unauthorized' });
    }
    clearFailures(ip);

    try {
        if (action === 'create')           return handleCreate(res, params);
        if (action === 'list')             return handleList(res);
        if (action === 'revoke')           return handleRevoke(res, params);
        if (action === 'unrevoke')         return handleUnrevoke(res, params);
        if (action === 'delete')           return handleDelete(res, params);
        if (action === 'update')           return handleUpdate(res, params);
        if (action === 'listscripts')      return handleListScripts(res);
        if (action === 'savescript')       return handleSaveScript(res, params);
        if (action === 'deletescript')     return handleDeleteScript(res, params);
        if (action === 'getscript')        return handleGetScript(res, params);
        if (action === 'scriptanalytics')  return handleScriptAnalytics(res, params);
        if (action === 'securitylog')      return handleSecurityLog(res);
        if (action === 'keyusers')         return handleKeyUsers(res, params);
        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('keys.js error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

// ── VALIDATE ──────────────────────────────────────────────────────────────
async function handleValidate(req, res, params, ip) {
    const { key, hwid, scriptHash, username } = params;

    if (!key)        return res.status(400).json({ ok: false, error: 'No key provided' });
    if (!scriptHash) return res.status(400).json({ ok: false, error: 'No scriptHash provided' });

    const allKeys = await getAllKeys();
    const keyData = allKeys.find(k => k.key === key);

    if (!keyData) {
        logSecurityEvent('invalid_key', { ip, key: key.slice(0, 8) + '…', scriptHash, username });
        return res.status(403).json({ ok: false, error: 'Invalid key' });
    }
    if (keyData.revoked) {
        logSecurityEvent('revoked_key_used', { ip, keyId: keyData.id, username });
        return res.status(403).json({ ok: false, error: 'Key has been revoked' });
    }
    if (keyData.blacklisted) {
        logSecurityEvent('blacklisted_key_used', { ip, keyId: keyData.id, username });
        return res.status(403).json({ ok: false, error: 'Key is blacklisted' });
    }
    if (keyData.expiresAt && Date.now() > keyData.expiresAt) {
        return res.status(403).json({ ok: false, error: 'Key has expired' });
    }
    if (keyData.maxUses && (keyData.useCount || 0) >= keyData.maxUses) {
        return res.status(403).json({ ok: false, error: 'Key has reached its maximum uses' });
    }
    if (keyData.scriptHash && keyData.scriptHash !== scriptHash) {
        logSecurityEvent('wrong_script_key', { ip, keyId: keyData.id, scriptHash, username });
        return res.status(403).json({ ok: false, error: 'Key is not valid for this script' });
    }

    if (hwid && hwid !== 'unknown') {
        if (!keyData.hwid) {
            keyData.hwid = hwid;
        } else if (keyData.hwid !== hwid) {
            logSecurityEvent('hwid_mismatch', { ip, keyId: keyData.id, username, expectedHwid: keyData.hwid.slice(0,8)+'…' });
            return res.status(403).json({ ok: false, error: 'HWID mismatch — wrong device' });
        }
    }

    // Log usage with Roblox username
    const now = Date.now();
    keyData.lastUsed  = now;
    keyData.useCount  = (keyData.useCount || 0) + 1;
    keyData.usageLog  = keyData.usageLog || [];
    keyData.usageLog.unshift({ 
        ts: now, 
        ip, 
        hwid: hwid || null,
        username: username || 'unknown',
    });
    if (keyData.usageLog.length > 50) keyData.usageLog = keyData.usageLog.slice(0, 50);

    // Track last known username
    if (username && username !== 'unknown') {
        keyData.lastUsername = username;
        if (!keyData.knownUsernames) keyData.knownUsernames = [];
        if (!keyData.knownUsernames.includes(username)) {
            keyData.knownUsernames.push(username);
        }
    }

    await saveKey(keyData.id, keyData);

    // Track per-script analytics
    await trackScriptUse(scriptHash, username || 'unknown', ip);

    // Fetch script content
    const { blobs } = await list({ prefix: `keyscripts/${scriptHash}.lua` });
    const luaBlob = blobs.find(b => b.pathname === `keyscripts/${scriptHash}.lua`);
    if (!luaBlob) return res.status(404).json({ ok: false, error: 'Script not found on server' });

    const content = await fetch(luaBlob.url).then(r => r.text());
    return res.status(200).json({ ok: true, content });
}

// ── CREATE KEY ────────────────────────────────────────────────────────────
async function handleCreate(res, params) {
    const { note, expiresAt, scriptHash, maxUses } = params;
    const id  = generateHash();
    const key = generateKey();
    const data = {
        id,
        key,
        note:            note || '',
        scriptHash:      scriptHash || null,
        hwid:            null,
        revoked:         false,
        blacklisted:     false,
        expiresAt:       expiresAt ? Number(expiresAt) : null,
        maxUses:         maxUses ? Number(maxUses) : null,
        useCount:        0,
        usageLog:        [],
        lastUsername:    null,
        knownUsernames:  [],
        createdAt:       Date.now(),
        lastUsed:        null,
    };
    await saveKey(id, data);
    return res.status(200).json({ ok: true, key: data.key, id });
}

// ── LIST KEYS ─────────────────────────────────────────────────────────────
async function handleList(res) {
    const keys = await getAllKeys();
    return res.status(200).json({ ok: true, keys });
}

// ── REVOKE KEY ────────────────────────────────────────────────────────────
async function handleRevoke(res, params) {
    const { id } = params;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const data = await getKey(id);
    if (!data) return res.status(404).json({ error: 'Key not found' });
    data.revoked = true;
    await saveKey(id, data);
    return res.status(200).json({ ok: true });
}

// ── UNREVOKE KEY ──────────────────────────────────────────────────────────
async function handleUnrevoke(res, params) {
    const { id } = params;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const data = await getKey(id);
    if (!data) return res.status(404).json({ error: 'Key not found' });
    data.revoked = false;
    await saveKey(id, data);
    return res.status(200).json({ ok: true });
}

// ── DELETE KEY ────────────────────────────────────────────────────────────
async function handleDelete(res, params) {
    const { id } = params;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const { blobs } = await list({ prefix: `keys/${id}.json` });
    await Promise.all(blobs.map(b => del(b.url)));
    return res.status(200).json({ ok: true });
}

// ── UPDATE KEY ────────────────────────────────────────────────────────────
async function handleUpdate(res, params) {
    const { id, note, expiresAt, resetHwid, blacklisted, scriptHash, maxUses } = params;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const data = await getKey(id);
    if (!data) return res.status(404).json({ error: 'Key not found' });
    if (note        !== undefined) data.note        = note;
    if (expiresAt   !== undefined) data.expiresAt   = expiresAt ? Number(expiresAt) : null;
    if (blacklisted !== undefined) data.blacklisted = blacklisted;
    if (scriptHash  !== undefined) data.scriptHash  = scriptHash || null;
    if (maxUses     !== undefined) data.maxUses     = maxUses ? Number(maxUses) : null;
    if (resetHwid)                 data.hwid        = null;
    await saveKey(id, data);
    return res.status(200).json({ ok: true });
}

// ── LIST KEY SCRIPTS ──────────────────────────────────────────────────────
async function handleListScripts(res) {
    const scripts = await getAllScripts();
    return res.status(200).json({ ok: true, scripts });
}

// ── SAVE KEY SCRIPT ───────────────────────────────────────────────────────
async function handleSaveScript(res, params) {
    const { hash, label, content } = params;
    if (!content) return res.status(400).json({ error: 'Missing content' });
    const scriptHash = hash || generateHash();

    await put(`keyscripts/${scriptHash}.lua`, content, {
        access: 'public', contentType: 'text/plain', addRandomSuffix: false,
    });

    const existing = await getScriptMeta(scriptHash);
    const meta = {
        hash: scriptHash,
        label: label || existing?.label || 'Unnamed',
        createdAt: existing?.createdAt || Date.now(),
        useCount:  existing?.useCount  || 0,
        usageLog:  existing?.usageLog  || [],
        lastUsed:  existing?.lastUsed  || null,
    };
    await saveScriptMeta(scriptHash, meta);

    return res.status(200).json({ ok: true, hash: scriptHash });
}

// ── DELETE KEY SCRIPT ─────────────────────────────────────────────────────
async function handleDeleteScript(res, params) {
    const { hash } = params;
    if (!hash) return res.status(400).json({ error: 'Missing hash' });
    const { blobs } = await list({ prefix: `keyscripts/${hash}` });
    await Promise.all(blobs.map(b => del(b.url)));
    return res.status(200).json({ ok: true });
}

// ── GET KEY SCRIPT CONTENT (for editor) ──────────────────────────────────
async function handleGetScript(res, params) {
    const { hash } = params;
    if (!hash) return res.status(400).json({ error: 'Missing hash' });
    const { blobs } = await list({ prefix: `keyscripts/${hash}.lua` });
    const luaBlob = blobs.find(b => b.pathname === `keyscripts/${hash}.lua`);
    if (!luaBlob) return res.status(404).json({ error: 'Script not found' });
    const [content, meta] = await Promise.all([
        fetch(luaBlob.url).then(r => r.text()),
        getScriptMeta(hash),
    ]);
    return res.status(200).json({ ok: true, hash, label: meta?.label || 'Unnamed', content });
}

// ── SCRIPT ANALYTICS ─────────────────────────────────────────────────────
async function handleScriptAnalytics(res, params) {
    const { hash } = params;
    if (hash) {
        // Single script analytics
        const meta = await getScriptMeta(hash);
        if (!meta) return res.status(404).json({ error: 'Script not found' });
        return res.status(200).json({ ok: true, analytics: meta });
    } else {
        // All scripts summary
        const scripts = await getAllScripts();
        const summary = scripts.map(s => ({
            hash:     s.hash,
            label:    s.label,
            useCount: s.useCount  || 0,
            lastUsed: s.lastUsed  || null,
            // Top 5 most recent users
            recentUsers: (s.usageLog || []).slice(0, 5).map(l => ({
                username: l.username,
                ts:       l.ts,
                ip:       l.ip,
            })),
        }));
        // Sort by use count descending
        summary.sort((a, b) => b.useCount - a.useCount);
        return res.status(200).json({ ok: true, scripts: summary });
    }
}

// ── SECURITY LOG ──────────────────────────────────────────────────────────
async function handleSecurityLog(res) {
    return res.status(200).json({ ok: true, events: securityLog });
}

// ── KEY USERS (who used a specific key) ──────────────────────────────────
async function handleKeyUsers(res, params) {
    const { id } = params;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const data = await getKey(id);
    if (!data) return res.status(404).json({ error: 'Key not found' });
    return res.status(200).json({ 
        ok: true, 
        usageLog:        data.usageLog        || [],
        knownUsernames:  data.knownUsernames   || [],
        lastUsername:    data.lastUsername     || null,
        useCount:        data.useCount         || 0,
    });
}
// api/keys.js
// Full key-based loader system with GET + POST support for validation
// Admin actions require POST + password

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

async function getAllScripts() {
    const { blobs } = await list({ prefix: 'keyscripts/' });
    const metaBlobs = blobs.filter(b => b.pathname.endsWith('.meta.json'));
    const scripts = await Promise.all(metaBlobs.map(async b => {
        try { return await fetch(b.url).then(r => r.json()); } catch { return null; }
    }));
    return scripts.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
    if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests.' });

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
        return res.status(401).json({ error: 'Unauthorized' });
    }
    clearFailures(ip);

    try {
        if (action === 'create')        return handleCreate(res, params);
        if (action === 'list')          return handleList(res);
        if (action === 'revoke')        return handleRevoke(res, params);
        if (action === 'unrevoke')      return handleUnrevoke(res, params);
        if (action === 'delete')        return handleDelete(res, params);
        if (action === 'update')        return handleUpdate(res, params);
        if (action === 'listscripts')   return handleListScripts(res);
        if (action === 'savescript')    return handleSaveScript(res, params);
        if (action === 'deletescript')  return handleDeleteScript(res, params);
        if (action === 'getscript')     return handleGetScript(res, params);
        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('keys.js error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

// ── VALIDATE ──────────────────────────────────────────────────────────────
async function handleValidate(req, res, params, ip) {
    const { key, hwid, scriptHash } = params;

    if (!key)        return res.status(400).json({ ok: false, error: 'No key provided' });
    if (!scriptHash) return res.status(400).json({ ok: false, error: 'No scriptHash provided' });

    const allKeys = await getAllKeys();
    const keyData = allKeys.find(k => k.key === key);

    if (!keyData)              return res.status(403).json({ ok: false, error: 'Invalid key' });
    if (keyData.revoked)       return res.status(403).json({ ok: false, error: 'Key has been revoked' });
    if (keyData.blacklisted)   return res.status(403).json({ ok: false, error: 'Key is blacklisted' });

    if (keyData.expiresAt && Date.now() > keyData.expiresAt) {
        return res.status(403).json({ ok: false, error: 'Key has expired' });
    }

    if (keyData.maxUses && (keyData.useCount || 0) >= keyData.maxUses) {
        return res.status(403).json({ ok: false, error: 'Key has reached its maximum uses' });
    }

    if (keyData.scriptHash && keyData.scriptHash !== scriptHash) {
        return res.status(403).json({ ok: false, error: 'Key is not valid for this script' });
    }

    if (hwid && hwid !== 'unknown') {
        if (!keyData.hwid) {
            keyData.hwid = hwid;
        } else if (keyData.hwid !== hwid) {
            return res.status(403).json({ ok: false, error: 'HWID mismatch — wrong device' });
        }
    }

    // Log usage
    const now = Date.now();
    keyData.lastUsed  = now;
    keyData.useCount  = (keyData.useCount || 0) + 1;
    keyData.usageLog  = keyData.usageLog || [];
    keyData.usageLog.push({ ts: now, ip, hwid: hwid || null });
    if (keyData.usageLog.length > 50) keyData.usageLog = keyData.usageLog.slice(-50);

    await saveKey(keyData.id, keyData);

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
        note:       note || '',
        scriptHash: scriptHash || null,
        hwid:       null,
        revoked:    false,
        blacklisted: false,
        expiresAt:  expiresAt ? Number(expiresAt) : null,
        maxUses:    maxUses ? Number(maxUses) : null,
        useCount:   0,
        usageLog:   [],
        createdAt:  Date.now(),
        lastUsed:   null,
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
    if (note        !== undefined) data.note       = note;
    if (expiresAt   !== undefined) data.expiresAt  = expiresAt ? Number(expiresAt) : null;
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
    };
    await put(`keyscripts/${scriptHash}.meta.json`, JSON.stringify(meta), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false,
    });

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
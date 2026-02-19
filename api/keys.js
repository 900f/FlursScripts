// api/keys.js
// Full key-based loader system with GET + POST support for validation
// Supports v2 (direct scriptHash) and v3 (key-linked) scripts
// Logs username, hwid, ip during validation and removes "unknown" usernames

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

// ── Security event log (persisted to blob storage) ───────────────────────
const SEC_LOG_KEY = 'security/log.json';
const SEC_LOG_MAX = 200;

async function logSecurityEvent(type, details) {
    try {
        let events = await getSecurityLog();
        events.unshift({ ts: Date.now(), type, ...details });
        if (events.length > SEC_LOG_MAX) events = events.slice(0, SEC_LOG_MAX);
        await put(SEC_LOG_KEY, JSON.stringify(events), {
            access: 'public', contentType: 'application/json', addRandomSuffix: false,
        });
    } catch (e) {
        console.error('logSecurityEvent error:', e);
    }
}

async function getSecurityLog() {
    try {
        const { blobs } = await list({ prefix: SEC_LOG_KEY });
        const b = blobs.find(x => x.pathname === SEC_LOG_KEY);
        if (!b) return [];
        return fetch(b.url).then(r => r.json());
    } catch {
        return [];
    }
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

async function getScriptMeta(hash, isV2 = false) {
    const prefix = isV2 ? `scripts/${hash}.meta.json` : `keyscripts/${hash}.meta.json`;
    const { blobs } = await list({ prefix });
    const b = blobs.find(x => x.pathname.endsWith('.meta.json'));
    if (!b) return null;
    return fetch(b.url).then(r => r.json());
}

async function saveScriptMeta(hash, meta, isV2 = false) {
    const prefix = isV2 ? `scripts/${hash}.meta.json` : `keyscripts/${hash}.meta.json`;
    await put(prefix, JSON.stringify(meta), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false,
    });
}

async function getScriptContent(hash, isV2 = false) {
    const prefix = isV2 ? `scripts/${hash}.lua` : `keyscripts/${hash}.lua`;
    const { blobs } = await list({ prefix });
    const b = blobs.find(x => x.pathname.endsWith('.lua'));
    if (!b) return null;
    return fetch(b.url).then(r => r.text());
}

// ── Validation + Logging Endpoint ────────────────────────────────────────
async function handleValidate(req, res, ip) {
    const query = req.query || {};
    const { key = "", hwid = "unknown", scriptHash, username = "unknown" } = query;

    if (!scriptHash) {
        return res.status(400).json({ ok: false, error: 'Missing scriptHash' });
    }

    // Assume v2 for now (scripts/ folder) - change logic if needed
    const isV2 = true;

    const content = await getScriptContent(scriptHash, isV2);
    if (!content) {
        return res.status(404).json({ ok: false, error: 'Script not found' });
    }

    // Log usage
    let meta = await getScriptMeta(scriptHash, isV2) || {
        hash: scriptHash,
        useCount: 0,
        usageLog: [],
        lastUsed: null
    };

    meta.useCount = (meta.useCount || 0) + 1;

    const logEntry = {
        ts: Date.now(),
        username: username || 'unknown',
        ip: ip,
        hwid: hwid || 'unknown',
        key: key || null
    };

    meta.usageLog = meta.usageLog || [];
    meta.usageLog.unshift(logEntry);
    meta.lastUsed = Date.now();

    // STRICTLY remove ALL "unknown" username entries
    meta.usageLog = meta.usageLog.filter(log => log.username !== 'unknown');

    await saveScriptMeta(scriptHash, meta, isV2);

    // Return content to client
    return res.status(200).json({ ok: true, content });
}

// ── Main Handler ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://flurs.xyz';
    const origin = req.headers.origin || '';
    if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden' });

    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

    if (isRateLimited(ip)) {
        return res.status(429).json({ error: 'Too many requests' });
    }

    const params = req.method === 'GET' ? req.query : (req.body || {});
    const { action } = params;

    // Public validation endpoint (used by loaders)
    if (action === 'validate') {
        return handleValidate(req, res, ip);
    }

    // ── All other actions require POST + password ────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { password } = params;
    if (!password || password !== ADMIN_PASSWORD) {
        recordFailure(ip);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    clearFailures(ip);

    try {
        // GENERATE NEW KEY
        if (action === 'generate') {
            const newKey = generateKey();
            await saveKey(newKey, {
                id: newKey,
                createdAt: Date.now(),
                note: params.note || '',
                expiresAt: params.expiresAt ? Number(params.expiresAt) : null,
                blacklisted: false,
                maxUses: params.maxUses ? Number(params.maxUses) : null,
                usageLog: [],
                knownUsernames: []
            });
            return res.status(200).json({ ok: true, key: newKey });
        }

        // DELETE KEY
        if (action === 'delete') {
            const { id } = params;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const { blobs } = await list({ prefix: `keys/${id}.json` });
            await Promise.all(blobs.map(b => del(b.url)));
            return res.status(200).json({ ok: true });
        }

        // UPDATE KEY
        if (action === 'update') {
            const { id, note, expiresAt, resetHwid, blacklisted, scriptHash, maxUses } = params;
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const data = await getKey(id);
            if (!data) return res.status(404).json({ error: 'Key not found' });
            if (note !== undefined) data.note = note;
            if (expiresAt !== undefined) data.expiresAt = expiresAt ? Number(expiresAt) : null;
            if (blacklisted !== undefined) data.blacklisted = blacklisted;
            if (scriptHash !== undefined) data.scriptHash = scriptHash || null;
            if (maxUses !== undefined) data.maxUses = maxUses ? Number(maxUses) : null;
            if (resetHwid) data.hwid = null;
            await saveKey(id, data);
            return res.status(200).json({ ok: true });
        }

        // LIST KEYS
        if (action === 'list') {
            const keys = await getAllKeys();
            return res.status(200).json({ ok: true, keys });
        }

        // LIST SECURITY LOG
        if (action === 'securitylog') {
            const events = await getSecurityLog();
            return res.status(200).json({ ok: true, events });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('Keys API error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
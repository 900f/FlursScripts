// api/bootstrap.js
// Creates a "bootstrap" Lua blob from a target script URL.
// The blob is XOR-encoded + base64-like obfuscated so the URL cannot be
// read by anyone who dumps the loader source.  At runtime the Lua decodes
// itself and HttpGet's the real URL.
//
// Admin actions: generate, list, delete  (all require password)
// Public action: serve  (GET /api/bootstrap/ID.lua — executor-only)

import { put, list, del } from '@vercel/blob';
import crypto from 'crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is not set');

// ── Rate limiter ──────────────────────────────────────────────────────────
const attempts  = new Map();
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

// ── Browser detection ─────────────────────────────────────────────────────
const BROWSER_UA = ['mozilla','chrome','safari','firefox','edge','opera','wget','python','postman','curl','insomnia','httpie'];
function isBrowser(req) {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (ua.includes('roblox') || ua.includes('wininet')) return false;
    if (BROWSER_UA.some(p => ua.includes(p))) return true;
    if (ua.length > 0) return true;
    return false;
}

// ── Obfuscation helpers ───────────────────────────────────────────────────
// We XOR each char of the URL against a rolling key derived from a random seed,
// then encode the byte array as a Lua table literal.  The seed is itself split
// across two Lua variables with misleading names, and the decode loop is buried
// inside a do-block with garbage variable names.

function generateSeed() {
    return crypto.randomBytes(4).readUInt32BE(0);
}

/** XOR-encode `text` using a linear congruential generator seeded by `seed`. */
function xorEncode(text, seed) {
    const bytes = Buffer.from(text, 'utf8');
    const out   = [];
    let   state = seed >>> 0;
    for (const b of bytes) {
        // LCG: same constants Lua's math.random uses
        state = ((state * 1664525 + 1013904223) & 0xFFFFFFFF) >>> 0;
        out.push(b ^ (state & 0xFF));
    }
    return out;
}

/** Turn a byte array into a Lua table literal, e.g. {72,101,...} */
function toLuaTable(bytes) {
    return '{' + bytes.join(',') + '}';
}

/** Generate a random 6-char alphanumeric variable name */
function randVar() {
    return '_' + crypto.randomBytes(4).toString('hex');
}

/**
 * Build the full obfuscated bootstrap Lua.
 * The URL is encoded as a Lua number table; the decoder is inlined.
 */
function buildBootstrapLua(targetUrl, label) {
    const seed      = generateSeed();
    const encoded   = xorEncode(targetUrl, seed);
    const luaTable  = toLuaTable(encoded);

    // Random var names to frustrate static analysis
    const vData  = randVar();
    const vSeed  = randVar();
    const vState = randVar();
    const vOut   = randVar();
    const vI     = randVar();
    const vB     = randVar();
    const vUrl   = randVar();
    const vFn    = randVar();
    const vErr   = randVar();

    // Split seed into two parts so it's not one obvious number
    const seedHi = (seed >>> 16) & 0xFFFF;
    const seedLo = seed & 0xFFFF;

    return `-- Flurs Bootstrap | https://flurs.xyz
-- ${label || 'Protected Script'}
do
    local ${vData}  = ${luaTable}
    local ${vSeed}  = bit32 and bit32.bor(bit32.lshift(${seedHi}, 16), ${seedLo}) or (${seedHi} * 65536 + ${seedLo})
    local ${vState} = ${vSeed}
    local ${vOut}   = {}
    for ${vI} = 1, #${vData} do
        ${vState} = (${vState} * 1664525 + 1013904223) % 4294967296
        ${vOut}[${vI}] = string.char(bit32 and bit32.bxor(${vData}[${vI}], ${vState} % 256)
                                              or (${vData}[${vI}] ~ (${vState} % 256)))
    end
    local ${vUrl} = table.concat(${vOut})
    local ${vFn}, ${vErr} = loadstring(game:HttpGet(${vUrl}, true))
    if not ${vFn} then error("[Flurs] " .. tostring(${vErr}), 0) end
    ${vFn}()
end
`;
}

function generateId() {
    return crypto.randomBytes(16).toString('hex');
}

export default async function handler(req, res) {
    // ── CORS ──────────────────────────────────────────────────────────────
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://flurs.xyz';
    const origin = req.headers.origin || '';

    // Allow same-origin POST from admin panel; always allow executor GET (no origin)
    if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden' });

    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests.' });

    // ── GET: serve bootstrap blob to executors ─────────────────────────────
    if (req.method === 'GET') {
        // Block browsers
        if (isBrowser(req)) {
            return res.status(403).setHeader('Content-Type', 'text/plain').end('-- Forbidden');
        }

        const urlMatch = (req.url || '').match(/([a-f0-9]{32,64})\.lua/i);
        const id = urlMatch ? urlMatch[1].toLowerCase() : null;
        if (!id) return res.status(400).end('-- invalid_id');

        try {
            const { blobs } = await list({ prefix: `bootstrap/${id}.meta.json` });
            const metaBlob  = blobs.find(b => b.pathname === `bootstrap/${id}.meta.json`);
            if (!metaBlob) return res.status(404).end('-- not_found');

            const meta = await fetch(metaBlob.url).then(r => r.json());

            // Re-generate the obfuscated Lua at serve time using stored seed + encoded bytes
            // (we store the encoded bytes + seed so the URL never touches our DB in plaintext)
            const lua = rebuildLua(meta);

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            return res.status(200).end(lua);
        } catch (err) {
            console.error('Bootstrap serve error:', err);
            return res.status(500).end('-- error');
        }
    }

    // ── POST: admin actions ────────────────────────────────────────────────
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { action, password, url: targetUrl, label, id } = req.body || {};

    if (!password || password !== ADMIN_PASSWORD) {
        recordFailure(ip);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    clearFailures(ip);

    try {
        // ── GENERATE: create a new bootstrap blob ─────────────────────────
        if (action === 'generate') {
            if (!targetUrl) return res.status(400).json({ error: 'Missing url' });

            // Validate it looks like a URL
            try { new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

            const newId  = generateId();
            const seed   = generateSeed();
            const encoded = xorEncode(targetUrl, seed);

            const meta = {
                id:        newId,
                label:     label || 'Bootstrap',
                seed,
                encoded,   // store encoded bytes (NOT the raw URL)
                createdAt: Date.now(),
            };

            await put(`bootstrap/${newId}.meta.json`, JSON.stringify(meta), {
                access: 'public', contentType: 'application/json', addRandomSuffix: false,
            });

            const serveUrl  = `https://api.flurs.xyz/files/v3/bootstrap/${newId}.lua`;
            const loadstring = `loadstring(game:HttpGet("${serveUrl}", true))()`;

            return res.status(200).json({ ok: true, id: newId, serveUrl, loadstring });
        }

        // ── LIST ──────────────────────────────────────────────────────────
        if (action === 'list') {
            const { blobs } = await list({ prefix: 'bootstrap/' });
            const metaBlobs = blobs.filter(b => b.pathname.endsWith('.meta.json'));
            const items = await Promise.all(metaBlobs.map(async b => {
                try {
                    const m = await fetch(b.url).then(r => r.json());
                    return { id: m.id, label: m.label, createdAt: m.createdAt };
                } catch { return null; }
            }));
            const sorted = items.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            return res.status(200).json({ ok: true, items: sorted });
        }

        // ── DELETE ────────────────────────────────────────────────────────
        if (action === 'delete') {
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const { blobs } = await list({ prefix: `bootstrap/${id}` });
            await Promise.all(blobs.map(b => del(b.url)));
            return res.status(200).json({ ok: true });
        }

        // ── RENAME ────────────────────────────────────────────────────────
        if (action === 'rename') {
            if (!id || !label) return res.status(400).json({ error: 'Missing id or label' });
            const { blobs } = await list({ prefix: `bootstrap/${id}.meta.json` });
            const metaBlob  = blobs.find(b => b.pathname === `bootstrap/${id}.meta.json`);
            if (!metaBlob) return res.status(404).json({ error: 'Not found' });
            const existing = await fetch(metaBlob.url).then(r => r.json());
            existing.label = label.trim();
            await put(`bootstrap/${id}.meta.json`, JSON.stringify(existing), {
                access: 'public', contentType: 'application/json', addRandomSuffix: false,
            });
            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ error: 'Unknown action' });

    } catch (err) {
        console.error('Bootstrap error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

// ── Rebuild Lua from stored meta (seed + encoded bytes) ───────────────────
// This is the same template as buildBootstrapLua but uses stored data.
// The raw URL is NEVER stored; we only have the XOR-encoded bytes.
function rebuildLua(meta) {
    const { seed, encoded, label, id } = meta;

    // Use stored encoded bytes directly — they were produced by xorEncode
    const luaTable  = toLuaTable(encoded);
    const seedHi    = (seed >>> 16) & 0xFFFF;
    const seedLo    = seed & 0xFFFF;

    // Regenerate random var names each serve request for extra obfuscation
    const vData  = randVar();
    const vSeed  = randVar();
    const vState = randVar();
    const vOut   = randVar();
    const vI     = randVar();
    const vB     = randVar();
    const vUrl   = randVar();
    const vFn    = randVar();
    const vErr   = randVar();

    return `-- Flurs Bootstrap | https://flurs.xyz
-- ${label || 'Protected Script'}
do
    local ${vData}  = ${luaTable}
    local ${vSeed}  = bit32 and bit32.bor(bit32.lshift(${seedHi}, 16), ${seedLo}) or (${seedHi} * 65536 + ${seedLo})
    local ${vState} = ${vSeed}
    local ${vOut}   = {}
    for ${vI} = 1, #${vData} do
        ${vState} = (${vState} * 1664525 + 1013904223) % 4294967296
        ${vOut}[${vI}] = string.char(bit32 and bit32.bxor(${vData}[${vI}], ${vState} % 256)
                                              or (${vData}[${vI}] ~ (${vState} % 256)))
    end
    local ${vUrl} = table.concat(${vOut})
    local ${vFn}, ${vErr} = loadstring(game:HttpGet(${vUrl}, true))
    if not ${vFn} then error("[Flurs] " .. tostring(${vErr}), 0) end
    ${vFn}()
end
`;
}
// api/bootstrap.js
// Creates obfuscated "bootstrap" Lua blobs from either:
//   - Raw Lua code (e.g. script_key="X"\nloadstring(...)())
//   - A target URL to HttpGet at runtime
//
// The content is XOR-encoded into a Lua byte table — never stored in plaintext.
// Variable names are re-randomised on every serve request.
//
// Admin POST actions: generate, list, delete, rename
// Public GET: /files/v3/bootstrap/ID.lua  (executor-only)

import { put, list, del } from '@vercel/blob';
import crypto from 'crypto';

// Required for Vercel to parse JSON POST bodies
export const config = { api: { bodyParser: true } };

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is not set');

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

const BROWSER_UA = ['mozilla','chrome','safari','firefox','edge','opera','wget','python','postman','curl','insomnia','httpie'];
function isBrowser(req) {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (ua.includes('roblox') || ua.includes('wininet')) return false;
    if (BROWSER_UA.some(p => ua.includes(p))) return true;
    if (ua.length > 0) return true;
    return false;
}

function generateSeed() { return crypto.randomBytes(4).readUInt32BE(0); }

function xorEncode(text, seed) {
    const bytes = Buffer.from(text, 'utf8');
    const out   = [];
    let state   = seed >>> 0;
    for (const b of bytes) {
        state = ((state * 1664525 + 1013904223) & 0xFFFFFFFF) >>> 0;
        out.push(b ^ (state & 0xFF));
    }
    return out;
}

function toLuaTable(bytes) { return '{' + bytes.join(',') + '}'; }
function randVar() { return '_' + crypto.randomBytes(4).toString('hex'); }
function generateId() { return crypto.randomBytes(16).toString('hex'); }

function buildLua(meta) {
    const { seed, encoded, label, mode } = meta;
    const luaTable = toLuaTable(encoded);
    const seedHi   = (seed >>> 16) & 0xFFFF;
    const seedLo   = seed & 0xFFFF;

    const vData    = randVar(), vSeed  = randVar(), vState = randVar();
    const vOut     = randVar(), vI     = randVar(), vDecoded = randVar();
    const vFn      = randVar(), vErr   = randVar();

    const decodeBlock = `local ${vData}  = ${luaTable}
    local ${vSeed}  = bit32 and bit32.bor(bit32.lshift(${seedHi}, 16), ${seedLo}) or (${seedHi} * 65536 + ${seedLo})
    local ${vState} = ${vSeed}
    local ${vOut}   = {}
    for ${vI} = 1, #${vData} do
        ${vState} = (${vState} * 1664525 + 1013904223) % 4294967296
        ${vOut}[${vI}] = string.char(bit32 and bit32.bxor(${vData}[${vI}], ${vState} % 256)
                                              or (${vData}[${vI}] ~ (${vState} % 256)))
    end
    local ${vDecoded} = table.concat(${vOut})`;

    const execBlock = (mode === 'url')
        ? `local ${vFn}, ${vErr} = loadstring(game:HttpGet(${vDecoded}, true))
    if not ${vFn} then error("[Flurs] " .. tostring(${vErr}), 0) end
    ${vFn}()`
        : `local ${vFn}, ${vErr} = loadstring(${vDecoded})
    if not ${vFn} then error("[Flurs] " .. tostring(${vErr}), 0) end
    ${vFn}()`;

    return `-- Flurs Bootstrap | https://flurs.xyz
-- ${label || 'Protected Script'}
do
    ${decodeBlock}
    ${execBlock}
end
`;
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

    // GET — serve blob to executor
    if (req.method === 'GET') {
        if (isBrowser(req)) return res.status(403).setHeader('Content-Type', 'text/plain').end('-- Forbidden');
        const urlMatch = (req.url || '').match(/([a-f0-9]{32,64})\.lua/i);
        const id = urlMatch ? urlMatch[1].toLowerCase() : null;
        if (!id) return res.status(400).end('-- invalid_id');
        try {
            const { blobs } = await list({ prefix: `bootstrap/${id}.meta.json` });
            const metaBlob  = blobs.find(b => b.pathname === `bootstrap/${id}.meta.json`);
            if (!metaBlob) return res.status(404).end('-- not_found');
            const meta = await fetch(metaBlob.url).then(r => r.json());
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            return res.status(200).end(buildLua(meta));
        } catch (err) {
            console.error('Bootstrap serve error:', err);
            return res.status(500).end('-- error');
        }
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { action, password, url: targetUrl, lua: rawLua, label, id } = req.body || {};

    if (!password || password !== ADMIN_PASSWORD) {
        recordFailure(ip);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    clearFailures(ip);

    try {
        if (action === 'generate') {
            let content, mode;
            if (rawLua) {
                content = rawLua; mode = 'lua';
            } else if (targetUrl) {
                try { new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
                content = targetUrl; mode = 'url';
            } else {
                return res.status(400).json({ error: 'Provide either lua or url' });
            }

            const newId   = generateId();
            const seed    = generateSeed();
            const encoded = xorEncode(content, seed);
            const meta    = { id: newId, label: label || 'Bootstrap', mode, seed, encoded, createdAt: Date.now() };

            await put(`bootstrap/${newId}.meta.json`, JSON.stringify(meta), {
                access: 'public', contentType: 'application/json', addRandomSuffix: false,
            });

            const serveUrl   = `https://api.flurs.xyz/files/v3/bootstrap/${newId}.lua`;
            const loadstring = `loadstring(game:HttpGet("${serveUrl}", true))()`;
            return res.status(200).json({ ok: true, id: newId, serveUrl, loadstring });
        }

        if (action === 'list') {
            const { blobs } = await list({ prefix: 'bootstrap/' });
            const metaBlobs = blobs.filter(b => b.pathname.endsWith('.meta.json'));
            const items = await Promise.all(metaBlobs.map(async b => {
                try { const m = await fetch(b.url).then(r => r.json()); return { id: m.id, label: m.label, mode: m.mode, createdAt: m.createdAt }; }
                catch { return null; }
            }));
            return res.status(200).json({ ok: true, items: items.filter(Boolean).sort((a, b) => (b.createdAt||0) - (a.createdAt||0)) });
        }

        if (action === 'delete') {
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const { blobs } = await list({ prefix: `bootstrap/${id}` });
            await Promise.all(blobs.map(b => del(b.url)));
            return res.status(200).json({ ok: true });
        }

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
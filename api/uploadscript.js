// api/uploadscript.js
// Handles publishing new script cards (name, description, loadstring, tags, image)
// that appear dynamically on the public Scripts page.

import { put, list, del } from '@vercel/blob';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is not set');

// ── Rate limiter (same pattern as admin.js) ──────────────────────────────
const attempts  = new Map();
const MAX_TRIES = 10;
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

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default async function handler(req, res) {
    // CORS
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://flurs.xyz';
    const origin = req.headers.origin || '';
    if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden' });
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

    const { action, password, name, description, loadstring, tags, imageBase64, imageType } = req.body || {};

    // ── AUTH check — required for auth, publish, delete ──────────────────
    const needsAuth = ['auth', 'publish', 'delete'].includes(action);
    if (needsAuth) {
        if (!password || password !== ADMIN_PASSWORD) {
            recordFailure(ip);
            return res.status(401).json({ error: 'Unauthorized' });
        }
        clearFailures(ip);
    }

    try {

        // ── AUTH ping — just validates the password ───────────────────────
        if (action === 'auth') {
            return res.status(200).json({ ok: true });
        }

        // ── PUBLISH — saves image + metadata to Vercel Blob ──────────────
        if (action === 'publish') {
            if (!name || !loadstring || !imageBase64) {
                return res.status(400).json({ error: 'Missing required fields: name, loadstring, imageBase64' });
            }

            const id  = generateId();
            const ext = imageType === 'image/png' ? 'png' : 'jpg';

            // Upload image
            const imageBuffer = Buffer.from(imageBase64, 'base64');
            const imageBlob   = await put(`scriptcards/${id}.${ext}`, imageBuffer, {
                access: 'public',
                contentType: imageType || 'image/jpeg',
                addRandomSuffix: false,
            });

            // Save metadata
            const meta = {
                id,
                name,
                description: description || '',
                loadstring,
                tags: tags || [],
                imageUrl: imageBlob.url,
                createdAt: Date.now(),
            };

            await put(`scriptcards/${id}.meta.json`, JSON.stringify(meta), {
                access: 'public',
                contentType: 'application/json',
                addRandomSuffix: false,
            });

            return res.status(200).json({ ok: true, id });
        }

        // ── DELETE ────────────────────────────────────────────────────────
        if (action === 'delete') {
            const { id } = req.body || {};
            if (!id) return res.status(400).json({ error: 'Missing id' });
            const { blobs } = await list({ prefix: `scriptcards/${id}` });
            await Promise.all(blobs.map(b => del(b.url)));
            return res.status(200).json({ ok: true });
        }

        // ── LIST — public, no password needed ─────────────────────────────
        if (action === 'list') {
            const { blobs }   = await list({ prefix: 'scriptcards/' });
            const metaBlobs   = blobs.filter(b => b.pathname.endsWith('.meta.json'));

            const scripts = await Promise.all(
                metaBlobs.map(async b => {
                    try { return await fetch(b.url).then(r => r.json()); }
                    catch { return null; }
                })
            );

            // Sort newest first
            const sorted = scripts
                .filter(Boolean)
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            return res.status(200).json({ ok: true, scripts: sorted });
        }

        return res.status(400).json({ error: 'Unknown action' });

    } catch (err) {
        console.error('uploadscript error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
// api/admin.js
// Protected admin endpoint — AES-256 encryption
// Actions: save, delete, get, list

import { put, del, list } from '@vercel/blob';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'flurs2025';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

function unauthorized(res) {
  return res.status(401).json({ error: 'Unauthorized' });
}

function encrypt(plaintext) {
  const key    = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv     = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted    += cipher.final('hex');
  return { iv: iv.toString('hex'), encrypted };
}

function decrypt(encryptedHex, ivHex) {
  const key      = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv       = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let out        = decipher.update(encryptedHex, 'hex', 'utf8');
  out           += decipher.final('utf8');
  return out;
}

async function getMeta(hash) {
  const { blobs } = await list({ prefix: `scripts/${hash}.meta.json` });
  const metaBlob  = blobs.find(b => b.pathname === `scripts/${hash}.meta.json`);
  if (!metaBlob) return null;
  return fetch(metaBlob.url).then(r => r.json());
}

async function saveMeta(hash, meta) {
  await put(`scripts/${hash}.meta.json`, JSON.stringify(meta), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false,
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, password, hash, label, content } = req.body || {};

  if (!password || password !== ADMIN_PASSWORD) return unauthorized(res);

  try {

    // ── SAVE (encrypts before storing) ──────────────────────────────────
    if (action === 'save') {
      if (!hash || !content) return res.status(400).json({ error: 'Missing hash or content' });

      const encData = encrypt(content);
      await put(`scripts/${hash}.enc`, JSON.stringify(encData), {
        access: 'public', contentType: 'application/json', addRandomSuffix: false,
      });

      const existing = await getMeta(hash);
      await saveMeta(hash, {
        hash,
        label:   label || existing?.label || 'Unnamed',
        created: existing?.created || Date.now(),
      });

      return res.status(200).json({ ok: true, hash });
    }

    // ── DELETE ──────────────────────────────────────────────────────────
    if (action === 'delete') {
      if (!hash) return res.status(400).json({ error: 'Missing hash' });
      const { blobs } = await list({ prefix: `scripts/${hash}` });
      await Promise.all(blobs.map(b => del(b.url)));
      return res.status(200).json({ ok: true });
    }

    // ── GET (decrypt for admin editor) ──────────────────────────────────
    if (action === 'get') {
      if (!hash) return res.status(400).json({ error: 'Missing hash' });

      const { blobs } = await list({ prefix: `scripts/${hash}.enc` });
      const encBlob   = blobs.find(b => b.pathname === `scripts/${hash}.enc`);
      if (!encBlob) return res.status(404).json({ error: 'Script not found' });

      const [encData, meta] = await Promise.all([
        fetch(encBlob.url).then(r => r.json()),
        getMeta(hash),
      ]);

      return res.status(200).json({
        ok:      true,
        hash,
        label:   meta?.label || 'Unnamed',
        content: decrypt(encData.encrypted, encData.iv),
      });
    }

    // ── LIST ────────────────────────────────────────────────────────────
    if (action === 'list') {
      const { blobs }   = await list({ prefix: 'scripts/' });
      const metaBlobs   = blobs.filter(b => b.pathname.endsWith('.meta.json'));

      const scripts = await Promise.all(
        metaBlobs.map(async b => {
          try { return await fetch(b.url).then(r => r.json()); }
          catch { return null; }
        })
      );

      return res.status(200).json({ ok: true, scripts: scripts.filter(Boolean) });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

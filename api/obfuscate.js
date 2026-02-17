// api/obfuscate.js
// Obfuscates Lua code using luamin (minification + basic obfuscation)

import luamin from 'luamin';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'flurs2025';

function obfuscate(luaCode) {
  try {
    // Minify and obfuscate
    let result = luamin.minify(luaCode);
    
    // Additional basic obfuscation - replace common patterns
    result = result
      .replace(/\blocal\s+/g, 'local ')
      .replace(/\bfunction\s+/g, 'function ')
      .replace(/\bend\b/g, 'end')
      .replace(/\s+/g, ' '); // Collapse whitespace
    
    return result;
  } catch (err) {
    throw new Error('Obfuscation failed: ' + err.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method Not Allowed' });

  const { password, code } = req.body || {};

  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!code || !code.trim()) {
    return res.status(400).json({ error: 'No code provided' });
  }

  try {
    const obfuscated = obfuscate(code);
    return res.status(200).json({ ok: true, obfuscated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

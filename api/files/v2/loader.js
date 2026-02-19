// api/files/v2/loader.js
// Two modes:
//   1. No ?u= param → serve a Lua bootstrapper that grabs username/hwid then refetches
//   2. Has ?u= param → log + serve the real script content

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const RATE_LIMIT_WINDOW = 15 * 1000;
const RATE_LIMIT_MAX    = 8;
const rateLimitStore    = new Map();

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(req) {
  const ip    = getIP(req);
  const now   = Date.now();
  const entry = rateLimitStore.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  rateLimitStore.set(ip, entry);
  return false;
}

const BROWSER_UA = ['mozilla','chrome','safari','firefox','edge','opera','wget','python','postman','curl','insomnia','httpie'];

function isBrowser(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('roblox') || ua.includes('wininet')) return false;
  if (BROWSER_UA.some(p => ua.includes(p))) return true;
  if (ua.length > 0) return true;
  return false;
}

async function writeLog({ hash, label, ip, ua, robloxUsername, hwid }) {
  try {
    await sql`
      INSERT INTO execution_logs (script_hash, script_label, script_type, ip, hwid, roblox_username, user_agent, executed_at)
      VALUES (${hash}, ${label || 'Unknown'}, 'v2', ${ip}, ${hwid || null}, ${robloxUsername || null}, ${ua}, ${Date.now()})
    `;
  } catch (e) {
    console.error('[v2 loader] log write failed:', e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') return res.status(405).end('-- Method Not Allowed');
  if (isBrowser(req))       return res.status(403).end('-- Forbidden');
  if (isRateLimited(req))   return res.status(429).end('-- Slow down');

  const urlMatch = (req.url || '').match(/([a-f0-9]{32})\.lua/i);
  const hash = urlMatch ? urlMatch[1].toLowerCase() : null;
  if (!hash) return res.status(400).end('-- Not found');

  const ip    = getIP(req);
  const ua    = req.headers['user-agent'] || 'unknown';
  const host  = req.headers.host || 'api.flurs.xyz';
  const urlObj = new URL(req.url, `https://${host}`);

  const robloxUsername = urlObj.searchParams.get('u')    || null;
  const hwid           = urlObj.searchParams.get('hwid') || null;

  // ── PHASE 1: no user info yet — serve the Lua bootstrapper ────────────
  if (!robloxUsername) {
    const scriptUrl = `https://${host}/files/v2/loader/${hash}.lua`;
    const hs = `game:GetService("HttpService")`;
    const bootstrapper = `-- Flurs v2 Loader
local hs   = ${hs}
local url  = "${scriptUrl}"

local ok1, hwid = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)
if not ok1 or not hwid or hwid == "" then
    local ok2, uid = pcall(function()
        return tostring(game:GetService("Players").LocalPlayer.UserId) .. "_device"
    end)
    hwid = (ok2 and uid) or "unknown"
end

local ok3, uname = pcall(function()
    return game:GetService("Players").LocalPlayer.Name
end)
local u = (ok3 and uname) or "unknown"

local finalUrl = url .. "?u=" .. hs:UrlEncode(u) .. "&hwid=" .. hs:UrlEncode(hwid)
local src = game:HttpGet(finalUrl, true)
loadstring(src)()`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(bootstrapper);
  }

  // ── PHASE 2: has user info — log it and serve the real script ─────────
  try {
    const rows = await sql`SELECT content, label FROM scripts WHERE hash = ${hash}`;
    if (!rows.length) return res.status(404).end('-- Not found');

    writeLog({ hash, label: rows[0].label, ip, ua, robloxUsername, hwid });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(rows[0].content);

  } catch (err) {
    console.error('Loader error:', err);
    return res.status(500).end('-- Error');
  }
}
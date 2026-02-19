// pages/api/files/v3/loader.js
// Serves KEY-PROTECTED scripts. Returns Lua that validates key server-side.
import { sql } from '../../../../lib/db.js';

const RATE_LIMIT_WINDOW = 15000;
const RATE_LIMIT_MAX = 20;
const rateLimitStore = new Map();

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}
function isRateLimited(req) {
  const ip = getIP(req);
  const now = Date.now();
  const e = rateLimitStore.get(ip) || { count: 0, start: now };
  if (now - e.start > RATE_LIMIT_WINDOW) { rateLimitStore.set(ip, { count: 1, start: now }); return false; }
  if (e.count >= RATE_LIMIT_MAX) return true;
  e.count++; rateLimitStore.set(ip, e);
  return false;
}

const BLOCKED_UA = ['mozilla','chrome','safari','firefox','edge','opera','wget','curl','python','postman','insomnia','node','fetch','go-http','java','perl','ruby','powershell','libwww','scrapy','burp','fiddler','charles','mitmproxy','nmap','sqlmap','nikto'];

function isBrowser(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase().trim();
  if (!ua) return false;
  if (ua.includes('roblox') || ua.includes('wininet')) return false;
  for (const p of BLOCKED_UA) { if (ua.includes(p)) return true; }
  if (req.headers['via']) return true;
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (req.method !== 'GET') return res.status(405).end('-- Method Not Allowed');

  if (isBrowser(req)) {
    res.setHeader('Location', '/forbidden.html');
    return res.status(302).end();
  }

  if (isRateLimited(req)) return res.status(429).end('-- Rate limited');

  const url = req.url || '';
  const match = url.match(/([a-f0-9]{32})\.lua/i);
  const scriptHash = match ? match[1].toLowerCase() : null;
  if (!scriptHash) return res.status(400).end('-- Missing script hash');

  // Check key + HWID from headers (executor passes them)
  const key      = req.headers['x-flurs-key']  || '';
  const hwid     = req.headers['x-flurs-hwid'] || '';
  const username = req.headers['x-flurs-user'] || 'unknown';

  // If no key header, return Lua stub that reads script_key global and re-fetches with headers
  // This handles the two-phase flow: first fetch returns loader Lua, second fetch (with key header) returns script
  if (!key) {
    const BASE = process.env.ALLOWED_ORIGIN || 'https://www.flurs.xyz';
    const lua = `-- Flurs v3 Key Loader
-- Usage: script_key = "YOUR-KEY"; loadstring(game:HttpGet("${BASE}/files/v3/loader/${scriptHash}.lua", true))()

local _key = (getgenv and getgenv().script_key) or (genv and genv().script_key) or ""
if _key == "" then
    error("[Flurs] Set script_key before running. Example: script_key = 'your-key-here'", 0)
end

local _ok_hwid, _hwid = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)
local _ok_user, _user = pcall(function()
    return game:GetService("Players").LocalPlayer.Name
end)

local _ok, _result = pcall(function()
    return game:HttpGet("${BASE}/files/v3/loader/${scriptHash}.lua", true, {
        ["X-Flurs-Key"]  = _key,
        ["X-Flurs-Hwid"] = _ok_hwid and _hwid or "unknown",
        ["X-Flurs-User"] = _ok_user and _user or "unknown",
    })
end)

if not _ok then error("[Flurs] Could not reach server: "..(tostring(_result)), 0) end
if type(_result) ~= "string" or _result == "" then error("[Flurs] Empty response from server.", 0) end
if _result:sub(1,2) == "--" and _result:find("error",1,true) then error("[Flurs] "..(_result:match("%-%-(.+)") or _result), 0) end

local _fn, _err = loadstring(_result)
if not _fn then error("[Flurs] Script error: "..(tostring(_err)), 0) end
_fn()`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(lua);
  }

  // Second phase: key is present — validate and return actual script content
  const ip = getIP(req);
  try {
    const keyRows = await sql`SELECT * FROM script_keys WHERE id = ${key}`;
    if (!keyRows.length) return res.status(401).end('-- error: Invalid key');

    const k = keyRows[0];
    if (k.blacklisted)                                 return res.status(403).end('-- error: Key is blacklisted');
    if (k.expires_at && Date.now() > k.expires_at)    return res.status(403).end('-- error: Key has expired');
    if (k.max_uses && (k.use_count||0) >= k.max_uses) return res.status(403).end('-- error: Key max uses reached');
    if (k.script_hash && k.script_hash !== scriptHash) return res.status(403).end('-- error: Key not valid for this script');
    if (k.hwid && k.hwid !== hwid)                    return res.status(403).end('-- error: HWID mismatch');

    // Bind HWID
    if (!k.hwid && hwid) {
      await sql`UPDATE script_keys SET hwid = ${hwid} WHERE id = ${key}`;
    }

    // Log usage
    const logEntry = JSON.stringify({ ts: Date.now(), username, ip });
    await sql`
      UPDATE script_keys SET
        use_count = use_count + 1,
        usage_log = jsonb_insert(usage_log, '{0}', ${logEntry}::jsonb),
        known_usernames = CASE WHEN NOT known_usernames @> ${JSON.stringify([username])}::jsonb THEN jsonb_insert(known_usernames, '{0}', ${JSON.stringify(username)}::jsonb) ELSE known_usernames END
      WHERE id = ${key}
    `;

    // Fetch the actual script
    const scriptRows = await sql`SELECT content FROM scripts WHERE hash = ${scriptHash} AND is_key_script = true`;
    if (!scriptRows.length || !scriptRows[0].content) return res.status(404).end('-- error: Script not found');

    // Track script usage
    sql`UPDATE scripts SET use_count = use_count + 1, last_used = ${Date.now()} WHERE hash = ${scriptHash}`.catch(() => {});

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(scriptRows[0].content);
  } catch (err) {
    console.error('[v3 loader]', err);
    return res.status(500).end('-- error: Server error');
  }
}

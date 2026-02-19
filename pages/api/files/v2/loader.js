// pages/api/files/v2/loader.js
// Serves HOSTED scripts. Roblox executors only.
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
  const entry = rateLimitStore.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_LIMIT_WINDOW) { rateLimitStore.set(ip, { count: 1, start: now }); return false; }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  rateLimitStore.set(ip, entry);
  return false;
}

const BLOCKED_UA = ['mozilla','chrome','safari','firefox','edge','opera','wget','curl','python','postman','insomnia','node','fetch','go-http','java','perl','ruby','powershell','libwww','scrapy','burp','fiddler','charles','mitmproxy','nmap','sqlmap','nikto'];

function isBrowser(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase().trim();
  if (!ua) return false;
  if (ua.includes('roblox') || ua.includes('wininet')) return false;
  for (const p of BLOCKED_UA) { if (ua.includes(p)) return true; }
  if (req.headers['via']) return true;
  return true; // any other user-agent is blocked
}

function wrapLua(content) {
  return `-- Flurs Protected Script
do
    local _ENV = getfenv and getfenv(0) or _G
    local _ps = game:GetService("Players")
    local _lp = _ps.LocalPlayer
    local function _kick(r) pcall(function() _lp:Kick("[Flurs] "..(r or "Anti-tamper")) end) while true do task.wait(9e9) end end
    rawset(_ENV,"print",function(...) _kick("print blocked") end)
    rawset(_ENV,"warn",function(...) _kick("warn blocked") end)
    rawset(_ENV,"printidentity",function() _kick("printidentity blocked") end)
    pcall(function() if rawget(string,"dump") then rawset(string,"dump",function() _kick("dump blocked") end) end end)
    for _,fn in ipairs({"getscriptclosure","getscriptfunction","dumpstring","decompile","getfuncs"}) do
        if rawget(_ENV,fn) then rawset(_ENV,fn,function() _kick(fn.." blocked") end) end
    end
    local _fn,_err = loadstring(${JSON.stringify(content)})
    if not _fn then _kick("Load failed: "..(tostring(_err))) return end
    local _ok,_e = pcall(_fn)
end`;
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

  // Extract hash from URL: /files/v2/loader/HASH.lua
  const url = req.url || '';
  const match = url.match(/([a-f0-9]{32})\.lua/i);
  const hash = match ? match[1].toLowerCase() : null;
  if (!hash) return res.status(400).end('-- Missing hash');

  try {
    const rows = await sql`SELECT content FROM scripts WHERE hash = ${hash} AND (is_key_script = false OR is_key_script IS NULL)`;
    if (!rows.length || !rows[0].content) return res.status(404).end('-- Script not found');

    // Track usage async
    sql`UPDATE scripts SET use_count = use_count + 1, last_used = ${Date.now()} WHERE hash = ${hash}`.catch(() => {});

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(wrapLua(rows[0].content));
  } catch (err) {
    console.error('[v2 loader]', err);
    return res.status(500).end('-- Server error');
  }
}

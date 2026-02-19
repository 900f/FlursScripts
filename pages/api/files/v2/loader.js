// pages/api/files/v2/loader.js
// Serves Lua scripts from DB. Executor-only.
import { sql } from '../../../../lib/db.js';

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

const BLOCKED_UA_PATTERNS = [
  'mozilla', 'chrome', 'safari', 'firefox', 'edge', 'opera', 'brave',
  'wget', 'curl', 'python', 'postman', 'insomnia', 'httpie', 'axios',
  'node', 'fetch', 'go-http', 'java', 'okhttp', 'dart', 'php',
  'perl', 'ruby', 'powershell', 'libwww', 'pycurl', 'aiohttp',
  'scrapy', 'mechanize', 'requests', 'http-client', 'apache',
  'burpsuite', 'burp', 'wireshark', 'fiddler', 'charles', 'mitmproxy',
  'nmap', 'hydra', 'sqlmap', 'nikto', 'metasploit', 'zap',
];

function isForbiddenRequest(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase().trim();
  if (ua.includes('roblox') || ua.includes('wininet')) return false;
  for (const p of BLOCKED_UA_PATTERNS) {
    if (ua.includes(p)) return true;
  }
  if (req.headers['via']) return true;
  if (ua.length > 0) return true;
  return false;
}

function wrapWithProtection(luaContent) {
  return `-- Flurs Protected Loader v2
do
    local _ENV = getfenv and getfenv(0) or _G
    local _ps    = game:GetService("Players")
    local _lp    = _ps.LocalPlayer

    local function _kick(reason)
        pcall(function()
            _lp:Kick("[Flurs] " .. (reason or "Anti-tamper triggered."))
        end)
        while true do task.wait(9e9) end
    end

    rawset(_ENV, "print",         function(...) _kick("Unauthorised print detected.") end)
    rawset(_ENV, "warn",          function(...) _kick("Unauthorised warn detected.")  end)
    rawset(_ENV, "printidentity", function()    _kick("printidentity blocked.") end)

    pcall(function()
        if rawget(string, "dump") then
            rawset(string, "dump", function() _kick("string.dump is not allowed.") end)
        end
    end)

    for _, fn in ipairs({"getscriptclosure","getscriptfunction","dumpstring","decompile","getfuncs"}) do
        if rawget(_ENV, fn) then
            rawset(_ENV, fn, function() _kick("Dumping functions are not allowed.") end)
        end
    end

    local _origTostring = rawget(_ENV, "tostring") or tostring
    rawset(_ENV, "tostring", function(v)
        if type(v) == "function" then return "[protected]" end
        return _origTostring(v)
    end)

    local _fn, _err = loadstring(${JSON.stringify(luaContent)})
    if not _fn then _kick("Script load failed.") return end
    local _ok, _runErr = pcall(_fn)
end
`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  if (req.method !== 'GET')    return res.status(405).end('-- Method Not Allowed');
  if (isForbiddenRequest(req)) return res.status(403).end('-- Forbidden');
  if (isRateLimited(req))      return res.status(429).end('-- Slow down');

  const urlMatch = (req.url || '').match(/([a-f0-9]{32})\.lua/i);
  const hash = urlMatch ? urlMatch[1].toLowerCase() : null;
  if (!hash) return res.status(400).end('-- Not found');

  const ip = getIP(req);

  try {
    const rows = await sql`SELECT content FROM scripts WHERE hash = ${hash}`;
    if (!rows.length || !rows[0].content) {
      return res.status(404).end('-- Not found');
    }

    const rawContent = rows[0].content;

    // Track usage (fire and forget)
    sql`
      UPDATE scripts
      SET use_count = use_count + 1, last_used = ${Date.now()}
      WHERE hash = ${hash}
    `.catch(e => console.error('track error:', e));

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(wrapWithProtection(rawContent));

  } catch (err) {
    console.error('Loader v2 error:', err);
    return res.status(500).end('-- Error');
  }
}

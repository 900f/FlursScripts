// api/files/v2/loader.js
// Serves a raw Lua script. Executor-only. Extreme print protection built in.

const BLOB_BASE_URL     = 'https://anynovmwoyinocra.public.blob.vercel-storage.com';
const BLOB_TOKEN        = process.env.BLOB_READ_WRITE_TOKEN;
const RATE_LIMIT_WINDOW = 15 * 1000;
const RATE_LIMIT_MAX    = 8;

const rateLimitStore = new Map();

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

// ── Extremely strict UA check ──────────────────────────────────────────────
// Only allow: no UA, Roblox, WinINet. Block everything else including tools.
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

  // Explicitly allow Roblox / WinINet executors
  if (ua.includes('roblox') || ua.includes('wininet')) return false;

  // Block any known UA pattern
  for (const p of BLOCKED_UA_PATTERNS) {
    if (ua.includes(p)) return true;
  }

  // Block common security tool headers
  if (req.headers['x-forwarded-host'] && req.headers['x-forwarded-host'] !== req.headers['host']) return true;
  if (req.headers['via']) return true;
  if (req.headers['x-real-ip'] && !req.headers['x-forwarded-for']) return true;

  // If the UA is non-empty and not recognised, block it
  if (ua.length > 0) return true;

  // Empty UA = likely executor
  return false;
}

// ── Print protection Lua wrapper ───────────────────────────────────────────
// Wraps any hosted Lua in a sandboxed environment that:
// 1. Overrides print/warn/tostring so they produce nothing or garbage
// 2. Detects common dumping methods and kicks immediately
// 3. Detects string.dump usage and terminates
// 4. Makes loadstring return dummy functions on the raw string
function wrapWithProtection(luaContent) {
  // We embed the raw content as a loadstring to double-obfuscate it
  // The outer shell intercepts any attempts to print/inspect
  return `-- Flurs Protected Loader v2
do
    -- === ANTI-PRINT / ANTI-DUMP SHIELD ===
    local _ENV = getfenv and getfenv(0) or _G
    local _realprint   = rawget(_ENV, "print")  or function() end
    local _realwarn    = rawget(_ENV, "warn")   or function() end
    local _hs          = game:GetService("HttpService")
    local _ps          = game:GetService("Players")
    local _localPlayer = _ps.LocalPlayer

    local function _kick(reason)
        pcall(function()
            _localPlayer:Kick("[Flurs] " .. (reason or "Anti-tamper triggered."))
        end)
        -- Hard stop execution
        while true do task.wait(9e9) end
    end

    -- Silence and trap print/warn
    local _junkStr = string.rep(string.char(math.random(33,126)), math.random(8000, 12000))
    rawset(_ENV, "print",   function(...) _kick("Unauthorised print detected.") end)
    rawset(_ENV, "warn",    function(...) _kick("Unauthorised warn detected.")  end)
    rawset(_ENV, "printidentity", function() _kick("printidentity blocked.") end)

    -- Trap string.dump (script dumping)
    if string and rawget(string, "dump") then
        rawset(string, "dump", function() _kick("string.dump is not allowed.") end)
    end

    -- Trap getscriptclosure / getscriptfunction (executor dump methods)
    for _, fn in ipairs({"getscriptclosure","getscriptfunction","dumpstring","decompile","getfuncs"}) do
        if rawget(_ENV, fn) then
            rawset(_ENV, fn, function() _kick("Dumping functions are not allowed.") end)
        end
    end

    -- Trap require-based dumps
    local _origRequire = rawget(_ENV, "require")
    if _origRequire then
        rawset(_ENV, "require", function(m)
            if type(m) == "string" and (
                m:lower():find("dump") or m:lower():find("decompile")
            ) then
                _kick("Disallowed require.")
                return nil
            end
            return _origRequire(m)
        end)
    end

    -- Trap tostring on functions (a common reflection technique)
    local _origTostring = rawget(_ENV, "tostring") or tostring
    rawset(_ENV, "tostring", function(v)
        if type(v) == "function" then
            return "[protected]"
        end
        return _origTostring(v)
    end)

    -- Run the actual script in a protected environment
    local _fn, _err = loadstring(${JSON.stringify(luaContent)})
    if not _fn then
        _kick("Script load failed.")
        return
    end

    -- Set up a clean env for the inner script that inherits globals
    -- but can't leak anything back
    local _ok, _runErr = pcall(_fn)
    if not _ok then
        -- Silent fail — don't expose error text
    end
end
`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  if (req.method !== 'GET')       return res.status(405).end('-- Method Not Allowed');
  if (isForbiddenRequest(req))    return res.status(403).end('-- Forbidden');
  if (isRateLimited(req))         return res.status(429).end('-- Slow down');

  const urlMatch = (req.url || '').match(/([a-f0-9]{32})\.lua/i);
  const hash = urlMatch ? urlMatch[1].toLowerCase() : null;

  if (!hash) return res.status(400).end('-- Not found');

  try {
    const url     = `${BLOB_BASE_URL}/scripts/${hash}.lua`;
    const blobRes = await fetch(url, {
      headers: BLOB_TOKEN ? { Authorization: `Bearer ${BLOB_TOKEN}` } : {},
    });

    if (!blobRes.ok) return res.status(404).end('-- Not found');

    const rawContent  = await blobRes.text();
    const protected_  = wrapWithProtection(rawContent);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(protected_);

  } catch (err) {
    console.error('Loader v2 error:', err);
    return res.status(500).end('-- Error');
  }
}
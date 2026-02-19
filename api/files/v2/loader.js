// api/files/v2/loader.js
// Hybrid v3-style logging for v2 scripts: validates via /api/keys, logs real username

import { put, list } from '@vercel/blob';

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
    const url     = `${BLOB_BASE_URL}/scripts/${hash}.lua`;
    const blobRes = await fetch(url, {
      headers: BLOB_TOKEN ? { Authorization: `Bearer ${BLOB_TOKEN}` } : {},
    });

    if (!blobRes.ok) return res.status(404).end('-- Not found');

    const rawContent = await blobRes.text();

    const API = 'https://api.flurs.xyz/api/keys';

    const lua = `-- Flurs Protected Loader v2 with v3-style logging
do
    local _hash = "${hash}"
    local _api  = "${API}"

    -- ANTI-TAMPER (your original v2 protections)
    local _ENV   = getfenv and getfenv(0) or _G
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

    local _origRequire = rawget(_ENV, "require")
    if _origRequire then
        rawset(_ENV, "require", function(m)
            if type(m) == "string" and (m:lower():find("dump") or m:lower():find("decompile")) then
                _kick("Disallowed require.")
                return nil
            end
            return _origRequire(m)
        end)
    end

    local _origTostring = rawget(_ENV, "tostring") or tostring
    rawset(_ENV, "tostring", function(v)
        if type(v) == "function" then return "[protected]" end
        return _origTostring(v)
    end)

    -- v3-style key validation + logging
    local key = (getgenv and getgenv().script_key)
             or (genv    and genv().script_key)
             or (getfenv and getfenv().script_key) or ""

    -- Optional: require key (uncomment if you want to force it)
    -- if key == "" then error("[Flurs] script_key = \\"YOUR-KEY\\" required", 0) end

    local hwid = "unknown"
    pcall(function()
        hwid = game:GetService("RbxAnalyticsService"):GetClientId()
    end)

    local username = "unknown"
    pcall(function()
        username = game.Players.LocalPlayer.Name
    end)

    local hs = game:GetService("HttpService")
    local query = "action=validate"
                .. "&key="        .. hs:UrlEncode(key)
                .. "&hwid="       .. hs:UrlEncode(hwid)
                .. "&scriptHash=" .. hs:UrlEncode(_hash)
                .. "&username="   .. hs:UrlEncode(username)

    local success, response = pcall(function()
        return http_request({
            Url     = _api .. "?" .. query,
            Method  = "GET",
            Headers = { ["Accept"] = "application/json" }
        })
    end)

    if not success then
        _kick("Validation request failed")
        return
    end

    if response.StatusCode < 200 or response.StatusCode >= 300 then
        _kick("Server denied access (" .. response.StatusCode .. ")")
        return
    end

    local data
    pcall(function()
        data = hs:JSONDecode(response.Body)
    end)

    if not data or not data.ok or not data.content then
        _kick("Invalid response from server")
        return
    end

    -- Execute the protected content
    local fn, err = loadstring(data.content)
    if not fn then
        _kick("Script load failed: " .. tostring(err))
        return
    end

    pcall(fn)
end`;

    // Optional: keep basic server-side IP count if you want
    // trackUse(hash, ip);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(lua);

  } catch (err) {
    console.error('Loader v2 error:', err);
    return res.status(500).end('-- Error');
  }
}
// pages/api/files/v3/loader.js
// Serves a Lua loader that key-validates and pulls script content from DB.
const RATE_LIMIT_WINDOW = 15 * 1000;
const RATE_LIMIT_MAX    = 20;
const rateLimitStore    = new Map();

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
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

  if (req.method !== 'GET') return res.status(405).end('-- Method Not Allowed');
  if (isForbiddenRequest(req)) return res.status(403).end('-- Forbidden');

  const ip = getIP(req);
  if (isRateLimited(ip)) return res.status(429).end('-- rate_limited');

  const urlMatch = (req.url || '').match(/([a-f0-9]{32})\.lua/i);
  const hash = urlMatch ? urlMatch[1].toLowerCase() : null;
  if (!hash) return res.status(400).end('-- invalid_hash');

  const API = 'https://www.flurs.xyz/api/keys';

  const lua = `-- Flurs Secure Loader v3 | https://flurs.xyz
do
local _hash = "${hash}"
local _api  = "${API}"

local _ENV   = getfenv and getfenv(0) or _G
local _ps    = game:GetService("Players")
local _lp    = _ps.LocalPlayer

local function _FLURS_KICK(reason)
    pcall(function()
        _lp:Kick("[Flurs] Security violation: " .. tostring(reason))
    end)
    while true do task.wait(9e9) end
end

rawset(_ENV, "print",         function(...) _FLURS_KICK("print blocked") end)
rawset(_ENV, "warn",          function(...) _FLURS_KICK("warn blocked")  end)
rawset(_ENV, "printidentity", function()    _FLURS_KICK("printidentity blocked") end)

pcall(function()
    if rawget(string, "dump") then
        rawset(string, "dump", function() _FLURS_KICK("string.dump blocked") end)
    end
end)

local _dumpFns = {
    "getscriptclosure","getscriptfunction","dumpstring",
    "decompile","getfuncs","getproto","getconstants","getupvalues",
    "getinfo","debug","hookfunction","newcclosure","checkcaller"
}
for _, fn in ipairs(_dumpFns) do
    if rawget(_ENV, fn) ~= nil then
        rawset(_ENV, fn, function(...) _FLURS_KICK(fn .. " blocked") end)
    end
end

local _ots = rawget(_ENV, "tostring") or tostring
rawset(_ENV, "tostring", function(v)
    if type(v) == "function" then return "[protected]" end
    return _ots(v)
end)

local key = (getgenv and getgenv().script_key)
         or (genv    and genv().script_key)
         or (getfenv and getfenv().script_key)

if not key or key == "" then
    error("[Flurs] No key set. Do this first:\\n  script_key=\\"YOUR-FLURS-KEY\\"", 0)
end

local ok_hwid, hwid = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)

local ok_name, username = pcall(function()
    return _lp and _lp.Name or "unknown"
end)
local _username = (ok_name and username) or "unknown"

local _hs    = game:GetService("HttpService")
local _query = "action=validate"
             .. "&key="        .. _hs:UrlEncode(key)
             .. "&hwid="       .. _hs:UrlEncode(ok_hwid and hwid or "unknown")
             .. "&scriptHash=" .. _hs:UrlEncode(_hash)
             .. "&username="   .. _hs:UrlEncode(_username)

local _success, _response = pcall(function()
    return http_request({
        Url     = _api .. "?" .. _query,
        Method  = "GET",
        Headers = { ["Accept"] = "application/json" }
    })
end)

if not _success then
    error("[Flurs] Request failed: " .. tostring(_response), 0)
end

if _response.StatusCode < 200 or _response.StatusCode >= 300 then
    error("[Flurs] Server error " .. tostring(_response.StatusCode), 0)
end

local _data
local _ok2, _decErr = pcall(function()
    _data = _hs:JSONDecode(_response.Body)
end)

if not _ok2 or type(_data) ~= "table" then
    error("[Flurs] Bad server response.", 0)
end

if not _data.ok then
    error("[Flurs] " .. tostring(_data.error or "Access denied"), 0)
end

local _fn, _err = loadstring(_data.content)
if not _fn then error("[Flurs] " .. tostring(_err), 0) end

local _runOk, _runErr = pcall(_fn)

end -- do
`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).end(lua);
}

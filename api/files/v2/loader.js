// api/files/v2/loader.js
// Serves a raw Lua script. Executor-only. Tracks usage server-side + client ping for full logging.

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
  if (req.headers['x-forwarded-host'] && req.headers['x-forwarded-host'] !== req.headers['host']) return true;
  if (req.headers['via']) return true;
  if (req.headers['x-real-ip'] && !req.headers['x-forwarded-for']) return true;
  if (ua.length > 0) return true;
  return false;
}

// ── Server-side tracking — no Lua ping needed ─────────────────────────────
async function trackUse(hash, ip) {
  try {
    const { blobs } = await list({ prefix: `scripts/${hash}.meta.json` });
    const metaBlob  = blobs.find(b => b.pathname === `scripts/${hash}.meta.json`);
    if (!metaBlob) return;
    const meta = await fetch(metaBlob.url + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
    meta.useCount = (meta.useCount || 0) + 1;
    meta.usageLog = meta.usageLog || [];
    meta.usageLog.push({
      ts:       Date.now(),
      ip:       ip || 'unknown',
      username: 'unknown', // client will fill better data
    });
    meta.lastUsed = Date.now();
    await put(`scripts/${hash}.meta.json`, JSON.stringify(meta), {
      access: 'public', contentType: 'application/json', addRandomSuffix: false,
    });
  } catch (e) {
    console.error('trackUse error:', e);
  }
}

function wrapWithProtection(luaContent, hash) {  // <-- added hash param
  return `-- Flurs Protected Loader v2 (logging + improved kick 2026)
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

    -- Original poisons (unchanged)
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

    -- ── 2026 kick improvement: detect common bypass patterns (catches low/mid executors) ──
    task.spawn(function()
        task.wait(1.5)  -- give time for executor restores
        if print == _G.print or type(print) ~= "function" or getfenv(print) ~= _ENV then
            _kick("Global tampering / restore detected")
        end
        if hookfunction and type(hookfunction) == "function" then
            _kick("hookfunction detected (tamper attempt)")
        end
    end)

    local _fn, _err = loadstring(${JSON.stringify(luaContent)})
    if not _fn then _kick("Script load failed.") return end
    local _ok, _runErr = pcall(_fn)

    -- ── Logging ping (fixed: now sends real Roblox data) ────────────────────────
    task.spawn(function()
        pcall(function()
            local hs = game:GetService("HttpService")
            local username = _lp and _lp.Name or "unknown"
            local gameId   = game.PlaceId
            local serverId = game.JobId
            local gameName = "unknown"

            pcall(function()
                local info = hs:JSONDecode(hs:GetAsync("https://games.roblox.com/v1/games?universeIds=" .. game.GameId))
                gameName = info.data[1].name or "unknown"
            end)

            local data = {
                hash     = "${hash}",
                username = username,
                gameId   = gameId,
                gameName = gameName,
                serverId = serverId,
            }

            local url = "https://api.flurs.xyz/api/admin?action=trackhosted"  -- change domain if needed

            -- Prioritize request/http_request/syn.request → fallback GET
            local reqFunc = request or (syn and syn.request) or http_request or (http and http.request)
            if reqFunc then
                reqFunc({
                    Url     = url,
                    Method  = "POST",
                    Headers = {["Content-Type"] = "application/json"},
                    Body    = hs:JSONEncode(data)
                })
            else
                hs:GetAsync(url .. "&" .. hs:UrlEncode(hs:JSONEncode(data)))
            end
        end)
    end)

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
    const url     = `${BLOB_BASE_URL}/scripts/${hash}.lua`;
    const blobRes = await fetch(url, {
      headers: BLOB_TOKEN ? { Authorization: `Bearer ${BLOB_TOKEN}` } : {},
    });

    if (!blobRes.ok) return res.status(404).end('-- Not found');

    const rawContent = await blobRes.text();

    // Track server-side (IP + basic count)
    trackUse(hash, ip);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(wrapWithProtection(rawContent, hash));  // pass hash

  } catch (err) {
    console.error('Loader v2 error:', err);
    return res.status(500).end('-- Error');
  }
}
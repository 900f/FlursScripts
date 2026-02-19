// api/files/v3/loader.js
// Serves a Lua loader file per script hash.
// User runs:
//   script_key="FLURS-XXXX-XXXX-XXXX-XXXX"
//   loadstring(game:HttpGet("https://api.flurs.xyz/files/v3/loader/HASH.lua", true))()

const RATE_LIMIT_WINDOW = 15 * 1000;
const RATE_LIMIT_MAX    = 20;
const rateLimitStore    = new Map();

function getIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.socket?.remoteAddress
        || 'unknown';
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

const BROWSER_UA = ['mozilla','chrome','safari','firefox','edge','opera','wget','python','postman','curl','insomnia','httpie'];

function isBrowser(req) {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (ua.includes('roblox') || ua.includes('wininet')) return false;
    if (BROWSER_UA.some(p => ua.includes(p))) return true;
    if (ua.length > 0) return true;
    return false;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method !== 'GET') return res.status(405).end('-- Method Not Allowed');
    if (isBrowser(req))       return res.status(403).end('-- Forbidden');

    const ip = getIP(req);
    if (isRateLimited(ip))    return res.status(429).end('-- rate_limited');

    const urlMatch = (req.url || '').match(/([a-f0-9]{32})\.lua/i);
    const hash = urlMatch ? urlMatch[1].toLowerCase() : null;
    if (!hash) return res.status(400).end('-- invalid_hash');

    const API = 'https://api.flurs.xyz/api/keys';

    const lua = `-- Flurs Loader v3 | https://flurs.xyz
local _hash = "${hash}"
local _api  = "${API}"

-- Key detection
local key = nil
local ok0, keyVal = pcall(function()
    if getgenv then return getgenv().script_key end
    return nil
end)
if ok0 and keyVal and keyVal ~= "" then
    key = keyVal
end
if not key then
    local ok0b, keyVal2 = pcall(function()
        if genv then return genv().script_key end
        return nil
    end)
    if ok0b and keyVal2 and keyVal2 ~= "" then key = keyVal2 end
end

if not key or key == "" then
    error("[Flurs] No key found. Set it with: script_key=\\"YOUR-KEY\\" before running.", 0)
end

local hs = game:GetService("HttpService")

-- HWID detection
local hwid = "unknown"
local ok1, h1 = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)
if ok1 and h1 and h1 ~= "" then
    hwid = h1
else
    local ok2, h2 = pcall(function()
        return tostring(game:GetService("Players").LocalPlayer.UserId) .. "_device"
    end)
    if ok2 and h2 then hwid = h2 end
end

-- Username detection
local robloxUsername = "unknown"
local ok3, uname = pcall(function()
    return game:GetService("Players").LocalPlayer.Name
end)
if ok3 and uname then robloxUsername = uname end

-- Build request
local query = "action=validate" ..
              "&key="            .. hs:UrlEncode(key) ..
              "&hwid="           .. hs:UrlEncode(hwid) ..
              "&robloxUsername=" .. hs:UrlEncode(robloxUsername) ..
              "&scriptHash="     .. hs:UrlEncode(_hash)

-- Send request
local ok4, response = pcall(function()
    return http_request({
        Url     = _api .. "?" .. query,
        Method  = "GET",
        Headers = { ["Accept"] = "application/json" }
    })
end)

if not ok4 then
    error("[Flurs] Request failed: " .. tostring(response), 0)
end

if not response or type(response.StatusCode) ~= "number" then
    error("[Flurs] Invalid response from server", 0)
end

if response.StatusCode == 429 then
    error("[Flurs] Rate limited. Wait a moment and try again.", 0)
end

if response.StatusCode == 401 or response.StatusCode == 403 then
    error("[Flurs] Access denied (HTTP " .. response.StatusCode .. ")", 0)
end

if response.StatusCode < 200 or response.StatusCode >= 300 then
    error("[Flurs] Server returned HTTP " .. tostring(response.StatusCode), 0)
end

-- Decode JSON
local data
local ok5, decodeErr = pcall(function()
    data = hs:JSONDecode(response.Body)
end)

if not ok5 or type(data) ~= "table" then
    error("[Flurs] Bad response from server: " .. tostring(response.Body and response.Body:sub(1, 100) or "empty"), 0)
end

if not data.ok then
    error("[Flurs] " .. tostring(data.error or "Access denied"), 0)
end

if type(data.content) ~= "string" or data.content == "" then
    error("[Flurs] Server returned empty script content", 0)
end

-- Parse and execute
local fn, parseErr = loadstring(data.content)
if not fn then
    error("[Flurs] Script parse error: " .. tostring(parseErr), 0)
end

local ok6, runErr = pcall(fn)
if not ok6 then
    error("[Flurs] Script runtime error: " .. tostring(runErr), 0)
end
`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(lua);
}
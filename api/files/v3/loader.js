// api/files/v3/loader.js
// Serves a Lua loader file per script hash.
// The Lua file itself reads script_key from the executor environment,
// calls your /api/keys validate endpoint via http_request (GET method),
// and executes the protected script.
//
// URL: https://api.flurs.xyz/files/v3/loader/HASH.lua
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

local key = (getgenv and getgenv().script_key)
         or (genv    and genv().script_key)
         or (getfenv and getfenv().script_key)

if not key or key == "" then
    error("[Flurs] No key set. Do: script_key=\\"YOUR-KEY\\"", 0)
end

local hs = game:GetService("HttpService")

-- Get HWID (try multiple methods)
local hwid = "unknown"
local ok1, h1 = pcall(function() return game:GetService("RbxAnalyticsService"):GetClientId() end)
if ok1 and h1 and h1 ~= "" then
    hwid = h1
else
    local ok2, h2 = pcall(function()
        return tostring(game:GetService("Players").LocalPlayer.UserId) .. "_device"
    end)
    if ok2 and h2 then hwid = h2 end
end

-- Get Roblox username
local robloxUsername = "unknown"
local ok3, uname = pcall(function()
    return game:GetService("Players").LocalPlayer.Name
end)
if ok3 and uname then robloxUsername = uname end

-- Build query string
local query = "action=validate" ..
              "&key="            .. hs:UrlEncode(key) ..
              "&hwid="           .. hs:UrlEncode(hwid) ..
              "&robloxUsername=" .. hs:UrlEncode(robloxUsername) ..
              "&scriptHash="     .. hs:UrlEncode(_hash)

local success, response = pcall(function()
    return http_request({
        Url = _api .. "?" .. query,
        Method = "GET",
        Headers = { ["Accept"] = "application/json" }
    })
end)

if not success then
    error("[Flurs] Request failed: " .. tostring(response), 0)
end

if response.StatusCode < 200 or response.StatusCode >= 300 then
    error("[Flurs] Server error " .. tostring(response.StatusCode), 0)
end

local data
local ok4, decodeErr = pcall(function()
    data = hs:JSONDecode(response.Body)
end)

if not ok4 or type(data) ~= "table" then
    error("[Flurs] Bad response: " .. tostring(response.Body:sub(1, 200)), 0)
end

if not data.ok then
    error("[Flurs] " .. tostring(data.error or "Access denied"), 0)
end

local fn, err = loadstring(data.content)
if not fn then error("[Flurs] " .. tostring(err), 0) end
fn()
`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(lua);
}
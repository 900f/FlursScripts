// api/files/v3/loader.js
// Serves a Lua loader file per script hash.
// - Overrides print/warn so any attempt to read source kicks the player
// - URL: https://api.flurs.xyz/files/v3/loader/HASH.lua

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

// ── Anti-tamper Lua header injected before every script ──────────────────
// Overrides print, warn, tostring globally so that if someone wraps the
// loadstring in print() or tries to read the source, they get kicked instead.
const ANTI_PRINT_LUA = `
-- [[ Flurs Anti-Tamper ]] --
do
    local _kick = function(reason)
        pcall(function()
            game:GetService("Players").LocalPlayer:Kick(reason or "Do not attempt to reverse this script")
        end)
        error("", 0)
    end

    -- Detect if this script is being printed / source-read
    local _rawprint = print
    local _rawwarn  = warn
    local _rawtostr = tostring

    -- Override print so printing the function/table kicks
    local _blocked = false
    local function _guard(...)
        if _blocked then return end
        local args = {...}
        for _, v in ipairs(args) do
            local t = type(v)
            if t == "function" or t == "table" then
                _blocked = true
                _kick("Do not attempt to reverse this script")
                return
            end
        end
        return _rawprint(...)
    end

    -- Override warn similarly
    local function _guardwarn(...)
        if _blocked then return end
        local args = {...}
        for _, v in ipairs(args) do
            local t = type(v)
            if t == "function" or t == "table" then
                _blocked = true
                _kick("Do not attempt to reverse this script")
                return
            end
        end
        return _rawwarn(...)
    end

    -- Block getfenv/debug access to our environment
    local _origGetfenv = getfenv
    getfenv = function(f)
        if f == nil or f == 0 or f == 1 then
            _kick("Do not attempt to reverse this script")
            return {}
        end
        return _origGetfenv(f)
    end

    -- Seal our overrides globally
    rawset(_G, "print", _guard)
    rawset(_G, "warn",  _guardwarn)
end
-- [[ End Anti-Tamper ]] --
`.trim();

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

    const lua = `-- Flurs Loader (v3) | https://flurs.xyz
local _hash = "${hash}"
local _api  = "${API}"

${ANTI_PRINT_LUA}

local key = (getgenv and getgenv().script_key)
         or (genv    and genv().script_key)
         or (getfenv and getfenv(0).script_key)

if not key or key == "" then
    error("[Flurs] No key set. Run this first: script_key=\\"YOUR-KEY\\"", 0)
end

local ok_hwid, hwid = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)

-- Build query string
local query = "action=validate" ..
              "&key="        .. game:GetService("HttpService"):UrlEncode(key) ..
              "&hwid="       .. game:GetService("HttpService"):UrlEncode(ok_hwid and hwid or "unknown") ..
              "&scriptHash=" .. game:GetService("HttpService"):UrlEncode(_hash)

local success, response = pcall(function()
    return http_request({
        Url = _api .. "?" .. query,
        Method = "GET",
        Headers = {
            ["Accept"] = "application/json",
            ["Content-Type"] = "application/json"
        }
    })
end)

if not success then
    error("[Flurs] http_request failed: " .. tostring(response), 0)
end

if response.StatusCode < 200 or response.StatusCode >= 300 then
    error("[Flurs] Server error " .. tostring(response.StatusCode), 0)
end

local hs = game:GetService("HttpService")
local data
local ok, decodeErr = pcall(function()
    data = hs:JSONDecode(response.Body)
end)

if not ok or type(data) ~= "table" then
    error("[Flurs] Bad response from server", 0)
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
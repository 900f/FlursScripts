// api/loaderfile.js
// Serves the Lua loader script for a given key script hash.
// URL pattern: /api/loaderfile/[hash].lua
// This is what users HttpGet — the loader logic lives here, not client-side.
// The actual protected script content never touches this endpoint.
//
// Deploy this as a Vercel serverless function and add a rewrite rule:
//   { "source": "/api/loader/:hash.lua", "destination": "/api/loaderfile?hash=:hash" }
// OR name it pages/api/loaderfile/[hash].js for file-based routing.

const BLOCKED_UA = ['mozilla','chrome','safari','firefox','edge','opera','brave','curl','wget','python','axios','node','postman'];

function isBrowser(req) {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (!ua) return false;
    if (ua.includes('roblox') || ua.includes('wininet')) return false;
    return BLOCKED_UA.some(p => ua.includes(p));
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).end('-- Method Not Allowed');
    if (isBrowser(req))       return res.status(403).end('-- Forbidden: browser access not allowed');

    // Extract hash from URL: /api/loader/abc123.lua or ?hash=abc123
    const urlMatch = (req.url || '').match(/([a-f0-9]{32})\.lua/i);
    const hash = (urlMatch ? urlMatch[1] : req.query?.hash || '').toLowerCase();

    if (!hash || !/^[a-f0-9]{32}$/.test(hash)) {
        return res.status(400).end('-- Invalid hash');
    }

    const API = process.env.SITE_URL || 'https://api.flurs.xyz';

    // Build the Lua loader dynamically with this hash baked in
    const lua = `-- Flurs Loader
-- Usage: FLURS_KEY="YOUR-KEY"; loadstring(game:HttpGet("${API}/api/loader/${hash}.lua"))()

local scriptHash = "${hash}"
local API        = "${API}/api/keys"

-- Read key from global set inline before this loadstring
local key = (getgenv and getgenv().FLURS_KEY)
         or (genv and genv().FLURS_KEY)

if not key or key == "" then
    error("[Flurs] No key provided. Set your key first:\\nFLURS_KEY=\\"YOUR-KEY\\"; loadstring(...)()", 0)
end

-- HWID
local ok_hwid, hwid = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)
hwid = ok_hwid and hwid or "unknown"

-- Validate
local hs   = game:GetService("HttpService")
local body = hs:JSONEncode({
    action     = "validate",
    key        = key,
    hwid       = hwid,
    scriptHash = scriptHash,
})

local ok, response = pcall(function()
    return hs:PostAsync(API, body, Enum.HttpContentType.ApplicationJson, false)
end)

if not ok then
    error("[Flurs] Could not reach key server.", 0)
end

local data
ok, data = pcall(function() return hs:JSONDecode(response) end)
if not ok or type(data) ~= "table" then
    error("[Flurs] Bad response from server.", 0)
end

if not data.ok then
    error("[Flurs] " .. tostring(data.error or "Access denied"), 0)
end

if not data.content or data.content == "" then
    error("[Flurs] Server returned empty script.", 0)
end

local fn, err = loadstring(data.content)
if not fn then error("[Flurs] " .. tostring(err), 0) end
fn()
`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).end(lua);
}
// api/files/v2/loader.js
// Serves a Lua bootstrapper that grabs username+hwid then fetches the real script

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

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
  if (isRateLimited(req))   return res.status(429).end('-- Slow down');

  const hash = req.query?.hash?.toLowerCase() || null;
  if (!hash) return res.status(400).end('-- Not found');

  const execUrl = `https://api.flurs.xyz/api/files/v2/exec/${hash}.lua`;

  const bootstrapper = `-- Flurs Loader v2
local hs = game:GetService("HttpService")

-- HWID detection
local hwid = "unknown"
local ok1, h1 = pcall(function()
    return game:GetService("RbxAnalyticsService"):GetClientId()
end)
if ok1 and h1 and h1 ~= "" then
    hwid = h1
else
    local ok2, uid = pcall(function()
        return tostring(game:GetService("Players").LocalPlayer.UserId) .. "_device"
    end)
    if ok2 and uid then hwid = uid end
end

-- Username detection
local u = "unknown"
local ok3, uname = pcall(function()
    return game:GetService("Players").LocalPlayer.Name
end)
if ok3 and uname then u = uname end

-- Fetch script
local url = "${execUrl}?u=" .. hs:UrlEncode(u) .. "&hwid=" .. hs:UrlEncode(hwid)
local ok4, src = pcall(function()
    return game:HttpGet(url, true)
end)
if not ok4 or type(src) ~= "string" or src == "" then
    warn("[Flurs] Failed to fetch script: " .. tostring(src))
    return
end

-- Execute script
local fn, err = loadstring(src)
if not fn then
    warn("[Flurs] Parse error: " .. tostring(err))
    return
end

local ok5, runErr = pcall(fn)
if not ok5 then
    warn("[Flurs] Runtime error: " .. tostring(runErr))
end`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).end(bootstrapper);
}
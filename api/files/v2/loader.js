// api/files/v2/loader.js
// Serves raw hosted Lua scripts with anti-tamper print/source protection.

const BLOB_BASE_URL      = 'https://anynovmwoyinocra.public.blob.vercel-storage.com';
const BLOB_TOKEN         = process.env.BLOB_READ_WRITE_TOKEN;
const RATE_LIMIT_WINDOW  = 15 * 1000;
const RATE_LIMIT_MAX     = 8;

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

const BROWSER_UA = ['mozilla', 'chrome', 'safari', 'firefox', 'edge', 'opera', 'wget', 'python', 'postman', 'curl', 'insomnia', 'httpie'];

function isBrowser(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('roblox') || ua.includes('wininet')) return false;
  if (BROWSER_UA.some(p => ua.includes(p))) return true;
  if (ua.length > 0) return true;
  return false;
}

// ── Anti-tamper header: override print/warn/getfenv to kick on abuse ─────
const ANTI_PRINT_LUA = `
-- [[ Flurs Anti-Tamper ]] --
do
    local _kick = function(reason)
        pcall(function()
            game:GetService("Players").LocalPlayer:Kick(reason or "Do not attempt to reverse this script")
        end)
        error("", 0)
    end

    local _rawprint = print
    local _rawwarn  = warn
    local _blocked  = false

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

    local _origGetfenv = getfenv
    getfenv = function(f)
        if f == nil or f == 0 or f == 1 then
            _kick("Do not attempt to reverse this script")
            return {}
        end
        return _origGetfenv(f)
    end

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
  if (isRateLimited(req))   return res.status(429).end('-- Slow down');

  const urlMatch = (req.url || '').match(/([a-f0-9]{32})\.lua/i);
  const hash = urlMatch ? urlMatch[1].toLowerCase() : null;

  if (!hash) return res.status(400).end('-- Not found');

  try {
    const url = `${BLOB_BASE_URL}/scripts/${hash}.lua`;
    const blobRes = await fetch(url, {
      headers: BLOB_TOKEN ? { Authorization: `Bearer ${BLOB_TOKEN}` } : {},
    });

    if (!blobRes.ok) return res.status(404).end('-- Not found');

    // Prepend anti-tamper header to every script served
    const scriptContent = await blobRes.text();
    const fullContent   = ANTI_PRINT_LUA + '\n\n' + scriptContent;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).end(fullContent);

  } catch (err) {
    console.error('Loader error:', err);
    return res.status(500).end('-- Error');
  }
}
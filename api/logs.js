// api/logs.js
// Execution log reader — admin only

import { neon } from '@neondatabase/serverless';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD environment variable is not set');

const sql = neon(process.env.DATABASE_URL);

const attempts = new Map();
const MAX_TRIES = 10;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now(), e = attempts.get(ip);
  if (!e || now > e.resetAt) { attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS }); return false; }
  return e.count >= MAX_TRIES;
}
function recordFailure(ip) {
  const now = Date.now(), e = attempts.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  e.count++; attempts.set(ip, e);
}
function clearFailures(ip) { attempts.delete(ip); }

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://www.flurs.xyz';
  const origin = req.headers.origin || '';
  if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests.' });

  const { action, password, limit = 200, offset = 0, scriptType, scriptHash } = req.body || {};

  if (!password || password !== ADMIN_PASSWORD) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  clearFailures(ip);

  try {

    // ── LIST logs ─────────────────────────────────────────────────────────
    if (action === 'list') {
      let rows;
      if (scriptType && scriptType !== 'all') {
        rows = await sql`
          SELECT * FROM execution_logs
          WHERE script_type = ${scriptType}
          ORDER BY executed_at DESC
          LIMIT ${Number(limit)} OFFSET ${Number(offset)}
        `;
      } else if (scriptHash) {
        rows = await sql`
          SELECT * FROM execution_logs
          WHERE script_hash = ${scriptHash}
          ORDER BY executed_at DESC
          LIMIT ${Number(limit)} OFFSET ${Number(offset)}
        `;
      } else {
        rows = await sql`
          SELECT * FROM execution_logs
          ORDER BY executed_at DESC
          LIMIT ${Number(limit)} OFFSET ${Number(offset)}
        `;
      }

      const countRow = await sql`SELECT COUNT(*) as total FROM execution_logs`;
      const total = Number(countRow[0].total);

      return res.status(200).json({ ok: true, logs: rows, total });
    }

    // ── STATS ─────────────────────────────────────────────────────────────
    if (action === 'stats') {
      const [total, todayRows, uniqueIps, byType, topScripts] = await Promise.all([
        sql`SELECT COUNT(*) as c FROM execution_logs`,
        sql`SELECT COUNT(*) as c FROM execution_logs WHERE executed_at > ${Date.now() - 86400000}`,
        sql`SELECT COUNT(DISTINCT ip) as c FROM execution_logs`,
        sql`SELECT script_type, COUNT(*) as c FROM execution_logs GROUP BY script_type`,
        sql`SELECT script_hash, script_label, script_type, COUNT(*) as c FROM execution_logs GROUP BY script_hash, script_label, script_type ORDER BY COUNT(*) DESC LIMIT 5`,
      ]);

      return res.status(200).json({
        ok: true,
        stats: {
          total: Number(total[0].c),
          today: Number(todayRows[0].c),
          uniqueIps: Number(uniqueIps[0].c),
          byType: byType.reduce((acc, r) => { acc[r.script_type] = Number(r.c); return acc; }, {}),
          topScripts,
        }
      });
    }

    // ── CLEAR logs ────────────────────────────────────────────────────────
    if (action === 'clear') {
      await sql`TRUNCATE execution_logs`;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('[logs] error:', err);
    return res.status(500).json({ error: 'Internal Server Error', detail: err.message });
  }
}
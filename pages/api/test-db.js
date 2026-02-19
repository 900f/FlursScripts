// pages/api/test-db.js
import { sql } from '../../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const result = await sql`SELECT NOW() AS time, version() AS pg_version`;
    res.status(200).json({
      ok: true,
      server_time: result[0].time,
      postgres_version: result[0].pg_version,
    });
  } catch (err) {
    console.error('DB test crash:', err);
    res.status(500).json({
      error: 'DB test failed',
      message: err.message,
      code: err.code || 'unknown',
      hint: err.hint || null,
    });
  }
}

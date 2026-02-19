// lib/db.js
import { neon, neonConfig } from '@neondatabase/serverless';
import { WebSocket } from 'undici';

neonConfig.webSocketConstructor = WebSocket;

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  console.error('[DB] Missing DATABASE_URL or POSTGRES_URL');
  throw new Error('DATABASE_URL or POSTGRES_URL is required');
}

export const sql = neon(connectionString, {
  fullResults: false,
  // If WebSocket fails in some environments, uncomment next line:
  // fetchConnection: true
});
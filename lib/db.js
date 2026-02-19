// lib/db.js
import { neon, neonConfig } from '@neondatabase/serverless';
import { WebSocket } from 'undici';

neonConfig.webSocketConstructor = WebSocket;

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL or POSTGRES_URL environment variable is required');
}

export const sql = neon(connectionString, { fullResults: false });

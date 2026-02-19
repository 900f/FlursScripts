// lib/db.js
import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('No DATABASE_URL or POSTGRES_URL environment variable set');
}

// Single client for the whole app (neon() is safe & pooled in serverless)
export const sql = neon(connectionString, {
  // Optional: fullResults: true → returns more metadata if needed
});
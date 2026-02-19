// api/debug.js
// TEMPORARY - lists all blobs in storage so we can see what's there
// DELETE THIS FILE after debugging

import { list } from '@vercel/blob';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export default async function handler(req, res) {
  const { password } = req.query;
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).end('Unauthorized');
  }

  const { blobs } = await list();
  return res.status(200).json({
    count: blobs.length,
    blobs: blobs.map(b => ({ pathname: b.pathname, url: b.url, size: b.size }))
  });
}

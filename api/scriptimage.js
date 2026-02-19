import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const id = req.url.split('/').pop().split('?')[0];
  if (!id) return res.status(400).end('Missing id');

  try {
    const rows = await sql`
      SELECT image_data, image_type FROM scriptcards WHERE id = ${id}
    `;
    if (!rows.length) return res.status(404).end('Not found');

    const { image_data, image_type } = rows[0];

    res.setHeader('Content-Type', image_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(200).send(Buffer.from(image_data));
  } catch (err) {
    console.error('[scriptimage] error:', err);
    return res.status(500).end('Internal Server Error');
  }
}
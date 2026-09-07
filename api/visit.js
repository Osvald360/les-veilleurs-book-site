import { store } from './_lib/store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const count = await store.incr('visits');
    return res.status(200).json({ visits: count });
  } catch (e) {
    return res.status(500).json({ error: 'storage_error' });
  }
}

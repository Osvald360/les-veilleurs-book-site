import { store } from './_lib/store.js';

// Enregistre une tentative de paiement.
//
// Un même acheteur peut cliquer plusieurs fois sur le même moyen de paiement
// (hésitation, retour en arrière, moyen pas encore actif...). On ne compte
// donc qu'une seule fois chaque couple commande + moyen, pour que les
// statistiques reflètent des intentions réelles et non des clics répétés.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { method, status, orderId } = req.body || {};
  if (!method || !status) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  try {
    if (orderId) {
      const key = `txn:${orderId}:${method}`;
      const already = await store.get(key);
      if (already) return res.status(200).json({ ok: true, deduped: true });
      await store.set(key, 1);
      await store.expire(key, 60 * 60 * 48); // mémoire de 48 h, suffisant
    }
    const entry = { ts: new Date().toISOString(), method, status, orderId: orderId || null };
    await store.lpush('transactions', JSON.stringify(entry));
    await store.ltrim('transactions', 0, 199);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'storage_error' });
  }
}

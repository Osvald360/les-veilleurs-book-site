import { createOrder } from './_lib/orders.js';
import { saleState } from './launch.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { firstName, lastName, address, email, phone } = req.body || {};
  if (!firstName || !lastName || !address || !email || !phone) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  try {
    // La fenêtre de vente et le stock sont vérifiés côté serveur : un
    // onglet resté ouvert après la clôture ou l'épuisement ne peut pas
    // créer de commande.
    const sale = await saleState();
    if (!sale.open) {
      return res.status(403).json({ error: 'sale_closed', status: sale.status });
    }
    const order = await createOrder({
      id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      firstName, lastName, address, email, phone,
      ts: new Date().toISOString(),
    });
    return res.status(200).json({ ok: true, orderId: order.id });
  } catch (e) {
    return res.status(500).json({ error: 'storage_error' });
  }
}

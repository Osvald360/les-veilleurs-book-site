import { getOrder, updateOrder } from './_lib/orders.js';
import { confirmSingpayOrder } from './_lib/singpay.js';

// Vérification active d'un paiement mobile money, appelée par le
// navigateur de l'acheteur après le push USSD. La logique (interrogation
// de SingPay, garde-fous, marquage payé, e-mail) vit dans _lib/singpay.js,
// partagée avec le balayage automatique côté serveur.
export default async function handler(req, res) {
  const orderId = (req.query && req.query.orderId) || (req.body || {}).orderId;
  if (!orderId) return res.status(400).json({ error: 'missing_order' });

  try {
    const order = await getOrder(String(orderId));
    if (!order) return res.status(404).json({ error: 'order_not_found' });
    if (order.status === 'paid') return res.status(200).json({ paid: true });

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const outcome = await confirmSingpayOrder(order, { host, protocol });

    if (outcome === 'paid') return res.status(200).json({ paid: true });
    if (outcome.startsWith('failed:')) {
      // Push soldé par un échec : on lève le verrou anti double-push pour
      // que l'acheteur puisse relancer un paiement immédiatement.
      try { await updateOrder(order.id, { singpayPushAt: '' }); } catch (e) {}
      return res.status(200).json({ paid: false, failed: true, reason: outcome.slice(7) });
    }
    return res.status(200).json({ paid: false, pending: true });
  } catch (e) {
    console.error('singpay_status exception', e && e.message);
    return res.status(200).json({ paid: false, pending: true });
  }
}

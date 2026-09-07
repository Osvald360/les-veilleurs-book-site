import { getOrder, markOrderPaid } from '../_lib/orders.js';
import { sendThankYouEmail } from '../_lib/thankyou.js';

// SingPay appelle cette URL (le "callback" configuré sur le portefeuille)
// une fois le paiement Mobile Money validé par le client sur son téléphone.
//
// Corps envoyé par SingPay :
//   { status: "Terminate", result: "Success", amount, reference,
//     transaction_id, client_msisdn, created_at, updated_at }
//
// La "reference" que nous recevons est l'identifiant de commande que nous
// avons envoyé au moment du paiement (orderId).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const { status, result, reference, transaction_id, amount } = body;

  if (!reference) {
    return res.status(400).json({ error: 'missing_reference' });
  }

  // On ne valide une commande que si SingPay indique un paiement réellement
  // abouti : traitement terminé ET résultat "Success".
  const success =
    String(status).toLowerCase() === 'terminate' &&
    String(result).toLowerCase() === 'success';

  try {
    const order = await getOrder(reference);
    if (!order) {
      // On renvoie 200 pour éviter que SingPay ne réessaie indéfiniment,
      // mais on signale que la commande est introuvable.
      return res.status(200).json({ ok: false, reason: 'order_not_found' });
    }

    if (!success) {
      return res.status(200).json({ ok: true, ignored: true, reason: 'not_successful' });
    }

    if (order.status !== 'paid') {
      await markOrderPaid(reference, {
        method: 'mobile_money',
        provider: 'singpay',
        providerTxId: transaction_id || null,
        amountXAF: amount || null,
      });

      // E-mail de remerciement (une seule fois).
      if (order.email && !order.thankYouSent) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        try {
          await sendThankYouEmail({
            firstName: order.firstName || '',
            email: order.email,
            host,
            protocol,
          });
        } catch (e) {}
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
}

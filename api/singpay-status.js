import { getOrder, markOrderPaid, updateOrder } from './_lib/orders.js';
import { getSettings } from './_lib/settings.js';
import { sendThankYouEmail } from './_lib/thankyou.js';

// Vérification active d'un paiement mobile money.
//
// Après le push USSD, le navigateur de l'acheteur interroge cet endpoint ;
// le serveur demande alors directement à SingPay où en est la transaction
// (GET /v1/transaction/api/status/{id}, authentifié par nos identifiants).
// La commande est ainsi confirmée même si le callback SingPay n'arrive
// jamais — le callback, s'il fonctionne, ne fait que doublonner sans effet
// (une commande déjà payée n'est pas retraitée).
//
// Vocabulaire SingPay : `result` n'est renseigné qu'en fin de traitement
// ("Success" ou un code d'erreur) ; avant cela, `status` vaut Start/
// Partenaire/... = paiement en cours.
export default async function handler(req, res) {
  const orderId = (req.query && req.query.orderId) || (req.body || {}).orderId;
  if (!orderId) return res.status(400).json({ error: 'missing_order' });

  try {
    const order = await getOrder(String(orderId));
    if (!order) return res.status(404).json({ error: 'order_not_found' });
    if (order.status === 'paid') return res.status(200).json({ paid: true });

    const txId = order.singpayTxId;
    if (!txId) return res.status(200).json({ paid: false, pending: true });

    const settings = await getSettings();
    if (!settings.singpayClientId || !settings.singpayClientSecret || !settings.singpayWallet) {
      return res.status(200).json({ paid: false, pending: true });
    }

    const r = await fetch(`https://gateway.singpay.ga/v1/transaction/api/status/${encodeURIComponent(txId)}`, {
      headers: {
        'x-client-id': settings.singpayClientId,
        'x-client-secret': settings.singpayClientSecret,
        'x-wallet': settings.singpayWallet,
        Accept: 'application/json',
      },
    });
    let body = {};
    try { body = await r.json(); } catch (e) {}
    const tx = (body && body.transaction) || body || {};
    const result = String(tx.result || '').toLowerCase();

    if (result === 'success') {
      // Mêmes garde-fous que le webhook : la transaction doit désigner
      // cette commande et couvrir le montant facturé.
      const ref = String(tx.reference || '');
      if (ref && ref !== String(orderId)) {
        console.error('singpay_status reference_mismatch', orderId, ref);
        return res.status(200).json({ paid: false, pending: true });
      }
      const charged = Number(order.amountXAF);
      const received = Number(tx.amount);
      if (Number.isFinite(charged) && charged > 0 && Number.isFinite(received) && received < charged) {
        console.error('singpay_status amount_mismatch', orderId, 'reçu:', received, 'attendu:', charged);
        return res.status(200).json({ paid: false, pending: true });
      }

      await markOrderPaid(String(orderId), {
        method: 'mobile_money',
        provider: 'singpay',
        providerTxId: txId,
        amountXAF: Number.isFinite(received) && received > 0 ? received : (charged || null),
      });

      if (order.email && !order.thankYouSent) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        try {
          const sent = await sendThankYouEmail({
            firstName: order.firstName || '',
            email: order.email,
            host,
            protocol,
          });
          if (sent && sent.ok) {
            await updateOrder(String(orderId), { thankYouSent: new Date().toISOString() });
          }
        } catch (e) {}
      }

      return res.status(200).json({ paid: true });
    }

    if (['passworderror', 'balanceerror', 'timeouterror', 'error'].includes(result)) {
      return res.status(200).json({ paid: false, failed: true, reason: result });
    }

    return res.status(200).json({ paid: false, pending: true });
  } catch (e) {
    console.error('singpay_status exception', e && e.message);
    return res.status(200).json({ paid: false, pending: true });
  }
}

import { store } from './store.js';
import { getOrder, markOrderPaid, updateOrder, listOrders } from './orders.js';
import { getSettings, getPrice } from './settings.js';
import { sendThankYouEmail } from './thankyou.js';

// Vérification d'un paiement mobile money directement auprès de SingPay
// (GET /v1/transaction/api/status/{id}, authentifié par nos identifiants).
// Utilisée par /api/singpay-status (le navigateur de l'acheteur) et par le
// balayage automatique ci-dessous. Retourne 'paid', 'failed:<raison>' ou
// 'pending'.
export async function confirmSingpayOrder(order, { host, protocol = 'https' }) {
  if (!order || order.status === 'paid') return 'paid';
  const txId = order.singpayTxId;
  if (!txId) return 'pending';

  const settings = await getSettings();
  if (!settings.singpayClientId || !settings.singpayClientSecret || !settings.singpayWallet) {
    return 'pending';
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
    // La transaction doit désigner cette commande et couvrir le montant
    // facturé (mémorisé au moment du push).
    const ref = String(tx.reference || '');
    if (ref && ref !== String(order.id)) {
      console.error('singpay_confirm reference_mismatch', order.id, ref);
      return 'pending';
    }
    const charged = Number(order.amountXAF) || getPrice(settings).xaf;
    const received = Number(tx.amount);
    if (Number.isFinite(received) && received < charged) {
      console.error('singpay_confirm amount_mismatch', order.id, 'reçu:', received, 'attendu:', charged);
      return 'pending';
    }

    await markOrderPaid(order.id, {
      method: 'mobile_money',
      provider: 'singpay',
      providerTxId: txId,
      amountXAF: Number.isFinite(received) && received > 0 ? received : charged,
    });

    if (order.email && !order.thankYouSent) {
      try {
        const sent = await sendThankYouEmail({
          firstName: order.firstName || '',
          email: order.email,
          host,
          protocol,
        });
        if (sent && sent.ok) {
          await updateOrder(order.id, { thankYouSent: new Date().toISOString() });
        }
      } catch (e) {}
    }
    return 'paid';
  }

  if (['passworderror', 'balanceerror', 'timeouterror', 'error'].includes(result)) {
    return 'failed:' + result;
  }
  return 'pending';
}

// Balayage automatique : re-vérifie les commandes mobile money restées
// « en attente » (acheteur qui a fermé la page avant la confirmation, par
// exemple). Appelé sur le trafic normal du site, au plus une fois par
// minute, sur les commandes des dernières 48 h.
export async function sweepPendingSingpay({ host, protocol = 'https' }) {
  try {
    // Verrou d'une minute : un seul balayage à la fois, sans ralentir
    // les autres visiteurs.
    const got = await store.setnx('singpaySweepLock', Date.now());
    if (!got) return;
    await store.expire('singpaySweepLock', 60);

    const orders = await listOrders(100);
    const cutoff = Date.now() - 48 * 3600 * 1000;
    const candidates = orders
      .filter((o) => o && o.status === 'pending' && o.singpayTxId)
      .filter((o) => {
        const t = Date.parse(o.createdAt || o.ts || '');
        return Number.isFinite(t) ? t >= cutoff : true;
      })
      .slice(0, 5);

    for (const o of candidates) {
      try {
        const fresh = await getOrder(o.id);
        if (fresh && fresh.status === 'pending') {
          await confirmSingpayOrder(fresh, { host, protocol });
        }
      } catch (e) {}
    }
  } catch (e) {}
}

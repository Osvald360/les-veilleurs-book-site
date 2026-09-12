import { store } from './store.js';
import { getOrder, markOrderPaid, updateOrder, listOrders, claimThankYou, releaseThankYou } from './orders.js';
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
    // Contrairement au webhook (appelable par n'importe qui), cette réponse
    // vient de l'API SingPay authentifiée : elle fait foi. Le montant peut
    // différer du facturé (SingPay renvoie parfois le net, commission
    // déduite) : on le trace sans bloquer la confirmation.
    const charged = Number(order.amountXAF) || getPrice(settings).xaf;
    const received = Number(tx.amount);
    if (Number.isFinite(received) && received < charged) {
      console.error('singpay_confirm amount_note', order.id, 'reçu:', received, 'facturé:', charged);
    }

    await markOrderPaid(order.id, {
      method: 'mobile_money',
      provider: 'singpay',
      providerTxId: txId,
      amountXAF: Number.isFinite(received) && received > 0 ? received : charged,
    });

    if (order.email && !order.thankYouSent && await claimThankYou(order.id)) {
      try {
        const sent = await sendThankYouEmail({
          firstName: order.firstName || '',
          email: order.email,
          host,
          protocol,
        });
        if (sent && sent.ok) {
          await updateOrder(order.id, { thankYouSent: new Date().toISOString() });
        } else {
          await releaseThankYou(order.id);
        }
      } catch (e) {
        await releaseThankYou(order.id);
      }
    }
    return 'paid';
  }

  if (['passworderror', 'balanceerror', 'timeouterror', 'error'].includes(result)) {
    return 'failed:' + result;
  }

  // Trace de diagnostic : ce que SingPay répond pour une transaction
  // ni aboutie ni échouée (utile si le vocabulaire de leur API évolue).
  console.error('singpay_confirm pending', order.id,
    JSON.stringify({ http: r.status, status: tx.status, result: tx.result, reference: tx.reference }).slice(0, 300));
  return 'pending';
}

// Balayage automatique : re-vérifie les commandes mobile money restées
// « en attente » (acheteur qui a fermé la page avant la confirmation, par
// exemple). Appelé sur le trafic normal du site, au plus une fois par
// minute, sur les commandes des dernières 48 h.
export async function sweepPendingSingpay({ host, protocol = 'https' }) {
  try {
    // Verrou d'une minute : un seul balayage à la fois, sans ralentir
    // les autres visiteurs. Un verrou plus vieux que 2 minutes est
    // considéré orphelin (fonction interrompue avant l'expiration) et
    // repris, pour que le balayage ne s'arrête jamais définitivement.
    const got = await store.setnx('singpaySweepLock', Date.now());
    if (!got) {
      const ts = Number(await store.get('singpaySweepLock'));
      if (Number.isFinite(ts) && Date.now() - ts < 120000) return;
      await store.set('singpaySweepLock', Date.now());
    }
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

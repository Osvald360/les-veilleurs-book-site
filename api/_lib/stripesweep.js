import { store } from './store.js';
import { listOrders, getOrder, markOrderPaid, updateOrder, claimThankYou, releaseThankYou } from './orders.js';
import { getSettings } from './settings.js';
import { sendThankYouEmail } from './thankyou.js';

// Balayage automatique côté cartes : retrouve chez Stripe les paiements
// aboutis dont le webhook a été manqué (commande restée « en attente »)
// et confirme la commande, e-mail compris. Même principe que le balayage
// SingPay : verrou d'une minute, petites tranches, déclenché par le trafic
// normal du site — aucune action manuelle nécessaire.
export async function sweepPendingStripe({ host, protocol = 'https' }) {
  try {
    const got = await store.setnx('stripeSweepLock', Date.now());
    if (!got) {
      const ts = Number(await store.get('stripeSweepLock'));
      if (Number.isFinite(ts) && Date.now() - ts < 120000) return;
      await store.set('stripeSweepLock', Date.now());
    }
    await store.expire('stripeSweepLock', 60);

    const settings = await getSettings();
    if (!settings.stripeSecretKey) return;

    const orders = await listOrders(100);
    const cutoff = Date.now() - 48 * 3600 * 1000;
    const candidates = orders
      .filter((o) => o && o.status === 'pending' && ['card', 'applepay'].includes(o.lastMethod || o.method))
      .filter((o) => {
        const t = Date.parse(o.createdAt || o.ts || '');
        return Number.isFinite(t) ? t >= cutoff : true;
      })
      .slice(0, 3);

    for (const o of candidates) {
      try {
        const fresh = await getOrder(o.id);
        if (!fresh || fresh.status !== 'pending') continue;

        // Le paiement est recherché par référence de commande, posée en
        // métadonnée sur chaque session Stripe au moment du checkout.
        const q = encodeURIComponent(`metadata['orderId']:'${o.id}'`);
        const ctrl = new AbortController();
        const cut = setTimeout(() => ctrl.abort(), 8000);
        let r;
        try {
          r = await fetch(`https://api.stripe.com/v1/payment_intents/search?query=${q}`, {
            headers: { Authorization: `Bearer ${settings.stripeSecretKey}` },
            signal: ctrl.signal,
          });
        } finally {
          clearTimeout(cut);
        }
        const d = await r.json();
        const pi = d && d.data && d.data.find((x) => x && x.status === 'succeeded');
        if (!pi) continue;

        const extra = { method: fresh.lastMethod || 'card', provider: 'stripe', providerTxId: pi.id };
        if (pi.currency === 'eur' && pi.amount_received > 0) extra.amountEur = pi.amount_received / 100;
        await markOrderPaid(o.id, extra);

        if (fresh.email && !fresh.thankYouSent && await claimThankYou(o.id)) {
          try {
            const sent = await sendThankYouEmail({ firstName: fresh.firstName || '', email: fresh.email, host, protocol });
            if (sent && sent.ok) await updateOrder(o.id, { thankYouSent: new Date().toISOString() });
            else await releaseThankYou(o.id);
          } catch (e) {
            await releaseThankYou(o.id);
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
}

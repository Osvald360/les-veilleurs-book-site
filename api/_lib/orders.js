import { store } from './store.js';

export async function createOrder(order) {
  const full = { status: 'pending', createdAt: new Date().toISOString(), ...order };
  await store.set(`order:${order.id}`, JSON.stringify(full));
  await store.lpush('orders:index', order.id);
  await store.ltrim('orders:index', 0, 999);
  return full;
}

export async function getOrder(id) {
  const raw = await store.get(`order:${id}`);
  return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
}

async function writeOrder(id, patch) {
  const order = await getOrder(id);
  if (!order) return null;
  const updated = { ...order, ...patch };
  await store.set(`order:${id}`, JSON.stringify(updated));
  return updated;
}

export async function markOrderPaid(id, extra = {}) {
  return writeOrder(id, { status: 'paid', paidAt: new Date().toISOString(), ...extra });
}

// Complète une commande sans toucher à son statut (montant facturé,
// e-mail de remerciement envoyé...).
export async function updateOrder(id, patch) {
  return writeOrder(id, patch);
}

// Réserve l'envoi de l'e-mail de confirmation : premier appelant servi.
// Webhook, vérification navigateur et balayage serveur peuvent confirmer
// la même commande à quelques secondes d'écart ; sans ce verrou, deux
// d'entre eux passeraient le test « pas encore envoyé » en même temps et
// l'acheteur recevrait l'e-mail en double. Le verrou expire de lui-même
// (10 min) pour qu'un envoi raté puisse être retenté.
export async function claimThankYou(id) {
  try {
    const got = await store.setnx(`thanks:${id}`, Date.now());
    if (got) await store.expire(`thanks:${id}`, 600);
    return Boolean(got);
  } catch (e) {
    return true; // sans verrou disponible, mieux vaut risquer un doublon qu'aucun e-mail
  }
}

export async function releaseThankYou(id) {
  try { await store.del(`thanks:${id}`); } catch (e) {}
}

// Marquage manuel depuis le tableau de bord (virement, mobile money encaissé
// hors ligne, remise en main propre...).
export async function setOrderStatus(id, status, note = '') {
  const patch = { status, updatedAt: new Date().toISOString() };
  if (status === 'paid') patch.paidAt = new Date().toISOString();
  if (note) patch.adminNote = note;
  return writeOrder(id, patch);
}

export async function listOrders(limit = 200) {
  const ids = (await store.lrange('orders:index', 0, limit - 1)) || [];
  if (ids.length === 0) return [];
  // Un seul aller-retour Redis (MGET) au lieu d'une requête par commande :
  // cette liste est relue à chaque visite (comptage des ventes), sa latence
  // conditionne le temps de réponse de la page publique.
  const raws = (await store.mget(ids.map((id) => `order:${id}`))) || [];
  return raws
    .map((raw) => {
      if (!raw) return null;
      if (typeof raw !== 'string') return raw;
      try { return JSON.parse(raw); } catch (e) { return null; }
    })
    .filter(Boolean);
}

export async function clearOrders() {
  const ids = (await store.lrange('orders:index', 0, 999)) || [];
  await Promise.all(ids.map((id) => store.del(`order:${id}`)));
  await store.del('orders:index');
}

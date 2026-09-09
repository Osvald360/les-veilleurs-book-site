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
  const orders = await Promise.all(ids.map((id) => getOrder(id)));
  return orders.filter(Boolean);
}

export async function clearOrders() {
  const ids = (await store.lrange('orders:index', 0, 999)) || [];
  await Promise.all(ids.map((id) => store.del(`order:${id}`)));
  await store.del('orders:index');
}

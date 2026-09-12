import { waitUntil } from '@vercel/functions';
import { store, storageReady } from './_lib/store.js';
import { listOrders } from './_lib/orders.js';
import { getSettings, getPrice } from './_lib/settings.js';
import { sweepPendingSingpay } from './_lib/singpay.js';

// Endpoint public : état de la vente, compte à rebours et exemplaires restants.
// Tout est piloté depuis le tableau de bord (onglet Système → Contrôle de la vente).

const DEFAULT_TOTAL = 200;
const DEFAULT_HOURS = 24;

function num(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// État complet de la vente, calculé côté serveur pour que tous les
// visiteurs voient exactement la même chose.
export async function saleState() {
  const now = Date.now();

  const startRaw = await store.get('launchTime');
  const hours = num(await store.get('launchDurationHours'), DEFAULT_HOURS);
  const total = num(await store.get('stockTotal'), DEFAULT_TOTAL);
  const forcedClosed = (await store.get('saleClosed')) ? true : false;

  let sold = 0;
  try {
    const orders = await listOrders(1000);
    sold = orders.filter((o) => o && o.status === 'paid').length;
  } catch (e) {}
  const remaining = Math.max(0, total - sold);

  // Pas encore de date d'ouverture : la vente n'a jamais été lancée.
  const start = startRaw === null || startRaw === undefined || startRaw === '' ? null : Number(startRaw);
  const end = start === null ? null : start + hours * 3600 * 1000;

  let status;
  if (forcedClosed) status = 'closed';
  else if (start === null) status = 'idle';         // jamais lancée
  else if (now < start) status = 'scheduled';        // ouverture programmée
  else if (now >= end) status = 'ended';             // temps écoulé
  else if (total > 0 && remaining <= 0) status = 'soldout';
  else status = 'open';

  return {
    now,
    status,
    open: status === 'open',
    startTs: start,
    endTs: end,
    durationHours: hours,
    forcedClosed,
    total,
    sold,
    remaining,
    price: getPrice(await getSettings()),
  };
}

export default async function handler(req, res) {
  if (!storageReady) {
    const now = Date.now();
    return res.status(200).json({
      now, status: 'open', open: true,
      startTs: now, endTs: now + DEFAULT_HOURS * 3600 * 1000,
      durationHours: DEFAULT_HOURS,
      total: DEFAULT_TOTAL, sold: 0, remaining: DEFAULT_TOTAL,
      price: { eur: 19.90, xaf: 13000 },
      degraded: true,
    });
  }
  try {
    const state = await saleState();
    // Filet de sécurité : re-vérifie les paiements mobile money restés en
    // attente (au plus une fois par minute, voir _lib/singpay.js), pour
    // confirmer même si l'acheteur a fermé la page avant la confirmation.
    // En arrière-plan (waitUntil) : le balayage peut prendre plusieurs
    // secondes (vérifications SingPay + e-mails) et, attendu ici, il faisait
    // expirer la requête — la page restait alors figée sur « -- ».
    try {
      waitUntil(sweepPendingSingpay({
        host: req.headers['x-forwarded-host'] || req.headers.host,
        protocol: req.headers['x-forwarded-proto'] || 'https',
      }));
    } catch (e) {}
    return res.status(200).json({ ...state, degraded: false });
  } catch (e) {
    const now = Date.now();
    return res.status(200).json({
      now, status: 'open', open: true,
      startTs: now, endTs: now + DEFAULT_HOURS * 3600 * 1000,
      durationHours: DEFAULT_HOURS,
      total: DEFAULT_TOTAL, sold: 0, remaining: DEFAULT_TOTAL,
      price: { eur: 19.90, xaf: 13000 },
      degraded: true,
    });
  }
}

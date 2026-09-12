import { waitUntil } from '@vercel/functions';
import { store, storageReady } from './_lib/store.js';
import { listOrders } from './_lib/orders.js';
import { getSettings, getPrice } from './_lib/settings.js';
import { sweepPendingSingpay } from './_lib/singpay.js';
import { sweepPendingStripe } from './_lib/stripesweep.js';

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

  // Tout est lu en parallèle : chaque aller-retour Redis évité compte pour
  // les visiteurs sur connexion mobile lente.
  const [startRaw, hoursRaw, totalRaw, closedRaw, ordersRes] = await Promise.all([
    store.get('launchTime'),
    store.get('launchDurationHours'),
    store.get('stockTotal'),
    store.get('saleClosed'),
    listOrders(1000).catch(() => []),
  ]);
  const hours = num(hoursRaw, DEFAULT_HOURS);
  const total = num(totalRaw, DEFAULT_TOTAL);
  const forcedClosed = closedRaw ? true : false;
  const sold = ordersRes.filter((o) => o && o.status === 'paid').length;
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
    res.setHeader('Cache-Control', 'no-store'); // réponse de secours : ne jamais la mettre en cache
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
      const sweepCtx = {
        host: req.headers['x-forwarded-host'] || req.headers.host,
        protocol: req.headers['x-forwarded-proto'] || 'https',
      };
      // Mobile money puis cartes, l'un après l'autre : les commandes
      // restées « en attente » se confirment toutes seules, e-mail compris.
      waitUntil(sweepPendingSingpay(sweepCtx).then(() => sweepPendingStripe(sweepCtx)));
    } catch (e) {}
    // Cache CDN : le bord Vercel sert cet état pendant 5 s (et jusqu'à 60 s
    // en le rafraîchissant en arrière-plan, 10 min si la fonction est en
    // erreur). Les visiteurs — notamment sur mobile au Gabon — reçoivent
    // une réponse quasi instantanée même quand la fonction est lente.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=60, stale-if-error=600');
    return res.status(200).json({ ...state, degraded: false });
  } catch (e) {
    const now = Date.now();
    res.setHeader('Cache-Control', 'no-store'); // réponse de secours : ne jamais la mettre en cache
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

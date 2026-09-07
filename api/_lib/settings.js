import { store } from './store.js';

const SETTINGS_KEY = 'paymentSettings';

const FIELDS = [
  'stripeSecretKey',
  'stripePublishableKey',
  'stripeWebhookSecret',
  'paypalClientId',
  'paypalClientSecret',
  'paypalMode', // "sandbox" | "live"
  // SingPay (Airtel Money / Moov Money — agrégateur gabonais)
  'singpayClientId',
  'singpayClientSecret',
  'singpayWallet',
  'singpayDisbursement',
  // Prix du livre (modifiable depuis le tableau de bord)
  'priceEur',        // ex. "19.90" — prix en euros (Stripe, PayPal, affichage)
  'priceXaf',        // ex. "13000" — prix en FCFA (Airtel/Moov via SingPay)
];

const SECRET_FIELDS = ['stripeSecretKey', 'stripeWebhookSecret', 'paypalClientSecret', 'singpayClientSecret'];

export async function getSettings() {
  const raw = await store.get(SETTINGS_KEY);
  const data = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
  const full = {};
  for (const f of FIELDS) full[f] = data[f] || '';
  return full;
}

// Version sûre à renvoyer au navigateur : jamais la valeur des secrets,
// seulement un booléen "configuré ou non".
export async function getPublicSettingsStatus() {
  const s = await getSettings();
  const status = {};
  for (const f of FIELDS) {
    status[f] = SECRET_FIELDS.includes(f) ? Boolean(s[f]) : s[f] || '';
  }
  return status;
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const updated = { ...current };
  for (const f of FIELDS) {
    // On ne remplace un champ que si une nouvelle valeur non vide est envoyée,
    // pour ne pas écraser un secret déjà enregistré avec un champ laissé vide.
    if (partial[f] !== undefined && partial[f] !== '') {
      updated[f] = partial[f];
    }
  }
  await store.set(SETTINGS_KEY, JSON.stringify(updated));
  return updated;
}

export function readinessFromSettings(s) {
  return {
    card: Boolean(s.stripeSecretKey && s.stripePublishableKey),
    applepay: Boolean(s.stripeSecretKey && s.stripePublishableKey),
    paypal: Boolean(s.paypalClientId && s.paypalClientSecret),
    airtel: Boolean(s.singpayClientId && s.singpayClientSecret && s.singpayWallet),
    moov: Boolean(s.singpayClientId && s.singpayClientSecret && s.singpayWallet),
  };
}

// Prix courant, avec valeurs par défaut si rien n'est réglé.
export function getPrice(settings) {
  const eur = Number(String(settings.priceEur || '').replace(',', '.'));
  const xaf = parseInt(settings.priceXaf, 10);
  return {
    eur: Number.isFinite(eur) && eur > 0 ? eur : 19.90,
    xaf: Number.isFinite(xaf) && xaf > 0 ? xaf : 13000,
  };
}

import { getSettings, readinessFromSettings } from './_lib/settings.js';

export default async function handler(req, res) {
  try {
    const settings = await getSettings();
    return res.status(200).json(readinessFromSettings(settings));
  } catch (e) {
    // Base injoignable : aucun moyen de paiement n'est annoncé plutôt
    // que de laisser un acheteur s'engager dans un parcours qui échouera.
    return res.status(200).json({ card: false, applepay: false, paypal: false, airtel: false, moov: false });
  }
}

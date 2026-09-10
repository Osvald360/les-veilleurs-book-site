import crypto from 'crypto';
import { getSettings } from '../_lib/settings.js';
import { markOrderPaid, getOrder, updateOrder } from '../_lib/orders.js';
import { sendThankYouEmail } from '../_lib/thankyou.js';

// Stripe exige le corps brut (non parsé) pour vérifier la signature.
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const signedPayload = `${parts.t}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return expected === parts.v1;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await readRawBody(req);

  // Réglages injoignables → 500 : Stripe retentera. Valider sans avoir pu
  // vérifier la signature serait une faille.
  let settings;
  try {
    settings = await getSettings();
  } catch (e) {
    return res.status(500).json({ error: 'settings_unavailable' });
  }

  if (settings.stripeWebhookSecret) {
    const valid = verifyStripeSignature(raw, req.headers['stripe-signature'], settings.stripeWebhookSecret);
    if (!valid) return res.status(400).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch (e) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  // Deux événements Stripe confirment un paiement selon la configuration
  // de l'endpoint ; l'ID de commande est posé sur les deux objets.
  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    if (orderId) {
      const order = await getOrder(orderId);
      if (order && order.status !== 'paid') {
        await markOrderPaid(orderId, { method: 'card', provider: 'stripe' });
        // E-mail une seule fois, marqué sur la commande pour qu'un
        // marquage manuel ultérieur ne le renvoie pas en double.
        if (order.email && !order.thankYouSent) {
          const host = req.headers['x-forwarded-host'] || req.headers.host;
          const protocol = req.headers['x-forwarded-proto'] || 'https';
          const sent = await sendThankYouEmail({ firstName: order.firstName, email: order.email, host, protocol });
          if (sent && sent.ok) {
            await updateOrder(orderId, { thankYouSent: new Date().toISOString() });
          }
        }
      }
    }
  }

  return res.status(200).json({ received: true });
}

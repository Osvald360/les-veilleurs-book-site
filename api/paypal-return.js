import { getSettings } from './_lib/settings.js';
import { getOrder, markOrderPaid } from './_lib/orders.js';
import { sendThankYouEmail } from './_lib/thankyou.js';

// PayPal redirige ici le navigateur de l'acheteur une fois qu'il a approuvé
// le paiement. On capture (encaisse) le paiement à ce moment précis —
// c'est cette étape, et non le clic initial, qui confirme l'argent reçu.
export default async function handler(req, res) {
  const { token, orderId } = req.query; // "token" = l'ID de commande PayPal renvoyé par PayPal
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${protocol}://${host}`;

  if (!token) {
    res.writeHead(302, { Location: `${origin}/?paiement=erreur` });
    return res.end();
  }

  try {
    const settings = await getSettings();
    const base = settings.paypalMode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

    const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${settings.paypalClientId}:${settings.paypalClientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json();

    const captureRes = await fetch(`${base}/v2/checkout/orders/${token}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
    });
    const captureData = await captureRes.json();

    const status = captureData.status;
    const custom = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id || orderId;

    if (status === 'COMPLETED' && custom) {
      const order = await getOrder(custom);
      if (order && order.status !== 'paid') {
        await markOrderPaid(custom, { method: 'paypal', provider: 'paypal' });
        await sendThankYouEmail({ firstName: order.firstName, email: order.email, host, protocol });
      }
      res.writeHead(302, { Location: `${origin}/?paiement=succes` });
      return res.end();
    }

    res.writeHead(302, { Location: `${origin}/?paiement=erreur` });
    return res.end();
  } catch (e) {
    res.writeHead(302, { Location: `${origin}/?paiement=erreur` });
    return res.end();
  }
}

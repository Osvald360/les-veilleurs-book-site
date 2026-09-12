import { getSettings, getPrice } from './_lib/settings.js';
import { getOrder, updateOrder } from './_lib/orders.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { method, orderId } = req.body || {};
  if (!method || !orderId) return res.status(400).json({ error: 'missing_fields' });

  const order = await getOrder(orderId);
  if (!order) return res.status(404).json({ error: 'order_not_found' });

  // Le moyen tenté est mémorisé sur la commande : le tableau de bord peut
  // ainsi identifier chaque paiement, y compris resté en attente.
  if (['card', 'applepay', 'paypal', 'airtel', 'moov'].includes(method)) {
    try { await updateOrder(orderId, { lastMethod: method }); } catch (e) {}
  }

  const settings = await getSettings();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${protocol}://${host}`;

  const price = getPrice(settings);
  const PRICE_EUR = Math.round(price.eur * 100); // centimes pour Stripe

  try {
    if (method === 'card' || method === 'applepay') {
      if (!settings.stripeSecretKey) return res.status(200).json({ ready: false });
      const params = new URLSearchParams({
        mode: 'payment',
        'line_items[0][price_data][currency]': 'eur',
        'line_items[0][price_data][unit_amount]': String(PRICE_EUR),
        'line_items[0][price_data][product_data][name]': "Les Veilleurs et l'étude des signes",
        'line_items[0][quantity]': '1',
        customer_email: order.email,
        success_url: `${origin}/?paiement=succes`,
        cancel_url: `${origin}/?paiement=annule`,
        'metadata[orderId]': orderId,
        // L'ID de commande est aussi posé sur le PaymentIntent : le webhook
        // retrouve ainsi la commande quel que soit l'événement écouté
        // (checkout.session.completed ou payment_intent.succeeded).
        'payment_intent_data[metadata][orderId]': orderId,
      });
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });
      const data = await r.json();
      if (!r.ok) {
        // Raison exacte du refus de Stripe : à l'écran et dans les logs.
        console.error('stripe_error', r.status, data.error?.message);
        return res.status(200).json({ ready: false, error: 'stripe_error', detail: data.error?.message || `HTTP ${r.status}` });
      }
      return res.status(200).json({ ready: true, url: data.url });
    }

    if (method === 'paypal') {
      if (!settings.paypalClientId || !settings.paypalClientSecret) return res.status(200).json({ ready: false });
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
      if (!tokenRes.ok) {
        console.error('paypal_auth_failed', tokenRes.status, JSON.stringify(tokenData));
        return res.status(200).json({
          ready: false,
          error: 'paypal_auth_failed',
          detail: 'Identifiants PayPal refusés' + (settings.paypalMode !== 'live' ? ' (mode test/sandbox actif)' : '') + '.',
        });
      }

      const orderRes = await fetch(`${base}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ custom_id: orderId, amount: { currency_code: 'EUR', value: price.eur.toFixed(2) } }],
          application_context: {
            return_url: `${origin}/api/paypal-return?orderId=${orderId}`,
            cancel_url: `${origin}/?paiement=annule`,
            brand_name: 'Les Veilleurs',
            user_action: 'PAY_NOW',
          },
        }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) {
        console.error('paypal_order_failed', orderRes.status, JSON.stringify(orderData));
        const ppDetail = (orderData.details && orderData.details[0] && orderData.details[0].description) || orderData.message;
        return res.status(200).json({ ready: false, error: 'paypal_order_failed', detail: ppDetail || `HTTP ${orderRes.status}` });
      }
      const approveLink = (orderData.links || []).find((l) => l.rel === 'approve');
      return res.status(200).json({ ready: true, url: approveLink?.href });
    }

    if (method === 'airtel' || method === 'moov') {
      // SingPay (agrégateur gabonais). Airtel Money = endpoint /74, Moov = /62.
      // Le paiement se fait par push USSD : le client valide sur son téléphone,
      // il n'y a donc pas de page de redirection. SingPay confirme ensuite via
      // le callback configuré sur le portefeuille (voir api/webhook/singpay.js).
      if (!settings.singpayClientId || !settings.singpayClientSecret || !settings.singpayWallet) {
        return res.status(200).json({ ready: false });
      }
      if (!order.phone) {
        return res.status(200).json({ ready: false, error: 'phone_required' });
      }

      // Montant en FCFA (XAF). 19,90 € ≈ 13 000 FCFA — ajustable dans les réglages.
      const amountXAF = price.xaf;
      const endpoint = method === 'airtel'
        ? 'https://gateway.singpay.ga/v1/74/paiement'
        : 'https://gateway.singpay.ga/v1/62/paiement';

      // Numéro au format attendu par SingPay : chiffres uniquement, en
      // format local gabonais. Les acheteurs saisissent souvent leur numéro
      // en international (+241 74 XX XX XX) : on retire le préfixe pays et
      // on rétablit le 0 initial des numéros à 9 chiffres.
      let msisdn = String(order.phone).replace(/[^0-9]/g, '');
      if (msisdn.startsWith('00241')) msisdn = msisdn.slice(5);
      else if (msisdn.startsWith('241') && msisdn.length > 9) msisdn = msisdn.slice(3);
      if (msisdn.length === 8) msisdn = '0' + msisdn;

      // Le montant facturé est figé sur la commande AVANT le push : le
      // webhook vérifiera le règlement contre cette valeur, même si le
      // prix affiché change entre le push et la confirmation.
      await updateOrder(orderId, { amountXAF, provider: 'singpay' });

      const body = {
        amount: amountXAF,
        reference: orderId,
        client_msisdn: msisdn,
        portefeuille: settings.singpayWallet,
        isTransfer: false,
      };
      if (settings.singpayDisbursement) body.disbursement = settings.singpayDisbursement;

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-client-id': settings.singpayClientId,
          'x-client-secret': settings.singpayClientSecret,
          'x-wallet': settings.singpayWallet,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      let data = {};
      try { data = await r.json(); } catch (e) {}

      if (!r.ok) {
        // Trace complète dans les logs Vercel pour diagnostiquer un refus
        // de la passerelle (identifiants, portefeuille, format du numéro…).
        console.error('singpay_error', r.status, JSON.stringify(data));
        const detail = data && (data.message || data.error);
        return res.status(200).json({
          ready: false,
          error: 'singpay_error',
          detail: (Array.isArray(detail) ? detail.join(', ') : detail) || `HTTP ${r.status}`,
        });
      }

      // L'identifiant de transaction SingPay est mémorisé sur la commande :
      // il permet au site de vérifier lui-même l'aboutissement du paiement
      // (endpoint /api/singpay-status), sans dépendre du callback.
      const txId = data && data.transaction && data.transaction.id ? String(data.transaction.id) : null;
      if (txId) {
        try { await updateOrder(orderId, { singpayTxId: txId }); } catch (e) {}
      }

      // Paiement lancé : le client doit maintenant valider sur son téléphone.
      // On ne redirige pas ; on affiche une consigne d'attente côté navigateur.
      return res.status(200).json({
        ready: true,
        push: true,
        message: 'Une demande de paiement a été envoyée sur votre téléphone. Composez votre code ' +
                 (method === 'airtel' ? 'Airtel Money' : 'Moov Money') + ' pour valider.',
        reference: orderId,
      });
    }

    return res.status(400).json({ error: 'unknown_method' });
  } catch (e) {
    console.error('checkout_exception', method, e && e.message);
    return res.status(200).json({ ready: false, error: 'exception', detail: 'Erreur interne : ' + ((e && e.message) || 'inconnue') });
  }
}

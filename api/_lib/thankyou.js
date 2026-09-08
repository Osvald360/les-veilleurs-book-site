// E-mail de confirmation envoyé automatiquement dès qu'une commande passe
// en « payée » (webhooks SingPay/Stripe, retour PayPal, ou marquage manuel
// depuis le tableau de bord). Texte fixe validé par l'équipe éditoriale.
//
// Deux modes d'envoi, dans cet ordre de priorité :
//   1. Gmail (GMAIL_USER + GMAIL_APP_PASSWORD) — mot de passe d'application
//      Google, pour envoyer depuis une adresse @gmail.com.
//   2. Resend (RESEND_API_KEY + RESEND_FROM_EMAIL) — nécessite un domaine
//      vérifié chez Resend.

const SUBJECT = 'Votre exemplaire est réservé : Les Veilleurs et l’Étude des Signes';

function buildMessage(firstName) {
  const bonjour = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  return `${bonjour}

Félicitations ! Vous faites partie des 120 personnes qui ont pu se procurer « Les Veilleurs et l’Étude des Signes » de Mgr Michel Ambouroue.

Votre paiement a bien été reçu et votre exemplaire vous est désormais réservé.

Vous le recevrez sous 15 jours, à l’adresse que vous avez renseignée lors de votre commande. Les frais de livraison sont déjà compris dans le montant que vous avez réglé.

Pour toute question, vous pouvez nous joindre au +241 74 64 38 38.

Merci pour votre confiance, et pour avoir répondu à cet appel.

Bien à vous,`;
}

const SIGNATURE = 'Équipe Éditoriale Mgr Michel Ambouroue';

export async function sendThankYouEmail({ firstName, email, host, protocol = 'https' }) {
  const gmailReady = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  if (!gmailReady && !process.env.RESEND_API_KEY) {
    return { ok: false, skipped: 'missing_api_keys' };
  }
  try {
    const message = buildMessage((firstName || '').trim());
    const photoUrl = `${protocol}://${host}/author-email.jpg`;

    // Mise en page en tableaux : c'est la seule structure fiable dans les
    // logiciels de messagerie (Gmail, Outlook, Apple Mail...). Flexbox,
    // object-fit et border-radius n'y sont pas pris en charge.
    const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paragraphs = safe
      .split(/\n\s*\n/)
      .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.75;color:#ECE7DA;">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');

    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Votre exemplaire est réservé</title></head>
<body style="margin:0;padding:0;background:#0A0E16;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A0E16;">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:#10151F;border:1px solid #2A3345;">
      <tr><td style="padding:38px 38px 8px;font-family:Georgia,'Times New Roman',serif;">
        <p style="margin:0 0 22px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C9A961;font-family:Arial,Helvetica,sans-serif;">Les Veilleurs &middot; Mgr Michel Ambouroue</p>
        ${paragraphs}
      </td></tr>
      <tr><td style="padding:14px 38px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #2A3345;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
      <tr><td style="padding:22px 38px 34px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="64" valign="top" style="padding-right:16px;">
              <img src="${photoUrl}" width="64" height="96" alt="Mgr Michel Ambouroue" style="display:block;width:64px;height:96px;border:0;outline:none;text-decoration:none;">
            </td>
            <td valign="middle" style="font-family:Georgia,'Times New Roman',serif;">
              <p style="margin:0;font-size:15px;color:#E8D9AE;">&Eacute;quipe &Eacute;ditoriale Mgr Michel Ambouroue</p>
              <p style="margin:4px 0 0;font-size:12px;color:#9AA1AE;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">+241&nbsp;74&nbsp;64&nbsp;38&nbsp;38</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    const text = message + '\n\n' + SIGNATURE;

    if (gmailReady) {
      const { default: nodemailer } = await import('nodemailer');
      const transport = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      });
      await transport.sendMail({
        from: `"Les Veilleurs — Équipe Éditoriale" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: SUBJECT,
        html,
        text,
      });
      return { ok: true };
    }

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: email,
        subject: SUBJECT,
        html,
        text,
      }),
    });
    if (!sendRes.ok) return { ok: false, skipped: 'email_error', detail: await sendRes.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, skipped: 'exception', detail: e && e.message };
  }
}

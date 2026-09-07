export async function sendThankYouEmail({ firstName, email, host, protocol = 'https' }) {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.RESEND_API_KEY) {
    return { ok: false, skipped: 'missing_api_keys' };
  }
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system:
          "Tu écris au nom de Michel Ambouroue, évêque et auteur du livre " +
          "« Les Veilleurs et l'étude des signes ». Ton style est pastoral, " +
          "chaleureux, empreint de gravité spirituelle mais jamais grandiloquent. " +
          "Tu rédiges un court message de remerciement personnel à un lecteur " +
          "qui vient d'acheter et de payer le livre. 90 à 130 mots. Une seule " +
          "fois le prénom du lecteur, pas de formule commerciale, pas d'emoji. " +
          "Termine par une phrase de bénédiction courte. Ne signe pas.",
        messages: [
          { role: 'user', content: `Rédige le message de remerciement pour ${firstName}, dont le paiement vient d'être confirmé.` },
        ],
      }),
    });
    if (!aiRes.ok) return { ok: false, skipped: 'ai_error' };
    const aiData = await aiRes.json();
    const message =
      (aiData.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() ||
      `Cher/Chère ${firstName}, merci d'avoir accueilli « Les Veilleurs » dans ta vie.`;

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
<title>Merci</title></head>
<body style="margin:0;padding:0;background:#0A0E16;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0A0E16;">
  <tr><td align="center" style="padding:36px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:#10151F;border:1px solid #2A3345;">
      <tr><td style="padding:38px 38px 8px;font-family:Georgia,'Times New Roman',serif;">
        <p style="margin:0 0 22px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#C9A961;font-family:Arial,Helvetica,sans-serif;">Les Veilleurs &middot; Michel Ambouroue</p>
        ${paragraphs}
      </td></tr>
      <tr><td style="padding:14px 38px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #2A3345;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
      <tr><td style="padding:22px 38px 34px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="64" valign="top" style="padding-right:16px;">
              <img src="${photoUrl}" width="64" height="96" alt="Michel Ambouroue" style="display:block;width:64px;height:96px;border:0;outline:none;text-decoration:none;">
            </td>
            <td valign="middle" style="font-family:Georgia,'Times New Roman',serif;">
              <p style="margin:0;font-size:15px;color:#E8D9AE;">Michel Ambouroue</p>
              <p style="margin:4px 0 0;font-size:12px;color:#9AA1AE;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">&Eacute;v&ecirc;que &middot; Christ R&eacute;v&eacute;l&eacute; aux Nations<br>CRN &Eacute;ditions</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: email,
        subject: 'Merci d\u2019avoir accueilli « Les Veilleurs »',
        html,
        text: message + '\n\n—\nMichel Ambouroue\nÉvêque · Christ Révélé aux Nations\nCRN Éditions',
      }),
    });
    if (!sendRes.ok) return { ok: false, skipped: 'email_error', detail: await sendRes.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, skipped: 'exception' };
  }
}

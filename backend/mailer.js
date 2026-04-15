"use strict";
const nodemailer = require("nodemailer");

// ── Transporter SMTP ──────────────────────────────────────────────────────────
// Supporte Gmail (avec mot de passe d'application) ou n'importe quel SMTP.
// Variables requises dans backend/.env :
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//   MAIL_FROM  → ex: "SMM Studio <noreply@ton-domaine.com>"
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port:   Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass },
  });
}

// ── Mail de bienvenue ─────────────────────────────────────────────────────────
async function sendWelcomeMail(email) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("[mailer] SMTP non configuré — mail de bienvenue non envoyé.");
    return;
  }

  const from    = process.env.MAIL_FROM || process.env.SMTP_USER;
  const appName = process.env.APP_NAME  || "SMM Studio";
  const appUrl  = process.env.APP_URL   || "http://localhost:3000";

  await transporter.sendMail({
    from,
    to: email,
    subject: `Bienvenue sur ${appName} 🎙️`,
    text: `
Bonjour,

Ton compte ${appName} vient d'être créé avec succès.

Tu peux dès maintenant transcrire tes fichiers audio et vidéo en .srt :
${appUrl}

Quota gratuit : 3 transcriptions par jour.

À bientôt,
L'équipe ${appName}
    `.trim(),
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1d27;border-radius:12px;overflow:hidden;max-width:560px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#6c63ff,#a78bfa);padding:36px 40px;text-align:center;">
            <div style="display:inline-block;width:48px;height:48px;background:rgba(255,255,255,.15);border-radius:12px;line-height:48px;font-size:22px;font-weight:700;color:#fff;margin-bottom:12px;">SS</div>
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;letter-spacing:-.3px;">${appName}</h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <h2 style="margin:0 0 12px;color:#f1f1f3;font-size:20px;font-weight:600;">Bienvenue ! 🎉</h2>
            <p style="margin:0 0 20px;color:#9ca3af;font-size:15px;line-height:1.6;">
              Ton compte a été créé avec succès. Tu peux dès maintenant transcrire tes fichiers audio et vidéo en <strong style="color:#a78bfa;">.srt</strong> directement depuis l'app.
            </p>

            <!-- Quota box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1117;border-radius:8px;margin:0 0 28px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.8px;">Quota gratuit</p>
                  <p style="margin:0;color:#f1f1f3;font-size:16px;font-weight:600;">3 transcriptions / jour</p>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#6c63ff;border-radius:8px;">
                  <a href="${appUrl}" style="display:inline-block;padding:13px 28px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-.1px;">
                    Ouvrir ${appName} →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #2a2d3a;">
            <p style="margin:0;color:#4b5563;font-size:12px;line-height:1.5;">
              Tu reçois ce mail parce qu'un compte a été créé avec cette adresse.<br>
              Si ce n'est pas toi, ignore simplement ce message.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });

  console.log(`[mailer] Mail de bienvenue envoyé à ${email}`);
}

module.exports = { sendWelcomeMail };

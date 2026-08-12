/**
 * Sends Ava verification emails via Resend (preferred) or SMTP.
 */

function appUrl() {
  return (process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || 8765}`).replace(/\/$/, "");
}

function mailFrom() {
  return (
    process.env.MAIL_FROM ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_USER ||
    "Ava <onboarding@resend.dev>"
  );
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

export function mailReady() {
  return resendConfigured() || smtpConfigured();
}

export function verificationLink(token) {
  return `${appUrl()}/verify.html?token=${encodeURIComponent(token)}`;
}

function buildBodies(name, link) {
  const subject = "Verify your Ava account";
  const text = `Hi ${name},

Confirm your Ava account by opening this link:
${link}

This link expires in 24 hours. If you didn’t sign up, you can ignore this email.`;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0b0b0b;color:#f3f0e8;font-family:Syne,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b0b;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:480px;background:#111;border:1px solid #23221e;border-radius:16px;padding:28px 24px;">
          <tr><td style="font-family:Georgia,serif;font-size:28px;padding-bottom:8px;">Ava</td></tr>
          <tr><td style="font-size:15px;line-height:1.5;color:#cfc9bb;padding-bottom:20px;">
            Hi ${escapeHtml(name)}, click the button below to verify your email and create your account.
          </td></tr>
          <tr><td align="center" style="padding-bottom:22px;">
            <a href="${link}"
               style="display:inline-block;background:#ece6d6;color:#111;text-decoration:none;font-weight:700;font-size:14px;padding:14px 22px;border-radius:999px;">
              Verify email &amp; create account
            </a>
          </td></tr>
          <tr><td style="font-size:12px;line-height:1.5;color:#8d897f;">
            Or paste this link into your browser:<br/>
            <span style="word-break:break-all;color:#cfc9bb;">${link}</span>
            <br/><br/>This link expires in 24 hours.
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

async function sendWithResend({ to, subject, text, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [to],
      subject,
      text,
      html,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message || data?.error || `Resend failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function sendWithSmtp({ to, subject, text, html }) {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  await transport.sendMail({
    from: mailFrom(),
    to,
    subject,
    text,
    html,
  });
}

export async function sendVerificationEmail({ to, name, token }) {
  const link = verificationLink(token);
  const { subject, text, html } = buildBodies(name, link);

  if (!mailReady()) {
    console.warn("[ava mail] No RESEND_API_KEY or SMTP configured. Verification link:");
    console.warn(link);
    return { sent: false, link, reason: "Email provider not configured" };
  }

  try {
    if (resendConfigured()) {
      await sendWithResend({ to, subject, text, html });
      console.log(`[ava mail] Verification email sent via Resend to ${to}`);
      return { sent: true, link, provider: "resend" };
    }
    await sendWithSmtp({ to, subject, text, html });
    console.log(`[ava mail] Verification email sent via SMTP to ${to}`);
    return { sent: true, link, provider: "smtp" };
  } catch (err) {
    console.error("[ava mail] send failed:", err.message || err);
    return { sent: false, link, reason: err.message || "send failed" };
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

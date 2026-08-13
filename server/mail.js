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

function relayConfigured() {
  return Boolean(process.env.MAIL_RELAY_URL && process.env.MAIL_RELAY_SECRET);
}

function resendFrom() {
  const from = mailFrom();
  const email = parseFrom(from).email.toLowerCase();
  if (email.endsWith("@resend.dev")) return from;
  return process.env.RESEND_FROM || "Ava <onboarding@resend.dev>";
}

function parseFrom(from) {
  const raw = String(from || "").trim();
  const match = raw.match(/^(.*)<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, "") || "Ava", email: match[2].trim() };
  }
  if (raw.includes("@")) return { name: "Ava", email: raw };
  return { name: "Ava", email: "hello@isexperience.house" };
}

export function mailReady() {
  return relayConfigured() || resendConfigured() || smtpConfigured();
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

async function sendWithRelay({ to, subject, text, html }) {
  const from = parseFrom(mailFrom());
  const res = await fetch(process.env.MAIL_RELAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ava-Mail-Secret": process.env.MAIL_RELAY_SECRET,
    },
    body: JSON.stringify({
      secret: process.env.MAIL_RELAY_SECRET,
      to,
      subject,
      text,
      html,
      from: mailFrom(),
      fromName: from.name,
      replyTo: from.email,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Mail relay failed (${res.status})`);
  }
  return data;
}

async function sendWithResend({ to, subject, text, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resendFrom(),
      to: [to],
      subject,
      text,
      html,
      reply_to: parseFrom(mailFrom()).email,
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
    console.warn("[ava mail] No mail relay, RESEND_API_KEY, or SMTP configured. Verification link:");
    console.warn(link);
    return { sent: false, link, reason: "Email provider not configured" };
  }

  const attempts = [];
  if (relayConfigured()) attempts.push(["relay", sendWithRelay]);
  if (resendConfigured()) attempts.push(["resend", sendWithResend]);
  if (smtpConfigured()) attempts.push(["smtp", sendWithSmtp]);

  const errors = [];
  for (const [provider, send] of attempts) {
    try {
      await send({ to, subject, text, html });
      console.log(`[ava mail] Verification email sent via ${provider} to ${to}`);
      return { sent: true, link, provider };
    } catch (err) {
      const message = err.message || String(err);
      console.error(`[ava mail] ${provider} failed:`, message);
      errors.push(`${provider}: ${message}`);
    }
  }

  return { sent: false, link, reason: errors.join(" | ") || "send failed" };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

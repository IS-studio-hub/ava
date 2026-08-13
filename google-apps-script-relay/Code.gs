/**
 * Ava signup verification mail relay (Google Apps Script).
 *
 * 1. script.google.com → New project → paste this file
 * 2. Deploy → New deployment → Web app
 *    Execute as: Me
 *    Who has access: Anyone
 * 3. Copy the web app URL into Railway / .env as MAIL_RELAY_URL
 */
const SECRET = "ava-mail-7f3c91e2a8b04d6e9c12f55a0e8d4b17";
const DEFAULT_REPLY_TO = "hello@isexperience.house";

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ error: "Missing body" });
    }

    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) {
      return json({ error: "Forbidden" });
    }

    const to = body.to;
    const subject = body.subject;
    const html = body.html || "";
    const text = body.text || "";
    const fromName = body.fromName || "Ava";
    const replyTo = body.replyTo || DEFAULT_REPLY_TO;

    if (!to || !subject) {
      return json({ error: "Missing to or subject" });
    }

    sendVerificationEmail_(to, subject, text, html, fromName, replyTo);
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err) });
  }
}

function sendVerificationEmail_(to, subject, text, html, fromName, replyTo) {
  GmailApp.sendEmail(to, subject, text, {
    htmlBody: html,
    name: fromName,
    replyTo: replyTo,
  });
}

function doGet() {
  return json({ ok: true, message: "Ava mail relay ready. Use POST." });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

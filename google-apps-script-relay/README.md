# Ava mail relay (Gmail)

Resend test mode can only email `shamrikin@gmail.com`. This relay sends verification mail to **any address** from your Gmail.

## Deploy (2 minutes)

1. Open [script.google.com](https://script.google.com) while signed in as the Gmail that should send (e.g. `hello@isexperience.house` or `shamrikin@gmail.com`).
2. **New project** → replace `Code.gs` with the file in this folder.
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the web app URL.

Then set on Railway / `.env`:

```
MAIL_RELAY_URL=https://script.google.com/macros/s/XXXX/exec
MAIL_RELAY_SECRET=ava-mail-7f3c91e2a8b04d6e9c12f55a0e8d4b17
MAIL_FROM=Ava <hello@isexperience.house>
```

Ava will use the relay first, then Resend, then SMTP.

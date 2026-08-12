# Ava — Letter Field

Kinetic typography studio: a dense field of small letters that form a big letter, word, or uploaded image. Includes accounts, library saves, embed codes, and video export.

## Run locally

```bash
npm install
cp .env.example .env
# Fill MongoDB, JWT, and email (Resend or SMTP) in .env
npm start
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

## Environment

See `.env.example`:

- `MONGODB_URI` — Atlas connection string (database **`ava`**: `users`, `saves`, `pending_users`)
- `JWT_SECRET` — session signing secret
- `APP_URL` — public origin used in verification emails
- `RESEND_API_KEY` + `MAIL_FROM` — verification email (or SMTP fallback)

Never commit `.env`.

## Pages

| Path | Purpose |
|---|---|
| `/` | Studio |
| `/library.html` | Saved pieces, embed + video download |
| `/embed.html?id=` | Public embed (stops if the save is deleted) |
| `/verify.html?token=` | Email verification |

## Deploy

This app is a Node/Express server (static files + `/api`). After cloning, set the same env vars on your host (Railway, Render, Fly, etc.) and run `npm start`.

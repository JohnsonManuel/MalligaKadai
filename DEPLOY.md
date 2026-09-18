# Deploying SparFuchs (free, on Render)

The app is a small Node server (`scripts/server.js`) that serves the frontend **and**
provides the API (`/api/offers` reads Postgres; `/admin` runs extractions). It needs a host
that runs Node — Render's **free web service** works and needs no credit card.

## One-time setup
1. Push to GitHub (already done).
2. Go to **render.com** → sign in with GitHub → **New → Blueprint** → pick this repo.
   Render reads `render.yaml` and creates a free web service.
3. Render will ask for the two secret env vars (they are **not** in the repo):
   - **`DATABASE_URL`** — your Aiven Postgres **Service URI** (from the Aiven console).
   - **`ADMIN_PASSWORD`** — the admin password (defaults to `88888888` if unset — set a stronger one here).
4. **Deploy.** You get a URL like `https://sparfuchs.onrender.com`.
   - App: `https://sparfuchs.onrender.com/`
   - Admin: `https://sparfuchs.onrender.com/admin`

That's it. The app reads offers from your Postgres; `/admin` (password-gated) lets you load/refresh regions.

## Good to know
- **Free tier sleeps** after ~15 min idle and cold-starts in ~30–50s on the next visit. Fine for a demo.
- **Data**: the deployed app reads the latest batch from Postgres via `DATABASE_URL`. Your DB already has
  data, so it works immediately. To refresh a region, open `/admin` and run it there.
- **Extraction on the host**: `/admin` spawns the kaufDA fetch and writes to Postgres — this works on a
  Render *web service* (a real container). It would **not** work on serverless (Vercel/Netlify functions).
- **The offer JSON files** in the repo are only a fallback if the DB is unreachable; Postgres is primary.
- **Env vars, not files**: the gitignored `config/database.local.json` isn't deployed — the host uses
  `DATABASE_URL`. Same for `ADMIN_PASSWORD`.

## Before sharing the link
- **Rotate the Aiven password** if it was ever shared in plaintext, then update `DATABASE_URL` in Render.
- Set a **real `ADMIN_PASSWORD`** (not `88888888`).
- Note: a public link serves scraped kaufDA data — fine for a small/private audience; a true public
  launch would need a licensed data source.

## Other free hosts
The same setup works on **Koyeb** (free web service, no sleep) or **Fly.io** (needs a card on file).
Any host that runs `node scripts/server.js` with a `PORT` env var and your two env vars will work.

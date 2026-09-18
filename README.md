# 🦊 SparFuchs

Search **real German supermarket offers** in your region, star your favorite products, and see
**which supermarket has each one cheapest this week**. Favorites are the actual products *you* pick,
saved locally in your browser.

## How it's built

```
┌──────────────────────────┐  writes  ┌────────────────────────────────┐  reads  ┌──────────────────┐
│  Data pipeline (Node)     │ ───────▶ │ data/kaufda/<zip>/             │ ──────▶ │  Static frontend  │
│  scripts/fetch-kaufda.js  │  weekly  │   offers-latest.json           │         │  index.html/js/css│
└──────────────────────────┘          └────────────────────────────────┘         └──────────────────┘
        ▲ triggered by                                                                     ▲ served by
        └──────────────────────  scripts/server.js  (/admin panel + /api) ─────────────────┘
```

- **Frontend** — plain static HTML/CSS/JS. Reads `data/kaufda/<zip>/offers-latest.json`. Deploys to any static host.
- **Data pipeline** — pulls real offers from kaufDA (see below), writes the JSON. Run weekly.
- **Server** — `scripts/server.js` serves the app **and** an **admin panel** to run the extraction and see data readiness.

## Run locally

```bash
npm run serve   # http://localhost:4173  (app)  ·  http://localhost:4173/admin  (admin)
npm run fetch   # run the kaufDA extraction from the CLI (same as the admin button)
```

Open <http://localhost:4173> (use the server, not the file directly).

## Deploy (free — Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/JohnsonManuel/MalligaKadai)

1. Click the button (or Render → **New → Blueprint** → pick this repo). Render reads `render.yaml`.
2. Set the two secrets it asks for:
   - **`DATABASE_URL`** — your Aiven Postgres Service URI
   - **`ADMIN_PASSWORD`** — a strong admin password (don't reuse `88888888`)
3. **Deploy** → you get `https://<name>.onrender.com` (app) and `/admin`.

Full walkthrough + notes in [`DEPLOY.md`](DEPLOY.md). (Free tier sleeps after ~15 min idle; the app
reads offers from your Postgres and `/admin` is password-gated.)

## User app

- **Search** the region's real offers; results group by product with the cheapest price + how many retailers carry it.
- **★ Favorite** any product — favorites are the real products you picked, saved in `localStorage` (per browser, no account).
- **Deine Favoriten** — for each favorite: the cheapest retailer this week, all offers across stores, and a basket/savings summary.
- **Data-not-ready state** — if the week's data is missing or expired, the app shows a clear "wird vorbereitet" notice instead of stale prices.

## Admin panel (`/admin`)

- Shows **data readiness** for a region (ready / stale / none), offer + brochure + retailer counts, validity and last-run time.
- **"Daten jetzt extrahieren"** runs `scripts/fetch-kaufda.js` and streams its live log.
- Dev tool: `server.js` binds to `127.0.0.1` and has **no auth** — don't expose it to the internet as-is.

### Schedule it weekly (instead of the admin button)

- **Windows (Task Scheduler):** run `node scripts/fetch-kaufda.js` weekly in this folder.
- **Linux/macOS (cron):** `0 6 * * 1 cd /path/to/sparfuchs && node scripts/fetch-kaufda.js`
- **CI:** a weekly GitHub Action that runs the fetch and commits/deploys the JSON.

## Real data: the kaufDA pipeline (Berlin 10178)

A working real-data source is wired up, scoped to **one postal code, Berlin 10178**, pulling
live weekly offers from **kaufDA.de** (Bonial), with **no OCR**. Two steps:

1. **Enumerate the location's brochures** (flyers) from the server-rendered `__NEXT_DATA__` on the
   homepage + grocery sector pages (`/Branchen/Supermarkt`, `/Branchen/Discounter`).
2. **Read each brochure's structured offers** from kaufDA's content-viewer API — the same data the
   flyer viewer's "Angebote" tab shows:
   `GET content-viewer-be.kaufda.de/v1/premiumPanel/offers?brochureId=<id>&page=0&size=200` (paginated).
   Required headers: `Bonial-Api-Consumer: web-content-viewer-fe` and `Accept: */*`.

```bash
node scripts/fetch-kaufda.js            # default location (10178) from config/locations.json
ZIP=10178 node scripts/fetch-kaufda.js  # explicit
```

Writes into the project folder:

- `data/kaufda/10178/offers-latest.json` — normalized offers the app/DB use (tracked in git).
- `data/kaufda/10178/raw-<date>.json` — full-fidelity raw snapshot + brochure metadata (gitignored).

Typical run: **~3,800 unique offers from ~22 brochures across ~10 retailers** (REWE, EDEKA, Lidl,
ALDI Nord, Penny, Netto, Kaufland, budni, E center, Thomas Philipps) — essentially the location's
complete weekly-offer set. Each offer: retailer, product title, description, price, unit price,
brochure + page, validity, category, image URL.

> Why not OCR? We verified both: OCR of the 18-page REWE flyer and this API returned **the same
> offers** (115/115 priced offers matched to the cent). The API is exact, complete and ~free, so
> OCR is only a fallback for image-only flyers.

**Files:** `scripts/adapters/kaufda.js` (enumerate + fetch + normalize), `scripts/lib/nextdata.js`
(SSR parse), `scripts/fetch-kaufda.js` (CLI), `config/locations.json` (add more zips here).

**Legal / politeness (important):** kaufDA/Bonial terms restrict scraping, and brochure **images**
are the retailers' copyrighted material. This pipeline is a **personal/dev prototype**: one postal
code, weekly cadence, low request volume, a real User-Agent, and it stores **only extracted facts +
references image URLs (never downloads/rehosts images)**. A public launch would need a licensed feed.

## Roadmap

- [x] Real data source (kaufDA, Berlin 10178) — brochure-offers API, ~3,800 offers, saved to `data/kaufda/`
- [x] User app: search real products, ★-favorite them locally, cheapest-per-favorite comparison
- [x] Data-not-ready state when the week's offers are missing/expired
- [x] Admin panel to run the extraction + report data readiness (`/admin`)
- [ ] Load offers into Postgres with full-text search; schedule weekly
- [ ] Expand beyond 10178 (add zips to `config/locations.json`)
- [ ] Weekly notification when favorites hit their cheapest (channel TBD — email is simplest)
- [ ] Auth on the admin panel before any non-local deployment

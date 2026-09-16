# 🦊 SparFuchs

Pick your favorite grocery products and see **which German supermarket has the cheapest price this week** — with location-aware suggestions for the closest and best-value store near you.

> MVP status: **Core comparison + location works today** on realistic seed data.
> Notifications and a live data source are the planned next steps.

## How it's built (two independent parts)

```
┌─────────────────────────┐        writes         ┌──────────────────────┐
│  Data pipeline (Node)    │ ───────────────────▶  │   data/offers.json    │
│  scripts/fetch-offers.js │   run every 24h       └──────────┬───────────┘
│  + swappable adapters    │                                  │ reads
└─────────────────────────┘                        ┌──────────▼───────────┐
                                                    │  Static frontend      │
                                                    │  index.html / js / css│
                                                    └──────────────────────┘
```

- **Frontend** = plain static HTML/CSS/JS. It only reads `data/offers.json`. Deploys to any static host (Netlify, GitHub Pages, S3…).
- **Data pipeline** = a Node script that fetches offers and writes that JSON. Runs on a schedule; the site is never coupled to the source.

## Run locally

```bash
npm run fetch    # generate data/offers.json (uses the seed source)
npm run serve    # http://localhost:4173
```

Open <http://localhost:4173>. (Use the server — opening `index.html` directly won't load the JSON files due to browser file:// restrictions.)

## Features (MVP)

- Pick favorites from a German product catalog (Hähnchen, Monster, Red Bull, Milch …), saved in your browser.
- Per product: the **cheapest chain this week**, offer badges, and all chains' prices.
- Warenkorb summary: total at best price + savings vs. average.
- **Location** (📍): finds your 3 nearest stores and unlocks two more priorities:
  - **Günstigster Preis** — best price anywhere
  - **Nächster Markt** — prices at your closest store
  - **Beste Wahl in der Nähe** — cheapest among your 3 nearest stores

## The data source (the important part)

`data/offers.json` is produced by an **adapter**. Swapping the source never touches the frontend.

- `scripts/adapters/seed.js` — realistic sample prices (active by default).
- `scripts/adapters/marktguru.js` — **scaffold** for a real live source. Not enabled.

```bash
SOURCE=seed node scripts/fetch-offers.js       # default
SOURCE=marktguru node scripts/fetch-offers.js  # once you implement + review ToS
```

**Honest caveats for going live:** German offer aggregators (marktguru, kaufDA, meinprospekt) generally **forbid scraping** in their terms, and their pages change often and will break scrapers. Prefer an official/licensed API where possible. The adapter boundary + validation in `fetch-offers.js` is built so a failed/garbage run **won't overwrite good data**.

### Schedule it every 24h

- **Windows (Task Scheduler):** run `node scripts/fetch-offers.js` daily in this folder.
- **Linux/macOS (cron):** `0 6 * * * cd /path/to/sparfuchs && node scripts/fetch-offers.js`
- **CI:** a daily GitHub Action that runs the fetch and commits/deploys the JSON.

## Real data: the kaufDA pipeline (Berlin 10178)

A working real-data source is wired up, scoped to **one postal code, Berlin 10178**, pulling
live weekly offers from **kaufDA.de** (Bonial). It is **structured-first** — kaufDA server-renders
fully structured offers into its page (`__NEXT_DATA__`), so a plain HTTP fetch + JSON parse gets
`title, brand, retailer, price, was-price, unit price, brochure + page, image URL` with **no OCR**.

```bash
node scripts/fetch-kaufda.js            # default location (10178) from config/locations.json
ZIP=10178 node scripts/fetch-kaufda.js  # explicit
```

It searches kaufDA at the location for each product in `data/catalog.json` (plus a few broad grocery
terms) and writes into the project folder:

- `data/kaufda/10178/offers-latest.json` — normalized offers the app/DB can use (tracked in git).
- `data/kaufda/10178/raw-<date>.json` — full-fidelity raw snapshot + brochure metadata (gitignored).

Typical run: **~400 unique offers across ~18 retailers** (REWE, EDEKA, Lidl, ALDI Nord, Penny,
Netto, Kaufland, Rossmann, …), most with a valid-until date and a was-price.

**Files:** `scripts/adapters/kaufda.js` (fetch + normalize), `scripts/lib/nextdata.js` (SSR parse),
`scripts/fetch-kaufda.js` (CLI), `config/locations.json` (add more zips here).

**Legal / politeness (important):** kaufDA/Bonial terms restrict scraping, and brochure **images**
are the retailers' copyrighted material. This pipeline is a **personal/dev prototype**: one postal
code, weekly cadence, low request volume, a real User-Agent, and it stores **only extracted facts +
references image URLs (never downloads/rehosts images)**. A public launch would need a licensed feed.

**Known limits (next steps):** per-term search returns up to 24 offers (broad terms like "Käse" have
more available — see `perTerm` in the raw file); wiring these offers into the frontend, matching them
to the catalog, and the Postgres load are the follow-ups.

## Roadmap

- [x] Real data source (kaufDA, Berlin 10178) — structured-first, saved to `data/kaufda/`
- [ ] Surface kaufDA offers in the frontend + match to the catalog
- [ ] Load offers into Postgres with full-text search; schedule weekly
- [ ] Expand beyond 10178 / paginate broad search terms
- [ ] Weekly notification when favorites hit their cheapest (channel TBD — email is simplest)
- [ ] Real store-locator data per chain (current branches are a Munich/Berlin sample)
- [ ] Postal-code entry as a fallback to GPS

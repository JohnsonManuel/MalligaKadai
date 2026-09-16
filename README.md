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

## Roadmap

- [ ] Real data source behind the adapter (API preferred over scraping)
- [ ] Weekly notification when favorites hit their cheapest (channel TBD — email is simplest)
- [ ] Real store-locator data per chain (current branches are a Munich/Berlin sample)
- [ ] Postal-code entry as a fallback to GPS

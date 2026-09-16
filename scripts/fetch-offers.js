#!/usr/bin/env node
// Data pipeline entry point.
// Runs the selected adapter and writes data/offers.json — the single file
// the static frontend reads. Schedule this every 24h (cron / Task Scheduler).
//
// Usage:
//   node scripts/fetch-offers.js            # uses SOURCE env or defaults to "seed"
//   SOURCE=seed node scripts/fetch-offers.js
//   SOURCE=marktguru node scripts/fetch-offers.js
//
// Validates against the catalog + stores so a broken source can't publish garbage.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(DATA, "offers.json");

const catalog = JSON.parse(fs.readFileSync(path.join(DATA, "catalog.json"), "utf8"));
const stores = JSON.parse(fs.readFileSync(path.join(DATA, "stores.json"), "utf8"));
const productIds = new Set(catalog.products.map((p) => p.id));
const chainIds = new Set(stores.chains.map((c) => c.id));

const ADAPTERS = {
  seed: require("./adapters/seed"),
  marktguru: require("./adapters/marktguru")
};

function validate(result) {
  if (!result || !Array.isArray(result.offers)) throw new Error("adapter returned no offers[]");
  const clean = [];
  let dropped = 0;
  for (const o of result.offers) {
    const ok =
      productIds.has(o.productId) &&
      chainIds.has(o.chainId) &&
      typeof o.price === "number" &&
      o.price > 0 &&
      o.price < 1000;
    if (ok) clean.push(o);
    else dropped++;
  }
  if (dropped) console.warn(`⚠  dropped ${dropped} invalid offer(s)`);
  if (!clean.length) throw new Error("no valid offers after validation — refusing to overwrite");
  return { ...result, offers: clean };
}

async function main() {
  const source = process.env.SOURCE || "seed";
  const adapter = ADAPTERS[source];
  if (!adapter) {
    console.error(`Unknown SOURCE="${source}". Options: ${Object.keys(ADAPTERS).join(", ")}`);
    process.exit(1);
  }

  console.log(`→ fetching offers from source: ${source}`);
  let result;
  try {
    result = validate(await adapter.fetchOffers());
  } catch (err) {
    console.error(`✗ ${source} failed: ${err.message}`);
    if (source !== "seed") {
      console.error("  Keeping existing data/offers.json (not overwriting with a failed run).");
    }
    process.exit(1);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source,
    weekOf: result.weekOf,
    validUntil: result.validUntil,
    offers: result.offers
  };

  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`✓ wrote ${result.offers.length} offers to ${path.relative(ROOT, OUT)}`);
  console.log(`  week ${result.weekOf} → ${result.validUntil}`);
}

main();

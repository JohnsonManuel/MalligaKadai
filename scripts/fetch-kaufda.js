#!/usr/bin/env node
// CLI: pull REAL kaufDA offers for one location (default Berlin 10178) and save
// them into the project folder. Structured-first (no OCR). Safe to schedule weekly.
//
// Usage:
//   node scripts/fetch-kaufda.js            # default location from config
//   ZIP=10178 node scripts/fetch-kaufda.js  # pick a configured location
//
// Search terms come from our product catalog (data/catalog.json), plus a few
// common grocery terms, so the pulled data covers the things the app compares.

const fs = require("fs");
const path = require("path");
const kaufda = require("./adapters/kaufda");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");

const locations = JSON.parse(fs.readFileSync(path.join(ROOT, "config/locations.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(DATA, "catalog.json"), "utf8"));

// Extra broad terms so the dataset isn't limited to our 18 catalog items.
const EXTRA_TERMS = ["Käse", "Wurst", "Joghurt", "Brot", "Chips", "Schokolade", "Wasser", "Waschmittel"];

// term = product name without any parenthetical qualifier ("Pils (Kasten)" -> "Pils")
function termFor(p) {
  return (p.name.split("(")[0] || p.name).trim();
}

function buildTerms() {
  const set = new Set();
  for (const p of catalog.products) set.add(termFor(p));
  for (const t of EXTRA_TERMS) set.add(t);
  return [...set];
}

async function main() {
  const zip = process.env.ZIP || locations.default;
  const loc = locations.locations[zip];
  if (!loc) {
    console.error(`Location "${zip}" not in config/locations.json. Options: ${Object.keys(locations.locations).join(", ")}`);
    process.exit(1);
  }

  const terms = buildTerms();
  console.log(`→ kaufDA: ${terms.length} search terms @ ${loc.zip} ${loc.city}`);

  const result = await kaufda.fetchForTerms(loc, terms, {
    delayMs: 700,
    onProgress: (p) =>
      p.error
        ? console.warn(`   ✗ "${p.term}": ${p.error}`)
        : console.log(`   · "${p.term}": ${p.returned} offers (of ${p.totalAvailable} available)`)
  });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const outDir = path.join(DATA, "kaufda", loc.zip);
  fs.mkdirSync(outDir, { recursive: true });

  // 1) Full-fidelity raw snapshot (offers as parsed from kaufDA + brochure metadata).
  const rawFile = path.join(outDir, `raw-${date}.json`);
  fs.writeFileSync(
    rawFile,
    JSON.stringify(
      { generatedAt: now.toISOString(), source: "kaufda", location: loc,
        brochures: result.brochures, offers: result.rawOffers, perTerm: result.perTerm },
      null, 2
    ) + "\n"
  );

  // 2) Normalized offers for the app / search.
  const normFile = path.join(outDir, "offers-latest.json");
  fs.writeFileSync(
    normFile,
    JSON.stringify(
      { generatedAt: now.toISOString(), source: "kaufda", zip: loc.zip, city: loc.city,
        weekOf: date, offerCount: result.offers.length, offers: result.offers },
      null, 2
    ) + "\n"
  );

  // summary
  const retailers = [...new Set(result.offers.map((o) => o.retailer).filter(Boolean))];
  const withPrice = result.offers.filter((o) => typeof o.price === "number");
  console.log(`\n✓ saved ${result.offers.length} unique offers`);
  console.log(`  retailers (${retailers.length}): ${retailers.slice(0, 12).join(", ")}${retailers.length > 12 ? " …" : ""}`);
  console.log(`  with numeric price: ${withPrice.length} · brochures: ${result.brochures.length}`);
  console.log(`  → ${path.relative(ROOT, normFile)}`);
  console.log(`  → ${path.relative(ROOT, rawFile)}`);
  console.log("\n  sample:");
  for (const o of withPrice.slice(0, 6)) {
    console.log(`    ${o.productTitle} (${o.brand || "—"}) · ${o.retailer} · ${o.priceFormatted}${o.wasPrice ? ` (statt ${o.wasPrice}€)` : ""}`);
  }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });

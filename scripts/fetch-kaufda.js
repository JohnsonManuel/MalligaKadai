#!/usr/bin/env node
// CLI: pull REAL kaufDA offers for one location (default Berlin 10178) and save
// them into the project folder. Enumerates the location's brochures, then reads
// each brochure's structured offers via the content-viewer API (no OCR, no keyword
// guessing). Safe to schedule weekly.
//
// Usage:
//   node scripts/fetch-kaufda.js            # default location from config
//   ZIP=10178 node scripts/fetch-kaufda.js  # pick a configured location

const fs = require("fs");
const path = require("path");
const kaufda = require("./adapters/kaufda");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const locations = JSON.parse(fs.readFileSync(path.join(ROOT, "config/locations.json"), "utf8"));

async function main() {
  const zip = process.env.ZIP || locations.default;
  const loc = locations.locations[zip];
  if (!loc) {
    console.error(`Location "${zip}" not in config/locations.json. Options: ${Object.keys(locations.locations).join(", ")}`);
    process.exit(1);
  }

  console.log(`→ kaufDA: enumerating brochures @ ${loc.zip} ${loc.city} …`);
  const result = await kaufda.fetchForLocation(loc, {
    delayMs: 500,
    onProgress: (p) =>
      p.error
        ? console.warn(`   ✗ ${p.retailer} · ${p.title}: ${p.error}`)
        : console.log(`   · ${String(p.added).padStart(3)} new (${p.offers} in flyer) · ${p.retailer} · ${p.title}`)
  });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const outDir = path.join(DATA, "kaufda", loc.zip);
  fs.mkdirSync(outDir, { recursive: true });

  // 1) full-fidelity raw snapshot
  fs.writeFileSync(
    path.join(outDir, `raw-${date}.json`),
    JSON.stringify(
      { generatedAt: now.toISOString(), source: "kaufda", location: loc,
        brochures: result.brochures, perBrochure: result.perBrochure, offers: result.rawOffers },
      null, 2
    ) + "\n"
  );

  // 2) normalized offers for the app / DB
  const normFile = path.join(outDir, "offers-latest.json");
  fs.writeFileSync(
    normFile,
    JSON.stringify(
      { generatedAt: now.toISOString(), source: "kaufda", method: "brochure-offers-api",
        zip: loc.zip, city: loc.city, weekOf: date,
        brochureCount: result.brochures.length, offerCount: result.offers.length, offers: result.offers },
      null, 2
    ) + "\n"
  );

  // summary
  const retailers = [...new Set(result.offers.map((o) => o.retailer).filter(Boolean))];
  const withPrice = result.offers.filter((o) => o.price != null);
  console.log(`\n✓ ${result.offers.length} unique offers from ${result.brochures.length} brochures`);
  console.log(`  retailers (${retailers.length}): ${retailers.slice(0, 14).join(", ")}${retailers.length > 14 ? " …" : ""}`);
  console.log(`  with fixed price: ${withPrice.length} · bonus/discount-only (no price): ${result.offers.length - withPrice.length}`);
  console.log(`  → ${path.relative(ROOT, normFile)}`);
  console.log("\n  cheapest 6:");
  withPrice.sort((a, b) => a.price - b.price).slice(0, 6).forEach((o) =>
    console.log(`    ${o.priceFormatted.padStart(8)} · ${o.retailer} · ${o.productTitle}`));
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });

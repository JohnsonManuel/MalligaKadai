// Marktguru adapter — SCAFFOLD for a real live source (not yet wired up).
//
// This shows exactly where real fetching goes. It must return the SAME
// shape as the seed adapter: { weekOf, validUntil, offers[] } where each
// offer is { productId, chainId, price, onOffer, wasPrice? }.
//
// IMPORTANT / HONEST NOTES before enabling this:
//   1. Aggregator terms of service generally forbid scraping. Check them,
//      and prefer an official/licensed API where one exists.
//   2. Their HTML/JSON endpoints change without notice and will break this.
//   3. You must map their product names -> our catalog product IDs. Free-text
//      matching is the hard part (e.g. "Monster Energy 500ml" -> "monster").
//
// Run only after you've reviewed the above and set SOURCE=marktguru.

const CATALOG = require("../../data/catalog.json").products;

// Map an arbitrary offer title from the source to one of our catalog IDs.
// Start simple (keyword contains), improve over time.
function matchProduct(title) {
  const t = title.toLowerCase();
  for (const p of CATALOG) {
    if (t.includes(p.name.toLowerCase()) || t.includes(p.nameEn.toLowerCase().split(" ")[0])) {
      return p.id;
    }
  }
  return null; // unmatched -> skip
}

async function fetchOffers() {
  throw new Error(
    "marktguru adapter is a scaffold. Implement the fetch + mapping, review ToS, " +
    "then run with SOURCE=marktguru. Using SOURCE=seed for now."
  );

  /* Example skeleton once you implement it:

  const res = await fetch("https://.../offers?zip=80331", { headers: {...} });
  const raw = await res.json();
  const offers = [];
  for (const item of raw.results) {
    const productId = matchProduct(item.title);
    if (!productId) continue;
    offers.push({
      productId,
      chainId: normalizeChain(item.retailer),   // -> our chain ids
      price: Number(item.price),
      onOffer: true,
      wasPrice: item.oldPrice ? Number(item.oldPrice) : undefined
    });
  }
  return { weekOf, validUntil, offers };
  */
}

module.exports = { name: "marktguru", fetchOffers, matchProduct };

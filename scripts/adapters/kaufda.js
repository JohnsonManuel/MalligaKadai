// kaufDA adapter — pulls REAL German supermarket offers from kaufda.de (Bonial).
//
// Approach: enumerate the location's brochures (flyers), then for each brochure call
// kaufDA's structured offers endpoint. This returns every offer in a flyer as clean
// JSON — no OCR, no keyword guessing. It's the same data the flyer viewer's
// "Angebote" tab shows.
//
//   Brochure list  : SSR __NEXT_DATA__ on the homepage + grocery sector pages
//   Offers per flyer: GET content-viewer-be.kaufda.de/v1/premiumPanel/offers
//
// Legal/politeness: single postal code, low request volume, real User-Agent, delay
// between calls, and we store only extracted facts + reference image URLs (never
// download/rehost the copyrighted flyer images). kaufDA/Bonial terms restrict
// scraping — personal/dev prototype; a public launch needs a licensed feed.

const { getNextData } = require("../lib/nextdata");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// Headers the offers backend requires (discovered from the viewer). Without the
// Bonial-Api-Consumer header it returns 400; with Accept: application/json it returns 406.
const API_HEADERS = {
  "User-Agent": UA,
  Accept: "*/*",
  "Bonial-Api-Consumer": "web-content-viewer-fe",
  delivery_channel: "dest.kaufda",
  user_platform_category: "desktop.web.browser",
  user_platform_os: "windows",
  Origin: "https://www.kaufda.de",
  Referer: "https://www.kaufda.de/"
};

// kaufDA publisherId -> our stores.json chain id (only the ones we model).
const CHAIN_BY_PUBLISHER_ID = {
  "DE-1062": "rewe",
  "DE-220164": "edeka",
  "DE-1013": "lidl",
  "DE-1050": "penny",
  "DE-424316869": "kaufland",
  "DE-1034": "netto",       // Netto Marken-Discount
  "DE-75": "aldi-nord",
  "DE-70": "aldi-sued"
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookie = (loc) => "location=" + encodeURIComponent(JSON.stringify(loc));
const fmtEur = (n) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

async function ssr(url, loc) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Cookie: cookie(loc), "Accept-Language": "de-DE,de;q=0.9" },
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return getNextData(await r.text());
}

// Enumerate brochures (flyers) for the location: homepage top-ranked + grocery sectors.
async function listBrochures(loc) {
  const map = new Map();
  const add = (b) => {
    const id = b.contentId || b.id;
    if (!id || map.has(id)) return;
    map.set(id, {
      contentId: id,
      title: b.title || "",
      retailer: b.publisher && b.publisher.name,
      retailerId: b.publisher && b.publisher.id,
      validFrom: b.validFrom || null,
      validUntil: b.validUntil || null,
      pageCount: b.pageCount || null
    });
  };
  const home = await ssr("https://www.kaufda.de/", loc);
  (home?.props?.pageProps?.pageInformation?.brochures?.topRanked || []).forEach(add);
  for (const sector of ["Supermarkt", "Discounter"]) {
    try {
      const d = await ssr("https://www.kaufda.de/Branchen/" + sector, loc);
      (d?.props?.pageProps?.pageInformation?.brochures?.sector || []).forEach(add);
    } catch { /* sector optional */ }
  }
  return [...map.values()];
}

// All offers in one brochure (paginated; the API caps a page at `size`).
async function offersForBrochure(contentId, loc, { size = 200, maxPages = 6 } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const url =
      `https://content-viewer-be.kaufda.de/v1/premiumPanel/offers?brochureId=${contentId}` +
      `&page=${page}&partner=kaufda_web&brochureKey=&lat=${loc.lat}&lng=${loc.lng}&size=${size}`;
    const r = await fetch(url, { headers: API_HEADERS, signal: AbortSignal.timeout(20000) });
    if (!r.ok) break;
    const j = await r.json();
    const contents = (j.contents || []).map((c) => c.content).filter(Boolean);
    all.push(...contents);
    if (contents.length < size) break; // last page
    await sleep(250);
  }
  return all;
}

// Map one raw API offer to our normalized shape.
function normalizeOffer(o, brochure) {
  const p = (o.products && o.products[0]) || {};
  const desc = Array.isArray(p.description) ? p.description.map((d) => d.paragraph).filter(Boolean).join(" ") : "";
  const deals = o.deals || [];
  const sale = deals.find((d) => d.type === "SALES_PRICE") || deals.find((d) => /PRICE/i.test(d.type || "")) || {};
  const reg = deals.find((d) => d.type === "REGULAR_PRICE");
  const price = typeof sale.max === "number" && sale.max > 0 ? sale.max : null; // 0 => bonus/discount only, no fixed price
  const wasPrice = reg && typeof reg.max === "number" && reg.max > 0 ? reg.max : null;
  const cats = p.categoryPaths || [];
  const chainId = CHAIN_BY_PUBLISHER_ID[o.publisher && o.publisher.id] || null;
  const title = p.name || "";
  const category = cats.length ? cats[cats.length - 1].name : "";
  return {
    id: o.id,
    brochureId: brochure.contentId,
    page: o.parentContent && o.parentContent.page ? o.parentContent.page.number : null,
    retailer: (o.publisher && o.publisher.name) || brochure.retailer || "",
    retailerId: (o.publisher && o.publisher.id) || brochure.retailerId || "",
    chainId,
    productTitle: title,
    description: desc,
    price,
    priceFormatted: price != null ? fmtEur(price) : "",
    wasPrice,
    unitPrice: sale.priceByBaseUnit || "",
    hasFixedPrice: price != null,
    validFrom: brochure.validFrom,
    validUntil: brochure.validUntil,
    category,
    imageUrl: (p.images && p.images[0] && p.images[0].url) || (o.image && o.image.url) || null,
    // lower-cased haystack for the app's free-text / favorite matching
    searchText: [title, desc, category, o.publisher && o.publisher.name].filter(Boolean).join(" ").toLowerCase()
  };
}

// Main entry: enumerate brochures for a location and pull every offer from each.
async function fetchForLocation(loc, { delayMs = 500, onProgress } = {}) {
  const brochures = await listBrochures(loc);
  const byId = new Map();
  const rawById = new Map();
  const perBrochure = [];

  for (const b of brochures) {
    await sleep(delayMs);
    try {
      const raw = await offersForBrochure(b.contentId, loc);
      let added = 0;
      for (const o of raw) {
        if (!o || !o.id) continue;
        if (!byId.has(o.id)) { byId.set(o.id, normalizeOffer(o, b)); rawById.set(o.id, o); added++; }
      }
      perBrochure.push({ retailer: b.retailer, title: b.title, contentId: b.contentId, offers: raw.length, added });
      if (onProgress) onProgress({ retailer: b.retailer, title: b.title, offers: raw.length, added });
    } catch (err) {
      perBrochure.push({ retailer: b.retailer, title: b.title, contentId: b.contentId, error: err.message });
      if (onProgress) onProgress({ retailer: b.retailer, title: b.title, error: err.message });
    }
  }

  return { location: loc, brochures, offers: [...byId.values()], rawOffers: [...rawById.values()], perBrochure };
}

module.exports = { name: "kaufda", fetchForLocation, listBrochures, offersForBrochure, normalizeOffer, CHAIN_BY_PUBLISHER_ID };

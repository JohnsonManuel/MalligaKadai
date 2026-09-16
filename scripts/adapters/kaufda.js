// kaufDA adapter — pulls REAL German supermarket offers from kaufda.de (Bonial),
// scoped to a single location, using the structured data kaufDA server-renders
// into its __NEXT_DATA__ blob. No OCR, no API keys, no headless browser.
//
// Strategy: for each product search term, call kaufDA's /search endpoint at the
// given location and collect the structured offers it returns across all
// retailers. This directly powers "which shop is cheapest for X this week near me".
//
// Legal/politeness: single postal code, low request volume, real User-Agent,
// delay between requests, and we store only extracted facts + reference image
// URLs (we never download/rehost the copyrighted brochure images). kaufDA/Bonial
// terms restrict scraping — this is a personal/dev prototype; a public launch
// would need a licensed feed.

const { getNextData } = require("../lib/nextdata");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// kaufDA publisherId -> our stores.json chain id (only the ones we model).
// Anything not here keeps its raw publisherName and chainId=null.
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

function locationCookie(loc) {
  return "location=" + encodeURIComponent(JSON.stringify(loc));
}

function searchUrl(term, loc) {
  const q = new URLSearchParams({
    query: term,
    lat: loc.lat,
    lng: loc.lng,
    city: loc.city,
    zip: loc.zip
  });
  return `https://www.kaufda.de/search?${q.toString()}`;
}

async function getPage(url, loc, tries = 2) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Cookie: locationCookie(loc),
          "Accept-Language": "de-DE,de;q=0.9",
          Accept: "text/html,application/xhtml+xml"
        },
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return getNextData(await res.text());
    } catch (err) {
      if (attempt === tries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

// Map a raw kaufDA offer object to our normalized offer shape.
function normalizeOffer(o, term, brochureValidity) {
  const chainId = CHAIN_BY_PUBLISHER_ID[o.publisherId] || null;
  const parent = o.parentContent || {};
  const validity = brochureValidity.get(parent.id) || {};
  const p = o.prices || {};
  return {
    id: o.id,
    searchTerm: term,
    productTitle: o.title || "",
    brand: o.brand || "",
    description: o.description || "",
    retailer: o.publisherName || "",
    retailerId: o.publisherId || "",
    chainId,
    price: typeof p.mainPrice === "number" ? p.mainPrice : null,
    priceFormatted: p.mainPriceFormatted || "",
    wasPrice: typeof p.secondaryPrice === "number" && p.secondaryPrice > 0 ? p.secondaryPrice : null,
    wasIsUVP: !!p.secondaryPriceIsUVP,
    unitPrice: p.priceByBaseUnit || "",
    validFrom: o.validFrom || validity.validFrom || null,
    validUntil: o.validUntil || validity.validUntil || null,
    brochureId: parent.id || null,
    page: parent.page && parent.page.number != null ? parent.page.number : null,
    category: Array.isArray(o.categories) ? o.categories[0] || "" : "",
    imageUrl: o.offerImages && o.offerImages.url ? o.offerImages.url.normal : null
  };
}

// Fetch the location's current brochures (publisher + validity + page image URLs).
// Used both as OCR-fallback metadata and to backfill offer validity dates.
async function fetchBrochures(loc) {
  const d = await getPage("https://www.kaufda.de/", loc);
  const list = d?.props?.pageProps?.pageInformation?.brochures?.topRanked || [];
  return list.map((b) => ({
    id: b.id,
    contentId: b.contentId,
    title: b.title,
    retailer: b.publisher && b.publisher.name,
    retailerId: b.publisher && b.publisher.id,
    validFrom: b.validFrom || null,
    validUntil: b.validUntil || null,
    pageCount: b.pageCount,
    pageImageUrls: Array.isArray(b.pages)
      ? b.pages.map((pg) => pg.url && pg.url.large).filter(Boolean)
      : []
  }));
}

async function searchOffers(term, loc) {
  const d = await getPage(searchUrl(term, loc), loc);
  const sr = d?.props?.pageProps?.pageInformation?.searchResults || {};
  const offers = (sr.contents && sr.contents.offers) || [];
  const brochures = (sr.contents && sr.contents.brochures) || [];
  const total = sr.metadata && sr.metadata.contentCount && sr.metadata.contentCount.offer;
  return { offers, brochures, total: total ?? offers.length };
}

// Main entry: fetch offers for a list of search terms at one location.
// Returns { location, brochures, offers[] (normalized, de-duped by offer id) }.
async function fetchForTerms(loc, terms, { delayMs = 700, onProgress } = {}) {
  const brochures = await fetchBrochures(loc);
  const brochureValidity = new Map(
    brochures.map((b) => [b.id, { validFrom: b.validFrom, validUntil: b.validUntil }])
  );

  const rawById = new Map();   // offer id -> { raw, term }
  const perTerm = [];
  for (const term of terms) {
    await sleep(delayMs);
    let got = 0, total = 0;
    try {
      const res = await searchOffers(term, loc);
      total = res.total;
      // harvest brochure validity so we can backfill offer dates later.
      // search-result brochures are wrapped: the brochure is under `.content`.
      for (const wrap of res.brochures) {
        const b = (wrap && wrap.content) || wrap;
        if (b && b.id && !brochureValidity.has(b.id)) {
          brochureValidity.set(b.id, { validFrom: b.validFrom || null, validUntil: b.validUntil || null });
        }
      }
      for (const raw of res.offers) {
        if (!raw || !raw.id) continue;
        got++;
        if (!rawById.has(raw.id)) rawById.set(raw.id, { raw, term });
      }
    } catch (err) {
      perTerm.push({ term, error: err.message });
      if (onProgress) onProgress({ term, error: err.message });
      continue;
    }
    perTerm.push({ term, returned: got, totalAvailable: total });
    if (onProgress) onProgress({ term, returned: got, totalAvailable: total });
  }

  // normalize once the brochure-validity map is complete
  const offers = [...rawById.values()].map(({ raw, term }) => normalizeOffer(raw, term, brochureValidity));
  const rawOffers = [...rawById.values()].map((x) => x.raw);
  return { location: loc, brochures, offers, rawOffers, perTerm };
}

module.exports = { name: "kaufda", fetchForTerms, searchOffers, fetchBrochures, normalizeOffer, CHAIN_BY_PUBLISHER_ID };

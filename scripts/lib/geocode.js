// Resolve a German postal code (PLZ) to { zip, city, lat, lng } via OpenStreetMap
// Nominatim. kaufDA only needs approximate coordinates to pick nearby stores.
//
// (zippopotam.us was tried first but its German dataset returns corrupt
//  lat/long values, so it's unusable here.)
//
// Nominatim usage policy: max ~1 req/s and a real identifying User-Agent — fine
// for the low-volume admin use here.

async function geocodePlz(plz) {
  if (!/^\d{5}$/.test(plz)) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${plz}&country=Germany&format=json&addressdetails=1&limit=1`;
    const r = await fetch(url, {
      headers: { "User-Agent": "SparFuchs/0.1 (personal price-comparison project)", "Accept-Language": "de" },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return null;
    const d = await r.json();
    const p = d[0];
    if (!p) return null;
    const lat = Number(p.lat), lng = Number(p.lon);
    // sanity-check the coordinates fall within Germany's bounding box
    if (!(lat > 47 && lat < 55.1 && lng > 5 && lng < 15.1)) return null;
    const a = p.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.suburb || a.city_district ||
      (p.display_name || "").split(",")[1]?.trim() || plz;
    return { zip: plz, city, lat: String(p.lat), lng: String(p.lon) };
  } catch {
    return null;
  }
}

module.exports = { geocodePlz };

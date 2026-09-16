"use strict";

// ---- state ----
const state = {
  chains: new Map(),   // chainId -> {name,color,initials}
  kaufda: null,        // loaded offers-latest.json (real brochure offers)
  ready: false,        // is this week's data valid today?
  favorites: loadFavorites()   // [{ key, title }]  key = normalized product title
};

const $ = (s) => document.querySelector(s);
const eur = (n) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const fmtShort = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
const fmtDay = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "long" });
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const normTitle = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

// ---- favorites (localStorage, per-user) ----
function loadFavorites() {
  try { return JSON.parse(localStorage.getItem("sf_favs_v2") || "[]"); } catch { return []; }
}
function saveFavorites() {
  try { localStorage.setItem("sf_favs_v2", JSON.stringify(state.favorites)); } catch {}
}
const isFav = (key) => state.favorites.some((f) => f.key === key);
function toggleFav(key, title) {
  const i = state.favorites.findIndex((f) => f.key === key);
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push({ key, title });
  saveFavorites();
  renderSearch();
  renderFavorites();
}

// ---- retailer visuals ----
function hashHue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }
function retailerVisual(o) {
  const c = o.chainId && state.chains.get(o.chainId);
  if (c) return { color: c.color, initials: c.initials, name: o.retailer || c.name };
  const name = o.retailer || "?";
  const initials = (name.replace(/[^A-Za-zÄÖÜäöü]/g, "").slice(0, 2) || name.slice(0, 2)).toUpperCase();
  return { color: `hsl(${hashHue(name)} 52% 42%)`, initials, name };
}
const chipHTML = (v) => `<span class="chip"><span class="dot" style="background:${v.color}">${v.initials}</span>${v.name}</span>`;

// ---- offer helpers ----
const pricedOffers = () => (state.kaufda ? state.kaufda.offers.filter((o) => typeof o.price === "number" && o.price > 0) : []);

// all current offers for a favorite product (exact title match, else keyword fallback)
function offersForKey(key) {
  const exact = pricedOffers().filter((o) => normTitle(o.productTitle) === key);
  const pool = exact.length ? exact : pricedOffers().filter((o) => (o.searchText || "").includes(key));
  return pool.sort((a, b) => a.price - b.price);
}

// ---- rendering: search ----
function renderSearch() {
  const wrap = $("#searchResults");
  const q = ($("#search").value || "").trim().toLowerCase();
  wrap.innerHTML = "";
  if (!state.kaufda) return;
  if (q.length < 2) {
    wrap.innerHTML = `<div class="empty">Tippe mindestens 2 Zeichen, um echte Angebote zu durchsuchen und mit ★ zu deinen Favoriten hinzuzufügen.</div>`;
    return;
  }
  const matches = pricedOffers().filter((o) => (o.searchText || "").includes(q));
  if (!matches.length) {
    wrap.innerHTML = `<div class="empty">Keine Angebote für „${esc(q)}“ in ${esc(state.kaufda.city)} ${esc(state.kaufda.zip)} diese Woche.</div>`;
    return;
  }
  // group distinct products by normalized title
  const byTitle = new Map();
  for (const o of matches) {
    const key = normTitle(o.productTitle);
    if (!key) continue;
    let g = byTitle.get(key);
    if (!g) { g = { key, title: o.productTitle, min: o.price, count: 0, retailers: new Set() }; byTitle.set(key, g); }
    g.count++; g.retailers.add(o.retailer); if (o.price < g.min) { g.min = o.price; g.title = o.productTitle; }
  }
  const products = [...byTitle.values()].sort((a, b) => a.min - b.min).slice(0, 40);

  const frag = document.createDocumentFragment();
  for (const p of products) {
    const on = isFav(p.key);
    const row = document.createElement("div");
    row.className = "prow";
    row.innerHTML = `
      <button class="star ${on ? "on" : ""}" title="${on ? "Favorit entfernen" : "Zu Favoriten"}">${on ? "★" : "☆"}</button>
      <div class="pinfo"><div class="ptitle">${esc(p.title)}</div>
        <div class="pmeta">ab <b>${eur(p.min)}</b> · ${p.count} Angebot${p.count === 1 ? "" : "e"} · ${p.retailers.size} Händler</div></div>`;
    row.querySelector(".star").addEventListener("click", () => toggleFav(p.key, p.title));
    frag.appendChild(row);
  }
  wrap.appendChild(frag);
}

// ---- rendering: favorites ----
function renderFavorites() {
  const wrap = $("#favResults");
  const summary = $("#favSummary");
  wrap.innerHTML = "";
  $("#favCount").textContent = `${state.favorites.length} gespeichert`;

  if (!state.favorites.length) {
    summary.classList.add("hidden");
    wrap.innerHTML = `<div class="empty">Noch keine Favoriten. Suche oben nach echten Produkten und markiere sie mit ★ — sie bleiben in diesem Browser gespeichert.</div>`;
    return;
  }

  let basket = 0, saved = 0, found = 0;
  const frag = document.createDocumentFragment();

  for (const fav of state.favorites) {
    const offers = offersForKey(fav.key);
    const card = document.createElement("div");
    card.className = "rescard";

    if (!offers.length) {
      card.innerHTML = `<div class="rescard-top">
        <div class="titles"><div class="pname">${esc(fav.title)}</div>
        <div class="punit">Diese Woche kein Angebot</div></div>
        <button class="favx" title="Entfernen">✕</button></div>`;
      card.querySelector(".favx").addEventListener("click", () => toggleFav(fav.key, fav.title));
      frag.appendChild(card);
      continue;
    }

    found++;
    const best = offers[0];
    const bv = retailerVisual(best);
    basket += best.price;
    const deal = best.wasPrice && best.wasPrice > best.price;
    if (deal) saved += best.wasPrice - best.price;

    const rows = offers.map((o, i) => {
      const v = retailerVisual(o);
      const label = `${esc(o.productTitle)}${o.unitPrice ? ` · ${esc(o.unitPrice)}` : ""}`;
      const price = `${esc(o.priceFormatted) || eur(o.price)}${o.wasPrice ? ` <s>${eur(o.wasPrice)}</s>` : ""}`;
      return `<div class="orow ${i === 0 ? "win" : ""}">${chipHTML(v)}<span class="oname">${label}</span><span class="oprice">${price}</span></div>`;
    }).join("");

    card.innerHTML = `
      <div class="rescard-top">
        <div class="titles">
          <div class="pname">${esc(fav.title)}${deal ? `<span class="tag-offer">ANGEBOT</span>` : ""}</div>
          <div class="punit">${chipHTML(bv)}${best.validUntil ? ` · gültig bis ${fmtShort(best.validUntil)}` : ""}</div>
        </div>
        <div class="best">
          <div class="price ${deal ? "deal" : ""}">${esc(best.priceFormatted) || eur(best.price)}</div>
          ${best.wasPrice ? `<div class="was">${eur(best.wasPrice)}</div>` : ""}
        </div>
        <button class="favx" title="Entfernen">✕</button>
      </div>
      <span class="toggle">Alle ${offers.length} Angebote ansehen ▾</span>
      <div class="allprices rows">${rows}</div>`;

    card.querySelector(".favx").addEventListener("click", () => toggleFav(fav.key, fav.title));
    card.querySelector(".toggle").addEventListener("click", (e) => {
      card.classList.toggle("open");
      e.target.textContent = card.classList.contains("open") ? "Angebote ausblenden ▴" : `Alle ${offers.length} Angebote ansehen ▾`;
    });
    frag.appendChild(card);
  }

  wrap.appendChild(frag);
  summary.classList.remove("hidden");
  summary.innerHTML = `
    <div class="stat"><div class="k">Warenkorb (Bestpreis)</div><div class="v">${eur(basket)}</div></div>
    <div class="stat save"><div class="k">Ersparnis ggü. Streichpreis</div><div class="v">${eur(saved)}</div></div>
    <div class="stat"><div class="k">Angebote gefunden</div><div class="v">${found}/${state.favorites.length}</div></div>`;
}

// ---- data readiness banner ----
function computeReady() {
  if (!state.kaufda || !state.kaufda.offers.length) return false;
  const today = new Date().toISOString().slice(0, 10);
  const until = state.kaufda.offers.map((o) => o.validUntil).filter(Boolean).sort().pop();
  return !!until && until.slice(0, 10) >= today;
}

function renderStatus() {
  const el = $("#statusBanner");
  const k = state.kaufda;
  if (!k || !k.offers.length) {
    el.innerHTML = `<div class="realctx warn"><span class="dotwarn"></span>
      <b>Die Angebote für diese Woche sind noch nicht verfügbar.</b> Bitte schau später wieder vorbei.</div>`;
    $("#weekBadge").textContent = "Daten in Vorbereitung";
    return;
  }
  const retailers = new Set(k.offers.map((o) => o.retailer).filter(Boolean)).size;
  const until = k.offers.map((o) => o.validUntil).filter(Boolean).sort().pop();
  if (state.ready) {
    el.innerHTML = `<div class="realctx"><span class="live">Live</span>
      <b>Echte Angebote</b> · <b>${esc(k.city)} ${esc(k.zip)}</b> · ${k.offerCount} Angebote aus ${k.brochureCount || "?"} Prospekten von ${retailers} Händlern${until ? ` · gültig bis ${fmtShort(until)}` : ""}</div>`;
    $("#weekBadge").textContent = until ? `Gültig bis ${fmtDay(until)}` : "Aktuelle Woche";
  } else {
    el.innerHTML = `<div class="realctx warn"><span class="dotwarn"></span>
      <b>Die Angebote der aktuellen Woche werden gerade vorbereitet.</b>
      Angezeigt werden die letzten verfügbaren Angebote${until ? ` (gültig bis ${fmtShort(until)})` : ""}.</div>`;
    $("#weekBadge").textContent = "Vorwoche";
  }
}

// ---- boot ----
async function boot() {
  // stores.json is only used for chain colors; ignore if missing
  try {
    const stores = await fetch("data/stores.json").then((r) => r.json());
    (stores.chains || []).forEach((c) => state.chains.set(c.id, c));
  } catch {}

  try {
    // read the latest offer batch from the DB (via the server; credential stays server-side)
    const k = await fetch("/api/offers?zip=10178", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    if (k && Array.isArray(k.offers) && k.offers.length) state.kaufda = k;
  } catch {}

  state.ready = computeReady();
  $("#regionLabel").textContent = state.kaufda ? `${state.kaufda.city} ${state.kaufda.zip}` : "–";
  $("#dataMeta").textContent = state.kaufda
    ? `Datenquelle: kaufDA · ${state.kaufda.offerCount} Angebote · Stand ${new Date(state.kaufda.generatedAt).toLocaleString("de-DE")}.`
    : "Noch keine Daten extrahiert.";

  $("#search").addEventListener("input", renderSearch);

  renderStatus();
  renderSearch();
  renderFavorites();
}

boot();

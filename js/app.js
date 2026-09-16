"use strict";

// ---- i18n ----
const I18N = {
  de: {
    tagline: "Günstigster Supermarkt der Woche",
    searchTitle: "Produkte suchen",
    realOffers: "echte Angebote",
    searchPlaceholder: "Produkt suchen … (z. B. Monster, Joghurt, Kaffee, Barilla)",
    favTitle: "Deine Favoriten",
    footerNote: "Echte Prospekt-Angebote via kaufDA · nur zur Veranschaulichung · Favoriten werden lokal in deinem Browser gespeichert.",
    favSaved: (n) => `${n} gespeichert`,
    searchHint: "Tippe mindestens 2 Zeichen, um echte Angebote zu durchsuchen und mit ★ zu deinen Favoriten hinzuzufügen.",
    searchNone: (q, place) => `Keine Angebote für „${q}“ in ${place} diese Woche.`,
    prodMeta: (min, count, ret) => `ab <b>${min}</b> · ${count} Angebot${count === 1 ? "" : "e"} · ${ret} Händler`,
    addFav: "Zu Favoriten", removeFav: "Favorit entfernen",
    favEmpty: "Noch keine Favoriten. Suche oben nach echten Produkten und markiere sie mit ★ — sie bleiben in diesem Browser gespeichert.",
    noOfferWeek: "Diese Woche kein Angebot",
    validUntil: (d) => `gültig bis ${d}`,
    showAll: (n) => `Alle ${n} Angebote ansehen ▾`,
    hideOffers: "Angebote ausblenden ▴",
    dealTag: "ANGEBOT",
    remove: "Entfernen",
    basket: "Warenkorb (Bestpreis)", savings: "Ersparnis ggü. Streichpreis", found: "Angebote gefunden",
    notReady: "Die Angebote für diese Woche sind noch nicht verfügbar.", notReadySub: "Bitte schau später wieder vorbei.",
    prepping: "Daten in Vorbereitung",
    liveReal: "Echte Angebote",
    ctx: (count, broch, ret, until) => `${count} Angebote aus ${broch} Prospekten von ${ret} Händlern${until ? ` · gültig bis ${until}` : ""}`,
    validBadge: (d) => `Gültig bis ${d}`, currentWeek: "Aktuelle Woche", lastWeek: "Vorwoche",
    stale: (until) => `Die Angebote der aktuellen Woche werden gerade vorbereitet. Angezeigt werden die letzten verfügbaren Angebote${until ? ` (gültig bis ${until})` : ""}.`,
    dataMeta: (count, ts) => `Datenquelle: kaufDA · ${count} Angebote · Stand ${ts}.`,
    noData: "Noch keine Daten extrahiert."
  },
  en: {
    tagline: "Cheapest supermarket of the week",
    searchTitle: "Search products",
    realOffers: "real offers",
    searchPlaceholder: "Search products … (e.g. Monster, yogurt, coffee, Barilla)",
    favTitle: "Your favorites",
    footerNote: "Real flyer offers via kaufDA · for illustration only · favorites are stored locally in your browser.",
    favSaved: (n) => `${n} saved`,
    searchHint: "Type at least 2 characters to search real offers and add them to your favorites with ★.",
    searchNone: (q, place) => `No offers for “${q}” in ${place} this week.`,
    prodMeta: (min, count, ret) => `from <b>${min}</b> · ${count} offer${count === 1 ? "" : "s"} · ${ret} retailer${ret === 1 ? "" : "s"}`,
    addFav: "Add to favorites", removeFav: "Remove favorite",
    favEmpty: "No favorites yet. Search real products above and mark them with ★ — they stay in this browser.",
    noOfferWeek: "No offer this week",
    validUntil: (d) => `valid until ${d}`,
    showAll: (n) => `Show all ${n} offers ▾`,
    hideOffers: "Hide offers ▴",
    dealTag: "DEAL",
    remove: "Remove",
    basket: "Basket (best price)", savings: "Savings vs. list price", found: "Offers found",
    notReady: "This week’s offers aren’t available yet.", notReadySub: "Please check back later.",
    prepping: "Data being prepared",
    liveReal: "Real offers",
    ctx: (count, broch, ret, until) => `${count} offers from ${broch} flyers across ${ret} retailers${until ? ` · valid until ${until}` : ""}`,
    validBadge: (d) => `Valid until ${d}`, currentWeek: "Current week", lastWeek: "Last week",
    stale: (until) => `This week’s offers are being prepared. Showing the latest available offers${until ? ` (valid until ${until})` : ""}.`,
    dataMeta: (count, ts) => `Data source: kaufDA · ${count} offers · as of ${ts}.`,
    noData: "No data extracted yet."
  }
};

function loadLang() {
  try { const s = localStorage.getItem("sf_lang"); if (s === "de" || s === "en") return s; } catch {}
  return (navigator.language || "de").toLowerCase().startsWith("en") ? "en" : "de";
}

// ---- state ----
const state = {
  lang: loadLang(),
  chains: new Map(),
  kaufda: null,
  ready: false,
  favorites: loadFavorites()
};

const $ = (s) => document.querySelector(s);
const t = (k, ...a) => { const v = I18N[state.lang][k] ?? I18N.de[k]; return typeof v === "function" ? v(...a) : v; };
const locale = () => (state.lang === "en" ? "en-IE" : "de-DE");
const eur = (n) => n.toLocaleString(locale(), { style: "currency", currency: "EUR" });
const fmtShort = (d) => new Date(d).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
const fmtDay = (d) => new Date(d).toLocaleDateString(locale(), { day: "2-digit", month: "long" });
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const normTitle = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

// ---- favorites ----
function loadFavorites() { try { return JSON.parse(localStorage.getItem("sf_favs_v2") || "[]"); } catch { return []; } }
function saveFavorites() { try { localStorage.setItem("sf_favs_v2", JSON.stringify(state.favorites)); } catch {} }
const isFav = (key) => state.favorites.some((f) => f.key === key);
function toggleFav(key, title) {
  const i = state.favorites.findIndex((f) => f.key === key);
  if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push({ key, title });
  saveFavorites(); renderSearch(); renderFavorites();
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
function offersForKey(key) {
  const exact = pricedOffers().filter((o) => normTitle(o.productTitle) === key);
  const pool = exact.length ? exact : pricedOffers().filter((o) => (o.searchText || "").includes(key));
  return pool.sort((a, b) => a.price - b.price);
}

// ---- search ----
function renderSearch() {
  const wrap = $("#searchResults");
  const q = ($("#search").value || "").trim().toLowerCase();
  wrap.innerHTML = "";
  if (!state.kaufda) return;
  if (q.length < 2) { wrap.innerHTML = `<div class="empty">${t("searchHint")}</div>`; return; }
  const matches = pricedOffers().filter((o) => (o.searchText || "").includes(q));
  if (!matches.length) {
    wrap.innerHTML = `<div class="empty">${esc(t("searchNone", q, `${state.kaufda.city} ${state.kaufda.zip}`))}</div>`;
    return;
  }
  const byTitle = new Map();
  for (const o of matches) {
    const key = normTitle(o.productTitle); if (!key) continue;
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
      <button class="star ${on ? "on" : ""}" title="${on ? t("removeFav") : t("addFav")}">${on ? "★" : "☆"}</button>
      <div class="pinfo"><div class="ptitle">${esc(p.title)}</div>
        <div class="pmeta">${t("prodMeta", eur(p.min), p.count, p.retailers.size)}</div></div>`;
    row.querySelector(".star").addEventListener("click", () => toggleFav(p.key, p.title));
    frag.appendChild(row);
  }
  wrap.appendChild(frag);
}

// ---- favorites ----
function renderFavorites() {
  const wrap = $("#favResults");
  const summary = $("#favSummary");
  wrap.innerHTML = "";
  $("#favCount").textContent = t("favSaved", state.favorites.length);

  if (!state.favorites.length) {
    summary.classList.add("hidden");
    wrap.innerHTML = `<div class="empty">${t("favEmpty")}</div>`;
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
        <div class="punit">${t("noOfferWeek")}</div></div>
        <button class="favx" title="${t("remove")}">✕</button></div>`;
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
          <div class="pname">${esc(fav.title)}${deal ? `<span class="tag-offer">${t("dealTag")}</span>` : ""}</div>
          <div class="punit">${chipHTML(bv)}${best.validUntil ? ` · ${t("validUntil", fmtShort(best.validUntil))}` : ""}</div>
        </div>
        <div class="best">
          <div class="price ${deal ? "deal" : ""}">${esc(best.priceFormatted) || eur(best.price)}</div>
          ${best.wasPrice ? `<div class="was">${eur(best.wasPrice)}</div>` : ""}
        </div>
        <button class="favx" title="${t("remove")}">✕</button>
      </div>
      <span class="toggle">${t("showAll", offers.length)}</span>
      <div class="allprices rows">${rows}</div>`;

    card.querySelector(".favx").addEventListener("click", () => toggleFav(fav.key, fav.title));
    card.querySelector(".toggle").addEventListener("click", (e) => {
      card.classList.toggle("open");
      e.target.textContent = card.classList.contains("open") ? t("hideOffers") : t("showAll", offers.length);
    });
    frag.appendChild(card);
  }

  wrap.appendChild(frag);
  summary.classList.remove("hidden");
  summary.innerHTML = `
    <div class="stat"><div class="k">${t("basket")}</div><div class="v">${eur(basket)}</div></div>
    <div class="stat save"><div class="k">${t("savings")}</div><div class="v">${eur(saved)}</div></div>
    <div class="stat"><div class="k">${t("found")}</div><div class="v">${found}/${state.favorites.length}</div></div>`;
}

// ---- readiness banner ----
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
    el.innerHTML = `<div class="realctx warn"><span class="dotwarn"></span><b>${t("notReady")}</b> ${t("notReadySub")}</div>`;
    $("#weekBadge").textContent = t("prepping");
    return;
  }
  const retailers = new Set(k.offers.map((o) => o.retailer).filter(Boolean)).size;
  const until = k.offers.map((o) => o.validUntil).filter(Boolean).sort().pop();
  if (state.ready) {
    el.innerHTML = `<div class="realctx"><span class="live">Live</span> <b>${t("liveReal")}</b> · <b>${esc(k.city)} ${esc(k.zip)}</b> · ${t("ctx", k.offerCount, k.brochureCount || "?", retailers, until ? fmtShort(until) : "")}</div>`;
    $("#weekBadge").textContent = until ? t("validBadge", fmtDay(until)) : t("currentWeek");
  } else {
    el.innerHTML = `<div class="realctx warn"><span class="dotwarn"></span><b>${t("stale", until ? fmtShort(until) : "")}</b></div>`;
    $("#weekBadge").textContent = t("lastWeek");
  }
}

// ---- apply static text + language ----
function applyStatic() {
  document.documentElement.lang = state.lang;
  $("#tagline").textContent = t("tagline");
  $("#searchTitle").textContent = t("searchTitle");
  $("#realOffersLabel").textContent = t("realOffers");
  $("#favTitle").textContent = t("favTitle");
  $("#footerNote").textContent = t("footerNote");
  $("#search").placeholder = t("searchPlaceholder");
  $("#dataMeta").textContent = state.kaufda
    ? t("dataMeta", state.kaufda.offerCount, new Date(state.kaufda.generatedAt).toLocaleString(locale()))
    : t("noData");
  document.querySelectorAll("#langToggle .lt").forEach((b) => b.classList.toggle("on", b.dataset.lang === state.lang));
}
function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem("sf_lang", lang); } catch {}
  applyStatic(); renderStatus(); renderSearch(); renderFavorites();
}

// ---- boot ----
async function boot() {
  try {
    const stores = await fetch("data/stores.json").then((r) => r.json());
    (stores.chains || []).forEach((c) => state.chains.set(c.id, c));
  } catch {}
  try {
    const k = await fetch("/api/offers?zip=10178", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
    if (k && Array.isArray(k.offers) && k.offers.length) state.kaufda = k;
  } catch {}

  state.ready = computeReady();
  $("#regionLabel").textContent = state.kaufda ? `${state.kaufda.city} ${state.kaufda.zip}` : "–";

  $("#search").addEventListener("input", renderSearch);
  document.querySelectorAll("#langToggle .lt").forEach((b) =>
    b.addEventListener("click", () => setLang(b.dataset.lang)));

  applyStatic();
  renderStatus();
  renderSearch();
  renderFavorites();
}

boot();

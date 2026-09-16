"use strict";

// ---- state ----
const state = {
  catalog: [],
  chains: new Map(),      // id -> chain
  branches: [],
  offers: [],             // {productId, chainId, price, onOffer, wasPrice?}
  meta: null,
  favorites: loadFavorites(),
  userLoc: null,          // {lat,lng}
  locLabel: null,         // human-readable location label
  nearestChainIds: [],    // 3 nearest chains (by closest branch)
  strategy: "cheapest",
  // real data (kaufDA)
  mode: "real",           // "real" | "demo"
  kaufda: null            // loaded offers-latest.json (brochure-based offers)
};

const $ = (s) => document.querySelector(s);
const eur = (n) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const fmtDay = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "long" });
const fmtShort = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

// Must match the term derivation in scripts/fetch-kaufda.js so favorites map to offers.
const termFor = (p) => (p.name.split("(")[0] || p.name).trim();

function hashHue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; }

// Visual identity for a retailer on a kaufDA offer (mapped chains reuse stores.json colors).
function retailerVisual(o) {
  const c = o.chainId && state.chains.get(o.chainId);
  if (c) return { color: c.color, initials: c.initials, name: o.retailer || c.name };
  const name = o.retailer || "?";
  const initials = (name.replace(/[^A-Za-zÄÖÜäöü]/g, "").slice(0, 2) || name.slice(0, 2)).toUpperCase();
  return { color: `hsl(${hashHue(name)} 52% 42%)`, initials, name };
}
const chipHTML = (v) => `<span class="chip"><span class="dot" style="background:${v.color}">${v.initials}</span>${v.name}</span>`;
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Match a favorite (catalog product) to kaufDA offers by keyword over the offer haystack.
function matchFavorite(term) {
  if (!state.kaufda) return [];
  const t = term.toLowerCase();
  const words = t.split(/[\s\-]+/).filter((w) => w.length >= 4);
  const primary = words.sort((a, b) => b.length - a.length)[0] || t;
  return state.kaufda.offers.filter((o) =>
    typeof o.price === "number" && o.price > 0 &&
    ((o.searchText || "").includes(t) || (o.searchText || "").includes(primary)));
}

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem("sf_favorites") || "[]"); }
  catch { return []; }
}
function saveFavorites() {
  try { localStorage.setItem("sf_favorites", JSON.stringify(state.favorites)); } catch {}
}

// ---- data helpers ----
const product = (id) => state.catalog.find((p) => p.id === id);
const chain = (id) => state.chains.get(id);
const offersFor = (pid) => state.offers.filter((o) => o.productId === pid);

function cheapestOffer(offers) {
  return offers.reduce((best, o) => (!best || o.price < best.price ? o : best), null);
}

function haversine(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function nearestBranches() {
  if (!state.userLoc) return [];
  return state.branches
    .map((b) => ({ ...b, dist: haversine(state.userLoc, b) }))
    .sort((a, b) => a.dist - b.dist);
}

// The set of chains to consider for a given strategy.
function allowedChains() {
  if (state.strategy === "cheapest" || !state.userLoc) return null; // null = all
  if (state.strategy === "nearest") return new Set([state.nearestChainIds[0]]);
  return new Set(state.nearestChainIds); // balanced: 3 nearest
}

// Best offer for a product under the current strategy.
function recommend(pid) {
  const allow = allowedChains();
  let pool = offersFor(pid);
  if (allow) pool = pool.filter((o) => allow.has(o.chainId));
  return { best: cheapestOffer(pool), pool: offersFor(pid) };
}

// ---- rendering ----
function renderCatalog() {
  const q = ($("#search").value || "").trim().toLowerCase();
  const grid = $("#catalog");
  grid.innerHTML = "";
  const list = state.catalog.filter((p) =>
    !q || p.name.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)
  );
  for (const p of list) {
    const on = state.favorites.includes(p.id);
    const el = document.createElement("button");
    el.className = "prod" + (on ? " on" : "");
    el.type = "button";
    el.innerHTML = `
      <span class="prod-emoji">${p.emoji}</span>
      <span class="prod-name">${p.name}</span>
      <span class="prod-unit">${p.unit}</span>
      <span class="prod-check">${on ? "✓ Favorit" : ""}</span>`;
    el.addEventListener("click", () => toggleFavorite(p.id));
    grid.appendChild(el);
  }
  $("#favCount").textContent = `${state.favorites.length} ausgewählt`;
}

function toggleFavorite(id) {
  const i = state.favorites.indexOf(id);
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push(id);
  saveFavorites();
  renderCatalog();
  renderResults();
}

function chip(chainId) {
  const c = chain(chainId);
  if (!c) return chainId;
  return `<span class="chip"><span class="dot" style="background:${c.color}">${c.initials}</span>${c.name}</span>`;
}

function renderResults() {
  if (state.mode === "real" && state.kaufda) {
    const q = ($("#search").value || "").trim();
    return q.length >= 2 ? renderOfferSearch(q) : renderRealResults();
  }
  return renderDemoResults();
}

// Free-text search over the loaded kaufDA offers (any product in the pulled set).
function renderOfferSearch(q) {
  const wrap = $("#results");
  const summary = $("#summary");
  const ql = q.toLowerCase();

  const matches = state.kaufda.offers
    .filter((o) => typeof o.price === "number" && o.price > 0 && (o.searchText || "").includes(ql))
    .sort((a, b) => a.price - b.price);

  if (!matches.length) {
    summary.classList.add("hidden");
    wrap.innerHTML =
      `<div class="empty">Keine Angebote für „${esc(q)}“ in Berlin&nbsp;10178 diese Woche.</div>`;
    return;
  }

  const capped = matches.slice(0, 80);
  const rows = capped.map((o, i) => {
    const v = retailerVisual(o);
    const label = `${o.brand ? `<b>${esc(o.brand)}</b> ` : ""}${esc(o.productTitle)}${o.unitPrice ? ` · ${esc(o.unitPrice)}` : ""}`;
    const price = `${esc(o.priceFormatted) || eur(o.price)}${o.wasPrice ? ` <s>${eur(o.wasPrice)}</s>` : ""}`;
    return `<div class="orow ${i === 0 ? "win" : ""}">${chipHTML(v)}<span class="oname">${label}</span><span class="oprice">${price}</span></div>`;
  }).join("");

  wrap.innerHTML =
    `<div class="rescard">
      <div class="srhead">${matches.length} Angebot${matches.length === 1 ? "" : "e"} für „${esc(q)}“ · Berlin&nbsp;10178${matches.length > capped.length ? ` <span class="muted small">(zeige günstigste ${capped.length})</span>` : ""}</div>
      <div class="allprices rows" style="display:block">${rows}</div>
    </div>`;

  const retailers = new Set(matches.map((o) => o.retailer)).size;
  summary.classList.remove("hidden");
  summary.innerHTML = `
    <div class="stat"><div class="k">Treffer</div><div class="v">${matches.length}</div></div>
    <div class="stat save"><div class="k">Günstigster Preis</div><div class="v">${eur(matches[0].price)}</div></div>
    <div class="stat"><div class="k">Händler</div><div class="v">${retailers}</div></div>`;
}

// ---- REAL results (kaufDA offers for Berlin 10178) ----
function renderRealResults() {
  const wrap = $("#results");
  const summary = $("#summary");
  wrap.innerHTML = "";

  if (!state.favorites.length) {
    summary.classList.add("hidden");
    wrap.innerHTML = `<div class="empty">Wähle oben deine Lieblingsprodukte aus, um echte Angebote in Berlin&nbsp;10178 zu sehen.</div>`;
    return;
  }

  let basket = 0, saved = 0, found = 0;
  const frag = document.createDocumentFragment();

  for (const pid of state.favorites) {
    const p = product(pid);
    const offers = matchFavorite(termFor(p)).sort((a, b) => a.price - b.price);

    const card = document.createElement("div");
    card.className = "rescard";

    if (!offers.length) {
      card.innerHTML = `<div class="rescard-top">
        <span class="emoji">${p.emoji}</span>
        <div class="titles"><div class="pname">${esc(p.name)}</div>
        <div class="punit">${esc(p.unit)}</div></div>
        <div class="best"><div class="where">Diese Woche kein Angebot</div></div></div>`;
      frag.appendChild(card);
      continue;
    }

    found++;
    const best = offers[0];
    const bv = retailerVisual(best);
    basket += best.price;
    const dealNow = best.wasPrice && best.wasPrice > best.price;
    if (dealNow) saved += best.wasPrice - best.price;

    const rows = offers.map((o) => {
      const v = retailerVisual(o);
      const label = `${o.brand ? `<b>${esc(o.brand)}</b> ` : ""}${esc(o.productTitle)}${o.unitPrice ? ` · ${esc(o.unitPrice)}` : ""}`;
      const price = `${esc(o.priceFormatted) || eur(o.price)}${o.wasPrice ? ` <s>${eur(o.wasPrice)}</s>` : ""}`;
      return `<div class="orow ${o === best ? "win" : ""}">${chipHTML(v)}<span class="oname">${label}</span><span class="oprice">${price}</span></div>`;
    }).join("");

    card.innerHTML = `
      <div class="rescard-top">
        <span class="emoji">${p.emoji}</span>
        <div class="titles">
          <div class="pname">${esc(p.name)}${dealNow ? `<span class="tag-offer">ANGEBOT</span>` : ""}</div>
          <div class="punit">${chipHTML(bv)} · ${best.brand ? esc(best.brand) + " " : ""}${esc(best.productTitle)}</div>
        </div>
        <div class="best">
          <div class="price ${dealNow ? "deal" : ""}">${esc(best.priceFormatted) || eur(best.price)}</div>
          ${best.wasPrice ? `<div class="was">${eur(best.wasPrice)}</div>` : ""}
          ${best.validUntil ? `<div class="valid">bis ${fmtShort(best.validUntil)}</div>` : ""}
        </div>
      </div>
      <span class="toggle">Alle ${offers.length} Angebote ansehen ▾</span>
      <div class="allprices rows">${rows}</div>`;

    card.querySelector(".toggle").addEventListener("click", (e) => {
      card.classList.toggle("open");
      e.target.textContent = card.classList.contains("open")
        ? `Angebote ausblenden ▴` : `Alle ${offers.length} Angebote ansehen ▾`;
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

// ---- DEMO results (seed data + location strategies) ----
function renderDemoResults() {
  const wrap = $("#results");
  const summary = $("#summary");
  wrap.innerHTML = "";

  if (!state.favorites.length) {
    summary.classList.add("hidden");
    wrap.innerHTML = `<div class="empty">Wähle oben ein paar Lieblingsprodukte aus, um die günstigsten Märkte zu sehen.</div>`;
    return;
  }

  let basketTotal = 0, basketFull = 0, dealCount = 0;
  const frag = document.createDocumentFragment();

  for (const pid of state.favorites) {
    const p = product(pid);
    const { best, pool } = recommend(pid);
    const card = document.createElement("div");
    card.className = "rescard";

    if (!best) {
      card.innerHTML = `<div class="rescard-top">
        <span class="emoji">${p.emoji}</span>
        <div class="titles"><div class="pname">${p.name}</div>
        <div class="punit">${p.unit}</div></div>
        <div class="best"><div class="where">Kein Angebot in Auswahl</div></div></div>`;
      frag.appendChild(card);
      continue;
    }

    basketTotal += best.price;
    const avg = pool.reduce((s, o) => s + o.price, 0) / pool.length;
    basketFull += avg;
    if (best.onOffer) dealCount++;

    const wasHtml = best.wasPrice ? `<div class="was">${eur(best.wasPrice)}</div>` : "";
    const offerTag = best.onOffer ? `<span class="tag-offer">ANGEBOT</span>` : "";

    const sorted = [...pool].sort((a, b) => a.price - b.price);
    const linesHtml = sorted.map((o) =>
      `<div class="pline ${o.chainId === best.chainId ? "win" : ""}">
        ${chip(o.chainId)}<span>${eur(o.price)}${o.onOffer ? " ⚡" : ""}</span></div>`).join("");

    card.innerHTML = `
      <div class="rescard-top">
        <span class="emoji">${p.emoji}</span>
        <div class="titles">
          <div class="pname">${p.name}${offerTag}</div>
          <div class="punit">${p.unit} · ${chip(best.chainId)}</div>
        </div>
        <div class="best">
          <div class="price ${best.onOffer ? "deal" : ""}">${eur(best.price)}</div>
          ${wasHtml}
        </div>
      </div>
      <span class="toggle">Alle ${pool.length} Preise ansehen ▾</span>
      <div class="allprices">${linesHtml}</div>`;

    card.querySelector(".toggle").addEventListener("click", (e) => {
      card.classList.toggle("open");
      e.target.textContent = card.classList.contains("open")
        ? `Preise ausblenden ▴` : `Alle ${pool.length} Preise ansehen ▾`;
    });
    frag.appendChild(card);
  }

  wrap.appendChild(frag);

  const saved = basketFull - basketTotal;
  summary.classList.remove("hidden");
  summary.innerHTML = `
    <div class="stat"><div class="k">Warenkorb (Bestpreis)</div><div class="v">${eur(basketTotal)}</div></div>
    <div class="stat save"><div class="k">Ersparnis ggü. Ø-Preis</div><div class="v">${eur(Math.max(0, saved))}</div></div>
    <div class="stat"><div class="k">Aktuelle Angebote</div><div class="v">${dealCount}</div></div>`;
}

// ---- location ----
function useLocation() {
  const status = $("#locStatus");
  if (!navigator.geolocation) { status.textContent = "Standort wird vom Browser nicht unterstützt."; return; }
  status.textContent = "GPS-Standort wird ermittelt …";
  navigator.geolocation.getCurrentPosition(
    (pos) => setLocation(pos.coords.latitude, pos.coords.longitude, "GPS-Standort"),
    (err) => { status.textContent = "Standort nicht verfügbar (" + err.message + "). Nutze die PLZ-Eingabe."; },
    { enableHighAccuracy: false, timeout: 8000 }
  );
}

// Look up a German postal code -> coordinates (free, CORS-enabled).
async function usePlz() {
  const status = $("#locStatus");
  const plz = ($("#plzInput").value || "").trim();
  if (!/^\d{5}$/.test(plz)) { status.textContent = "Bitte eine 5-stellige Postleitzahl eingeben."; return; }
  status.textContent = `PLZ ${plz} wird gesucht …`;
  try {
    const r = await fetch(`https://api.zippopotam.us/de/${plz}`);
    if (!r.ok) throw new Error("nicht gefunden");
    const d = await r.json();
    const p = d.places[0];
    setLocation(+p.latitude, +p.longitude, `${plz} ${p["place name"]}`);
  } catch {
    status.textContent = `PLZ ${plz} nicht gefunden. Bitte prüfen oder eine Schnellauswahl nutzen.`;
  }
}

function setLocation(lat, lng, label) {
  state.userLoc = { lat, lng };
  state.locLabel = label;
  onLocation();
}

function onLocation() {
  const branches = nearestBranches();
  // 3 nearest DISTINCT chains, each with its closest branch
  const seen = new Set(); const nearChains = [];
  for (const b of branches) {
    if (!seen.has(b.chainId)) { seen.add(b.chainId); nearChains.push(b); }
    if (nearChains.length >= 3) break;
  }
  state.nearestChainIds = nearChains.map((b) => b.chainId);

  $("#locStatus").textContent = `Standort: ${state.locLabel || "erkannt"}. Wähle eine Priorität.`;
  document.querySelectorAll('.strat-opt[data-lock] input').forEach((i) => (i.disabled = false));
  document.querySelectorAll(".strat-opt.is-locked").forEach((el) => el.classList.remove("is-locked"));

  const fmtDist = (km) => (km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1) + " km");
  const near = $("#nearby");
  near.classList.remove("hidden");
  let html = `<h3>Deine nächsten Märkte</h3>` + nearChains.map((b) =>
    `<div class="branch">${chip(b.chainId)}<span class="muted">${b.name}</span>
     <span class="dist">${fmtDist(b.dist)}</span></div>`).join("");
  // Sample store data currently only covers München + Berlin — be honest if far.
  if (nearChains[0] && nearChains[0].dist > 40) {
    html += `<div class="coverage">ℹ️ Aktuell sind nur Beispiel-Märkte in München &amp; Berlin hinterlegt
      (nächster ist ${fmtDist(nearChains[0].dist)} entfernt). Die Standort-Prioritäten funktionieren,
      aber echte Filialdaten für deine Region folgen.</div>`;
  }
  near.innerHTML = html;

  renderResults();
}

// Switch between real (kaufDA) and demo (seed) data modes.
function setMode(mode) {
  if (mode === "real" && !state.kaufda) mode = "demo";
  state.mode = mode;
  document.querySelectorAll("#modeToggle .mt").forEach((b) =>
    b.classList.toggle("on", b.dataset.mode === mode));
  // demo location panel only makes sense in demo mode
  $("#locPanel").classList.toggle("hidden", mode === "real");
  $("#realContext").classList.toggle("hidden", mode !== "real");
  $("#search").placeholder = mode === "real"
    ? "Angebote durchsuchen … (z. B. Joghurt, Barilla, Käse) oder Favoriten wählen"
    : "Produkt suchen … (z. B. Monster, Milch, Hähnchen)";
  applyHeader();
  renderResults();
}

function applyHeader() {
  const badge = $("#weekBadge"), meta = $("#dataMeta");
  if (state.mode === "real" && state.kaufda) {
    const k = state.kaufda;
    badge.textContent = `Echte Angebote · Berlin ${k.zip}`;
    meta.textContent = `Datenquelle: kaufDA (${k.offerCount} Angebote, Berlin ${k.zip}) · Stand ${new Date(k.generatedAt).toLocaleString("de-DE")}.`;
  } else {
    badge.textContent = `Angebote gültig bis ${fmtDay(state.meta.validUntil)}`;
    meta.textContent = `Beispieldaten (${state.meta.source}) · aktualisiert am ${new Date(state.meta.generatedAt).toLocaleString("de-DE")} · Angebotswoche ab ${fmtDay(state.meta.weekOf)}.`;
  }
}

// ---- boot ----
async function boot() {
  try {
    const [catalog, stores, offers] = await Promise.all([
      fetch("data/catalog.json").then((r) => r.json()),
      fetch("data/stores.json").then((r) => r.json()),
      fetch("data/offers.json").then((r) => r.json())
    ]);
    state.catalog = catalog.products;
    stores.chains.forEach((c) => state.chains.set(c.id, c));
    state.branches = stores.branches;
    state.offers = offers.offers;
    state.meta = offers;
  } catch (e) {
    document.querySelector("main").innerHTML =
      `<div class="panel"><b>Daten konnten nicht geladen werden.</b><br>
      Bitte die Seite über einen lokalen Server öffnen (siehe README), nicht per Doppelklick als Datei.<br>
      <span class="muted small">${e.message}</span></div>`;
    return;
  }

  // Real kaufDA data is optional — degrade to demo if it's not there.
  try {
    const k = await fetch("data/kaufda/10178/offers-latest.json").then((r) => r.json());
    if (k && Array.isArray(k.offers) && k.offers.length) {
      state.kaufda = k;
      const retailers = new Set(k.offers.map((o) => o.retailer).filter(Boolean)).size;
      const until = k.offers.map((o) => o.validUntil).filter(Boolean).sort().pop();
      $("#realContext").innerHTML =
        `<span class="live">Live</span> <b>Echte Angebote</b> aus kaufDA · <b>Berlin ${k.zip}</b> · ${k.offerCount} Angebote aus ${k.brochureCount || "?"} Prospekten von ${retailers} Händlern${until ? ` · gültig bis ${fmtShort(until)}` : ""}`;
    }
  } catch { /* no real data → demo mode */ }

  $("#search").addEventListener("input", () => { renderCatalog(); renderResults(); });
  $("#locBtn").addEventListener("click", useLocation);
  $("#plzBtn").addEventListener("click", usePlz);
  $("#plzInput").addEventListener("keydown", (e) => { if (e.key === "Enter") usePlz(); });
  document.querySelectorAll(".city").forEach((b) =>
    b.addEventListener("click", () => setLocation(+b.dataset.lat, +b.dataset.lng, b.dataset.label)));
  document.querySelectorAll('input[name="strat"]').forEach((r) =>
    r.addEventListener("change", (e) => { state.strategy = e.target.value; renderResults(); }));
  document.querySelectorAll("#modeToggle .mt").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode)));

  renderCatalog();
  setMode(state.kaufda ? "real" : "demo");
}

boot();

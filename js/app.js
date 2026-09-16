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
  nearestChainIds: [],    // 3 nearest chains (by closest branch)
  strategy: "cheapest"
};

const $ = (s) => document.querySelector(s);
const eur = (n) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

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
  status.textContent = "Standort wird ermittelt …";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      onLocation();
    },
    (err) => { status.textContent = "Standort nicht verfügbar (" + err.message + "). Es gilt der bundesweite Bestpreis."; },
    { enableHighAccuracy: false, timeout: 8000 }
  );
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

  $("#locStatus").textContent = "Standort erkannt. Wähle eine Priorität.";
  document.querySelectorAll('.strat-opt[data-lock] input').forEach((i) => (i.disabled = false));
  document.querySelectorAll(".strat-opt.is-locked").forEach((el) => el.classList.remove("is-locked"));

  const near = $("#nearby");
  near.classList.remove("hidden");
  near.innerHTML = `<h3>Deine nächsten Märkte</h3>` + nearChains.map((b) =>
    `<div class="branch">${chip(b.chainId)}<span class="muted">${b.name}</span>
     <span class="dist">${b.dist < 1 ? Math.round(b.dist * 1000) + " m" : b.dist.toFixed(1) + " km"}</span></div>`).join("");

  renderResults();
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

  const fmt = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "long" });
  $("#weekBadge").textContent = `Angebote gültig bis ${fmt(state.meta.validUntil)}`;
  $("#dataMeta").textContent =
    `Datenquelle: ${state.meta.source} · aktualisiert am ${new Date(state.meta.generatedAt).toLocaleString("de-DE")} · Angebotswoche ab ${fmt(state.meta.weekOf)}.`;

  $("#search").addEventListener("input", renderCatalog);
  $("#locBtn").addEventListener("click", useLocation);
  document.querySelectorAll('input[name="strat"]').forEach((r) =>
    r.addEventListener("change", (e) => { state.strategy = e.target.value; renderResults(); }));

  renderCatalog();
  renderResults();
}

boot();

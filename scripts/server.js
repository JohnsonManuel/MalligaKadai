#!/usr/bin/env node
// Local app server: serves the static frontend AND provides an admin API to run
// the weekly kaufDA extraction and report data readiness.
//
//   GET  /                     -> user app (index.html)
//   GET  /admin                -> admin panel
//   GET  /api/status?zip=10178 -> data readiness + last extraction job state
//   POST /api/extract          -> run `node scripts/fetch-kaufda.js` (zip in body/query)
//   GET  /api/extract/log      -> live log + result of the running/last job
//
// Dev tool: binds to localhost, no auth. Don't expose this to the internet as-is.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const zlib = require("zlib");
const db = require("./lib/db");
const geocode = require("./lib/geocode");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 4173;
// Bind to all interfaces so a PaaS (Render, etc.) can route traffic; localhost still works.
const HOST = process.env.HOST || "0.0.0.0";
const locations = JSON.parse(fs.readFileSync(path.join(ROOT, "config/locations.json"), "utf8"));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "88888888";
const checkPw = (req) => (req.headers["x-admin-password"] || "") === ADMIN_PASSWORD;

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// ---- extraction job state (single job at a time) ----
let job = { running: false, zip: null, log: "", startedAt: null, finishedAt: null, ok: null };

// Fallback to the on-disk JSON batch when the DB is unconfigured/unreachable.
function fileBatch(zip) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kaufda", zip, "offers-latest.json"), "utf8")); }
  catch { return null; }
}
function readyOf(offers) {
  const today = new Date().toISOString().slice(0, 10);
  const until = (offers || []).map((o) => o.validUntil).filter(Boolean)
    .map((d) => new Date(d).toISOString().slice(0, 10)).sort().pop() || null;
  return { ready: !!until && until >= today, validUntil: until };
}

function runExtract(loc) {
  job = { running: true, zip: loc.zip, log: `Starte Extraktion für ${loc.zip} ${loc.city || ""} …\n`, startedAt: new Date().toISOString(), finishedAt: null, ok: null };
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "fetch-kaufda.js")], {
    cwd: ROOT, env: { ...process.env, ZIP: loc.zip, LAT: loc.lat || "", LNG: loc.lng || "", CITY: loc.city || "" }
  });
  const append = (b) => { job.log += b.toString(); if (job.log.length > 20000) job.log = job.log.slice(-20000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("close", (code) => { job.running = false; job.finishedAt = new Date().toISOString(); job.ok = code === 0; job.log += `\n— fertig (exit ${code}) —\n`; });
  child.on("error", (err) => { job.running = false; job.finishedAt = new Date().toISOString(); job.ok = false; job.log += `\nFehler: ${err.message}\n`; });
}

function sendJson(res, code, obj, req) {
  const body = Buffer.from(JSON.stringify(obj));
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  const ae = (req && req.headers["accept-encoding"]) || "";
  if (/\bgzip\b/.test(ae) && body.length > 1024) {
    const gz = zlib.gzipSync(body);
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
    res.writeHead(code, headers);
    res.end(gz);
  } else {
    res.writeHead(code, headers);
    res.end(body);
  }
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath === "/admin") urlPath = "/admin.html";
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    // admin: readiness (from the DB, falling back to the JSON file) + current job state
    if (p === "/api/status") {
      const zip = url.searchParams.get("zip") || locations.default;
      let data, dbError = null;
      try {
        data = await db.status(zip);
        if (!data.exists) throw new Error("no DB batch");   // fall back to file
      } catch (e) {
        dbError = db.isConfigured() ? e.message : null;
        const f = fileBatch(zip);
        data = f ? { configured: db.isConfigured(), source: "file", exists: true, ...readyOf(f.offers),
          weekOf: f.weekOf, generatedAt: f.generatedAt, offerCount: f.offerCount, brochureCount: f.brochureCount,
          retailers: new Set((f.offers || []).map((o) => o.retailer).filter(Boolean)).size }
          : { configured: db.isConfigured(), exists: false, ready: false };
      }
      return sendJson(res, 200, { zip, known: !!locations.locations[zip], locations: Object.keys(locations.locations),
        data, dbError, job: { running: job.running, zip: job.zip, ok: job.ok, startedAt: job.startedAt, finishedAt: job.finishedAt } });
    }

    // user app: the latest offer batch — from the DB, falling back to the JSON file
    if (p === "/api/offers") {
      const zip = url.searchParams.get("zip") || locations.default;
      let batch = null, source = "db";
      if (db.isConfigured()) { try { const b = await db.latestOffers(zip); if (b && b.offers.length) batch = b; } catch {} }
      if (!batch) { const f = fileBatch(zip); if (f) { batch = f; source = "file"; } }
      if (!batch) return sendJson(res, 200, { zip, ready: false, configured: db.isConfigured(), offers: [] }, req);
      return sendJson(res, 200, { ...batch, source, configured: db.isConfigured(), ...readyOf(batch.offers) }, req);
    }

    // loaded regions (from the DB) — so the admin sees what's already there
    if (p === "/api/regions") {
      let regions = [], dbError = null;
      try { if (db.isConfigured()) regions = await db.listRegions(); }
      catch (e) { dbError = e.message; }
      return sendJson(res, 200, { configured: db.isConfigured(), regions, dbError });
    }

    // verify the admin password (so the admin UI can unlock without hardcoding it)
    if (p === "/api/admin/verify" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let pw = req.headers["x-admin-password"];
        try { if (!pw && body) pw = JSON.parse(body).password; } catch {}
        return sendJson(res, 200, { ok: (pw || "") === ADMIN_PASSWORD });
      });
      return;
    }

    if (p === "/api/extract/log") {
      return sendJson(res, 200, { running: job.running, zip: job.zip, ok: job.ok, startedAt: job.startedAt, finishedAt: job.finishedAt, log: job.log });
    }

    // extract any German PLZ: geocode it, then run the pipeline + DB load
    if (p === "/api/extract" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        let zip = url.searchParams.get("zip");
        try { if (!zip && body) zip = JSON.parse(body).zip; } catch {}
        if (!checkPw(req)) return sendJson(res, 401, { error: "Falsches oder fehlendes Passwort" });
        zip = (zip || locations.default).trim();
        if (!/^\d{5}$/.test(zip)) return sendJson(res, 400, { error: "PLZ muss 5-stellig sein" });
        if (job.running) return sendJson(res, 409, { error: "extraction already running", zip: job.zip });
        let loc = locations.locations[zip];
        if (!loc) { loc = await geocode.geocodePlz(zip); }
        if (!loc) return sendJson(res, 400, { error: `PLZ ${zip} konnte nicht gefunden werden` });
        runExtract(loc);
        return sendJson(res, 202, { started: true, zip: loc.zip, city: loc.city });
      });
      return;
    }

    if (p.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });
    return serveStatic(req, res);
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
}).listen(PORT, HOST, async () => {
  console.log(`SparFuchs → listening on ${HOST}:${PORT}  (admin: /admin)`);
  // warm the DB connection + ensure schema once, so the first request is fast
  try { if (db.isConfigured()) await db.ensureSchema(db.getPool()); } catch (e) { console.warn("schema warmup:", e.message); }
});

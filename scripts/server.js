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

const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 4173;
const locations = JSON.parse(fs.readFileSync(path.join(ROOT, "config/locations.json"), "utf8"));

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".ico": "image/x-icon" };

// ---- extraction job state (single job at a time) ----
let job = { running: false, zip: null, log: "", startedAt: null, finishedAt: null, ok: null };

function offersPath(zip) { return path.join(ROOT, "data", "kaufda", zip, "offers-latest.json"); }

// Is the current week's data ready? (offers exist and are still valid today)
function dataStatus(zip) {
  try {
    const d = JSON.parse(fs.readFileSync(offersPath(zip), "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    const validUntil = (d.offers || []).map((o) => o.validUntil).filter(Boolean).sort().pop() || null;
    const ready = !!validUntil && validUntil.slice(0, 10) >= today;
    return { exists: true, ready, weekOf: d.weekOf, generatedAt: d.generatedAt, validUntil,
      offerCount: d.offerCount, brochureCount: d.brochureCount,
      retailers: [...new Set((d.offers || []).map((o) => o.retailer).filter(Boolean))].length };
  } catch { return { exists: false, ready: false }; }
}

function runExtract(zip) {
  job = { running: true, zip, log: `Starte Extraktion für ${zip} …\n`, startedAt: new Date().toISOString(), finishedAt: null, ok: null };
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "fetch-kaufda.js")], {
    cwd: ROOT, env: { ...process.env, ZIP: zip }
  });
  const append = (b) => { job.log += b.toString(); if (job.log.length > 20000) job.log = job.log.slice(-20000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("close", (code) => { job.running = false; job.finishedAt = new Date().toISOString(); job.ok = code === 0; job.log += `\n— fertig (exit ${code}) —\n`; });
  child.on("error", (err) => { job.running = false; job.finishedAt = new Date().toISOString(); job.ok = false; job.log += `\nFehler: ${err.message}\n`; });
}

function sendJson(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }

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

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p === "/api/status") {
    const zip = url.searchParams.get("zip") || locations.default;
    return sendJson(res, 200, { zip, known: !!locations.locations[zip], locations: Object.keys(locations.locations),
      data: dataStatus(zip), job: { running: job.running, zip: job.zip, ok: job.ok, startedAt: job.startedAt, finishedAt: job.finishedAt } });
  }

  if (p === "/api/extract/log") {
    return sendJson(res, 200, { running: job.running, zip: job.zip, ok: job.ok, startedAt: job.startedAt, finishedAt: job.finishedAt, log: job.log });
  }

  if (p === "/api/extract" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let zip = url.searchParams.get("zip");
      try { if (!zip && body) zip = JSON.parse(body).zip; } catch {}
      zip = zip || locations.default;
      if (!locations.locations[zip]) return sendJson(res, 400, { error: `unknown zip "${zip}"` });
      if (job.running) return sendJson(res, 409, { error: "extraction already running", zip: job.zip });
      runExtract(zip);
      return sendJson(res, 202, { started: true, zip });
    });
    return;
  }

  if (p.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });
  return serveStatic(req, res);
}).listen(PORT, "127.0.0.1", () => console.log(`SparFuchs → http://localhost:${PORT}  (admin: http://localhost:${PORT}/admin)`));

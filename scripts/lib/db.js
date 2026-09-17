// Postgres layer for the kaufDA offer store.
//
// Uses ONLY new, prefixed tables (sparfuchs_*). Never drops, truncates or alters
// anything else. Loads are append-only: each extraction inserts a new batch, and
// the app reads the most recent batch per zip — so a refresh never deletes data.
//
// Connection string: DATABASE_URL env var, else config/database.local.json (gitignored).

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const ROOT = path.join(__dirname, "..", "..");

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "database.local.json"), "utf8"));
    return c.url || null;
  } catch { return null; }
}

// Drop sslmode/ssl from the URL so we control TLS via the ssl config below.
// (With sslmode in the string, pg enforces full cert verification and rejects
//  Aiven's self-signed CA chain.)
function stripSslParams(cs) {
  try { const u = new URL(cs); ["sslmode", "ssl", "uselibpqcompat"].forEach((k) => u.searchParams.delete(k)); return u.toString(); }
  catch { return cs; }
}

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const cs = connectionString();
  if (!cs) return null;
  // Aiven requires TLS; we don't ship their CA here, so encrypt without verifying the chain.
  _pool = new Pool({ connectionString: stripSslParams(cs), ssl: { require: true, rejectUnauthorized: false }, max: 4, connectionTimeoutMillis: 8000 });
  _pool.on("error", () => {}); // don't let idle-client errors crash the process
  return _pool;
}
const isConfigured = () => !!connectionString();

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sparfuchs_extractions (
      id            BIGSERIAL PRIMARY KEY,
      zip           TEXT NOT NULL,
      city          TEXT,
      week_of       DATE,
      generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      valid_until   TIMESTAMPTZ,
      offer_count   INTEGER,
      brochure_count INTEGER,
      retailer_count INTEGER,
      source        TEXT
    );`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sparfuchs_extractions_zip_idx ON sparfuchs_extractions (zip, generated_at DESC);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sparfuchs_offers (
      id             BIGSERIAL PRIMARY KEY,
      extraction_id  BIGINT NOT NULL REFERENCES sparfuchs_extractions(id) ON DELETE CASCADE,
      zip            TEXT NOT NULL,
      offer_id       TEXT,
      retailer       TEXT,
      retailer_id    TEXT,
      chain_id       TEXT,
      product_title  TEXT,
      description    TEXT,
      price          NUMERIC(10,2),
      price_formatted TEXT,
      was_price      NUMERIC(10,2),
      unit_price     TEXT,
      valid_from     TIMESTAMPTZ,
      valid_until    TIMESTAMPTZ,
      brochure_id    TEXT,
      page           INTEGER,
      category       TEXT,
      image_url      TEXT,
      search_text    TEXT
    );`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sparfuchs_offers_extraction_idx ON sparfuchs_offers (extraction_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sparfuchs_offers_zip_idx ON sparfuchs_offers (zip);`);
}

const OFFER_COLS = [
  "extraction_id","zip","offer_id","retailer","retailer_id","chain_id","product_title","description",
  "price","price_formatted","was_price","unit_price","valid_from","valid_until","brochure_id","page",
  "category","image_url","search_text"
];

// Save one extraction batch (append-only). Returns { extractionId, inserted }.
async function saveExtraction(meta, offers) {
  const pool = getPool();
  if (!pool) throw new Error("no DATABASE_URL / config/database.local.json");
  await ensureSchema(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const validUntil = offers.map((o) => o.validUntil).filter(Boolean).sort().pop() || null;
    const retailers = new Set(offers.map((o) => o.retailer).filter(Boolean)).size;
    const ext = await client.query(
      `INSERT INTO sparfuchs_extractions (zip, city, week_of, valid_until, offer_count, brochure_count, retailer_count, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [meta.zip, meta.city || null, meta.weekOf || null, validUntil, offers.length, meta.brochureCount || null, retailers, meta.source || "kaufda"]
    );
    const extractionId = ext.rows[0].id;

    const perRow = OFFER_COLS.length;
    const batchRows = Math.max(1, Math.floor(60000 / perRow)); // stay under param limit
    let inserted = 0;
    for (let i = 0; i < offers.length; i += batchRows) {
      const slice = offers.slice(i, i + batchRows);
      const values = [];
      const tuples = slice.map((o, r) => {
        const base = r * perRow;
        values.push(
          extractionId, meta.zip, o.id || null, o.retailer || null, o.retailerId || null, o.chainId || null,
          o.productTitle || null, o.description || null,
          (typeof o.price === "number" ? o.price : null), o.priceFormatted || null,
          (typeof o.wasPrice === "number" ? o.wasPrice : null), o.unitPrice || null,
          o.validFrom || null, o.validUntil || null, o.brochureId || null,
          (Number.isInteger(o.page) ? o.page : null), o.category || null, o.imageUrl || null, o.searchText || null
        );
        return "(" + OFFER_COLS.map((_, c) => `$${base + c + 1}`).join(",") + ")";
      });
      await client.query(`INSERT INTO sparfuchs_offers (${OFFER_COLS.join(",")}) VALUES ${tuples.join(",")}`, values);
      inserted += slice.length;
    }
    await client.query("COMMIT");
    return { extractionId, inserted };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Latest extraction metadata for a zip (or null).
async function latestExtraction(pool, zip) {
  const r = await pool.query(
    `SELECT * FROM sparfuchs_extractions WHERE zip=$1 ORDER BY generated_at DESC LIMIT 1`, [zip]);
  return r.rows[0] || null;
}

// Readiness + counts for a zip, read from the DB.
async function status(zip) {
  const pool = getPool();
  if (!pool) return { configured: false, exists: false, ready: false };
  await ensureSchema(pool);
  const ext = await latestExtraction(pool, zip);
  if (!ext) return { configured: true, exists: false, ready: false };
  const today = new Date().toISOString().slice(0, 10);
  const vu = ext.valid_until ? new Date(ext.valid_until).toISOString().slice(0, 10) : null;
  return {
    configured: true, exists: true, source: "db",
    ready: !!vu && vu >= today,
    weekOf: ext.week_of ? new Date(ext.week_of).toISOString().slice(0, 10) : null,
    generatedAt: ext.generated_at, validUntil: ext.valid_until,
    offerCount: ext.offer_count, brochureCount: ext.brochure_count, retailers: ext.retailer_count
  };
}

// Full latest offer batch for the user app (same shape the frontend expects).
async function latestOffers(zip) {
  const pool = getPool();
  if (!pool) return null;
  await ensureSchema(pool);
  const ext = await latestExtraction(pool, zip);
  if (!ext) return { zip, offers: [], offerCount: 0 };
  const r = await pool.query(
    `SELECT offer_id AS id, retailer, retailer_id AS "retailerId", chain_id AS "chainId",
            product_title AS "productTitle", description, price::float8 AS price, price_formatted AS "priceFormatted",
            was_price::float8 AS "wasPrice", unit_price AS "unitPrice", valid_from AS "validFrom",
            valid_until AS "validUntil", brochure_id AS "brochureId", page, category, image_url AS "imageUrl", search_text AS "searchText"
     FROM sparfuchs_offers WHERE extraction_id=$1 ORDER BY price NULLS LAST`, [ext.id]);
  return {
    zip: ext.zip, city: ext.city,
    weekOf: ext.week_of ? new Date(ext.week_of).toISOString().slice(0, 10) : null,
    generatedAt: ext.generated_at, offerCount: ext.offer_count, brochureCount: ext.brochure_count,
    source: "db", offers: r.rows
  };
}

// One row per loaded region (the latest extraction), for the admin panel.
async function listRegions() {
  const pool = getPool();
  if (!pool) return [];
  await ensureSchema(pool);
  const r = await pool.query(`
    SELECT DISTINCT ON (zip) zip, city, generated_at, valid_until, offer_count, brochure_count, retailer_count
    FROM sparfuchs_extractions ORDER BY zip, generated_at DESC`);
  const today = new Date().toISOString().slice(0, 10);
  return r.rows.map((x) => ({
    zip: x.zip, city: x.city, generatedAt: x.generated_at, validUntil: x.valid_until,
    offerCount: x.offer_count, brochureCount: x.brochure_count, retailers: x.retailer_count,
    ready: !!x.valid_until && new Date(x.valid_until).toISOString().slice(0, 10) >= today
  }));
}

module.exports = { isConfigured, getPool, ensureSchema, saveExtraction, status, latestOffers, listRegions };

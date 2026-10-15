import db from "./db.js";

const UA = "VelizonTracking/2.0 (+https://velizon.com; support@velizon.com)";
const TTL_FOUND_DAYS = 90;
const TTL_MISS_HOURS = 12;

let lastCall = 0;
let chain = Promise.resolve();

// Nominatim's usage policy allows at most one request per second, so lookups are queued.
function throttled(fn) {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function lookup(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`geocoder ${res.status}`);
  const data = await res.json();
  const hit = data[0];
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

/** Returns { lat, lng } or null. Results (including misses) are cached in the database. */
export async function geocode(rawQuery) {
  const query = String(rawQuery || "").trim().replace(/\s+/g, " ");
  if (!query) return null;
  const key = query.toLowerCase();

  const cached = await db.query("SELECT lat, lng, found, updated_at FROM geocache WHERE query = $1", [key]);
  const row = cached.rows[0];
  if (row) {
    const ageMs = Date.now() - new Date(row.updated_at).getTime();
    if (row.found && ageMs < TTL_FOUND_DAYS * 864e5) return { lat: row.lat, lng: row.lng };
    if (!row.found && ageMs < TTL_MISS_HOURS * 36e5) return null;
  }

  try {
    const hit = await throttled(() => lookup(query));
    await db.query(
      `INSERT INTO geocache (query, lat, lng, found, updated_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (query) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, found = EXCLUDED.found, updated_at = NOW()`,
      [key, hit?.lat ?? null, hit?.lng ?? null, Boolean(hit)],
    );
    return hit;
  } catch (err) {
    console.error("[geocode] failed:", err.message);
    return row?.found ? { lat: row.lat, lng: row.lng } : null;
  }
}

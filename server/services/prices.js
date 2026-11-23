// Read side of the price data: summaries (latest or any past week), city/brand tables, history,
// CSV export, and the single "what does a liter cost here?" lookup used by the trip planner.
import { db } from '../db/index.js';
import { PRODUCTS, REGIONS } from '../integrations/doe.js';
import { addDays, daysBetween, manilaDate, nowSql, round } from '../lib/util.js';

export const PRODUCT_ORDER = ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS', 'KEROSENE'];
export const ADJ_PRODUCT = { RON91: 'GASOLINE', RON95: 'GASOLINE', RON97_100: 'GASOLINE', RON97: 'GASOLINE', RON100: 'GASOLINE', DIESEL: 'DIESEL', DIESEL_PLUS: 'DIESEL', KEROSENE: 'KEROSENE' };
export const STALE_DAYS = 14;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const normCity = (s) => String(s || '').toLowerCase().replace(/^city of\s+/, '').replace(/\s+city$/, '').replace(/[^a-zñ ]/g, '').trim();

/** Latest week on file for a region, or the latest one on/before `asOf`. */
export async function latestWeek(region, asOf = null) {
  const params = [region];
  let sql = "SELECT MAX(week_start) AS w FROM fuel_prices WHERE region = ? AND area = 'ALL' AND brand = 'ALL'";
  if (asOf && ISO.test(asOf)) { sql += ' AND week_start <= ?'; params.push(asOf); }
  const r = await db.get(sql, params);
  return r?.w || null;
}

async function previousWeek(region, week) {
  const r = await db.get("SELECT MAX(week_start) AS w FROM fuel_prices WHERE region = ? AND area = 'ALL' AND brand = 'ALL' AND week_start < ?", [region, week]);
  return r?.w || null;
}

/** Every week with data for a region, newest first. */
export async function weeksList(region) {
  return db.all("SELECT DISTINCT week_start, week_end FROM fuel_prices WHERE region = ? AND area = 'ALL' AND brand = 'ALL' ORDER BY week_start DESC", [region]);
}

const shapeRow = (r, prev) => ({
  product: r.product,
  label: PRODUCTS[r.product] || r.product,
  min: r.price_min, max: r.price_max, common: r.price_common,
  estimate: Boolean(r.common_is_estimate),
  change: prev?.price_common != null && r.price_common != null ? round(r.price_common - prev.price_common) : null,
  compareCommon: prev?.price_common ?? null,
});

/**
 * Region summary for `week` (default latest), with change vs `compareTo` (default previous week).
 * `week` may be any date: the week on or before it is used.
 */
export async function regionSummary(region, { week = null, compareTo = null } = {}) {
  const w = await latestWeek(region, week);
  if (!w) return { region, weekStart: null, products: [] };
  const latest = await latestWeek(region);
  const cmp = compareTo ? await latestWeek(region, compareTo) : await previousWeek(region, w);
  const rows = await db.all("SELECT * FROM fuel_prices WHERE region = ? AND area = 'ALL' AND brand = 'ALL' AND week_start = ?", [region, w]);
  const prevRows = cmp ? await db.all("SELECT * FROM fuel_prices WHERE region = ? AND area = 'ALL' AND brand = 'ALL' AND week_start = ?", [region, cmp]) : [];
  const prevBy = new Map(prevRows.map((r) => [r.product, r]));
  const products = rows.filter((r) => PRODUCT_ORDER.includes(r.product)).map((r) => shapeRow(r, prevBy.get(r.product)))
    .sort((a, b) => PRODUCT_ORDER.indexOf(a.product) - PRODUCT_ORDER.indexOf(b.product));
  const first = rows[0];
  const age = daysBetween(w, manilaDate());
  return {
    region, weekStart: w, weekEnd: first?.week_end || addDays(w, 6), isLatest: w === latest, latestWeek: latest,
    compareWeek: cmp, previousWeek: cmp,
    source: first?.source, sourceUrl: first?.source_url, fetchedAt: first?.fetched_at,
    estimated: rows.every((r) => r.common_is_estimate), stale: w === latest && age > STALE_DAYS, ageDays: age, products,
  };
}

export async function allRegions() {
  return Promise.all(REGIONS.map((r) => regionSummary(r)));
}

export async function areaTable(region, week) {
  const w = week || (await latestWeek(region));
  if (!w) return { weekStart: null, areas: [] };
  const rows = await db.all("SELECT area, product, price_min, price_max, price_common, common_is_estimate FROM fuel_prices WHERE region = ? AND week_start = ? AND area <> 'ALL' AND brand = 'ALL' ORDER BY area", [region, w]);
  const areas = new Map();
  for (const r of rows) {
    if (!areas.has(r.area)) areas.set(r.area, { area: r.area, products: {} });
    areas.get(r.area).products[r.product] = { min: r.price_min, max: r.price_max, common: r.price_common, estimate: Boolean(r.common_is_estimate) };
  }
  return { weekStart: w, areas: [...areas.values()] };
}

export async function brandMatrix(region, area, week) {
  const w = week || (await latestWeek(region));
  if (!w) return { weekStart: null, rows: [] };
  const params = [region, w];
  let sql = "SELECT area, brand, product, price_min, price_max FROM fuel_prices WHERE region = ? AND week_start = ? AND brand <> 'ALL'";
  if (area) { sql += ' AND area = ?'; params.push(area); }
  const rows = await db.all(sql, params);
  return { weekStart: w, rows: rows.map((r) => ({ area: r.area, brand: r.brand, product: r.product, min: r.price_min, max: r.price_max })) };
}

/** Weekly history; `from`/`to` (YYYY-MM-DD) or the last `weeks` weeks. */
export async function history(region, product, { area = 'ALL', weeks = 26, from = null, to = null } = {}) {
  const start = from && ISO.test(from) ? from : addDays(manilaDate(), -weeks * 7);
  const end = to && ISO.test(to) ? to : '9999-12-31';
  return db.all("SELECT week_start, price_min AS min, price_max AS max, price_common AS common FROM fuel_prices WHERE region = ? AND area = ? AND brand = 'ALL' AND product = ? AND week_start >= ? AND week_start <= ? ORDER BY week_start", [region, area, product, start, end]);
}

/** Areas (cities / field offices) that have history in a region. */
export async function areasWithHistory(region) {
  const rows = await db.all("SELECT area, COUNT(DISTINCT week_start) AS weeks, MIN(week_start) AS first FROM fuel_prices WHERE region = ? AND area <> 'ALL' AND brand = 'ALL' GROUP BY area ORDER BY area", [region]);
  return rows;
}

/** CSV of prices for a region (all areas or one), optionally between two dates. */
export async function exportCsv(region, { area = null, from = null, to = null, brands = false } = {}) {
  const params = [region, from && ISO.test(from) ? from : '0000-01-01', to && ISO.test(to) ? to : '9999-12-31'];
  let sql = 'SELECT week_start, week_end, region, area, brand, product, price_min, price_max, price_common, common_is_estimate, source, source_url FROM fuel_prices WHERE region = ? AND week_start >= ? AND week_start <= ?';
  if (area) { sql += ' AND area = ?'; params.push(area); }
  if (!brands) sql += " AND brand = 'ALL'";
  sql += ' ORDER BY week_start, area, brand, product';
  const rows = await db.all(sql, params);
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const head = 'week_start,week_end,region,area,brand,product,min,max,common,common_is_estimate,source,source_url';
  return [head, ...rows.map((r) => [r.week_start, r.week_end, r.region, r.area, r.brand, r.product, r.price_min, r.price_max, r.price_common, r.common_is_estimate, r.source, r.source_url].map(esc).join(','))].join('\n');
}

export async function adjustments(weeks = 12) {
  const rows = await db.all("SELECT week_start, week_end, product, amount FROM price_adjustments WHERE company = 'ALL' ORDER BY week_start DESC");
  const byWeek = new Map();
  for (const r of rows) {
    if (!byWeek.has(r.week_start)) byWeek.set(r.week_start, { weekStart: r.week_start, weekEnd: r.week_end, GASOLINE: null, DIESEL: null, KEROSENE: null });
    byWeek.get(r.week_start)[r.product] = r.amount;
  }
  return [...byWeek.values()].slice(0, weeks);
}

export async function adjustmentDetail(weekStart) {
  const w = weekStart || (await db.get('SELECT MAX(week_start) AS w FROM price_adjustments'))?.w;
  if (!w) return { weekStart: null, companies: [] };
  const rows = await db.all("SELECT company, product, amount, source_url FROM price_adjustments WHERE week_start = ? AND company <> 'ALL' ORDER BY company", [w]);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.company)) by.set(r.company, { company: r.company });
    by.get(r.company)[r.product] = r.amount;
  }
  return { weekStart: w, sourceUrl: rows[0]?.source_url || null, companies: [...by.values()] };
}

/**
 * Price per liter to use for a place. Prefers the city's DOE common price, then the region's,
 * then NCR. With `brand`, uses that brand's monitored range in the city (midpoint).
 * With `asOf` (YYYY-MM-DD), uses the week on or before that date instead of the latest.
 */
export async function priceFor({ region = 'NCR', city = null, product = 'RON91', brand = null, asOf = null } = {}) {
  const lookups = [];
  const regionWeek = await latestWeek(region, asOf);
  if (regionWeek) {
    if (city) {
      const areaRows = await db.all("SELECT DISTINCT area FROM fuel_prices WHERE region = ? AND week_start = ? AND area <> 'ALL'", [region, regionWeek]);
      const match = areaRows.find((a) => normCity(a.area) === normCity(city));
      if (match && brand) lookups.push({ region, week: regionWeek, area: match.area, brand, basis: `${brand} range in ${match.area}` });
      if (match) lookups.push({ region, week: regionWeek, area: match.area, brand: 'ALL', basis: `${match.area} common price` });
    }
    lookups.push({ region, week: regionWeek, area: 'ALL', brand: 'ALL', basis: `${region} common price` });
  }
  if (region !== 'NCR') {
    const ncrWeek = await latestWeek('NCR', asOf);
    if (ncrWeek) lookups.push({ region: 'NCR', week: ncrWeek, area: 'ALL', brand: 'ALL', basis: `NCR common price (no ${region} data for this product)`, fallback: true });
  }
  const products = product === 'RON97_100' ? ['RON97_100', 'RON97', 'RON100'] : [product];
  for (const l of lookups) {
    for (const p of products) {
      const r = await db.get('SELECT * FROM fuel_prices WHERE region = ? AND week_start = ? AND area = ? AND brand = ? AND product = ?', [l.region, l.week, l.area, l.brand, p]);
      if (!r) continue;
      const price = l.brand !== 'ALL' ? round((r.price_min + r.price_max) / 2) : r.price_common ?? round((r.price_min + r.price_max) / 2);
      if (price == null) continue;
      const age = daysBetween(r.week_start, manilaDate());
      return {
        price, product, productLabel: PRODUCTS[product] || product, region: l.region, area: l.area, brand: l.brand === 'ALL' ? null : l.brand,
        basis: l.basis, min: r.price_min, max: r.price_max, weekStart: r.week_start, weekEnd: r.week_end, ageDays: age,
        historical: Boolean(asOf), stale: !asOf && age > STALE_DAYS, fallback: Boolean(l.fallback), estimate: Boolean(r.common_is_estimate), sourceUrl: r.source_url,
      };
    }
  }
  return null;
}

/** Admin: manual entry (e.g. while DOE is down, or for a region whose PDF layout is unsupported). */
export async function saveManualPrices(entries, userEmail) {
  let n = 0;
  await db.transaction(async () => {
    for (const e of entries) {
      await db.upsert('fuel_prices', {
        region: e.region, area: e.area || 'ALL', brand: e.brand || 'ALL', product: e.product,
        price_min: e.min ?? e.common, price_max: e.max ?? e.common, price_common: e.common, common_is_estimate: 0,
        week_start: e.weekStart, week_end: e.weekEnd || addDays(e.weekStart, 6), source: 'manual', source_url: `manual entry by ${userEmail}`, fetched_at: nowSql(),
      }, ['region', 'area', 'brand', 'product', 'week_start']);
      n++;
    }
  });
  return n;
}

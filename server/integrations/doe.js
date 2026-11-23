// DOE Philippines retail pump prices: scrape the report listing pages on doe.gov.ph,
// download the weekly PDFs, rebuild their tables from text coordinates, and store
// normalized rows in fuel_prices / price_adjustments.
import { db } from '../db/index.js';
import { cached } from '../lib/cache.js';
import { request } from '../lib/http.js';
import { addDays, isoDate, manilaDate, median, mode, monthIndex, mondayOf, nowSql, round, sha1 } from '../lib/util.js';
import { pdfPages, toRows } from './pdf.js';

const BASE = 'https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices';
export const DOE_PAGES = {
  ncr: { url: `${BASE}/ncr-pump-prices`, kind: 'ncr', region: 'NCR' },
  adjustments: { url: `${BASE}/price-adjustments`, kind: 'adjustment', region: null },
  north_luzon: { url: `${BASE}/north-luzon-pump-prices`, kind: 'regional', region: 'North Luzon' },
  south_luzon: { url: `${BASE}/south-luzon-pump-prices`, kind: 'regional', region: 'South Luzon' },
  visayas: { url: `${BASE}/visayas-pump-prices`, kind: 'regional', region: 'Visayas' },
  mindanao: { url: `${BASE}/mindanao-pump-prices`, kind: 'regional', region: 'Mindanao' },
};
export const REGIONS = ['NCR', 'North Luzon', 'South Luzon', 'Visayas', 'Mindanao'];

export const PRODUCTS = {
  RON91: 'Gasoline RON 91 (Regular)',
  RON95: 'Gasoline RON 95 (Premium)',
  RON97_100: 'Gasoline RON 97/100 (Premium Plus)',
  RON97: 'Gasoline RON 97',
  RON100: 'Gasoline RON 100',
  DIESEL: 'Diesel',
  DIESEL_PLUS: 'Diesel Plus (Premium)',
  KEROSENE: 'Kerosene',
};

const BRAND_NAMES = {
  PETRON: 'Petron', SHELL: 'Shell', CALTEX: 'Caltex', PHOENIX: 'Phoenix', TOTAL: 'Total', TOTALENERGIES: 'Total',
  'FLYING V': 'Flying V', UNIOIL: 'Unioil', SEAOIL: 'Seaoil', PTT: 'PTT', INDEPENDENT: 'Independent',
  CLEANFUEL: 'Cleanfuel', 'CLEAN FUEL': 'Cleanfuel', JETTI: 'Jetti', 'PETRO GAZZ': 'Petro Gazz', FILPRIDE: 'Filpride',
};
export const normalizeBrand = (s) => {
  const k = String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  return BRAND_NAMES[k] || k.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
};

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// ---------------------------------------------------------------- listing pages

/** Best-effort date for a report link from its file name, anchor text and the page's year/month headings. */
export function guessDocDate(rawText, ctxYear, ctxMonth) {
  const text = rawText.replace(/[_\-+%]/g, ' ').replace(/\s+/g, ' ');
  const yearIn = text.match(/\b(20\d{2})\b/);
  const year = yearIn ? +yearIn[1] : ctxYear;
  let m;
  if ((m = text.match(/\b(0[1-9]|1[0-2])([0-3]\d)(20\d{2})\b/))) return isoDate(+m[3], +m[1], +m[2]);
  if ((m = text.match(new RegExp(`\\b${MONTH_RE}[a-z]*\\.?\\s*(\\d{1,2})(?!\\d)`, 'i'))) && year) return isoDate(year, monthIndex(m[1]), +m[2]);
  if ((m = text.match(new RegExp(`\\b(\\d{1,2})\\s+(?:(?:to\\s+)?\\d{1,2}\\s+)?${MONTH_RE}\\b`, 'i'))) && year) return isoDate(year, monthIndex(m[2]), +m[1]);
  if ((m = text.match(/\b(0[1-9]|1[0-2])([0-3]\d)(\d{2})\b/))) return isoDate(2000 + +m[3], +m[1], +m[2]);
  if (ctxYear && ctxMonth) {
    const day = text.match(/\b([0-3]?\d)\s*(?:to|\s)\s*[0-3]?\d\b/);
    return isoDate(ctxYear, ctxMonth, day ? Math.min(28, +day[1]) || 1 : 1);
  }
  return null;
}

export async function listDocuments(pageKey) {
  const page = DOE_PAGES[pageKey];
  // Short cache: the hourly check must see a newly posted report on its next run.
  const html = await cached('doe', `list:${page.url}`, 45 * 60, () => request('doe', page.url, { as: 'text', timeout: 45000 }));
  const headings = [];
  for (const m of html.matchAll(/>\s*(20\d{2})\s*</g)) headings.push({ i: m.index, year: +m[1] });
  for (const m of html.matchAll(new RegExp(`>\\s*${MONTH_RE}\\s*<`, 'gi'))) headings.push({ i: m.index, month: monthIndex(m[1]) });
  headings.sort((a, b) => a.i - b.i);

  const docs = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = m[1].replace(/&amp;/g, '&');
    if (!/\.pdf(\?|$)|-pdf(-\d+)?$|\/documents\/d\//i.test(href)) continue;
    href = href.replace(/^http:\/\//i, 'https://');
    if (!/^https:\/\/[^\s"'<>]+$/i.test(href) || docs.has(href)) continue;
    const anchor = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    let ctxYear = null; let ctxMonth = null;
    for (const h of headings) { if (h.i > m.index) break; if (h.year) { ctxYear = h.year; ctxMonth = null; } if (h.month) ctxMonth = h.month; }
    let file = href.split('?')[0].split('/').pop();
    try { file = decodeURIComponent(file); } catch { /* keep raw */ }
    const date = guessDocDate(`${file} ${anchor}`, ctxYear, ctxMonth);
    docs.set(href, { url: href, title: (anchor || file).slice(0, 250), file, guessedDate: date, kind: page.kind, region: page.region, area: areaFromName(file) });
  }
  const today = manilaDate();
  return [...docs.values()]
    .filter((d) => d.guessedDate && d.guessedDate <= addDays(today, 10))
    .sort((a, b) => (b.guessedDate || '').localeCompare(a.guessedDate || ''));
}

function areaFromName(name) {
  const m = name.match(/\b(CALABARZON|MIMAROPA|Bicol|Region\s+[IVX]+(?:\s*-\s*[AB])?)\b/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

// ---------------------------------------------------------------- PDF parsing

/** "(For the week of October 13-19, 2026)", "for the period of Oct 20-26 2026", "September 29 to October 5, 2026" ... */
export function parseWeek(text) {
  const t = text.replace(/\s+/g, ' ');
  let m = t.match(new RegExp(`${MONTH_RE}\\.?\\s+(\\d{1,2})\\s*(?:-|–|to)\\s*(?:${MONTH_RE}\\.?\\s+)?(\\d{1,2}),?\\s*(20\\d{2})`, 'i'));
  if (m) {
    const y = +m[5]; const sm = monthIndex(m[1]); const em = m[3] ? monthIndex(m[3]) : sm;
    const sy = em < sm ? y - 1 : y;
    return { start: isoDate(sy, sm, +m[2]), end: isoDate(y, em, +m[4]) };
  }
  m = t.match(new RegExp(`(\\d{1,2})\\s*(?:-|–|to)\\s*(\\d{1,2})\\s+${MONTH_RE},?\\s*(20\\d{2})`, 'i'));
  if (m) { const mo = monthIndex(m[3]); return { start: isoDate(+m[4], mo, +m[1]), end: isoDate(+m[4], mo, +m[2]) }; }
  m = t.match(new RegExp(`(\\d{1,2})\\s+${MONTH_RE}\\s*(?:-|–|to)\\s*(\\d{1,2})\\s+${MONTH_RE},?\\s*(20\\d{2})`, 'i'));
  if (m) { const y = +m[5]; return { start: isoDate(y, monthIndex(m[2]), +m[1]), end: isoDate(y, monthIndex(m[4]), +m[3]) }; }
  m = t.match(new RegExp(`${MONTH_RE}\\.?\\s+(\\d{1,2}),?\\s*(20\\d{2})`, 'i'));
  if (m) { const d = isoDate(+m[3], monthIndex(m[1]), +m[2]); const s = addDays(mondayOf(d), 1); return { start: s, end: addDays(s, 6) }; }
  return null;
}

const PRODUCT_LABEL = /^(RON\s*\d{2,3}|DIESEL\s*PLUS|DIESEL|KEROSENE)$/i;
const productKey = (label) => {
  const s = label.toUpperCase().replace(/\s+/g, ' ').trim();
  if (s.startsWith('RON')) return `RON${s.replace(/\D/g, '')}`;
  if (s === 'DIESEL PLUS') return 'DIESEL_PLUS';
  return s;
};
const NUM = /^\d{2,3}\.\d{1,2}$/;
const nearest = (list, v, key) => list.reduce((best, it) => (Math.abs(it[key] - v) < Math.abs(best[key] - v) ? it : best), list[0]);

/** NCR "Price Monitoring of Liquid Fuels": city x product x brand ranges + overall summary. */
export function parseNcr(pages) {
  const fullText = pages.map((p) => toRows(p.items).map((r) => r.items.map((i) => i.s).join(' ')).join('\n')).join('\n');
  const week = parseWeek((fullText.match(/week of[^)\n]*/i) || [fullText])[0]) || parseWeek(fullText);
  const detail = []; const cityRows = [];
  const usedCities = new Set();

  for (const page of pages) {
    const items = page.items;
    const petron = items.find((i) => /^PETRON$/i.test(i.s));
    const productHdr = items.find((i) => /^PRODUCT$/i.test(i.s));
    if (!petron || !productHdr) continue;
    const hy = petron.y;
    const cut = items.find((i) => /^(Date of Monitoring|PREVAILING RETAIL)/i.test(i.s))?.y ?? -Infinity;
    const cols = items
      .filter((i) => Math.abs(i.y - hy) <= 8 && !/^(AREA|PRODUCT|PRICE)$/i.test(i.s))
      .map((i) => ({ cx: i.cx, name: /OVERALL/i.test(i.s) ? '__overall' : /COMMON/i.test(i.s) ? '__common' : normalizeBrand(i.s) }));
    if (cols.length < 4) continue;

    const labels = items
      .filter((i) => PRODUCT_LABEL.test(i.s) && i.x < productHdr.x + 30 && i.y < hy - 4 && i.y > cut)
      .map((i) => ({ ...i, product: productKey(i.s), values: [] }))
      .sort((a, b) => b.y - a.y);
    if (!labels.length) continue;
    const values = items.filter((i) => (NUM.test(i.s) || i.s === '#N/A') && i.x > productHdr.x + 25 && i.y < hy - 4 && i.y > cut - 3);
    for (const v of values) {
      const lab = nearest(labels, v.y, 'y');
      if (Math.abs(lab.y - v.y) <= 6.5) lab.values.push(v);
    }

    const cityLabels = items.filter((i) => i.x < productHdr.x - 5 && i.y < hy - 4 && i.y > cut && /[A-Za-z]{3}/.test(i.s) && !/^AREA$/i.test(i.s) && !PRODUCT_LABEL.test(i.s));
    // Split the label column into one block per city (each block restarts its product list).
    const blocks = []; let cur = null;
    for (const lab of labels) {
      if (!cur || cur.seen.has(lab.product) || lab.product === 'RON100') { cur = { rows: [], seen: new Set() }; blocks.push(cur); }
      cur.rows.push(lab); cur.seen.add(lab.product);
    }
    for (const block of blocks) {
      const top = block.rows[0].y + 6; const bottom = block.rows[block.rows.length - 1].y - 6;
      const mid = (top + bottom) / 2;
      const cands = cityLabels.filter((c) => c.y <= top && c.y >= bottom && !usedCities.has(c.s)).sort((a, b) => Math.abs(a.y - mid) - Math.abs(b.y - mid));
      const city = cands[0]?.s || `Area ${usedCities.size + 1}`;
      usedCities.add(city);
      for (const row of block.rows) {
        const byCol = new Map();
        for (const v of row.values) {
          const col = nearest(cols, v.cx, 'cx');
          if (!byCol.has(col.name)) byCol.set(col.name, []);
          if (v.s !== '#N/A') byCol.get(col.name).push(+v.s);
        }
        const brandVals = [];
        for (const [name, vals] of byCol) {
          if (name.startsWith('__') || !vals.length) continue;
          detail.push({ area: city, brand: name, product: row.product, min: Math.min(...vals), max: Math.max(...vals) });
          brandVals.push(...vals);
        }
        const overall = byCol.get('__overall') || [];
        const common = (byCol.get('__common') || [])[0] ?? null;
        if (!overall.length && !brandVals.length) continue;
        const lo = overall.length ? Math.min(...overall) : Math.min(...brandVals);
        const hi = overall.length ? Math.max(...overall) : Math.max(...brandVals);
        cityRows.push({ area: city, product: row.product, min: lo, max: hi, common: common ?? round(median(brandVals)), commonIsEstimate: common == null });
      }
    }
  }

  // 2017–2018 reports: a brand table without cities, plus a separate "COMMON PRICES" table,
  // or the same printed sideways (rotated page).
  if (!cityRows.length) {
    const legacy = parseNcrLegacy(pages);
    if (legacy.length) return { week, summary: legacy, cityRows, detail };
    const rotated = parseNcrTransposed(pages);
    if (rotated.length) return { week, summary: rotated, cityRows, detail };
    const ranged = parseNcrRanges(pages);
    if (ranged.length) return { week, summary: ranged, cityRows, detail };
  }

  // Overall NCR summary table ("PREVAILING RETAIL PRICES OF PETROLEUM PRODUCTS NCR").
  const summary = [];
  for (const page of pages) {
    const head = page.items.find((i) => /PREVAILING RETAIL PRICES/i.test(i.s));
    if (!head) continue;
    const labs = page.items.filter((i) => i.y < head.y && /^(Gasoline\s*\(RON[^)]*\)|Diesel Plus|Diesel|Kerosene)$/i.test(i.s));
    for (const lab of labs) {
      const nums = page.items.filter((i) => NUM.test(i.s) && Math.abs(i.y - lab.y) <= 7 && i.x > lab.x + 40).sort((a, b) => a.x - b.x).map((i) => +i.s);
      if (nums.length < 2) continue;
      const p = lab.s.match(/RON\s*([\d/]+)/i);
      const product = p ? (p[1].includes('/') ? 'RON97_100' : `RON${p[1]}`) : productKey(lab.s);
      summary.push({ product, min: nums[0], max: nums[1], common: nums[2] ?? null });
    }
  }
  if (!summary.length && cityRows.length) {
    // 2019–2022 reports have no NCR-wide table: derive it from the city rows.
    const derive = (product, rows) => ({ product, min: Math.min(...rows.map((r) => r.min)), max: Math.max(...rows.map((r) => r.max)), common: mode(rows.map((r) => r.common)), estimate: true });
    for (const product of new Set(cityRows.map((r) => r.product))) summary.push(derive(product, cityRows.filter((r) => r.product === product)));
    const premium = cityRows.filter((r) => r.product === 'RON97' || r.product === 'RON100');
    if (premium.length && !summary.some((s) => s.product === 'RON97_100')) {
      const ron97 = premium.filter((r) => r.product === 'RON97');
      summary.push({ ...derive('RON97_100', premium), common: mode((ron97.length ? ron97 : premium).map((r) => r.common)) });
    }
  }
  return { week, summary, cityRows, detail };
}

/** 2017–2018 layout: "PREVAILING RETAIL PRICES ... IN METRO MANILA" (brand ranges) + "COMMON PRICES ..." table. */
function parseNcrLegacy(pages) {
  const out = [];
  const keyOf = (s) => {
    const r = s.match(/RON\s*(\d+)/i);
    if (r) return r[1] === '97' || r[1] === '100' ? 'RON97_100' : `RON${r[1]}`;
    if (/diesel\s*plus/i.test(s)) return 'DIESEL_PLUS';
    if (/diesel/i.test(s)) return 'DIESEL';
    if (/kerosene/i.test(s)) return 'KEROSENE';
    return null;
  };
  for (const page of pages) {
    const commonHead = page.items.find((i) => /COMMON PRICES OF PETROLEUM/i.test(i.s));
    if (!commonHead) continue;
    const commons = new Map();
    for (const lab of page.items.filter((i) => i.y < commonHead.y && /^(Gasoline\s*\(RON\d+\)|Diesel Plus|Diesel|Kerosene)$/i.test(i.s))) {
      const n = page.items.find((i) => NUM.test(i.s) && Math.abs(i.y - lab.y) <= 6 && i.x > lab.x + 40);
      const k = keyOf(lab.s);
      if (n && k) commons.set(k, +n.s);
    }
    // Brand table above: label rows "(RON97)", "Diesel", ... with every brand's min/max on the row.
    const ranges = new Map();
    for (const lab of page.items.filter((i) => i.y > commonHead.y && i.x < 130 && /^(\(RON\d+\)|Gasoline\s*\(RON\d+\)|Diesel Plus|Diesel|Kerosene)$/i.test(i.s))) {
      const k = keyOf(lab.s);
      const nums = page.items.filter((i) => Math.abs(i.y - lab.y) <= 4 && i.x > lab.x + 40 && NUM.test(i.s)).map((i) => +i.s).filter((v) => v > 10);
      if (k && nums.length) ranges.set(k, [Math.min(...nums), Math.max(...nums)]);
    }
    for (const [product, common] of commons) {
      const [min, max] = ranges.get(product) || [common, common];
      out.push({ product, min: Math.min(min, common), max: Math.max(max, common), common });
    }
  }
  return out;
}

/** 2018 rotated layout: products run across one row; "Common Price" and "Overall Range" are rows. */
function parseNcrTransposed(pages) {
  const out = [];
  for (const page of pages) {
    const items = page.items;
    const hdr = items.find((i) => /^Product$/i.test(i.s));
    if (!hdr) continue;
    const band = items.filter((i) => Math.abs(i.y - hdr.y) <= 4 && i.x > hdr.x);
    const cols = [];
    for (const it of band) {
      let product = null;
      const r = it.s.match(/^\(RON\s*(\d+)\)$/i);
      if (r) product = r[1] === '97' || r[1] === '100' ? 'RON97_100' : `RON${r[1]}`;
      else if (/^Diesel$/i.test(it.s)) product = items.some((p) => /^Plus$/i.test(p.s) && Math.abs(p.x - it.x) <= 4) ? 'DIESEL_PLUS' : 'DIESEL';
      else if (/^Kerosene$/i.test(it.s)) product = 'KEROSENE';
      if (product && !cols.some((c) => c.product === product)) cols.push({ x: it.x, product });
    }
    if (cols.length < 3) continue;
    const lo = Math.min(...cols.map((c) => c.x)) - 6; const hi = Math.max(...cols.map((c) => c.x)) + 6;
    const valueRows = toRows(items.filter((i) => NUM.test(i.s) && i.x >= lo && i.x <= hi), 3).filter((r) => r.items.length >= 3);
    const rowNear = (re) => {
      const lab = items.find((i) => re.test(i.s) && i.x < lo);
      if (!lab) return null;
      const best = [...valueRows].sort((a, b) => Math.abs(a.y - lab.y) - Math.abs(b.y - lab.y))[0];
      return best && Math.abs(best.y - lab.y) < 40 ? best : null;
    };
    const common = rowNear(/^Common$/i); const min = rowNear(/^Overall$/i); const max = rowNear(/^Range$/i);
    if (!common) continue;
    const at = (row, x) => row?.items.find((i) => Math.abs(i.x - x) <= 6);
    for (const c of cols) {
      const cv = at(common, c.x);
      if (!cv) continue;
      const v = +cv.s; const a = at(min, c.x); const b = at(max, c.x);
      out.push({ product: c.product, min: a ? Math.min(+a.s, v) : v, max: b ? Math.max(+b.s, v) : v, common: v });
    }
  }
  return out;
}

/**
 * Early-2017 layout: one row per product with "min-max" per brand and no common price.
 * The common price is estimated as the median of the brand midpoints.
 */
function parseNcrRanges(pages) {
  const out = new Map();
  for (const page of pages) {
    for (const row of toRows(page.items, 3)) {
      const text = row.items.map((i) => i.s).join(' ');
      const lab = text.match(/^\s*(GASOLINE\s*\(RON\s*(\d+)\)|DIESEL\s*PLUS|DIESEL|KEROSENE)/i);
      if (!lab) continue;
      const ranges = [...text.matchAll(/(\d{2,3}\.\d{2})\s*-\s*(\d{2,3}\.\d{2})/g)].map((m) => [+m[1], +m[2]]);
      if (!ranges.length) continue;
      const product = lab[2] ? (lab[2] === '97' || lab[2] === '100' ? 'RON97_100' : `RON${lab[2]}`) : productKey(lab[1]);
      if (out.has(product)) continue;
      out.set(product, { product, min: Math.min(...ranges.map((r) => r[0])), max: Math.max(...ranges.map((r) => r[1])), common: round(median(ranges.map(([a, b]) => (a + b) / 2))), estimate: true });
    }
  }
  return [...out.values()];
}

/** DOE price weeks run Tuesday to Monday; snap any date inside a week to its Tuesday. */
export function tuesdayOf(iso) {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((dow - 2 + 7) % 7));
}

/** "Summary of Prior Notice on Price Adjustments": per-company peso/liter changes. */
export function parseAdjustments(pages) {
  const fullText = pages.map((p) => toRows(p.items).map((r) => r.items.map((i) => i.s).join(' ')).join('\n')).join('\n');
  const week = parseWeek((fullText.match(/week[^\n]*/i) || [''])[0]) || parseWeek(fullText);
  const rows = [];
  for (const page of pages) {
    const heads = page.items.filter((i) => /^(Gasoline|Diesel|Kerosene)$/i.test(i.s));
    const gas = heads.find((h) => /gasoline/i.test(h.s));
    if (!gas) continue;
    const cols = heads.filter((h) => Math.abs(h.y - gas.y) <= 8).map((h) => ({ cx: h.cx, product: h.s.toUpperCase() }));
    const NUMV = /^\(?[+-−–]?\s?\d{1,2}(\.\d{1,2})?\)?$/;
    const companies = page.items.filter((i) => i.y < gas.y && i.x < gas.x - 60 && /^[A-Za-z][A-Za-z .&'-]{1,30}$/.test(i.s)
      && !new RegExp(`^(oil company|text message|date|time|effectivity|was received|products|summary|for the week|am|pm|${MONTH_RE})`, 'i').test(i.s));
    const nums = page.items.filter((i) => i.y < gas.y && i.x > gas.x - 40 && NUMV.test(i.s));
    const byCompany = new Map();
    for (const n of nums) {
      if (!companies.length) break;
      const c = nearest(companies, n.y, 'y');
      if (Math.abs(c.y - n.y) > 9) continue;
      const col = nearest(cols, n.cx, 'cx');
      if (Math.abs(col.cx - n.cx) > 45) continue;
      let v = +n.s.replace(/[()\s]/g, '').replace(/[−–]/g, '-');
      if (/^\(.*\)$/.test(n.s)) v = -Math.abs(v);
      if (!Number.isFinite(v) || Math.abs(v) > 25) continue;
      const key = normalizeBrand(c.s);
      if (!byCompany.has(key)) byCompany.set(key, {});
      byCompany.get(key)[col.product] = v;
    }
    for (const [company, vals] of byCompany) for (const [product, amount] of Object.entries(vals)) rows.push({ company, product, amount });
  }
  const consensus = {};
  for (const product of ['GASOLINE', 'DIESEL', 'KEROSENE']) {
    const vals = rows.filter((r) => r.product === product).map((r) => r.amount);
    if (vals.length) consensus[product] = mode(vals);
  }
  return { week, rows, consensus };
}

const REGIONAL_PRODUCTS = [
  ['RON97_100', /\b(RON\s*-?\s*(97|100)|PREMIUM\s*PLUS|SUPER\s*PREMIUM|BLAZE|V-?POWER\s*RACING)\b/i],
  ['DIESEL_PLUS', /\b(DIESEL\s*PLUS|PREMIUM\s*DIESEL|TURBO\s*DIESEL|DIESEL\s*MAX|V-?POWER\s*DIESEL|POWER\s*DIESEL)\b/i],
  ['RON95', /\b(RON\s*-?\s*95|PREMIUM|XCS|V-?POWER(?!\s*(DIESEL|RACING))|PLATINUM)\b/i],
  ['RON91', /\b(RON\s*-?\s*91|UNLEADED|REGULAR|XTRA|FUEL\s*SAVE|SILVER)\b/i],
  ['DIESEL', /\bDIESEL\b/i],
  ['KEROSENE', /\bKEROSENE\b/i],
];
const regionalProduct = (s) => (REGIONAL_PRODUCTS.find(([, re]) => re.test(s)) || [null])[0];
const priceLike = (s) => {
  if (!/^\d{2,3}([.,]\d{1,2})?$/.test(s)) return null;
  const v = +s.replace(',', '.');
  return v >= 40 && v <= 200 ? v : null;
};

/**
 * Regional reports vary a lot by field office; collect every price-like value per product.
 * `ref` (product -> NCR common price) drops values far outside a plausible band, which removes
 * numbers that landed in the wrong column.
 */
export function parseRegional(pages, ref = {}) {
  const plausible = (product, v) => !ref[product] || (v >= ref[product] * 0.75 && v <= ref[product] * 1.3);
  const fullText = pages.map((p) => toRows(p.items).map((r) => r.items.map((i) => i.s).join(' ')).join('\n')).join('\n');
  const week = parseWeek((fullText.match(/(week|period)[^\n]*/i) || [''])[0]) || parseWeek(fullText);
  const byRow = {}; const byCol = {};
  const push = (bag, k, v) => { (bag[k] ||= []).push(v); };

  for (const page of pages) {
    const rows = toRows(page.items, 3);
    // Layout A: product label at the start of a row, prices across the row.
    for (const row of rows) {
      const label = row.items.find((i) => /[A-Za-z]/.test(i.s));
      const product = label && label.x < 200 ? regionalProduct(label.s) : null;
      if (!product) continue;
      for (const it of row.items) { const v = priceLike(it.s); if (v != null && it.x > label.x) push(byRow, product, v); }
    }
    // Layout B: products are column headers, one station or LGU per row.
    const headerRow = rows.find((r) => new Set(r.items.map((i) => regionalProduct(i.s)).filter(Boolean)).size >= 3);
    if (headerRow) {
      const cols = headerRow.items.map((i) => ({ cx: i.cx, product: regionalProduct(i.s) })).filter((c) => c.product);
      for (const row of rows) {
        if (row.y >= headerRow.y) continue;
        for (const it of row.items) {
          const v = priceLike(it.s); if (v == null) continue;
          const col = nearest(cols, it.cx, 'cx');
          if (Math.abs(col.cx - it.cx) < 40) push(byCol, col.product, v);
        }
      }
    }
  }
  const countVals = (bag) => Object.values(bag).reduce((s, a) => s + a.length, 0);
  const bag = countVals(byCol) > countVals(byRow) ? byCol : byRow;
  const products = {};
  for (const [product, all] of Object.entries(bag)) {
    const vals = all.filter((v) => plausible(product, v));
    if (vals.length < 3) continue;
    const sorted = [...vals].sort((a, b) => a - b);
    // Trim the outer 5% to drop stray numbers (dates, IDs) that look like prices.
    const k = Math.floor(sorted.length * 0.05);
    const core = sorted.slice(k, sorted.length - k || undefined);
    products[product] = { min: core[0], max: core[core.length - 1], common: round(median(core)), n: vals.length };
  }
  return { week, products };
}


// ---------------------------------------------------------------- storage

/** A report that downloaded fine but cannot be read (scanned, new layout). Not retried automatically. */
class ParseError extends Error {}

async function fetchPdf(url) {
  return request('doe', url, { as: 'buffer', timeout: 60000, retries: 1 });
}

/** Tuesday-to-Monday week from the PDF text, falling back to the date in the file name. */
function weekOf(parsedWeek, guessedDate) {
  const anchor = parsedWeek?.start || guessedDate;
  if (!anchor) return null;
  const start = tuesdayOf(anchor);
  return { start, end: addDays(start, 6) };
}

async function recordDoc(doc, status, message, rows, weekStart) {
  await db.upsert('doe_documents', {
    url_hash: sha1(doc.url), url: doc.url, kind: doc.kind, region: doc.region, title: doc.title?.slice(0, 250) || null,
    guessed_date: doc.guessedDate, week_start: weekStart || null, status, message: message ? String(message).slice(0, 480) : null,
    rows_count: rows || 0, fetched_at: nowSql(),
  }, ['url_hash']);
}

const priceRow = (o) => ({
  region: o.region, area: o.area, brand: o.brand, product: o.product,
  price_min: o.min ?? null, price_max: o.max ?? null, price_common: o.common ?? null, common_is_estimate: o.estimate ? 1 : 0,
  week_start: o.weekStart, week_end: o.weekEnd || null, source: o.source || 'doe_pdf', source_url: o.url || null, fetched_at: nowSql(),
});

export async function storePriceRows(rows) {
  await db.transaction(async () => {
    for (const r of rows) await db.upsert('fuel_prices', priceRow(r), ['region', 'area', 'brand', 'product', 'week_start']);
  });
  return rows.length;
}

async function importNcr(doc) {
  const pages = await pdfPages(await fetchPdf(doc.url));
  // DOE occasionally files an adjustment notice under the NCR price page.
  if (pages.some((p) => p.items.some((i) => /Prior Notice on Price Adjustments/i.test(i.s)))) return importAdjustment(doc, pages);
  const parsed = parseNcr(pages);
  const week = weekOf(parsed.week, doc.guessedDate);
  if (!week) throw new ParseError('Could not find the report week in the PDF text');
  if (!parsed.summary.length && !parsed.cityRows.length) throw new ParseError('No price table found (scanned PDF or new layout)');
  const base = { region: 'NCR', weekStart: week.start, weekEnd: week.end, url: doc.url };
  const rows = [
    ...parsed.summary.map((s) => ({ ...base, area: 'ALL', brand: 'ALL', product: s.product, min: s.min, max: s.max, common: s.common, estimate: s.estimate })),
    ...parsed.cityRows.map((c) => ({ ...base, area: c.area, brand: 'ALL', product: c.product, min: c.min, max: c.max, common: c.common, estimate: c.commonIsEstimate })),
    ...parsed.detail.map((d) => ({ ...base, area: d.area, brand: d.brand, product: d.product, min: d.min, max: d.max })),
  ];
  // The summary merges RON 97/100; city tables keep them apart. Add a merged city row for lookups.
  for (const area of new Set(parsed.cityRows.map((c) => c.area))) {
    const prem = parsed.cityRows.filter((c) => c.area === area && (c.product === 'RON97' || c.product === 'RON100'));
    if (prem.length) {
      rows.push({ ...base, area, brand: 'ALL', product: 'RON97_100', min: Math.min(...prem.map((p) => p.min)), max: Math.max(...prem.map((p) => p.max)), common: (prem.find((p) => p.product === 'RON97' && !p.commonIsEstimate) || prem[0]).common, estimate: true });
    }
  }
  await storePriceRows(rows);
  return { rows: rows.length, weekStart: week.start };
}

async function importAdjustment(doc, pages = null) {
  const parsed = parseAdjustments(pages || await pdfPages(await fetchPdf(doc.url)));
  const week = weekOf(parsed.week, doc.guessedDate);
  if (!week) throw new ParseError('Could not find the adjustment week in the PDF text');
  if (!parsed.rows.length) throw new ParseError('No company adjustment rows found');
  const rows = [
    ...parsed.rows,
    ...Object.entries(parsed.consensus).map(([product, amount]) => ({ company: 'ALL', product, amount })),
  ];
  await db.transaction(async () => {
    for (const r of rows) {
      await db.upsert('price_adjustments', {
        week_start: week.start, week_end: week.end, company: r.company, product: r.product, amount: r.amount, source_url: doc.url, fetched_at: nowSql(),
      }, ['week_start', 'company', 'product']);
    }
  });
  return { rows: rows.length, weekStart: week.start };
}

async function importRegional(doc) {
  const refRows = await db.all("SELECT product, price_common FROM fuel_prices WHERE region = 'NCR' AND area = 'ALL' AND brand = 'ALL' AND week_start = (SELECT MAX(week_start) FROM fuel_prices WHERE region = 'NCR' AND area = 'ALL')");
  const ref = Object.fromEntries(refRows.filter((r) => r.price_common).map((r) => [r.product, r.price_common]));
  const parsed = parseRegional(await pdfPages(await fetchPdf(doc.url)), ref);
  const week = weekOf(parsed.week, doc.guessedDate);
  if (!week) throw new ParseError('Could not determine the report week');
  const entries = Object.entries(parsed.products);
  if (!entries.length) throw new ParseError('No recognizable price rows (layout not supported or scanned PDF)');
  const area = doc.area || 'Field office report';
  const rows = entries.map(([product, s]) => ({
    region: doc.region, area, brand: 'ALL', product, min: s.min, max: s.max, common: s.common, estimate: true, weekStart: week.start, weekEnd: week.end, url: doc.url,
  }));
  await storePriceRows(rows);
  await rebuildRegionTotals(doc.region, week.start);
  return { rows: rows.length, weekStart: week.start };
}

/** Region-wide row (area = ALL) from the per-report rows of that week. */
async function rebuildRegionTotals(region, weekStart) {
  const rows = await db.all("SELECT * FROM fuel_prices WHERE region = ? AND week_start = ? AND area <> 'ALL' AND brand = 'ALL'", [region, weekStart]);
  const byProduct = new Map();
  for (const r of rows) { if (!byProduct.has(r.product)) byProduct.set(r.product, []); byProduct.get(r.product).push(r); }
  const out = [];
  for (const [product, list] of byProduct) {
    out.push({
      region, area: 'ALL', brand: 'ALL', product, min: Math.min(...list.map((r) => r.price_min)), max: Math.max(...list.map((r) => r.price_max)),
      common: round(median(list.map((r) => r.price_common))), estimate: true, weekStart, weekEnd: list[0].week_end, url: list[0].source_url,
    });
  }
  await storePriceRows(out);
}

/**
 * Sync DOE reports.
 * @param {object} o
 * @param {string[]} [o.pages]  listing pages to check (keys of DOE_PAGES)
 * @param {number} [o.weeks]    how many of the newest NCR / adjustment reports to consider
 * @param {boolean} [o.force]   re-import reports already processed
 * @param {(msg:string)=>void} [o.progress]
 * @returns {Promise<{imported, skipped, failed, retry, rows, errors, newWeeks: {kind, region, weekStart}[]}>}
 */
export async function syncDoe({ pages = Object.keys(DOE_PAGES), weeks = 8, force = false, progress = () => {} } = {}) {
  const summary = { imported: 0, skipped: 0, failed: 0, retry: 0, rows: 0, errors: [], newWeeks: [] };
  const known = new Map((await db.all('SELECT url_hash, status FROM doe_documents')).map((r) => [r.url_hash, r.status]));

  const plan = [];
  for (const key of pages) {
    let docs;
    try { docs = await listDocuments(key); } catch (err) {
      summary.retry++; summary.errors.push(`${key} listing: ${err.message}`); continue;
    }
    if (DOE_PAGES[key].kind === 'regional') {
      const newest = docs[0]?.guessedDate;
      plan.push(...docs.filter((d) => newest && d.guessedDate >= addDays(newest, -6)).slice(0, 4));
    } else {
      plan.push(...docs.slice(0, weeks));
    }
  }

  const todo = plan.filter((doc) => {
    const status = known.get(sha1(doc.url));
    // "retry" means the download failed (network) — try again. Parsed and failed reports are done.
    if (!force && (status === 'parsed' || status === 'failed')) { summary.skipped++; return false; }
    return true;
  });
  let i = 0;
  for (const doc of todo) {
    i++;
    if (todo.length > 3) progress(`Importing DOE report ${i} of ${todo.length}`);
    try {
      const fn = doc.kind === 'ncr' ? importNcr : doc.kind === 'adjustment' ? importAdjustment : importRegional;
      const r = await fn(doc);
      await recordDoc(doc, 'parsed', null, r.rows, r.weekStart);
      summary.imported++; summary.rows += r.rows;
      summary.newWeeks.push({ kind: doc.kind, region: doc.region, weekStart: r.weekStart });
    } catch (err) {
      const permanent = err instanceof ParseError;
      await recordDoc(doc, permanent ? 'failed' : 'retry', err.message, 0, null);
      if (permanent) summary.failed++; else summary.retry++;
      summary.errors.push(`${doc.title}: ${err.message}`);
    }
  }
  return summary;
}

/** How far back the stored NCR history goes, and how many reports the DOE archive lists. */
export async function historyCoverage() {
  const r = await db.get("SELECT MIN(week_start) AS first, MAX(week_start) AS last, COUNT(DISTINCT week_start) AS weeks FROM fuel_prices WHERE region = 'NCR' AND area = 'ALL' AND brand = 'ALL'");
  let available = null;
  try { available = (await listDocuments('ncr')).length; } catch { /* listing unavailable */ }
  return { first: r?.first || null, last: r?.last || null, weeks: r?.weeks || 0, availableReports: available };
}

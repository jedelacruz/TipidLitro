// Fuel-related news from several free sources: Google News RSS, Philippine outlet RSS feeds,
// GDELT, and (optional, with keys) GNews and NewsData.io. Headlines are tagged by topic and by
// the direction of price pressure they imply.
import { XMLParser } from 'fast-xml-parser';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { request } from '../lib/http.js';
import { nowSql, sha1 } from '../lib/util.js';

const GOOGLE_QUERIES = [
  'fuel price Philippines',
  'oil price rollback OR hike Philippines',
  'DOE pump price',
  'Brent crude oil price',
  'peso dollar exchange rate',
  'fuel excise tax OR fuel subsidy Philippines',
];
const OUTLET_FEEDS = [
  ['Inquirer', 'https://business.inquirer.net/feed'],
  ['Philstar', 'https://www.philstar.com/rss/business'],
  ['GMA News', 'https://data.gmanetwork.com/gno/rss/money/feed.xml'],
  ['Rappler', 'https://www.rappler.com/business/feed/'],
];
const RELEVANT = /\b(fuel|oil|gasoline|gas prices?|diesel|kerosene|lpg|petrol|petroleum|crude|brent|wti|opec|pump|rollback|excise|peso|forex|exchange rate|pantawid|tanker|refiner\w*)\b/i;

export const NEWS_CATEGORIES = {
  price_adjustment: { label: 'Pump prices', re: /\b(rollback|price hikes?|price increase|price cut|pump prices?|oil price adjustment|fuel prices?|big-time|taas-presyo|bawas-presyo|dagdag-presyo)\b/i },
  supply: { label: 'Supply', re: /\b(opec\+?|supply|output|production|inventor(y|ies)|stockpile|refiner(y|ies)|shipping|tankers?|imports?)\b/i },
  conflict: { label: 'Conflict', re: /\b(war|attacks?|strikes?|missiles?|iran|israel|russia|ukraine|red sea|hormuz|houthis?|sanctions?|tensions?|conflict|middle east|gaza)\b/i },
  policy: { label: 'Policy & taxes', re: /\b(excise|tax(es)?|vat|subsid(y|ies)|pantawid|congress|senate|bill|executive order|price freeze|ltfrb|fare|doe|department of energy)\b/i },
  peso: { label: 'Peso', re: /\b(peso|forex|dollar|exchange rate|bsp|bangko sentral)\b/i },
  market: { label: 'Oil market', re: /\b(brent|wti|crude|futures|barrel|oil prices?)\b/i },
};

export function classify(title) {
  const cats = Object.entries(NEWS_CATEGORIES).filter(([, c]) => c.re.test(title)).map(([k]) => k);
  const t = title.toLowerCase();
  let up = /\b(hikes?|increases?|surges?|rises?|rising|jumps?|spikes?|soars?|higher|up by|climbs?|taas|dagdag|rall(y|ies)|skyrocket\w*)\b/.test(t);
  let down = /\b(rollbacks?|cuts?|decreases?|drops?|falls?|slumps?|plunges?|lower|down by|eases?|bawas|tumbles?|dips?|slides?)\b/.test(t);
  // Context flips: weaker peso or lower OPEC output push pump prices up, and vice versa.
  if (/peso\b.*\b(weak\w*|slump\w*|falls?|drops?|slides?|plunges?|record low)/.test(t)) { up = true; down = false; }
  if (/peso\b.*\b(strength\w*|gains?|rall\w*|rebounds?)/.test(t)) { down = true; up = false; }
  if (/\b(cuts?|slash\w*|reduc\w*)\b.*\b(output|production|supply)\b/.test(t)) { up = true; down = false; }
  if (/\b(boost\w*|rais\w*|increas\w*)\b.*\b(output|production|supply)\b/.test(t)) { down = true; up = false; }
  const direction = up && down ? 'mixed' : up ? 'up' : down ? 'down' : 'neutral';
  return { categories: cats, direction };
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const text = (v) => (v == null ? '' : typeof v === 'object' ? (v['#text'] ?? '') : String(v));
const stripHtml = (s) => text(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function parseRss(body, provider, defaultSource) {
  const doc = xml.parse(body);
  const items = doc?.rss?.channel?.item || doc?.feed?.entry || [];
  return (Array.isArray(items) ? items : [items]).map((it) => {
    let title = stripHtml(it.title);
    const source = stripHtml(it.source) || defaultSource;
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = text(it.link?.['@_href'] ?? it.link);
    const pub = new Date(text(it.pubDate || it.published || it.updated));
    return { title, url: link, source, summary: stripHtml(it.description || it.summary).slice(0, 400), publishedAt: Number.isNaN(+pub) ? new Date() : pub, provider };
  }).filter((a) => a.title && a.url);
}

async function fromGoogleNews() {
  const out = [];
  for (const q of GOOGLE_QUERIES) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&hl=en-PH&gl=PH&ceid=PH:en`;
    try { out.push(...parseRss(await request('google-news', url, { as: 'text', timeout: 15000 }), 'google-news', null).slice(0, 25)); } catch { /* next query */ }
  }
  return out;
}

async function fromOutlets() {
  const out = [];
  await Promise.all(OUTLET_FEEDS.map(async ([name, url]) => {
    try {
      const items = parseRss(await request('rss', url, { as: 'text', timeout: 15000, retries: 0 }), 'rss', name);
      out.push(...items.filter((a) => RELEVANT.test(a.title)));
    } catch { /* feed down; monitor will show it */ }
  }));
  return out;
}

async function fromGdelt() {
  const q = '(fuel OR diesel OR gasoline OR "oil price" OR "pump price") sourcecountry:RP';
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=50&timespan=7d&sort=datedesc`;
  const d = await request('gdelt', url, { timeout: 25000, retries: 1 });
  return (d.articles || []).filter((a) => !a.language || a.language === 'English').map((a) => {
    const s = a.seendate || '';
    const iso = s.length >= 15 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z` : null;
    return { title: a.title, url: a.url, source: a.domain, summary: '', publishedAt: iso ? new Date(iso) : new Date(), provider: 'gdelt' };
  });
}

async function fromGNews() {
  if (!config.keys.gnews) return [];
  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent('fuel OR oil OR diesel OR gasoline')}&country=ph&lang=en&max=25&apikey=${config.keys.gnews}`;
  const d = await request('gnews', url, { timeout: 15000 });
  return (d.articles || []).map((a) => ({ title: a.title, url: a.url, source: a.source?.name, summary: a.description || '', publishedAt: new Date(a.publishedAt), provider: 'gnews' }));
}

async function fromNewsData() {
  if (!config.keys.newsdata) return [];
  const url = `https://newsdata.io/api/1/latest?apikey=${config.keys.newsdata}&q=${encodeURIComponent('fuel OR oil OR diesel OR gasoline')}&country=ph&language=en`;
  const d = await request('newsdata', url, { timeout: 15000 });
  return (d.results || []).map((a) => ({ title: a.title, url: a.link, source: a.source_name || a.source_id, summary: a.description || '', publishedAt: new Date(`${a.pubDate}Z`), provider: 'newsdata' }));
}

const titleKey = (t) => sha1(t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120));

/** Job: pull every source, dedupe by URL and by normalized title, classify, store. */
export async function syncNews() {
  const results = await Promise.allSettled([fromGoogleNews(), fromOutlets(), fromGdelt(), fromGNews(), fromNewsData()]);
  const names = ['google-news', 'rss', 'gdelt', 'gnews', 'newsdata'];
  const errors = results.map((r, i) => (r.status === 'rejected' ? `${names[i]}: ${r.reason.message}` : null)).filter(Boolean);
  const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  let inserted = 0;
  const seenTitles = new Set();
  for (const a of all) {
    // Only plain web links: a feed must never be able to inject javascript: or data: URLs.
    if (!a.title || !/^https?:\/\/[^\s"'<>]+$/i.test(a.url || '')) continue;
    const th = titleKey(a.title);
    if (seenTitles.has(th)) continue;
    seenTitles.add(th);
    const dup = await db.get('SELECT id FROM news_articles WHERE title_hash = ?', [th]);
    if (dup) continue;
    const { categories, direction } = classify(a.title);
    if (!categories.length && !RELEVANT.test(a.title)) continue;
    const pub = a.publishedAt > new Date() ? new Date() : a.publishedAt;
    const r = await db.insertIgnore('news_articles', {
      url_hash: sha1(a.url), title_hash: th, url: a.url, title: a.title.slice(0, 390), source: a.source?.slice(0, 150) || null,
      summary: a.summary || null, categories: categories.join(','), direction, provider: a.provider, published_at: nowSql(pub), fetched_at: nowSql(),
    });
    inserted += r.changes;
  }
  if (!all.length && errors.length) throw new Error(errors.join('; '));
  return { fetched: all.length, inserted, errors };
}

export async function latestNews({ category, limit = 40, days = 14 } = {}) {
  const since = nowSql(new Date(Date.now() - days * 86400000));
  const params = [since];
  let sql = 'SELECT id, url, title, source, summary, categories, direction, provider, published_at FROM news_articles WHERE published_at >= ?';
  if (category && NEWS_CATEGORIES[category]) { sql += ' AND categories LIKE ?'; params.push(`%${category}%`); }
  sql += ' ORDER BY published_at DESC LIMIT ?';
  params.push(Math.min(+limit || 40, 200));
  const rows = await db.all(sql, params);
  return rows.filter((r) => /^https?:\/\//i.test(r.url)).map((r) => ({ ...r, categories: r.categories ? r.categories.split(',').filter(Boolean) : [] }));
}

/** Net up/down pressure from recent headlines, for the Price Watch gauge. */
export async function newsPressure(days = 7) {
  const rows = await latestNews({ days, limit: 200 });
  const relevant = rows.filter((r) => r.categories.some((c) => ['price_adjustment', 'market', 'supply', 'conflict', 'peso'].includes(c)));
  const up = relevant.filter((r) => r.direction === 'up').length;
  const down = relevant.filter((r) => r.direction === 'down').length;
  const total = up + down;
  return { up, down, mixed: relevant.filter((r) => r.direction === 'mixed').length, total: relevant.length, score: total ? (up - down) / total : 0 };
}

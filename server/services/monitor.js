// Integration Monitor: one row per external system with call volume, latency, errors and cache use.
import { config } from '../config.js';
import { db } from '../db/index.js';
import { cacheStats } from '../lib/cache.js';
import { nowSql } from '../lib/util.js';

export const INTEGRATIONS = [
  { key: 'doe', name: 'DOE retail pump price reports', provider: 'Department of Energy', format: 'HTML + PDF (scraped)', purpose: 'Official weekly NCR city/brand prices, regional prices, price adjustment notices', url: 'https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices' },
  { key: 'osrm', name: 'OSRM routing', provider: 'Project OSRM', format: 'REST / JSON', purpose: 'Route distance, duration, alternatives, expressway/toll/ferry segments', url: 'http://project-osrm.org/docs/v5.24.0/api/' },
  { key: 'photon', name: 'Photon geocoder', provider: 'Komoot', format: 'REST / GeoJSON', purpose: 'Place search and autocomplete', url: 'https://photon.komoot.io/' },
  { key: 'nominatim', name: 'Nominatim reverse geocoding', provider: 'OpenStreetMap Foundation', format: 'REST / JSON', purpose: 'Coordinates → place, city and region (for local prices)', url: 'https://operations.osmfoundation.org/policies/nominatim/' },
  { key: 'open-meteo', name: 'Open-Meteo weather', provider: 'Open-Meteo', format: 'REST / JSON', purpose: 'Rain and wind along the route at departure time', url: 'https://open-meteo.com/en/docs' },
  { key: 'open-meteo-elevation', name: 'Open-Meteo elevation', provider: 'Open-Meteo', format: 'REST / JSON', purpose: 'Climb and descent along the route', url: 'https://open-meteo.com/en/docs/elevation-api' },
  { key: 'overpass', name: 'Overpass API (fuel stations)', provider: 'OpenStreetMap', format: 'REST / JSON (OverpassQL)', purpose: 'Nearby fuel stations and brands', url: 'https://wiki.openstreetmap.org/wiki/Overpass_API' },
  { key: 'eia', name: 'EIA open data', provider: 'U.S. Energy Information Administration', format: 'REST / JSON', purpose: 'Brent spot price (when EIA_API_KEY is set)', url: 'https://www.eia.gov/opendata/', needsKey: 'eia' },
  { key: 'fred', name: 'FRED', provider: 'Federal Reserve Bank of St. Louis', format: 'REST / JSON or CSV', purpose: 'Brent spot price (DCOILBRENTEU)', url: 'https://fred.stlouisfed.org/docs/api/fred/' },
  { key: 'frankfurter', name: 'Frankfurter FX', provider: 'Frankfurter (ECB rates)', format: 'REST / JSON', purpose: 'USD → PHP exchange rate', url: 'https://frankfurter.dev' },
  { key: 'google-news', name: 'Google News RSS', provider: 'Google News', format: 'RSS / XML', purpose: 'Fuel price, oil market, peso and policy headlines (PH edition)', url: 'https://news.google.com/' },
  { key: 'rss', name: 'Philippine outlet RSS feeds', provider: 'Inquirer, Philstar, GMA, Rappler', format: 'RSS / XML', purpose: 'Business news filtered for fuel topics', url: null },
  { key: 'gdelt', name: 'GDELT DOC 2.0', provider: 'The GDELT Project', format: 'REST / JSON', purpose: 'Global event coverage from Philippine sources', url: 'https://www.gdeltproject.org/' },
  { key: 'gnews', name: 'GNews API', provider: 'GNews', format: 'REST / JSON', purpose: 'Extra headlines (when GNEWS_API_KEY is set)', url: 'https://gnews.io/', needsKey: 'gnews' },
  { key: 'newsdata', name: 'NewsData.io', provider: 'NewsData.io', format: 'REST / JSON', purpose: 'Extra headlines (when NEWSDATA_API_KEY is set)', url: 'https://newsdata.io/', needsKey: 'newsdata' },
  { key: 'gemini', name: 'Google Gemini', provider: 'Google', format: 'REST / JSON', purpose: 'Chat assistant: request extraction and phrasing only', url: 'https://ai.google.dev/gemini-api/docs', needsKey: 'gemini' },
  { key: 'client:leaflet', name: 'Leaflet + OSM tiles', provider: 'Leaflet / OpenStreetMap', format: 'JS library + raster tiles', purpose: 'Interactive maps (browser side)', url: 'https://leafletjs.com/', client: true },
  { key: 'client:geolocation', name: 'Browser Geolocation API', provider: 'Web platform', format: 'Browser API', purpose: '"My location" origin and nearby stations', url: null, client: true },
  { key: 'client:gmaps', name: 'Google Maps URLs', provider: 'Google', format: 'Deep link', purpose: 'Open the route in Google Maps (two-wheeler mode for motorcycles)', url: 'https://developers.google.com/maps/documentation/urls/get-started', client: true },
];

export async function monitorSnapshot() {
  const since24 = nowSql(new Date(Date.now() - 24 * 3600 * 1000));
  const since7d = nowSql(new Date(Date.now() - 7 * 86400000));
  const agg = await db.all(
    `SELECT source, COUNT(*) AS calls, SUM(ok) AS ok_calls, AVG(duration_ms) AS avg_ms, MAX(duration_ms) AS max_ms
     FROM integration_log WHERE created_at >= ? GROUP BY source`, [since24],
  );
  const agg7 = await db.all('SELECT source, COUNT(*) AS calls, SUM(ok) AS ok_calls FROM integration_log WHERE created_at >= ? GROUP BY source', [since7d]);
  const lastOk = await db.all('SELECT source, MAX(created_at) AS at FROM integration_log WHERE ok = 1 GROUP BY source');
  const lastErr = await db.all(
    `SELECT l.source, l.created_at AS at, l.error, l.status_code FROM integration_log l
     JOIN (SELECT source, MAX(id) AS id FROM integration_log WHERE ok = 0 GROUP BY source) m ON m.id = l.id`,
  );
  const by = (rows) => new Map(rows.map((r) => [r.source, r]));
  const A = by(agg); const A7 = by(agg7); const OK = by(lastOk); const ERR = by(lastErr);

  const items = INTEGRATIONS.map((i) => {
    const a = A.get(i.key); const a7 = A7.get(i.key); const ok = OK.get(i.key); const err = ERR.get(i.key);
    const cache = cacheStats.get(i.key) || { hits: 0, misses: 0 };
    const configured = !i.needsKey || Boolean(config.keys[i.needsKey]);
    // Status follows the most recent call; a recovered source with recent errors shows as degraded.
    let status = 'idle';
    if (i.client) status = 'client';
    else if (!configured) status = 'not_configured';
    else if (ok || err) {
      const lastFailed = err && (!ok || err.at > ok.at);
      const errRate = a?.calls ? 1 - (a.ok_calls || 0) / a.calls : 0;
      // A source that mostly works (e.g. 4 of 5 RSS feeds) is "degraded", not "down".
      status = lastFailed && (errRate >= 0.5 || !ok) ? 'down' : lastFailed || errRate > 0.25 ? 'degraded' : 'healthy';
    }
    return {
      ...i, configured, status,
      calls24h: a?.calls || 0, errors24h: a ? a.calls - (a.ok_calls || 0) : 0, avgMs: a ? Math.round(a.avg_ms) : null, maxMs: a?.max_ms ?? null,
      calls7d: a7?.calls || 0, successRate7d: a7?.calls ? Math.round(((a7.ok_calls || 0) / a7.calls) * 100) : null,
      lastSuccess: ok?.at || null, lastError: err ? { at: err.at, message: err.error, status: err.status_code } : null,
      cacheHits: cache.hits, cacheMisses: cache.misses,
    };
  });

  const counts = await db.get(`SELECT
      (SELECT COUNT(*) FROM fuel_prices) AS prices,
      (SELECT COUNT(*) FROM price_adjustments) AS adjustments,
      (SELECT COUNT(*) FROM doe_documents WHERE status = 'parsed') AS docs_parsed,
      (SELECT COUNT(*) FROM doe_documents WHERE status = 'failed') AS docs_failed,
      (SELECT COUNT(*) FROM news_articles) AS news,
      (SELECT COUNT(*) FROM market_series) AS market_points,
      (SELECT COUNT(*) FROM stations) AS stations,
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM saved_trips) AS trips,
      (SELECT COUNT(*) FROM api_cache) AS cache_rows,
      (SELECT COUNT(*) FROM chat_logs) AS chats`);
  return { generatedAt: new Date().toISOString(), database: config.db.client, items, counts };
}

export async function recentLog(limit = 60, source = null) {
  const params = [];
  let sql = 'SELECT source, endpoint, status_code, ok, duration_ms, error, created_at FROM integration_log';
  if (source) { sql += ' WHERE source = ?'; params.push(source); }
  sql += ' ORDER BY id DESC LIMIT ?'; params.push(Math.min(+limit || 60, 300));
  return db.all(sql, params);
}

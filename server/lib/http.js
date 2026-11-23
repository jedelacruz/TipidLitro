// Outbound HTTP for every integration: timeouts, retries, per-host throttling
// (Nominatim 1 req/s, GDELT 1 req/5 s, ...), and a log row per call for the Integration Monitor.
import { USER_AGENT } from '../config.js';
import { db } from '../db/index.js';
import { nowSql, sleep } from './util.js';

const THROTTLE_MS = {
  'nominatim.openstreetmap.org': 1100,
  'api.gdeltproject.org': 5500,
  'overpass-api.de': 1000,
  'overpass.kumi.systems': 1000,
  'photon.komoot.io': 150,
  'router.project-osrm.org': 150,
  'news.google.com': 400,
  // DOE file hosts: be gentle during history backfills.
  'prod-cms.doe.gov.ph': 400,
  'd24qbtp4vooyzi.cloudfront.net': 300,
  'doe.gov.ph': 500,
};
const hostQueues = new Map();

function throttle(host) {
  const gap = THROTTLE_MS[host];
  if (!gap) return Promise.resolve();
  const prev = hostQueues.get(host) || Promise.resolve();
  const next = prev.then(() => sleep(gap));
  hostQueues.set(host, next.catch(() => {}));
  return prev;
}

const redact = (url) => url
  .replace(/([?&](api_?key|apikey|key|token)=)[^&]+/gi, '$1***')
  .slice(0, 250);

export async function logCall(source, endpoint, { status = null, ok, ms, error = null }) {
  try {
    await db.insert('integration_log', {
      source, endpoint: redact(endpoint), status_code: status, ok: ok ? 1 : 0, duration_ms: Math.round(ms), error: error ? String(error).slice(0, 480) : null, created_at: nowSql(),
    });
  } catch { /* logging must never break a request */ }
}

/**
 * fetch with integration logging.
 * @param {string} source  logical integration name (e.g. 'osrm', 'doe')
 * @param {string} url
 * @param {{as?: 'json'|'text'|'buffer', method?: string, headers?: object, body?: any, timeout?: number, retries?: number}} opts
 */
export async function request(source, url, opts = {}) {
  const { as = 'json', method = 'GET', headers = {}, body, timeout = 20000, retries = 1 } = opts;
  const host = new URL(url).host;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    const started = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method, body, signal: ctrl.signal, redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Accept: as === 'json' ? 'application/json' : '*/*', ...headers },
      });
      const ms = performance.now() - started;
      if (!res.ok) {
        const snippet = (await res.text().catch(() => '')).slice(0, 200);
        const err = new Error(`${source} HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`);
        err.status = res.status;
        await logCall(source, url, { status: res.status, ok: false, ms, error: err.message });
        // 4xx (except 429) will not succeed on retry.
        if (res.status < 500 && res.status !== 429) throw err;
        lastErr = err;
      } else {
        let data;
        if (as === 'json') data = await res.json();
        else if (as === 'buffer') data = Buffer.from(await res.arrayBuffer());
        else data = await res.text();
        await logCall(source, url, { status: res.status, ok: true, ms });
        return data;
      }
    } catch (err) {
      if (err.status && err.status < 500 && err.status !== 429) throw err;
      const ms = performance.now() - started;
      const msg = err.name === 'AbortError' ? `${source} timed out after ${timeout} ms` : err.message;
      if (!err.status) await logCall(source, url, { ok: false, ms, error: msg });
      lastErr = new Error(msg);
      lastErr.status = err.status;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(800 * (attempt + 1) + (lastErr?.status === 429 ? 4000 : 0));
  }
  throw lastErr;
}

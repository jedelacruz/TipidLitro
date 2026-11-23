// Two-level cache (memory + database) so repeated lookups stay inside free-tier rate limits
// and survive restarts.
import { db } from '../db/index.js';
import { addSeconds, nowSql, sha1 } from './util.js';

const mem = new Map();
const MEM_MAX = 2000;
export const cacheStats = new Map(); // source -> { hits, misses }

const stat = (source, hit) => {
  const s = cacheStats.get(source) || { hits: 0, misses: 0 };
  if (hit) s.hits++; else s.misses++;
  cacheStats.set(source, s);
};

/** Return cached value for (source, key) or compute it with fn() and store for ttlSec. */
export async function cached(source, key, ttlSec, fn) {
  const k = sha1(`${source}:${typeof key === 'string' ? key : JSON.stringify(key)}`);
  const now = Date.now();
  const m = mem.get(k);
  if (m && m.exp > now) { stat(source, true); return m.value; }

  try {
    const row = await db.get('SELECT payload, expires_at FROM api_cache WHERE cache_key = ?', [k]);
    if (row && row.expires_at > nowSql()) {
      const value = JSON.parse(row.payload);
      remember(k, value, new Date(String(row.expires_at).replace(' ', 'T') + 'Z').getTime());
      stat(source, true);
      return value;
    }
  } catch { /* fall through to a live call */ }

  stat(source, false);
  const value = await fn();
  if (value !== undefined && value !== null) {
    remember(k, value, now + ttlSec * 1000);
    try {
      await db.upsert('api_cache', { cache_key: k, source, payload: JSON.stringify(value), expires_at: addSeconds(ttlSec), created_at: nowSql() }, ['cache_key']);
    } catch { /* cache write failures are not fatal */ }
  }
  return value;
}

function remember(k, value, exp) {
  if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value);
  mem.set(k, { value, exp });
}

export async function clearCache(source) {
  if (source) {
    await db.run('DELETE FROM api_cache WHERE source = ?', [source]);
  } else {
    await db.run('DELETE FROM api_cache');
  }
  mem.clear();
}

export async function pruneCache() {
  const r = await db.run('DELETE FROM api_cache WHERE expires_at < ?', [nowSql()]);
  return r.changes;
}

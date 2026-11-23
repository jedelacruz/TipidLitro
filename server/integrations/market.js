// Oil market indicators: Brent crude (EIA or FRED API with key; FRED's public CSV otherwise)
// and USD/PHP (Frankfurter, ECB reference rates).
import { config } from '../config.js';
import { db } from '../db/index.js';
import { request } from '../lib/http.js';
import { addDays, manilaDate } from '../lib/util.js';

async function brentFromEia(from) {
  const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${config.keys.eia}&frequency=daily&data[0]=value`
    + `&facets[series][]=RBRTE&start=${from}&sort[0][column]=period&sort[0][direction]=asc&length=5000`;
  const d = await request('eia', url, { timeout: 20000 });
  return (d.response?.data || []).map((r) => ({ date: r.period, value: +r.value })).filter((r) => Number.isFinite(r.value));
}

async function brentFromFredApi(from) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DCOILBRENTEU&api_key=${config.keys.fred}&file_type=json&observation_start=${from}`;
  const d = await request('fred', url, { timeout: 20000 });
  return (d.observations || []).map((o) => ({ date: o.date, value: +o.value })).filter((r) => Number.isFinite(r.value));
}

async function brentFromFredCsv(from) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU&cosd=${from}`;
  const csv = await request('fred', url, { as: 'text', timeout: 20000 });
  return csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [date, v] = line.split(',');
    return { date, value: +v };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value) && r.value > 0);
}

export async function fetchBrent(from) {
  const attempts = [];
  if (config.keys.eia) attempts.push(['eia', brentFromEia]);
  if (config.keys.fred) attempts.push(['fred-api', brentFromFredApi]);
  attempts.push(['fred-csv', brentFromFredCsv]);
  let lastErr;
  for (const [source, fn] of attempts) {
    try {
      const rows = await fn(from);
      if (rows.length) return { source, rows };
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('No Brent data available');
}

export async function fetchUsdPhp(from) {
  const url = `https://api.frankfurter.dev/v1/${from}..?base=USD&symbols=PHP`;
  const d = await request('frankfurter', url, { timeout: 15000 });
  return Object.entries(d.rates || {}).map(([date, r]) => ({ date, value: +r.PHP })).filter((r) => Number.isFinite(r.value));
}

/** Job: refresh both series (last `days` days) into market_series. */
export async function syncMarket({ days = 400 } = {}) {
  const from = addDays(manilaDate(), -days);
  const [brent, fx] = await Promise.allSettled([fetchBrent(from), fetchUsdPhp(from)]);
  let n = 0; const errors = [];
  await db.transaction(async () => {
    if (brent.status === 'fulfilled') {
      for (const r of brent.value.rows) { await db.upsert('market_series', { series: 'BRENT', obs_date: r.date, value: r.value, source: brent.value.source }, ['series', 'obs_date']); n++; }
    } else errors.push(`Brent: ${brent.reason.message}`);
    if (fx.status === 'fulfilled') {
      for (const r of fx.value) { await db.upsert('market_series', { series: 'USDPHP', obs_date: r.date, value: r.value, source: 'frankfurter' }, ['series', 'obs_date']); n++; }
    } else errors.push(`USD/PHP: ${fx.reason.message}`);
  });
  if (errors.length === 2) throw new Error(errors.join('; '));
  return { rows: n, errors };
}

export async function getSeries(series, days = 120) {
  const from = addDays(manilaDate(), -days);
  return db.all('SELECT obs_date AS date, value, source FROM market_series WHERE series = ? AND obs_date >= ? ORDER BY obs_date', [series, from]);
}

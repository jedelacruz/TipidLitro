// Next-week pump price adjustment estimate.
//
// Philippine oil companies adjust prices every Tuesday based on the previous Monday–Friday
// average of regional product prices (MOPS). MOPS is paid data, so this model uses the free
// proxy: Brent crude x USD/PHP, converted to pesos per liter, then calibrated against the
// actual DOE-announced adjustments stored in the database.
import { db } from '../db/index.js';
import { getSeries } from '../integrations/market.js';
import { newsPressure } from '../integrations/news.js';
import { addDays, manilaDate, manilaParts, mean, nowSql, round, stdev } from '../lib/util.js';
import { adjustments, regionSummary } from './prices.js';

const LITERS_PER_BARREL = 158.987;
const PRODUCTS = ['GASOLINE', 'DIESEL', 'KEROSENE'];
const PUMP_PRODUCTS = { GASOLINE: ['RON91', 'RON95', 'RON97_100'], DIESEL: ['DIESEL', 'DIESEL_PLUS'], KEROSENE: ['KEROSENE'] };

/** Tuesday of the next price adjustment (Manila time). */
export function nextAdjustmentTuesday(now = new Date()) {
  const today = manilaDate(now);
  const { dow, h } = manilaParts(now);
  // Adjustments take effect 6:00 AM Tuesday; after that, the next one is a week away.
  let delta = (2 - dow + 7) % 7;
  if (delta === 0 && h >= 6) delta = 7;
  return addDays(today, delta);
}

/** Daily crude cost in PHP per liter, using the latest FX on or before each Brent date. */
function dailyCrudeCost(brent, fx) {
  const out = []; let j = 0; let lastFx = null;
  for (const b of brent) {
    while (j < fx.length && fx[j].date <= b.date) { lastFx = fx[j].value; j++; }
    if (lastFx) out.push({ date: b.date, brent: b.value, fx: lastFx, php: (b.value * lastFx) / LITERS_PER_BARREL });
  }
  return out;
}

const windowAvg = (series, from, to) => {
  const pts = series.filter((s) => s.date >= from && s.date <= to);
  return pts.length ? { n: pts.length, php: mean(pts.map((p) => p.php)), brent: mean(pts.map((p) => p.brent)), fx: mean(pts.map((p) => p.fx)) } : null;
};

/** Raw signal for the adjustment taking effect on Tuesday `t`: last week's average minus the week before. */
function rawDelta(series, t) {
  const cur = windowAvg(series, addDays(t, -8), addDays(t, -4));
  const prev = windowAvg(series, addDays(t, -15), addDays(t, -11));
  return cur && prev ? { delta: cur.php - prev.php, cur, prev } : null;
}

function fit(pairs) {
  const n = pairs.length;
  if (n < 5) return { a: 0, b: 1, n, r2: null, rmse: null, calibrated: false };
  const mx = mean(pairs.map((p) => p.x)); const my = mean(pairs.map((p) => p.y));
  const sxx = pairs.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx < 1e-6) return { a: 0, b: 1, n, r2: null, rmse: null, calibrated: false };
  let b = pairs.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  b = Math.min(Math.max(b, 0.2), 3);
  const a = my - b * mx;
  const resid = pairs.map((p) => p.y - (a + b * p.x));
  const sst = pairs.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const sse = resid.reduce((s, r) => s + r * r, 0);
  return { a, b, n, r2: sst > 0 ? 1 - sse / sst : null, rmse: Math.sqrt(sse / n), calibrated: true };
}

export async function computeForecast() {
  const [brent, fx] = await Promise.all([getSeries('BRENT', 200), getSeries('USDPHP', 200)]);
  if (brent.length < 10 || fx.length < 5) throw new Error('Not enough Brent / USD-PHP history yet (run the market sync first).');
  const series = dailyCrudeCost(brent, fx);
  const adj = await adjustments(26);

  // Calibrate per product on past announced adjustments.
  const calib = {}; const history = [];
  for (const product of PRODUCTS) {
    const pairs = [];
    for (const w of adj) {
      if (w[product] == null) continue;
      const r = rawDelta(series, w.weekStart);
      if (r) pairs.push({ x: r.delta, y: w[product], week: w.weekStart });
    }
    calib[product] = fit(pairs);
    for (const p of pairs) history.push({ weekStart: p.week, product, actual: p.y, raw: round(p.x, 2), predicted: round(calib[product].a + calib[product].b * p.x, 2) });
  }

  const target = nextAdjustmentTuesday();
  let basis = rawDelta(series, target);
  let lagged = false;
  const latestObs = series[series.length - 1];
  if (!basis || basis.cur.n < 2) {
    // Brent feeds publish with a delay; fall back to the latest five observations vs the five before.
    const last = series.slice(-5); const prev = series.slice(-10, -5);
    basis = {
      delta: mean(last.map((s) => s.php)) - mean(prev.map((s) => s.php)),
      cur: { n: last.length, php: mean(last.map((s) => s.php)), brent: mean(last.map((s) => s.brent)), fx: mean(last.map((s) => s.fx)) },
      prev: { n: prev.length, php: mean(prev.map((s) => s.php)), brent: mean(prev.map((s) => s.brent)), fx: mean(prev.map((s) => s.fx)) },
    };
    lagged = true;
  }

  const ncr = await regionSummary('NCR');
  const pressure = await newsPressure(7).catch(() => null);
  const announced = adj.find((w) => w.weekStart === target) || null;
  const products = [];
  for (const product of PRODUCTS) {
    const c = calib[product];
    const estimate = c.a + c.b * basis.delta;
    const band = c.calibrated ? Math.max(0.35, 1.2 * c.rmse) : Math.max(0.5, 0.35 * Math.abs(estimate) + 0.4);
    const confidence = c.calibrated && c.n >= 8 && (c.r2 ?? 0) >= 0.5 && !lagged ? 'high' : c.calibrated && !lagged ? 'medium' : 'low';
    const pumps = PUMP_PRODUCTS[product].map((p) => {
      const cur = ncr.products.find((x) => x.product === p);
      return cur?.common != null ? { product: p, current: cur.common, projected: round(cur.common + (announced?.[product] ?? estimate), 2) } : null;
    }).filter(Boolean);
    const effective = announced?.[product] ?? estimate;
    const day = new Date(`${target}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const advice = effective >= 0.3 ? { action: 'fill_now', text: `Gas up before ${day} — prices likely up about ₱${round(effective, 2).toFixed(2)}/L.` }
      : effective <= -0.3 ? { action: 'wait', text: `If your tank allows, wait for the ${day} rollback of about ₱${round(Math.abs(effective), 2).toFixed(2)}/L.` }
        : { action: 'neutral', text: 'Little change expected. Fill up as usual.' };
    products.push({
      product, estimate: round(estimate, 2), low: round(estimate - band, 2), high: round(estimate + band, 2), confidence,
      announced: announced?.[product] ?? null, calibration: { n: c.n, a: round(c.a, 3), b: round(c.b, 3), r2: c.r2 == null ? null : round(c.r2, 2), rmse: c.rmse == null ? null : round(c.rmse, 2), calibrated: c.calibrated },
      pumps, advice,
    });
    await db.upsert('forecasts', {
      target_week_start: target, product, estimate: round(estimate, 3), low: round(estimate - band, 3), high: round(estimate + band, 3),
      method: c.calibrated ? 'brent_fx_calibrated' : 'brent_fx_passthrough', details: JSON.stringify({ basis: round(basis.delta, 3), lagged, calib: c }), created_at: nowSql(),
    }, ['target_week_start', 'product']);
  }

  return {
    generatedAt: new Date().toISOString(),
    targetWeekStart: target,
    basis: {
      window: lagged ? 'latest 5 trading days vs previous 5' : `${addDays(target, -8)} to ${addDays(target, -4)} vs prior week`,
      lagged,
      latestBrentDate: latestObs?.date,
      brentAvg: round(basis.cur.brent, 2), brentPrevAvg: round(basis.prev.brent, 2),
      fxAvg: round(basis.cur.fx, 3), fxPrevAvg: round(basis.prev.fx, 3),
      crudePhpPerL: round(basis.cur.php, 2), crudePhpPerLPrev: round(basis.prev.php, 2),
      rawDelta: round(basis.delta, 2), days: basis.cur.n,
      volatility: round(stdev(series.slice(-20).map((s) => s.brent)), 2),
    },
    products,
    pressure,
    history: history.sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    ncrWeek: ncr.weekStart,
  };
}

/** Latest stored forecast + a fresh computation if missing. */
let lastForecast = null;
export async function getForecast({ refresh = false } = {}) {
  if (!refresh && lastForecast && Date.now() - lastForecast.at < 30 * 60 * 1000) return lastForecast.data;
  const data = await computeForecast();
  lastForecast = { at: Date.now(), data };
  return data;
}

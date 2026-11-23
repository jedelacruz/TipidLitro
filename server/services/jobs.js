// Scheduled jobs that keep the shared database current. Each run is recorded in job_runs.
import { config } from '../config.js';
import { db } from '../db/index.js';
import { syncDoe } from '../integrations/doe.js';
import { syncMarket } from '../integrations/market.js';
import { syncNews } from '../integrations/news.js';
import { syncStations } from '../integrations/overpass.js';
import { pruneCache } from '../lib/cache.js';
import { nowSql, sqlToDate } from '../lib/util.js';
import { evaluateAlerts } from './alerts.js';
import { getForecast } from './forecast.js';

const H = 3600 * 1000;
const summarize = (r) => `imported ${r.imported}, already had ${r.skipped}${r.retry ? `, will retry ${r.retry}` : ''}${r.failed ? `, unreadable ${r.failed}` : ''}${r.errors.length ? ` — ${r.errors.slice(0, 2).join(' | ')}` : ''}`;

/** After new DOE data lands: refresh the forecast (it calibrates on adjustments) and run alerts. */
async function afterPrices(r) {
  if (!r.imported) return 0;
  await getForecast({ refresh: true }).catch(() => {});
  return evaluateAlerts().catch(() => 0);
}

export const JOBS = {
  // Checked hourly: DOE posts adjustment notices on Mondays and NCR monitoring mid-week.
  doe_latest: {
    label: 'DOE NCR prices & weekly adjustments', everyMs: 1 * H,
    run: async ({ progress }) => {
      const r = await syncDoe({ pages: ['ncr', 'adjustments'], weeks: config.doeBackfillWeeks, progress });
      const alerts = await afterPrices(r);
      return { items: r.rows, message: `${summarize(r)}${r.newWeeks.length ? ` · new weeks: ${[...new Set(r.newWeeks.map((w) => w.weekStart))].join(', ')}` : ''}${alerts ? ` · ${alerts} alert(s) sent` : ''}` };
    },
  },
  doe_regional: {
    label: 'DOE regional prices (Luzon, Visayas, Mindanao)', everyMs: 12 * H,
    run: async ({ progress }) => {
      const r = await syncDoe({ pages: ['north_luzon', 'south_luzon', 'visayas', 'mindanao'], progress });
      await afterPrices(r);
      return { items: r.rows, message: summarize(r) };
    },
  },
  doe_backfill: {
    label: 'DOE price history import (manual)', everyMs: null,
    run: async ({ params, progress }) => {
      const weeks = params?.weeks === 'all' ? 1000 : Math.max(1, Math.min(Number(params?.weeks) || 52, 1000));
      const r = await syncDoe({ pages: ['ncr', 'adjustments'], weeks, progress });
      return { items: r.rows, message: summarize(r) };
    },
  },
  market: { label: 'Brent crude & USD/PHP', everyMs: 6 * H, run: () => syncMarket().then((r) => ({ items: r.rows, message: r.errors.join('; ') || null })) },
  news: { label: 'Fuel news headlines', everyMs: 1 * H, run: () => syncNews().then((r) => ({ items: r.inserted, message: `fetched ${r.fetched}, new ${r.inserted}${r.errors.length ? `; ${r.errors.join('; ')}` : ''}` })) },
  forecast: {
    label: 'Price adjustment forecast', everyMs: 3 * H,
    run: async () => {
      const f = await getForecast({ refresh: true });
      const alerts = await evaluateAlerts().catch(() => 0);
      return { items: f.products.length, message: `target ${f.targetWeekStart}${f.basis.lagged ? ' (Brent data lagged)' : ''}${alerts ? ` · ${alerts} alert(s) sent` : ''}` };
    },
  },
  stations: { label: 'Fuel stations (Metro Manila, Cebu, Davao)', everyMs: 7 * 24 * H, run: syncStations },
  cleanup: { label: 'Prune logs, sessions, cache', everyMs: 24 * H, run: cleanup },
};
// Boot order: fast sources first so the UI has something to show quickly.
const BOOT_ORDER = ['market', 'news', 'doe_latest', 'forecast', 'doe_regional', 'stations', 'cleanup'];

const running = new Set();
let queue = Promise.resolve();

async function cleanup() {
  const day = (n) => nowSql(new Date(Date.now() - n * 86400000));
  const a = await db.run('DELETE FROM integration_log WHERE created_at < ?', [day(14)]);
  const b = await db.run('DELETE FROM sessions WHERE expires_at < ?', [nowSql()]);
  const c = await db.run('DELETE FROM job_runs WHERE started_at < ?', [day(30)]);
  const d = await db.run('DELETE FROM news_articles WHERE published_at < ?', [day(180)]);
  const n = await db.run('DELETE FROM notifications WHERE created_at < ?', [day(90)]);
  const e = await pruneCache();
  return { items: a.changes + b.changes + c.changes + d.changes + n.changes + e, message: `logs ${a.changes}, sessions ${b.changes}, runs ${c.changes}, news ${d.changes}, notifications ${n.changes}, cache ${e}` };
}

export const isRunning = (name) => running.has(name);

export async function runJob(name, { quiet = false, params = null } = {}) {
  const job = JOBS[name];
  if (!job) throw new Error(`Unknown job ${name}`);
  if (running.has(name)) return { status: 'already_running' };
  running.add(name);
  const { insertId } = await db.insert('job_runs', { job: name, started_at: nowSql(), status: 'running', items: 0 });
  const t0 = Date.now();
  let lastProgress = 0;
  // Long jobs (history import) report progress into their job_runs row for the Monitor.
  const progress = (msg) => {
    if (Date.now() - lastProgress < 1500) return;
    lastProgress = Date.now();
    db.run('UPDATE job_runs SET message = ? WHERE id = ?', [String(msg).slice(0, 990), insertId]).catch(() => {});
  };
  try {
    const r = (await job.run({ params, progress })) || {};
    await db.run('UPDATE job_runs SET finished_at = ?, status = ?, items = ?, message = ? WHERE id = ?', [nowSql(), 'success', r.items || 0, r.message ? String(r.message).slice(0, 990) : null, insertId]);
    if (!quiet) console.log(`[job] ${name} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${r.message || `${r.items || 0} items`}`);
    return { status: 'success', ...r };
  } catch (err) {
    await db.run('UPDATE job_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?', [nowSql(), 'error', String(err.message).slice(0, 990), insertId]);
    console.warn(`[job] ${name} failed: ${err.message}`);
    return { status: 'error', message: err.message };
  } finally {
    running.delete(name);
  }
}

/** Queue a job behind any other scheduled job so outbound traffic stays polite. */
export const enqueueJob = (name) => { queue = queue.then(() => runJob(name)).catch(() => {}); return queue; };

export async function lastRuns() {
  const rows = await db.all('SELECT j.* FROM job_runs j JOIN (SELECT job, MAX(id) AS id FROM job_runs GROUP BY job) m ON m.id = j.id');
  const ok = await db.all("SELECT job, MAX(finished_at) AS at FROM job_runs WHERE status = 'success' GROUP BY job");
  const okBy = new Map(ok.map((r) => [r.job, r.at]));
  return Object.entries(JOBS).map(([name, j]) => {
    const r = rows.find((x) => x.job === name);
    const lastOk = okBy.get(name) || null;
    const nextDue = j.everyMs && lastOk ? new Date(sqlToDate(lastOk).getTime() + j.everyMs).toISOString() : null;
    return { name, label: j.label, everyHours: j.everyMs ? j.everyMs / H : null, manual: !j.everyMs, running: running.has(name), last: r || null, lastSuccess: lastOk, nextDue };
  });
}

export async function lastSuccess(name) {
  const r = await db.get("SELECT MAX(finished_at) AS at FROM job_runs WHERE job = ? AND status = 'success'", [name]);
  return r?.at || null;
}

async function dueJobs() {
  const ok = await db.all("SELECT job, MAX(finished_at) AS at FROM job_runs WHERE status = 'success' GROUP BY job");
  const failed = await db.all("SELECT job, MAX(finished_at) AS at FROM job_runs WHERE status = 'error' GROUP BY job");
  const okBy = new Map(ok.map((r) => [r.job, sqlToDate(r.at)?.getTime() || 0]));
  const errBy = new Map(failed.map((r) => [r.job, sqlToDate(r.at)?.getTime() || 0]));
  const now = Date.now();
  return BOOT_ORDER.filter((name) => {
    const last = okBy.get(name) || 0;
    const lastErr = errBy.get(name) || 0;
    // After a failure, wait 20 minutes before retrying instead of the full interval.
    if (lastErr > last) return now - lastErr > 20 * 60 * 1000;
    return now - last >= JOBS[name].everyMs;
  });
}

export function startScheduler() {
  if (!config.scheduler) { console.log('[jobs] scheduler disabled (ENABLE_SCHEDULER=false)'); return; }
  const tick = async () => {
    try { for (const name of await dueJobs()) if (!running.has(name)) enqueueJob(name); } catch (err) { console.warn('[jobs] tick failed:', err.message); }
  };
  setTimeout(tick, 1500);
  setInterval(tick, 5 * 60 * 1000).unref();
}

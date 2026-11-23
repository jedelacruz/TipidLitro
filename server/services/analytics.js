// Admin dashboard data: integration traffic and latency, job history, data coverage and freshness,
// anonymous usage (trips, assistant, users), database size, system info, and an "attention" list.
import { statSync } from 'node:fs';
import os from 'node:os';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { REGIONS } from '../integrations/doe.js';
import { daysBetween, manilaDate, nowSql, round, sqlToDate } from '../lib/util.js';
import { monitorSnapshot } from './monitor.js';

const STARTED_AT = new Date();
const TABLES = ['fuel_prices', 'price_adjustments', 'doe_documents', 'market_series', 'news_articles', 'stations', 'community_prices', 'users', 'sessions', 'user_vehicles', 'fuel_logs', 'saved_trips', 'price_alerts', 'notifications', 'trip_logs', 'chat_logs', 'forecasts', 'api_cache', 'integration_log', 'job_runs', 'vehicle_presets'];

const since = (days) => nowSql(new Date(Date.now() - days * 86400000));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);

async function dbSize() {
  if (config.db.client === 'mysql') {
    const r = await db.get('SELECT SUM(data_length + index_length) AS b FROM information_schema.tables WHERE table_schema = ?', [config.db.mysql.database]);
    return Number(r?.b) || null;
  }
  let total = 0;
  for (const suffix of ['', '-wal']) { try { total += statSync(config.db.sqlitePath + suffix).size; } catch { /* no wal file */ } }
  return total;
}

export async function adminStats() {
  // Integration traffic
  const callsHourly = await db.all("SELECT substr(created_at, 1, 13) AS hr, source, COUNT(*) AS n, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors FROM integration_log WHERE created_at >= ? GROUP BY substr(created_at, 1, 13), source", [since(1)]);
  const callsDaily = await db.all("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors FROM integration_log WHERE created_at >= ? GROUP BY substr(created_at, 1, 10) ORDER BY day", [since(14)]);
  const latRows = await db.all('SELECT source, duration_ms, ok FROM integration_log WHERE created_at >= ? ORDER BY id DESC LIMIT 20000', [since(7)]);
  const bySource = new Map();
  for (const r of latRows) {
    if (!bySource.has(r.source)) bySource.set(r.source, { ms: [], ok: 0, n: 0 });
    const s = bySource.get(r.source); s.n++; if (r.ok) { s.ok++; s.ms.push(r.duration_ms); }
  }
  const latency = [...bySource.entries()].map(([source, s]) => {
    const sorted = s.ms.sort((a, b) => a - b);
    return { source, calls: s.n, successRate: round((s.ok / s.n) * 100, 1), avgMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null, p95Ms: pct(sorted, 0.95), medianMs: pct(sorted, 0.5) };
  }).sort((a, b) => b.calls - a.calls);

  // Jobs: durations of recent runs
  const runs = await db.all('SELECT job, started_at, finished_at, status, items FROM job_runs WHERE started_at >= ? ORDER BY id', [since(7)]);
  const jobs = new Map();
  for (const r of runs) {
    if (!jobs.has(r.job)) jobs.set(r.job, { job: r.job, runs: 0, ok: 0, failed: 0, totalSec: 0, lastSec: null, items: 0 });
    const j = jobs.get(r.job);
    j.runs++; if (r.status === 'success') j.ok++; if (r.status === 'error') j.failed++;
    if (r.finished_at) { const sec = (sqlToDate(r.finished_at) - sqlToDate(r.started_at)) / 1000; j.totalSec += sec; j.lastSec = round(sec, 1); }
    j.items += r.items || 0;
  }
  const jobStats = [...jobs.values()].map((j) => ({ ...j, avgSec: j.runs ? round(j.totalSec / j.runs, 1) : null }));

  // Data coverage and freshness
  const coverage = await db.all("SELECT substr(week_start, 1, 4) AS yr, COUNT(DISTINCT week_start) AS weeks FROM fuel_prices WHERE region = 'NCR' AND area = 'ALL' AND brand = 'ALL' GROUP BY substr(week_start, 1, 4) ORDER BY yr");
  const docs = await db.all("SELECT substr(COALESCE(week_start, guessed_date), 1, 4) AS yr, status, COUNT(*) AS n FROM doe_documents GROUP BY substr(COALESCE(week_start, guessed_date), 1, 4), status ORDER BY yr");
  const docKinds = await db.all('SELECT kind, status, COUNT(*) AS n FROM doe_documents GROUP BY kind, status');
  const freshness = [];
  for (const region of REGIONS) {
    const r = await db.get("SELECT MAX(week_start) AS w, MAX(fetched_at) AS f, COUNT(DISTINCT week_start) AS weeks FROM fuel_prices WHERE region = ? AND area = 'ALL' AND brand = 'ALL'", [region]);
    freshness.push({ region, latestWeek: r?.w || null, ageDays: r?.w ? daysBetween(r.w, manilaDate()) : null, weeks: r?.weeks || 0, fetchedAt: r?.f || null });
  }
  const market = await db.all('SELECT series, MAX(obs_date) AS latest, COUNT(*) AS n FROM market_series GROUP BY series');
  const news = await db.all("SELECT substr(published_at, 1, 10) AS day, provider, COUNT(*) AS n FROM news_articles WHERE published_at >= ? GROUP BY substr(published_at, 1, 10), provider ORDER BY day", [since(14)]);
  const newsDirection = await db.all('SELECT direction, COUNT(*) AS n FROM news_articles WHERE published_at >= ? GROUP BY direction', [since(7)]);

  // Usage (anonymous)
  const tripsDaily = await db.all("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n, AVG(cost) AS avg_cost, AVG(distance_km) AS avg_km FROM trip_logs WHERE created_at >= ? GROUP BY substr(created_at, 1, 10) ORDER BY day", [since(30)]);
  const tripTotals = await db.get('SELECT COUNT(*) AS n, AVG(cost) AS avg_cost, AVG(distance_km) AS avg_km, SUM(liters) AS liters, SUM(round_trip) AS round_trips FROM trip_logs WHERE created_at >= ?', [since(30)]);
  const topVehicles = await db.all('SELECT vehicle_name AS name, COUNT(*) AS n FROM trip_logs WHERE created_at >= ? GROUP BY vehicle_name ORDER BY n DESC LIMIT 8', [since(30)]);
  const categories = await db.all('SELECT vehicle_category AS category, COUNT(*) AS n FROM trip_logs WHERE created_at >= ? GROUP BY vehicle_category ORDER BY n DESC', [since(30)]);
  const tripRegions = await db.all('SELECT region, COUNT(*) AS n FROM trip_logs WHERE created_at >= ? GROUP BY region ORDER BY n DESC', [since(30)]);
  const fuels = await db.all('SELECT fuel_type, COUNT(*) AS n FROM trip_logs WHERE created_at >= ? GROUP BY fuel_type', [since(30)]);
  const chatsDaily = await db.all("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM chat_logs WHERE created_at >= ? GROUP BY substr(created_at, 1, 10) ORDER BY day", [since(30)]);
  const intents = await db.all('SELECT intent, COUNT(*) AS n FROM chat_logs WHERE created_at >= ? GROUP BY intent ORDER BY n DESC', [since(30)]);
  const providers = await db.all('SELECT provider, COUNT(*) AS n FROM chat_logs WHERE created_at >= ? GROUP BY provider', [since(30)]);
  const users = await db.get("SELECT COUNT(*) AS n, SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new30 FROM users", [since(30)]);
  const activeUsers = await db.get('SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE created_at >= ?', [since(7)]);
  const alerts = await db.all('SELECT kind, COUNT(*) AS n FROM price_alerts WHERE active = 1 GROUP BY kind');
  const notifications = await db.get('SELECT COUNT(*) AS n, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM notifications WHERE created_at >= ?', [since(30)]);
  const reports = await db.get('SELECT COUNT(*) AS n FROM community_prices WHERE reported_at >= ?', [since(14)]);

  // Database
  const tables = [];
  for (const t of TABLES) { try { tables.push({ table: t, rows: (await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n }); } catch { /* table missing */ } }

  // System
  const mem = process.memoryUsage();
  const system = {
    version: '1.0.0', node: process.version, platform: `${os.type()} ${os.release()} (${os.arch()})`, cpus: os.cpus().length,
    uptimeSec: Math.round(process.uptime()), startedAt: STARTED_AT.toISOString(), serverTime: new Date().toISOString(), manilaDate: manilaDate(),
    memoryMb: round(mem.rss / 1048576, 1), heapMb: round(mem.heapUsed / 1048576, 1), freeMemMb: round(os.freemem() / 1048576, 0),
    database: config.db.client === 'mysql' ? `MySQL/MariaDB · ${config.db.mysql.host}:${config.db.mysql.port}/${config.db.mysql.database}` : `SQLite · ${config.db.sqlitePath}`,
    dbBytes: await dbSize().catch(() => null), scheduler: config.scheduler,
    keys: { gemini: Boolean(config.keys.gemini), eia: Boolean(config.keys.eia), fred: Boolean(config.keys.fred), gnews: Boolean(config.keys.gnews), newsdata: Boolean(config.keys.newsdata), contactEmail: Boolean(config.contactEmail) },
    settings: { doeBackfillWeeks: config.doeBackfillWeeks, electricityRate: config.electricityRate, geminiModel: config.geminiModel, osrmUrl: config.osrmUrl },
  };

  // Things an admin should look at
  const snapshot = await monitorSnapshot();
  const attention = [];
  for (const i of snapshot.items) {
    if (i.status === 'down') attention.push({ level: i.key === 'gdelt' ? 'info' : 'warn', text: `${i.name} is failing${i.lastError ? `: ${String(i.lastError.message).slice(0, 120)}` : ''}`, tab: 'integrations' });
    else if (i.status === 'degraded') attention.push({ level: 'info', text: `${i.name} had errors in the last 24 hours (${i.errors24h} of ${i.calls24h} calls).`, tab: 'integrations' });
  }
  const lastByJob = await db.all('SELECT j.job, j.status, j.message FROM job_runs j JOIN (SELECT job, MAX(id) AS id FROM job_runs GROUP BY job) m ON m.id = j.id');
  for (const j of lastByJob) if (j.status === 'error') attention.push({ level: 'warn', text: `Job "${j.job}" failed last time: ${String(j.message || '').slice(0, 120)}`, tab: 'data' });
  const ncr = freshness.find((f) => f.region === 'NCR');
  if (!ncr?.latestWeek) attention.push({ level: 'danger', text: 'No NCR prices yet — the DOE sync has not completed.', tab: 'data' });
  else if (ncr.ageDays > 10) attention.push({ level: 'warn', text: `Latest NCR prices are ${ncr.ageDays} days old (week of ${ncr.latestWeek}). DOE may not have posted a new report, or its layout changed.`, tab: 'data' });
  const unreadable = docKinds.filter((d) => d.status === 'failed').reduce((s, d) => s + d.n, 0);
  if (unreadable) attention.push({ level: 'info', text: `${unreadable} DOE report(s) could not be read (mostly old scans). Enter those weeks manually if you need them.`, tab: 'data' });
  if (!config.keys.gemini) attention.push({ level: 'info', text: 'Gemini is not configured — the assistant runs in rule-based mode. Add GEMINI_API_KEY to .env to enable it.', tab: 'system' });
  if (!config.contactEmail) attention.push({ level: 'info', text: 'CONTACT_EMAIL is not set. OpenStreetMap\'s Nominatim policy asks apps to identify themselves.', tab: 'system' });

  return {
    generatedAt: new Date().toISOString(),
    integrations: { callsHourly, callsDaily, latency, healthy: snapshot.items.filter((i) => i.status === 'healthy').length, total: snapshot.items.filter((i) => !i.client && i.configured).length },
    jobs: jobStats,
    data: { coverage, docs, docKinds, freshness, market, news, newsDirection },
    usage: { tripsDaily, tripTotals, topVehicles, categories, tripRegions, fuels, chatsDaily, intents, providers, users, activeUsers: activeUsers?.n || 0, alerts, notifications, reports: reports?.n || 0 },
    tables, system, attention,
  };
}

export async function listUsers() {
  return db.all(`SELECT u.id, u.name, u.email, u.role, u.created_at, u.home_region,
      (SELECT COUNT(*) FROM user_vehicles v WHERE v.user_id = u.id) AS vehicles,
      (SELECT COUNT(*) FROM saved_trips t WHERE t.user_id = u.id) AS trips,
      (SELECT COUNT(*) FROM fuel_logs l WHERE l.user_id = u.id) AS fill_ups,
      (SELECT COUNT(*) FROM price_alerts a WHERE a.user_id = u.id) AS alerts,
      (SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_login
    FROM users u ORDER BY u.id DESC LIMIT 500`);
}

export async function listReports() {
  return db.all(`SELECT c.id, c.product, c.price, c.note, c.reported_at, c.station_osm_id, s.name AS station, s.brand, u.email
    FROM community_prices c LEFT JOIN stations s ON s.osm_id = c.station_osm_id LEFT JOIN users u ON u.id = c.user_id
    ORDER BY c.id DESC LIMIT 200`);
}

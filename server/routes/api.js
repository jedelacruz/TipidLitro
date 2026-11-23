// REST API. Every page and the chat assistant read from these endpoints, which read from the
// shared database (single source of truth) or from cached integrations.
import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { REGIONS, PRODUCTS, historyCoverage } from '../integrations/doe.js';
import { geminiEnabled } from '../integrations/gemini.js';
import { doeRegionFor, reverseGeocode, searchPlaces } from '../integrations/geocode.js';
import { getSeries } from '../integrations/market.js';
import { NEWS_CATEGORIES, latestNews, newsPressure } from '../integrations/news.js';
import { quickDistance } from '../integrations/osrm.js';
import { stationsNear } from '../integrations/overpass.js';
import { createSession, destroySession, hashPassword, isMobileClient, rateLimit, requireAdmin, requireUser, verifyPassword } from '../lib/auth.js';
import { clearCache } from '../lib/cache.js';
import { HttpError, asyncRoute, haversineKm, isFiniteCoord, manilaDate, nowSql, round } from '../lib/util.js';
import { ALERT_KINDS, describeAlert, evaluateAlerts } from '../services/alerts.js';
import { adminStats, listReports, listUsers } from '../services/analytics.js';
import { chat } from '../services/assistant.js';
import { getForecast } from '../services/forecast.js';
import { JOBS, isRunning, lastRuns, lastSuccess, runJob } from '../services/jobs.js';
import { monitorSnapshot, recentLog } from '../services/monitor.js';
import { adjustmentDetail, adjustments, allRegions, areaTable, areasWithHistory, brandMatrix, exportCsv, history, priceFor, regionSummary, saveManualPrices, weeksList } from '../services/prices.js';
import { compareVehicles, estimateTrip, resolveVehicle, unitOf } from '../services/trip.js';

export const api = Router();
const r = (fn) => asyncRoute(fn);
const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));
const str = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const coordsOf = (q) => { const lat = num(q.lat); const lng = num(q.lng); return isFiniteCoord(lat, lng) ? { lat, lng } : null; };
const PRODUCT_KEYS = Object.keys(PRODUCTS);

// ------------------------------------------------------------------ status
api.get('/status', r(async (_req, res) => {
  const regions = await allRegions();
  const runs = await lastRuns();
  const adj = (await adjustments(1))[0] || null;
  res.json({
    ok: true, database: config.db.client, gemini: geminiEnabled(), today: manilaDate(), electricityRate: config.electricityRate,
    hasPrices: regions.some((x) => x.weekStart), regions: regions.map((x) => ({ region: x.region, weekStart: x.weekStart, stale: x.stale })),
    doe: { checkedAt: runs.find((j) => j.name === 'doe_latest')?.lastSuccess || null, checking: isRunning('doe_latest'), latestNcrWeek: regions.find((x) => x.region === 'NCR')?.weekStart || null, latestAdjustment: adj?.weekStart || null },
    syncing: runs.some((j) => j.running), jobs: runs.map((j) => ({ name: j.name, running: j.running, lastSuccess: j.lastSuccess, status: j.last?.status || null })),
  });
}));

// ------------------------------------------------------------------ geocoding
const geoLimit = rateLimit({ windowSec: 60, max: 90, name: 'search' });
api.get('/geocode/search', geoLimit, r(async (req, res) => {
  const near = coordsOf(req.query);
  res.json(await searchPlaces(str(req.query.q, 120), { ...(near || {}), limit: 6 }));
}));
api.get('/geocode/reverse', geoLimit, r(async (req, res) => {
  const c = coordsOf(req.query); if (!c) throw new HttpError(400, 'lat and lng are required');
  const place = await reverseGeocode(c.lat, c.lng);
  res.json({ ...place, doeRegion: doeRegionFor({ region: place.region, state: place.state, lat: c.lat, lng: c.lng }) });
}));

// ------------------------------------------------------------------ vehicles & trips
api.get('/vehicles', r(async (_req, res) => {
  res.json(await db.all('SELECT slug, name, category, fuel_type, product, kmpl_city, kmpl_highway, mass_kg, engine_cc, seats FROM vehicle_presets ORDER BY category, name'));
}));

const tripLimit = rateLimit({ windowSec: 60, max: 30, name: 'trip' });
api.post('/trip/estimate', tripLimit, r(async (req, res) => {
  const trip = await estimateTrip(req.body || {}, req.user);
  const slugs = Array.isArray(req.body?.compare) ? req.body.compare.map((s) => str(s, 60)).slice(0, 8) : [];
  if (slugs.length) trip.comparison = await compareVehicles(trip, slugs);
  const rec = trip.routes[trip.recommendedIndex];
  db.insert('trip_logs', {
    user_id: req.user?.id || null, vehicle_name: trip.vehicle.name?.slice(0, 120), vehicle_category: trip.vehicle.category, fuel_type: trip.vehicle.fuelType, product: trip.product,
    region: trip.region, distance_km: rec.distanceKm, liters: rec.liters, cost: rec.totalCost, round_trip: trip.roundTrip ? 1 : 0, stops: Math.max(0, trip.points.length - 2), created_at: nowSql(),
  }).catch(() => {});
  res.json(trip);
}));

api.get('/range', r(async (req, res) => {
  const budget = num(req.query.budget);
  if (!(budget > 0 && budget < 1e6)) throw new HttpError(400, 'budget (pesos) is required');
  const vehicle = await resolveVehicle({ presetSlug: str(req.query.preset, 60) || undefined, kmpl: num(req.query.kmpl) || undefined, userVehicleId: num(req.query.vehicleId) || undefined, category: str(req.query.category, 20) || undefined }, req.user);
  const c = coordsOf(req.query);
  const place = c ? await reverseGeocode(c.lat, c.lng).catch(() => null) : null;
  const region = str(req.query.region, 40) || doeRegionFor({ region: place?.region, state: place?.state, lat: c?.lat, lng: c?.lng });
  const ev = vehicle.fuelType === 'electric';
  let price;
  if (num(req.query.price) > 0) price = { price: num(req.query.price), basis: ev ? 'Your electricity rate' : 'Your price' };
  else if (ev) price = { price: config.electricityRate, basis: 'Typical residential electricity rate' };
  else {
    const product = str(req.query.product, 20);
    price = await priceFor({ region, city: place?.city, product: product && product !== 'ELECTRICITY' ? product : vehicle.product });
  }
  if (!price) throw new HttpError(503, 'No fuel price data yet.');
  const liters = budget / price.price;
  res.json({ budget, vehicle: vehicle.name, kmpl: round(vehicle.kmplStated, 1), unit: unitOf(vehicle.fuelType), price, liters: round(liters, 2), oneWayKm: round(liters * vehicle.kmplStated, 1), roundTripKm: round((liters * vehicle.kmplStated) / 2, 1), region });
}));

api.get('/route/quick', geoLimit, r(async (req, res) => {
  const [a1, a2] = str(req.query.from, 60).split(',').map(Number); const [b1, b2] = str(req.query.to, 60).split(',').map(Number);
  if (!isFiniteCoord(a1, a2) || !isFiniteCoord(b1, b2)) throw new HttpError(400, 'from and to must be "lat,lng"');
  res.json(await quickDistance({ lat: a1, lng: a2 }, { lat: b1, lng: b2 }));
}));

// ------------------------------------------------------------------ prices
api.get('/prices/summary', r(async (_req, res) => {
  const [regions, adj] = await Promise.all([allRegions(), adjustments(1)]);
  res.json({ regions, latestAdjustment: adj[0] || null, products: PRODUCTS });
}));

const regionParam = (v) => REGIONS.find((x) => x.toLowerCase() === String(v || '').toLowerCase().replace(/-/g, ' '));
const dateParam = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

/** Region prices for the latest week, or any past week (?week=YYYY-MM-DD), compared with ?compare=. */
api.get('/prices/region/:region', r(async (req, res) => {
  const region = regionParam(req.params.region);
  if (!region) throw new HttpError(404, 'Unknown region');
  const summary = await regionSummary(region, { week: dateParam(req.query.week), compareTo: dateParam(req.query.compare) });
  const [areas, brands] = await Promise.all([areaTable(region, summary.weekStart), brandMatrix(region, null, summary.weekStart)]);
  res.json({ summary, areas: areas.areas, brands: brands.rows });
}));

api.get('/prices/weeks', r(async (req, res) => {
  const region = regionParam(req.query.region) || 'NCR';
  const weeks = await weeksList(region);
  res.json({ region, weeks: weeks.map((w) => ({ weekStart: w.week_start, weekEnd: w.week_end })), areas: await areasWithHistory(region) });
}));

api.get('/prices/history', r(async (req, res) => {
  const region = regionParam(req.query.region) || 'NCR';
  const products = str(req.query.products || req.query.product || 'RON91,RON95,DIESEL', 200).split(',').filter((p) => PRODUCT_KEYS.includes(p));
  const weeks = Math.min(num(req.query.weeks) || 26, 1000);
  const out = {};
  for (const p of products) out[p] = await history(region, p, { area: str(req.query.area, 80) || 'ALL', weeks, from: dateParam(req.query.from), to: dateParam(req.query.to) });
  res.json({ region, series: out });
}));

api.get('/prices/export.csv', r(async (req, res) => {
  const region = regionParam(req.query.region) || 'NCR';
  const csv = await exportCsv(region, { area: str(req.query.area, 80) || null, from: dateParam(req.query.from), to: dateParam(req.query.to), brands: req.query.brands === '1' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tipidlitro-${region.toLowerCase().replace(/\s+/g, '-')}-prices.csv"`);
  res.send(`﻿${csv}`);
}));

/** Anyone can ask for a fresh DOE check; it runs at most once every 10 minutes. */
api.post('/prices/check', rateLimit({ windowSec: 600, max: 5, name: 'update check' }), r(async (_req, res) => {
  if (isRunning('doe_latest')) return res.json({ status: 'running' });
  const last = await lastSuccess('doe_latest');
  if (last && Date.now() - new Date(`${String(last).replace(' ', 'T')}Z`).getTime() < 10 * 60 * 1000) return res.json({ status: 'recent', checkedAt: last });
  const out = await runJob('doe_latest');
  res.json({ status: out.status, message: out.message, checkedAt: await lastSuccess('doe_latest') });
}));

api.get('/prices/adjustments', r(async (req, res) => {
  res.json({ weeks: await adjustments(Math.min(num(req.query.weeks) || 12, 52)), latest: await adjustmentDetail(str(req.query.week, 10) || null) });
}));

api.get('/prices/lookup', r(async (req, res) => {
  const p = await priceFor({ region: REGIONS.includes(req.query.region) ? req.query.region : 'NCR', city: str(req.query.city, 80) || null, product: PRODUCT_KEYS.includes(req.query.product) ? req.query.product : 'RON91', brand: str(req.query.brand, 40) || null });
  if (!p) throw new HttpError(404, 'No price data');
  res.json(p);
}));

// ------------------------------------------------------------------ market, forecast, news
api.get('/market', r(async (req, res) => {
  const days = Math.min(num(req.query.days) || 120, 400);
  const [brent, fx] = await Promise.all([getSeries('BRENT', days), getSeries('USDPHP', days)]);
  res.json({ brent, usdphp: fx });
}));

api.get('/forecast', r(async (req, res) => {
  try { res.json(await getForecast({ refresh: req.query.refresh === '1' && req.user?.role === 'admin' })); } catch (err) { throw new HttpError(503, err.message); }
}));

api.get('/news', r(async (req, res) => {
  const category = NEWS_CATEGORIES[req.query.category] ? req.query.category : undefined;
  const [items, pressure] = await Promise.all([latestNews({ category, limit: num(req.query.limit) || 60, days: num(req.query.days) || 14 }), newsPressure(7)]);
  res.json({ items, pressure, categories: Object.fromEntries(Object.entries(NEWS_CATEGORIES).map(([k, v]) => [k, v.label])) });
}));

// ------------------------------------------------------------------ stations
api.get('/stations', geoLimit, r(async (req, res) => {
  const c = coordsOf(req.query); if (!c) throw new HttpError(400, 'lat and lng are required');
  const product = PRODUCT_KEYS.includes(req.query.product) ? req.query.product : 'RON91';
  const [{ stations, source: stationSource }, place] = await Promise.all([stationsNear(c.lat, c.lng, num(req.query.radius) || 3000), reverseGeocode(c.lat, c.lng).catch(() => null)]);
  const region = doeRegionFor({ region: place?.region, state: place?.state, lat: c.lat, lng: c.lng });
  const areaPrice = await priceFor({ region, city: place?.city, product });
  const brandRows = (await brandMatrix(region, areaPrice?.area && areaPrice.area !== 'ALL' ? areaPrice.area : null, areaPrice?.weekStart)).rows.filter((x) => x.product === product);
  const brandBy = new Map();
  for (const b of brandRows) {
    const cur = brandBy.get(b.brand);
    brandBy.set(b.brand, cur ? { min: Math.min(cur.min, b.min), max: Math.max(cur.max, b.max) } : { min: b.min, max: b.max });
  }
  const ids = stations.map((s) => s.osmId);
  const since = nowSql(new Date(Date.now() - 14 * 86400000));
  const reports = ids.length ? await db.all(
    `SELECT station_osm_id, product, price, reported_at, note FROM community_prices WHERE reported_at >= ? AND station_osm_id IN (${ids.map(() => '?').join(',')}) ORDER BY reported_at DESC`,
    [since, ...ids],
  ) : [];
  // DOE monitors these brands by name; every other brand falls under its "Independent" column.
  const DOE_NAMED = new Set(['Petron', 'Shell', 'Caltex', 'Phoenix', 'Total', 'Flying V', 'Unioil', 'Seaoil', 'PTT']);
  const out = stations.map((s) => {
    const doe = brandBy.get(s.brand) || (DOE_NAMED.has(s.brand) ? null : brandBy.get('Independent')) || null;
    const rep = reports.filter((x) => x.station_osm_id === s.osmId);
    const latest = rep.find((x) => x.product === product) || null;
    return {
      ...s, distanceKm: round(haversineKm(c, s), 2),
      doeRange: doe, doeMid: doe ? round((doe.min + doe.max) / 2) : null,
      community: latest ? { price: latest.price, reportedAt: latest.reported_at, note: latest.note, count: rep.filter((x) => x.product === product).length } : null,
      bestPrice: latest?.price ?? (doe ? round((doe.min + doe.max) / 2) : null),
    };
  }).sort((a, b) => a.distanceKm - b.distanceKm);
  const weekLabel = areaPrice?.weekStart ? new Date(`${areaPrice.weekStart}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  res.json({ center: c, place, region, product, areaPrice, stationSource, brandBasis: brandRows.length ? `DOE ${region} brand ranges${areaPrice?.area && areaPrice.area !== 'ALL' ? ` in ${areaPrice.area}` : ''}, week of ${weekLabel}` : null, stations: out });
}));

api.post('/stations/:type/:id/report', requireUser, rateLimit({ windowSec: 3600, max: 30, name: 'price report' }), r(async (req, res) => {
  const osmId = `${str(req.params.type, 10)}/${str(req.params.id, 20)}`;
  if (!/^(node|way|relation)\/\d+$/.test(osmId)) throw new HttpError(400, 'Invalid station id');
  const station = await db.get('SELECT osm_id FROM stations WHERE osm_id = ?', [osmId]);
  if (!station) throw new HttpError(404, 'Unknown station — open it from the Stations map first.');
  const product = PRODUCT_KEYS.includes(req.body?.product) ? req.body.product : null;
  const price = num(req.body?.price);
  if (!product || !(price >= 30 && price <= 250)) throw new HttpError(400, 'Choose a product and a price between ₱30 and ₱250 per liter.');
  await db.insert('community_prices', { station_osm_id: osmId, user_id: req.user.id, product, price: round(price), note: str(req.body?.note, 250) || null, reported_at: nowSql() });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ assistant
api.post('/chat', rateLimit({ windowSec: 60, max: 20, name: 'chat' }), r(async (req, res) => {
  const { message, history: hist, context } = req.body || {};
  const ctx = {};
  if (context?.location && isFiniteCoord(+context.location.lat, +context.location.lng)) ctx.location = { lat: +context.location.lat, lng: +context.location.lng };
  if (context?.vehicle && typeof context.vehicle === 'object') ctx.vehicle = { presetSlug: str(context.vehicle.presetSlug, 60) || undefined, kmpl: num(context.vehicle.kmpl) || undefined, userVehicleId: num(context.vehicle.userVehicleId) || undefined, category: str(context.vehicle.category, 20) || undefined };
  if (REGIONS.includes(context?.region)) ctx.region = context.region;
  res.json(await chat({ message, history: hist, context: ctx }, req.user));
}));

// ------------------------------------------------------------------ auth
const authLimit = rateLimit({ windowSec: 600, max: 20, name: 'sign-in' });
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, monthlyBudget: u.monthly_budget ?? null, homeRegion: u.home_region ?? null });

api.post('/auth/register', authLimit, r(async (req, res) => {
  const name = str(req.body?.name, 120); const email = str(req.body?.email, 190).toLowerCase(); const password = String(req.body?.password || '');
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter your name and a valid email.');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (await db.get('SELECT id FROM users WHERE email = ?', [email])) throw new HttpError(409, 'That email is already registered.');
  const first = !(await db.get('SELECT id FROM users LIMIT 1'));
  const role = first || (config.adminEmail && email === config.adminEmail) ? 'admin' : 'user';
  const { insertId } = await db.insert('users', { email, name, password_hash: await hashPassword(password), role, created_at: nowSql() });
  const token = await createSession(res, insertId);
  res.json({ ...publicUser({ id: insertId, name, email, role }), ...(isMobileClient(req) ? { token } : {}) });
}));

api.post('/auth/login', authLimit, r(async (req, res) => {
  const email = str(req.body?.email, 190).toLowerCase();
  const u = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!u || !(await verifyPassword(String(req.body?.password || ''), u.password_hash))) throw new HttpError(401, 'Wrong email or password.');
  const token = await createSession(res, u.id);
  // Only the mobile app gets the token in the body; the web keeps it in an HttpOnly cookie.
  res.json({ ...publicUser(u), ...(isMobileClient(req) ? { token } : {}) });
}));

api.post('/auth/logout', r(async (req, res) => { await destroySession(req, res); res.json({ ok: true }); }));
api.get('/auth/me', (req, res) => res.json(req.user ? publicUser(req.user) : null));

// ------------------------------------------------------------------ my garage
const me = Router();
me.use(requireUser);
api.use('/me', me);

const vehicleBody = (b) => {
  const kmpl = num(b.kmpl);
  if (!(kmpl > 0 && kmpl < 200)) throw new HttpError(400, 'Fuel economy must be between 0 and 200 km per liter (or kWh).');
  const category = ['motorcycle', 'tricycle', 'car', 'suv', 'mpv', 'pickup', 'van', 'truck', 'jeepney'].includes(b.category) ? b.category : 'car';
  const fuel = ['diesel', 'electric'].includes(b.fuelType) ? b.fuelType : 'gasoline';
  const plate = String(b.plateDigit ?? '').trim();
  return {
    name: str(b.name, 120) || 'My vehicle', preset_slug: str(b.presetSlug, 60) || null, category, fuel_type: fuel,
    product: fuel === 'electric' ? 'ELECTRICITY' : PRODUCT_KEYS.includes(b.product) ? b.product : (fuel === 'diesel' ? 'DIESEL' : 'RON91'),
    kmpl, mass_kg: num(b.massKg) > 0 ? num(b.massKg) : null, engine_cc: num(b.engineCc) > 0 ? Math.round(num(b.engineCc)) : null, tank_liters: num(b.tankLiters) > 0 ? num(b.tankLiters) : null,
    plate_digit: /^\d$/.test(plate) ? Number(plate) : null,
  };
};

me.get('/vehicles', r(async (req, res) => res.json(await db.all('SELECT * FROM user_vehicles WHERE user_id = ? ORDER BY is_default DESC, id', [req.user.id]))));
me.post('/vehicles', r(async (req, res) => {
  const v = vehicleBody(req.body || {});
  const count = await db.get('SELECT COUNT(*) AS n FROM user_vehicles WHERE user_id = ?', [req.user.id]);
  if (count.n >= 20) throw new HttpError(400, 'Garage is full (20 vehicles).');
  const { insertId } = await db.insert('user_vehicles', { ...v, user_id: req.user.id, is_default: count.n === 0 ? 1 : 0, created_at: nowSql() });
  res.json({ id: insertId });
}));
me.put('/vehicles/:id', r(async (req, res) => {
  const v = vehicleBody(req.body || {});
  const r2 = await db.run('UPDATE user_vehicles SET name = ?, category = ?, fuel_type = ?, product = ?, kmpl = ?, mass_kg = ?, engine_cc = ?, tank_liters = ?, plate_digit = ? WHERE id = ? AND user_id = ?',
    [v.name, v.category, v.fuel_type, v.product, v.kmpl, v.mass_kg, v.engine_cc, v.tank_liters, v.plate_digit, num(req.params.id), req.user.id]);
  if (req.body?.isDefault) {
    await db.run('UPDATE user_vehicles SET is_default = 0 WHERE user_id = ?', [req.user.id]);
    await db.run('UPDATE user_vehicles SET is_default = 1 WHERE id = ? AND user_id = ?', [num(req.params.id), req.user.id]);
  }
  res.json({ ok: r2.changes > 0 });
}));
me.delete('/vehicles/:id', r(async (req, res) => {
  await db.run('DELETE FROM user_vehicles WHERE id = ? AND user_id = ?', [num(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

me.get('/logs', r(async (req, res) => {
  const vid = num(req.query.vehicleId);
  res.json(await db.all(`SELECT * FROM fuel_logs WHERE user_id = ?${vid ? ' AND vehicle_id = ?' : ''} ORDER BY filled_on DESC, id DESC LIMIT 500`, vid ? [req.user.id, vid] : [req.user.id]));
}));
me.post('/logs', r(async (req, res) => {
  const b = req.body || {};
  const liters = num(b.liters); const ppl = num(b.pricePerLiter);
  if (!(liters > 0 && liters < 500) || !(ppl > 20 && ppl < 300)) throw new HttpError(400, 'Enter liters and the price per liter you paid.');
  const filled = /^\d{4}-\d{2}-\d{2}$/.test(b.filledOn) ? b.filledOn : manilaDate();
  const vid = num(b.vehicleId) || null;
  if (vid && !(await db.get('SELECT id FROM user_vehicles WHERE id = ? AND user_id = ?', [vid, req.user.id]))) throw new HttpError(404, 'Vehicle not found');
  const { insertId } = await db.insert('fuel_logs', {
    user_id: req.user.id, vehicle_id: vid, filled_on: filled, odometer_km: num(b.odometerKm) > 0 ? num(b.odometerKm) : null, liters: round(liters, 3), price_per_liter: round(ppl, 2),
    total_cost: round(num(b.totalCost) > 0 ? num(b.totalCost) : liters * ppl, 2), full_tank: b.fullTank === false ? 0 : 1, product: PRODUCT_KEYS.includes(b.product) ? b.product : null,
    station_name: str(b.stationName, 160) || null, notes: str(b.notes, 250) || null, created_at: nowSql(),
  });
  res.json({ id: insertId });
}));
me.delete('/logs/:id', r(async (req, res) => {
  await db.run('DELETE FROM fuel_logs WHERE id = ? AND user_id = ?', [num(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

/** Spending by month, and real km/L from consecutive full-tank fill-ups (tank-to-tank method). */
me.get('/stats', r(async (req, res) => {
  const logs = await db.all('SELECT * FROM fuel_logs WHERE user_id = ? ORDER BY filled_on, id', [req.user.id]);
  const months = new Map();
  for (const l of logs) {
    const k = String(l.filled_on).slice(0, 7);
    const m = months.get(k) || { month: k, cost: 0, liters: 0, fills: 0 };
    m.cost += l.total_cost; m.liters += l.liters; m.fills++;
    months.set(k, m);
  }
  const vehicles = await db.all('SELECT id, name, kmpl FROM user_vehicles WHERE user_id = ?', [req.user.id]);
  const efficiency = vehicles.map((v) => {
    const vl = logs.filter((l) => l.vehicle_id === v.id && l.odometer_km != null).sort((a, b) => a.odometer_km - b.odometer_km);
    const segments = []; let prev = null; let liters = 0;
    for (const l of vl) {
      if (prev) liters += l.liters;
      if (l.full_tank) {
        if (prev && l.odometer_km > prev.odometer_km && liters > 0) segments.push({ to: l.filled_on, km: round(l.odometer_km - prev.odometer_km, 1), liters: round(liters, 2), kmpl: round((l.odometer_km - prev.odometer_km) / liters, 1) });
        prev = l; liters = 0;
      }
    }
    const totalKm = segments.reduce((s, x) => s + x.km, 0); const totalL = segments.reduce((s, x) => s + x.liters, 0);
    return { vehicleId: v.id, name: v.name, statedKmpl: v.kmpl, measuredKmpl: totalL ? round(totalKm / totalL, 1) : null, segments: segments.slice(-12) };
  });
  const thisMonth = manilaDate().slice(0, 7);
  const cur = months.get(thisMonth) || { cost: 0, liters: 0, fills: 0 };
  const day = +manilaDate().slice(8, 10);
  const daysInMonth = new Date(Date.UTC(+thisMonth.slice(0, 4), +thisMonth.slice(5, 7), 0)).getUTCDate();
  res.json({
    months: [...months.values()].slice(-12).map((m) => ({ ...m, cost: round(m.cost, 2), liters: round(m.liters, 2) })),
    thisMonth: { ...cur, cost: round(cur.cost, 2), liters: round(cur.liters, 2), projected: round((cur.cost / day) * daysInMonth, 0), budget: req.user.monthly_budget ?? null },
    efficiency,
  });
}));

me.put('/settings', r(async (req, res) => {
  const budget = num(req.body?.monthlyBudget);
  const region = REGIONS.includes(req.body?.homeRegion) ? req.body.homeRegion : null;
  const name = str(req.body?.name, 120);
  await db.run('UPDATE users SET monthly_budget = ?, home_region = ?, name = COALESCE(NULLIF(?, \'\'), name) WHERE id = ?', [budget > 0 ? budget : null, region, name, req.user.id]);
  res.json({ ok: true });
}));

// Price alerts and notifications
me.get('/alerts', r(async (req, res) => {
  const rows = await db.all('SELECT * FROM price_alerts WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.json(rows.map((a) => ({ ...a, description: describeAlert(a) })));
}));
me.post('/alerts', r(async (req, res) => {
  const b = req.body || {};
  const kind = ALERT_KINDS.includes(b.kind) ? b.kind : null;
  const region = regionParam(b.region) || 'NCR';
  const product = PRODUCT_KEYS.includes(b.product) ? b.product : 'RON91';
  const threshold = num(b.threshold);
  if (!kind) throw new HttpError(400, 'Choose an alert type.');
  if ((kind === 'below' || kind === 'above') && !(threshold > 20 && threshold < 300)) throw new HttpError(400, 'Enter a price between ₱20 and ₱300.');
  if ((await db.get('SELECT COUNT(*) AS n FROM price_alerts WHERE user_id = ?', [req.user.id])).n >= 20) throw new HttpError(400, 'Up to 20 alerts.');
  const { insertId } = await db.insert('price_alerts', { user_id: req.user.id, kind, region, product, threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : null, active: 1, last_triggered: null, created_at: nowSql() });
  // An alert that already matches today's data fires right away.
  await evaluateAlerts().catch(() => {});
  res.json({ id: insertId });
}));
me.delete('/alerts/:id', r(async (req, res) => {
  await db.run('DELETE FROM price_alerts WHERE id = ? AND user_id = ?', [num(req.params.id), req.user.id]);
  res.json({ ok: true });
}));
me.get('/notifications', r(async (req, res) => {
  const items = await db.all('SELECT id, title, body, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30', [req.user.id]);
  res.json({ unread: items.filter((n) => !n.read_at).length, items });
}));
me.post('/notifications/read', r(async (req, res) => {
  await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [nowSql(), req.user.id]);
  res.json({ ok: true });
}));

me.get('/trips', r(async (req, res) => res.json(await db.all('SELECT id, name, origin_label, destination_label, distance_km, cost_php, payload, created_at FROM saved_trips WHERE user_id = ? ORDER BY id DESC LIMIT 100', [req.user.id]))));
me.post('/trips', r(async (req, res) => {
  const b = req.body || {};
  const payload = JSON.stringify(b.params || {});
  if (payload.length > 20000) throw new HttpError(400, 'Trip is too large to save.');
  const { insertId } = await db.insert('saved_trips', {
    user_id: req.user.id, name: str(b.name, 160) || 'My trip', origin_label: str(b.originLabel, 250) || null, destination_label: str(b.destinationLabel, 250) || null,
    distance_km: num(b.distanceKm) || null, cost_php: num(b.cost) || null, payload, created_at: nowSql(),
  });
  res.json({ id: insertId });
}));
me.delete('/trips/:id', r(async (req, res) => {
  await db.run('DELETE FROM saved_trips WHERE id = ? AND user_id = ?', [num(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ admin
const admin = Router();
admin.use(requireAdmin);
api.use('/admin', admin);

admin.get('/monitor', r(async (_req, res) => res.json(await monitorSnapshot())));
admin.get('/stats', r(async (_req, res) => res.json(await adminStats())));
admin.get('/users', r(async (_req, res) => res.json(await listUsers())));
admin.put('/users/:id/role', r(async (req, res) => {
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  const id = num(req.params.id);
  if (role === 'user') {
    const admins = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")).n;
    const target = await db.get('SELECT role FROM users WHERE id = ?', [id]);
    if (target?.role === 'admin' && admins <= 1) throw new HttpError(400, 'There must be at least one admin.');
  }
  const r2 = await db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  if (!r2.changes) throw new HttpError(404, 'User not found');
  res.json({ ok: true, role });
}));
admin.get('/reports', r(async (_req, res) => res.json(await listReports())));
admin.delete('/reports/:id', r(async (req, res) => {
  await db.run('DELETE FROM community_prices WHERE id = ?', [num(req.params.id)]);
  res.json({ ok: true });
}));
admin.get('/log', r(async (req, res) => res.json(await recentLog(num(req.query.limit) || 80, str(req.query.source, 40) || null))));
admin.get('/jobs', r(async (_req, res) => res.json(await lastRuns())));
admin.post('/jobs/:name/run', r(async (req, res) => {
  if (!JOBS[req.params.name]) throw new HttpError(404, 'Unknown job');
  runJob(req.params.name); // runs in the background; the UI polls /admin/jobs
  res.json({ ok: true, started: req.params.name });
}));
admin.get('/history', r(async (_req, res) => res.json(await historyCoverage())));
/** Import older weekly NCR reports and adjustment notices from the DOE archive (back to 2017). */
admin.post('/history/import', r(async (req, res) => {
  const w = req.body?.weeks === 'all' ? 'all' : Math.max(1, Math.min(num(req.body?.weeks) || 52, 1000));
  if (isRunning('doe_backfill')) throw new HttpError(409, 'A history import is already running.');
  runJob('doe_backfill', { params: { weeks: w } });
  res.json({ ok: true, weeks: w });
}));
admin.get('/documents', r(async (_req, res) => res.json(await db.all('SELECT id, url, kind, region, title, guessed_date, week_start, status, message, rows_count, fetched_at FROM doe_documents ORDER BY COALESCE(week_start, guessed_date) DESC, id DESC LIMIT 200'))));
admin.post('/documents/:id/retry', r(async (req, res) => {
  await db.run('DELETE FROM doe_documents WHERE id = ?', [num(req.params.id)]);
  runJob('doe_prices');
  res.json({ ok: true });
}));

const validEntry = (e) => {
  const region = REGIONS.find((x) => x.toLowerCase() === String(e.region || '').trim().toLowerCase());
  const product = String(e.product || '').trim().toUpperCase();
  const common = num(e.common); const min = num(e.min); const max = num(e.max);
  const weekStart = String(e.weekStart || e.week_start || '').trim();
  if (!region || !PRODUCT_KEYS.includes(product) || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !(common > 20 && common < 300)) return null;
  return { region, area: str(e.area, 80) || 'ALL', brand: str(e.brand, 40) || 'ALL', product, common: round(common), min: min > 0 ? round(min) : null, max: max > 0 ? round(max) : null, weekStart };
};
admin.post('/prices', r(async (req, res) => {
  const entries = (Array.isArray(req.body?.entries) ? req.body.entries : []).map(validEntry);
  if (!entries.length || entries.some((e) => !e)) throw new HttpError(400, 'Each entry needs region, product, common price and week start (YYYY-MM-DD).');
  res.json({ saved: await saveManualPrices(entries, req.user.email) });
}));
admin.post('/prices/csv', r(async (req, res) => {
  const lines = String(req.body?.csv || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new HttpError(400, 'Paste a header row and at least one data row.');
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const entries = []; const bad = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const o = Object.fromEntries(head.map((h, k) => [h === 'week_start' ? 'weekStart' : h, cells[k]]));
    const e = validEntry(o);
    if (e) entries.push(e); else bad.push(i + 2);
  });
  if (!entries.length) throw new HttpError(400, `No valid rows. Expected columns: region,area,brand,product,min,max,common,week_start. Bad lines: ${bad.slice(0, 10).join(', ')}`);
  res.json({ saved: await saveManualPrices(entries, req.user.email), skippedLines: bad });
}));
admin.post('/cache/clear', r(async (req, res) => { await clearCache(str(req.body?.source, 40) || null); res.json({ ok: true }); }));

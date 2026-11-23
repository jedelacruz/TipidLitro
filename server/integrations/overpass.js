// Fuel stations from OpenStreetMap via the Overpass API (amenity=fuel).
// Metro areas are synced in bulk by a weekly job into the stations table, so most searches are
// answered locally; other places query Overpass live (cached), falling back to stored stations.
import { db } from '../db/index.js';
import { cached } from '../lib/cache.js';
import { request } from '../lib/http.js';
import { HttpError, haversineKm, nowSql } from '../lib/util.js';
import { normalizeBrand } from './doe.js';

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const KNOWN = ['Petron', 'Shell', 'Caltex', 'Phoenix', 'Total', 'Flying V', 'Unioil', 'Seaoil', 'PTT', 'Cleanfuel', 'Jetti', 'Petro Gazz', 'Filpride', 'City Oil', 'Ecooil'];

/** Areas synced in bulk (south, west, north, east). */
export const SYNC_AREAS = [
  { name: 'Metro Manila', bbox: [14.35, 120.9, 14.8, 121.15] },
  { name: 'Metro Cebu', bbox: [10.2, 123.8, 10.45, 124.05] },
  { name: 'Metro Davao', bbox: [6.95, 125.45, 7.2, 125.7] },
];

export function stationBrand(tags = {}) {
  const raw = `${tags.brand || ''} ${tags.operator || ''} ${tags.name || ''}`.toLowerCase();
  if (/totalenergies|\btotal\b/.test(raw)) return 'Total';
  if (/clean\s?fuel/.test(raw)) return 'Cleanfuel';
  if (/sea\s?oil/.test(raw)) return 'Seaoil';
  for (const b of KNOWN) if (raw.includes(b.toLowerCase())) return b;
  return tags.brand ? normalizeBrand(tags.brand) : 'Independent';
}

async function overpass(query, timeout) {
  let lastErr;
  for (const url of MIRRORS) {
    try {
      const d = await request('overpass', url, {
        method: 'POST', body: `data=${encodeURIComponent(query)}`, timeout, retries: 0,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return d.elements || [];
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

const toStation = (e) => {
  const t = e.tags || {};
  const brand = stationBrand(t);
  return {
    osmId: `${e.type}/${e.id}`,
    name: t.name || t.brand || `${brand} station`,
    brand,
    lat: e.lat ?? e.center?.lat,
    lng: e.lon ?? e.center?.lon,
    address: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' ') || null,
    openingHours: t.opening_hours || null,
  };
};

async function store(stations) {
  await db.transaction(async () => {
    for (const s of stations) {
      await db.upsert('stations', {
        osm_id: s.osmId, name: s.name?.slice(0, 160), brand: s.brand, lat: s.lat, lng: s.lng, address: s.address?.slice(0, 255) || null, opening_hours: s.openingHours?.slice(0, 120) || null, updated_at: nowSql(),
      }, ['osm_id']);
    }
  });
}

/** Job: bulk-sync every fuel station in the metro areas. */
export async function syncStations() {
  let total = 0; const errors = [];
  for (const area of SYNC_AREAS) {
    try {
      const els = await overpass(`[out:json][timeout:120];nwr["amenity"="fuel"](${area.bbox.join(',')});out center tags;`, 150000);
      const stations = els.map(toStation).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      await store(stations);
      total += stations.length;
    } catch (err) { errors.push(`${area.name}: ${err.message}`); }
  }
  if (!total && errors.length) throw new Error(errors.join('; '));
  return { items: total, message: `${total} stations${errors.length ? `; ${errors.join('; ')}` : ''}` };
}

async function localStations(lat, lng, radiusM) {
  const dLat = radiusM / 111000; const dLng = radiusM / (111000 * Math.cos((lat * Math.PI) / 180));
  const rows = await db.all('SELECT * FROM stations WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?', [lat - dLat, lat + dLat, lng - dLng, lng + dLng]);
  return rows.map((r) => ({ osmId: r.osm_id, name: r.name, brand: r.brand, lat: r.lat, lng: r.lng, address: r.address, openingHours: r.opening_hours }))
    .filter((s) => haversineKm({ lat, lng }, s) * 1000 <= radiusM);
}

const inSyncedArea = (lat, lng) => SYNC_AREAS.some(({ bbox: [s, w, n, e] }) => lat >= s && lat <= n && lng >= w && lng <= e);

export async function stationsNear(lat, lng, radiusM = 3000) {
  const r = Math.min(Math.max(+radiusM || 3000, 500), 15000);
  const local = await localStations(lat, lng, r);
  if (local.length && inSyncedArea(lat, lng)) return { stations: local, source: 'synced' };
  try {
    // Snap to a ~1 km grid so nearby searches share one cached Overpass call.
    const key = `${lat.toFixed(2)},${lng.toFixed(2)},${r}`;
    const stations = await cached('overpass', key, 24 * 3600, async () => {
      const els = await overpass(`[out:json][timeout:45];nwr["amenity"="fuel"](around:${r + 800},${lat.toFixed(2)},${lng.toFixed(2)});out center tags 300;`, 50000);
      const list = els.map(toStation).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
      await store(list).catch(() => {});
      return list;
    });
    return { stations: stations.filter((s) => haversineKm({ lat, lng }, s) * 1000 <= r), source: 'live' };
  } catch (err) {
    if (local.length) return { stations: local, source: 'stored' };
    throw new HttpError(503, `Station data from OpenStreetMap (Overpass) is not responding right now (${err.message}). Please try again in a minute.`);
  }
}

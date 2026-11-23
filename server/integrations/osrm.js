// OSRM routing (public demo server, with a community mirror as fallback).
import { config } from '../config.js';
import { cached } from '../lib/cache.js';
import { request } from '../lib/http.js';
import { HttpError } from '../lib/util.js';

const coordKey = (p) => `${(+p.lng).toFixed(5)},${(+p.lat).toFixed(5)}`;

/**
 * @param {{lat:number,lng:number}[]} points  origin, optional stops, destination
 * @returns {Promise<Array<{distanceKm, durationMin, geometry:[number,number][], motorwayKm, tollKm, ferryKm, roads:string[]}>>}
 */
export async function getRoutes(points, { alternatives = true } = {}) {
  if (points.length < 2) throw new HttpError(400, 'A route needs at least an origin and a destination.');
  const path = points.map(coordKey).join(';');
  const alt = alternatives && points.length === 2 ? '&alternatives=3' : '';
  const qs = `?overview=full&geometries=geojson&steps=true${alt}`;
  return cached('osrm', path + alt, 24 * 3600, async () => {
    let data;
    try {
      data = await request('osrm', `${config.osrmUrl}/route/v1/driving/${path}${qs}`, { timeout: 20000 });
    } catch (err) {
      if (!config.osrmFallbackUrl) throw err;
      data = await request('osrm', `${config.osrmFallbackUrl}/route/v1/driving/${path}${qs}`, { timeout: 25000 });
    }
    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new HttpError(422, data.code === 'NoRoute' ? 'No drivable route found between those places (different islands without a ferry link?).' : `Routing failed: ${data.message || data.code}`);
    }
    return data.routes.map(summarizeRoute);
  });
}

function summarizeRoute(r) {
  let motorway = 0; let toll = 0; let ferry = 0;
  const roadKm = new Map();
  for (const leg of r.legs) {
    for (const step of leg.steps || []) {
      const classes = new Set((step.intersections || []).flatMap((i) => i.classes || []));
      if (step.mode === 'ferry' || classes.has('ferry')) ferry += step.distance;
      else {
        if (classes.has('motorway')) motorway += step.distance;
        if (classes.has('toll')) toll += step.distance;
      }
      const ref = step.ref?.split(';')[0].trim();
      const name = step.name || (ref ? (/^\d+$/.test(ref) ? `N${ref}` : ref) : null);
      if (name && step.distance > 0) roadKm.set(name, (roadKm.get(name) || 0) + step.distance);
    }
  }
  const roads = [...roadKm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n);
  return {
    distanceKm: r.distance / 1000,
    durationMin: r.duration / 60,
    geometry: r.geometry.coordinates,
    motorwayKm: motorway / 1000,
    tollKm: toll / 1000,
    ferryKm: ferry / 1000,
    roads,
  };
}

/** Driving distance/time only (used by the detour calculator and the assistant). */
export async function quickDistance(a, b) {
  const [r] = await getRoutes([a, b], { alternatives: false });
  return { distanceKm: r.distanceKm, durationMin: r.durationMin };
}

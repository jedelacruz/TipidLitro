// Open-Meteo: hourly weather at points along a route, and terrain elevation for climb/descent.
import { cached } from '../lib/cache.js';
import { request } from '../lib/http.js';

const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 80: 'Rain showers', 81: 'Heavy showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm',
};
export const weatherText = (code) => WMO[code] || 'Unknown';

/**
 * Weather for each point at the given time (ISO string, any time zone).
 * @returns {Promise<Array<{lat,lng,time,tempC,precipMm,precipProb,windKmh,windDir,code,text}>>}
 */
export async function weatherAlong(points, when = new Date()) {
  const t = new Date(when);
  const lat = points.map((p) => p.lat.toFixed(2)).join(',');
  const lng = points.map((p) => p.lng.toFixed(2)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    + '&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,weather_code'
    + '&timezone=GMT&forecast_days=3&past_days=1';
  const data = await cached('open-meteo', url, 30 * 60, () => request('open-meteo', url, { timeout: 12000 }));
  const list = Array.isArray(data) ? data : [data];
  const hourKey = t.toISOString().slice(0, 13) + ':00';
  return list.map((d, i) => {
    const h = d.hourly; let idx = h.time.indexOf(hourKey);
    if (idx < 0) idx = h.time.length - 1;
    const code = h.weather_code[idx];
    return {
      lat: points[i].lat, lng: points[i].lng, time: h.time[idx] + 'Z',
      tempC: h.temperature_2m[idx], precipMm: h.precipitation[idx], precipProb: h.precipitation_probability[idx],
      windKmh: h.wind_speed_10m[idx], windDir: h.wind_direction_10m[idx], code, text: weatherText(code),
    };
  });
}

/** Elevations (m) for up to a few hundred points; batched 100 per request. */
export async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const lat = chunk.map((p) => p.lat.toFixed(4)).join(',');
    const lng = chunk.map((p) => p.lng.toFixed(4)).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`;
    const d = await cached('open-meteo-elevation', url, 30 * 24 * 3600, () => request('open-meteo-elevation', url, { timeout: 15000 }));
    out.push(...d.elevation);
  }
  return out;
}

/** Total climb/descent with a small dead-band so DEM noise does not count as hills. */
export function climbStats(elev, threshold = 2) {
  let climb = 0; let descent = 0; let ref = elev[0];
  for (const e of elev.slice(1)) {
    const d = e - ref;
    if (Math.abs(d) >= threshold) { if (d > 0) climb += d; else descent -= d; ref = e; }
  }
  return { climbM: Math.round(climb), descentM: Math.round(descent), minM: Math.round(Math.min(...elev)), maxM: Math.round(Math.max(...elev)) };
}

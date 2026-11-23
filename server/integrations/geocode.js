// Place search (Photon / Komoot) and reverse geocoding (Nominatim, Photon as fallback).
import { cached } from '../lib/cache.js';
import { request } from '../lib/http.js';

const PH_BBOX = '116.9,4.5,126.7,21.2';

const join = (...parts) => [...new Set(parts.filter(Boolean))].join(', ');

function fromPhoton(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry.coordinates;
  const name = p.name || join(p.housenumber, p.street) || p.city || p.state;
  return {
    name,
    label: join(name, p.street && p.name ? p.street : null, p.district, p.city || p.county, p.state),
    city: p.city || p.county || null,
    state: p.state || null,
    country: p.countrycode || p.country || null,
    kind: p.osm_value || p.type || null,
    lat, lng,
  };
}

export async function searchPlaces(q, { lat, lng, limit = 6 } = {}) {
  const query = String(q || '').trim().slice(0, 120);
  if (query.length < 2) return [];
  const bias = Number.isFinite(lat) && Number.isFinite(lng) ? `&lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}` : '&lat=14.5995&lon=120.9842';
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit + 4}&bbox=${PH_BBOX}${bias}`;
  const data = await cached('photon', url, 7 * 24 * 3600, () => request('photon', url, { timeout: 10000 }));
  const seen = new Set();
  return (data.features || [])
    .filter((f) => !f.properties?.countrycode || f.properties.countrycode === 'PH')
    .map(fromPhoton)
    .filter((p) => { const k = p.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit);
}

/** Coordinates -> { label, city, state, region } */
export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  return cached('nominatim', key, 30 * 24 * 3600, async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1&accept-language=en`;
      const d = await request('nominatim', url, { timeout: 10000 });
      const a = d.address || {};
      const city = a.city || a.town || a.municipality || a.village || a.county || null;
      return {
        label: join(d.name || a.road || a.neighbourhood, a.suburb || a.quarter, city, a.state || a.region),
        city,
        state: a.state || a.province || null,
        region: a.region || a.state || null,
        lat, lng,
      };
    } catch {
      const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=1`;
      const d = await request('photon', url, { timeout: 10000 });
      const f = d.features?.[0];
      if (!f) return { label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, city: null, state: null, region: null, lat, lng };
      const p = fromPhoton(f);
      return { label: p.label, city: p.city, state: p.state, region: p.state, lat, lng };
    }
  });
}

/** Map a Philippine region/state name to the DOE price-monitoring region. Falls back to coordinates. */
export function doeRegionFor({ region, state, lat, lng } = {}) {
  const s = `${region || ''} ${state || ''}`.toLowerCase();
  if (/metro manila|national capital|\bncr\b/.test(s)) return 'NCR';
  if (/ilocos|cagayan valley|central luzon|cordillera|\bcar\b|region i\b|region ii\b|region iii\b/.test(s)) return 'North Luzon';
  if (/calabarzon|mimaropa|bicol|region iv|region v\b|southwestern tagalog/.test(s)) return 'South Luzon';
  if (/visayas|negros|region vi|region vii|region viii/.test(s)) return 'Visayas';
  if (/mindanao|zamboanga|davao|soccsksargen|caraga|bangsamoro|barmm|region ix|region x|region xi|region xii|region xiii/.test(s)) return 'Mindanao';
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'NCR';
  if (lat > 14.35 && lat < 14.79 && lng > 120.9 && lng < 121.14) return 'NCR';
  if (lat >= 14.9) return 'North Luzon';
  if (lat >= 12.4 && lng < 124.5) return 'South Luzon';
  if (lat >= 9.4 || (lat >= 9.0 && lng < 123.6)) return 'Visayas';
  return 'Mindanao';
}

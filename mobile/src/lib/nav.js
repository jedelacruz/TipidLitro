// Deep links to navigation apps, GPX export and sharing (same targets as the web app).
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Platform, Share } from 'react-native';
import { apiUrl } from './api';

const ll = (p) => `${(+p.lat).toFixed(6)},${(+p.lng).toFixed(6)}`;

export function gmapsUrl(points, twoWheeler) {
  const q = new URLSearchParams({ api: '1', origin: ll(points[0]), destination: ll(points[points.length - 1]), travelmode: twoWheeler ? 'two-wheeler' : 'driving' });
  if (points.length > 2) q.set('waypoints', points.slice(1, -1).map(ll).join('|'));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** Navigation apps. Waze routes from the phone's current location to B. */
export function navApps(points, { twoWheeler = false } = {}) {
  const o = points[0]; const d = points[points.length - 1];
  const stops = points.length > 2;
  return [
    { key: 'google', name: 'Google Maps', color: '#1a73e8', short: 'G', url: gmapsUrl(points, twoWheeler), note: twoWheeler ? 'Two-wheeler mode, with stops' : stops ? 'Includes your stops' : 'Driving directions' },
    { key: 'waze', name: 'Waze', color: '#33ccff', short: 'W', url: `https://waze.com/ul?ll=${ll(d)}&navigate=yes`, note: 'From your current location to B' },
    { key: 'apple', name: 'Apple Maps', color: '#111827', short: '', url: `https://maps.apple.com/?saddr=${ll(o)}&daddr=${ll(d)}&dirflg=d`, note: stops ? 'A to B (stops not supported)' : 'Driving directions', ios: true },
    { key: 'osm', name: 'OpenStreetMap', color: '#7ebc6f', short: 'O', url: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(`${ll(o)};${ll(d)}`)}`, note: 'Open data, opens in the browser' },
  ].filter((a) => !a.ios || Platform.OS === 'ios');
}

export const openUrl = (url) => Linking.openURL(url);

export async function copyText(text) {
  await Clipboard.setStringAsync(text);
}

export async function shareText(message, title = 'TipidLitro') {
  try { await Share.share({ message, title }); } catch { /* dismissed */ }
}

export function coordinatesText(points) {
  return points.map((p, i) => `${i === 0 ? 'A' : i === points.length - 1 ? 'B' : i}: ${(+p.lat).toFixed(6)}, ${(+p.lng).toFixed(6)}${p.label ? ` (${p.label})` : ''}`).join('\n');
}

const safeName = (name, ext) => `${String(name).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'tipidlitro'}.${ext}`;

/** Write a GPX track + waypoints to the cache folder and open the share sheet (OsmAnd, Organic Maps, Garmin…). */
export async function shareGpx(name, points, geometry) {
  const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const wpts = points.map((p, i) => `  <wpt lat="${p.lat}" lon="${p.lng}"><name>${x(i === 0 ? `A ${p.label || ''}` : i === points.length - 1 ? `B ${p.label || ''}` : `Stop ${i}`)}</name></wpt>`).join('\n');
  const trk = geometry.map(([lng, lat]) => `      <trkpt lat="${lat}" lon="${lng}"/>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TipidLitro" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${x(name)}</name></metadata>\n${wpts}\n  <trk><name>${x(name)}</name><trkseg>\n${trk}\n    </trkseg></trk>\n</gpx>\n`;
  const file = new File(Paths.cache, safeName(name, 'gpx'));
  file.create({ overwrite: true });
  await file.write(gpx);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/gpx+xml', dialogTitle: 'Share route (GPX)', UTI: 'com.topografix.gpx' });
}

/** Download a CSV from the server (e.g. price history) and open the share sheet. */
export async function shareCsv(path, name) {
  const target = new File(Paths.cache, safeName(name, 'csv'));
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(apiUrl(path), target, { idempotent: true });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Share prices (CSV)', UTI: 'public.comma-separated-values-text' });
}

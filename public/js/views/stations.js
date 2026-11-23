// Stations: nearby fuel stations (OpenStreetMap) with DOE brand price ranges, community reports,
// and the real cost of driving to each one (fill-up + detour fuel).
import { PRODUCT_LABELS, alertBox, api, brandColor, clear, fmt, getLocation, h, icon, loading, modal, openInMenu, state, store, toast } from '../lib.js';
import { autocomplete, baseMap } from './planner.js';
import { pageHeader, term } from '../ui.js';

const HELP = {
  intro: 'Find fuel stations near you and see which one is really the cheapest once you count the fuel it takes to get there.',
  steps: [
    "Tap 'Use my location' or search an area. You can also click the map.",
    'Choose your fuel. Prices come from DOE brand ranges for your city, or from recent reports by other users.',
    "Sort by 'Best value' (fill-up + detour fuel) or 'Nearest'.",
    "Tap 'Open in' for directions in Google Maps, Waze or Apple Maps.",
    "Saw the actual price? Tap 'Report price' to help others.",
  ],
  terms: ['trueCost', 'brandRange', 'community', 'common'],
};

export async function render(root) {
  const L = window.L;
  const S = { center: state.location || { lat: 14.6199, lng: 121.0509, label: 'Cubao, Quezon City' }, data: null, markers: new Map(), sort: 'value', selected: null, here: null };
  const presetKey = store.get('vehicleKey', 'preset:honda-click-125');
  const preset = state.presets.find((p) => `preset:${p.slug}` === presetKey);
  const twoWheel = preset ? ['motorcycle', 'tricycle'].includes(preset.category) : true;

  const productSel = h('select', null, ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS'].map((p) => h('option', { value: p }, PRODUCT_LABELS[p])));
  productSel.value = preset && preset.product !== 'ELECTRICITY' ? preset.product : 'RON91';
  const radiusSel = h('select', null, [[1500, '1.5 km'], [3000, '3 km'], [5000, '5 km'], [10000, '10 km']].map(([v, t]) => h('option', { value: v }, t)));
  radiusSel.value = '3000';
  const litersIn = h('input', { type: 'number', min: '1', max: '200', step: '0.5', value: twoWheel ? '4' : '30' });
  const kmplIn = h('input', { type: 'number', min: '1', max: '150', step: '0.1', value: preset ? Math.round(((preset.kmpl_city + preset.kmpl_highway) / 2) * 10) / 10 : '45' });
  const searchIn = h('input', { type: 'text', placeholder: 'Search an area (e.g. Makati)', autocomplete: 'off' });
  const list = h('div', { class: 'station-list' });
  const info = h('div');
  const sortSeg = h('div', { class: 'seg' }, [['value', 'Best value'], ['distance', 'Nearest']].map(([k, t]) => h('button', { type: 'button', class: k === S.sort ? 'on' : '', onClick: (e) => { S.sort = k; [...sortSeg.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); drawList(); } }, t)));

  const mapEl = h('div', { class: 'map' });
  root.append(
    pageHeader({ title: 'Nearby stations', subtitle: 'Find the station that is really cheapest: the fill-up plus the fuel to get there and back.', help: HELP }),
    h('div', { class: 'stations' },
      h('section', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'row', style: { marginBottom: '10px' } },
            h('button', { class: 'btn small primary', type: 'button', onClick: locate }, icon('locate'), 'Use my location'),
            h('div', { class: 'ac', style: { flex: 1, minWidth: '160px' } }, searchIn)),
          h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', null, 'Fuel'), productSel), h('div', { class: 'field' }, h('label', null, 'Radius'), radiusSel)),
          h('details', { class: 'more', style: { marginBottom: '10px' } }, h('summary', null, 'My fill-up: ', h('span', { class: 'muted', style: { fontWeight: 500 } }, 'liters and km/L')),
            h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', null, 'Liters to buy'), litersIn), h('div', { class: 'field' }, h('label', null, 'Your km/L'), kmplIn))),
          h('div', { class: 'row between' }, sortSeg, h('button', { class: 'btn small', type: 'button', onClick: load }, icon('refresh'), 'Refresh'))),
        info, list),
      h('section', { class: 'map-wrap' }, mapEl)));

  const map = baseMap(mapEl, [S.center.lat, S.center.lng], 14);
  map.on('click', (e) => { S.center = { lat: e.latlng.lat, lng: e.latlng.lng }; load(); });
  autocomplete(searchIn, (p) => { S.center = p; map.setView([p.lat, p.lng], 14); load(); }, () => S.center);
  [productSel, radiusSel].forEach((el) => el.addEventListener('change', load));
  [litersIn, kmplIn].forEach((el) => el.addEventListener('input', drawList));

  async function locate() {
    try { const loc = await getLocation(); S.center = loc; map.setView([loc.lat, loc.lng], 14); load(); } catch (e) { toast(e.message, 'error'); }
  }

  function priced(s) {
    const fallback = S.data.areaPrice?.price ?? null;
    const price = s.bestPrice ?? fallback;
    const basis = s.community ? 'community' : s.doeMid != null ? 'doe' : 'area';
    const liters = Number(litersIn.value) || 0; const kmpl = Number(kmplIn.value) || 1;
    const detourKm = s.distanceKm * 2 * 1.3;
    const detourCost = price != null ? (detourKm / kmpl) * price : null;
    return { ...s, price, basis, detourKm, detourCost, total: price != null ? liters * price + detourCost : null };
  }

  function drawList() {
    if (!S.data) return;
    const rows = S.data.stations.map(priced);
    const nearest = rows[0];
    const sorted = [...rows].sort((a, b) => (S.sort === 'distance' ? a.distanceKm - b.distanceKm : (a.total ?? 1e9) - (b.total ?? 1e9)));
    const best = sorted.find((r) => r.total != null);
    clear(list);
    if (!rows.length) { list.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No fuel stations mapped within this radius. Try a larger radius.'))); return; }
    for (const s of sorted) {
      const save = nearest?.total != null && s.total != null ? nearest.total - s.total : null;
      const card = h('div', { class: `card station ${S.selected === s.osmId ? 'on' : ''}`, dataset: { id: s.osmId }, onClick: () => select(s.osmId, true) },
        h('div', { class: 'row between' },
          h('div', { style: { minWidth: 0 } }, h('b', null, s.name), h('div', { class: 'muted', style: { fontSize: '.8rem' } }, h('span', { class: 'brand-dot', style: { background: brandColor(s.brand), marginRight: '5px' } }), `${s.brand} · ${fmt.num(s.distanceKm, 2)} km away`)),
          h('div', { style: { textAlign: 'right' } }, h('div', { class: 'kpi', style: { fontSize: '1.2rem' } }, s.price != null ? fmt.peso(s.price) : '—'),
            h('span', { class: `badge ${s.basis === 'community' ? 'blue' : s.basis === 'doe' ? 'green' : 'gray'}` }, s.basis === 'community' ? `reported ${fmt.ago(s.community.reportedAt)}` : s.basis === 'doe' ? 'DOE brand range' : 'area avg'))),
        h('div', { class: 'row between', style: { fontSize: '.82rem', marginTop: '6px' } },
          h('span', { class: 'muted' }, s.total != null ? `${litersIn.value} L + detour ${fmt.peso(s.detourCost)} = ` : '', s.total != null ? h('b', null, fmt.peso(s.total)) : ''),
          s === best ? h('span', { class: 'badge green' }, 'best value') : save != null && Math.abs(save) >= 1 && s !== nearest ? h('span', { class: save > 0 ? 'down' : 'up', style: { fontWeight: 700 } }, save > 0 ? `saves ${fmt.peso(save)}` : `costs ${fmt.peso(-save)} more`) : null),
        s.doeRange && s.basis !== 'doe' ? h('div', { class: 'faint', style: { fontSize: '.76rem' } }, `DOE ${s.brand} range: ${fmt.peso(s.doeRange.min)}–${fmt.peso(s.doeRange.max)}`) : null,
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('div', { onClick: (e) => e.stopPropagation() }, openInMenu([{ ...S.center, label: 'You' }, { lat: s.lat, lng: s.lng, label: s.name }], { twoWheeler: twoWheel, label: 'Other apps' })),
          h('button', { class: 'btn small', type: 'button', onClick: (e) => { e.stopPropagation(); report(s); } }, icon('plus'), 'Report price')));
      list.append(card);
    }
    drawMarkers(rows);
  }

  function drawMarkers(rows) {
    S.markers.forEach((m) => m.remove()); S.markers.clear();
    S.here?.remove();
    S.here = L.circleMarker([S.center.lat, S.center.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map).bindTooltip('Search center');
    for (const s of rows) {
      const label = s.price != null ? `₱${s.price.toFixed(2)}` : s.brand.slice(0, 8);
      const m = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: '', html: `<span class="station-pin" style="background:${brandColor(s.brand)}">${label.replace(/[<>&"]/g, '')}</span>`, iconSize: [0, 0] }) }).addTo(map);
      m.bindPopup(() => h('div', null, h('b', null, s.name), h('br'), `${s.brand} · ${fmt.num(s.distanceKm, 2)} km`, s.openingHours ? [h('br'), s.openingHours] : null));
      m.on('click', () => select(s.osmId, false));
      S.markers.set(s.osmId, m);
    }
  }

  function select(id, fly) {
    S.selected = id;
    const m = S.markers.get(id);
    if (m && fly) { map.setView(m.getLatLng(), Math.max(map.getZoom(), 15)); m.openPopup(); }
    for (const c of list.children) {
      c.classList.toggle('on', c.dataset.id === id);
      if (!fly && c.dataset.id === id) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  async function report(s) {
    if (!state.user) { const u = await window.tlAuth(); if (!u) return; }
    const prod = h('select', null, ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS'].map((p) => h('option', { value: p }, PRODUCT_LABELS[p])));
    prod.value = productSel.value;
    const price = h('input', { type: 'number', min: '30', max: '250', step: '0.01', placeholder: 'e.g. 88.90' });
    const note = h('input', { type: 'text', maxlength: '200', placeholder: 'Optional (e.g. "promo for riders")' });
    const ok = await modal(`Report a price at ${s.name}`, h('div', null,
      h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', null, 'Fuel'), prod), h('div', { class: 'field' }, h('label', null, '₱ per liter'), price)),
      h('div', { class: 'field' }, h('label', null, 'Note'), note),
      h('p', { class: 'muted', style: { fontSize: '.82rem' } }, 'Reports are shown to everyone for 14 days next to the DOE range.')),
    [{ label: 'Cancel', value: false }, { label: 'Submit', primary: true, onClick: async () => {
      try { await api(`/stations/${s.osmId}/report`, { method: 'POST', body: { product: prod.value, price: Number(price.value), note: note.value } }); return true; } catch (e) { toast(e.message, 'error'); return false; }
    } }]);
    if (ok) { toast('Thanks! Price reported.'); load(); }
  }

  async function load() {
    clear(info).append(loading('Finding stations (OpenStreetMap) and DOE brand prices…'));
    try {
      S.data = await api(`/stations?lat=${S.center.lat}&lng=${S.center.lng}&radius=${radiusSel.value}&product=${productSel.value}`);
      const a = S.data.areaPrice;
      clear(info).append(h('div', { class: 'card flat', style: { padding: '12px' } },
        h('div', { style: { fontSize: '.86rem' } }, h('b', null, S.data.place?.label || 'Selected area'), h('div', { class: 'muted' }, `${S.data.stations.length} stations · ${S.data.region}`,
          a ? ` · ${PRODUCT_LABELS[S.data.product]} ${fmt.peso(a.price)} (${a.basis})` : '')),
        S.data.brandBasis ? h('div', { class: 'faint', style: { fontSize: '.78rem', marginTop: '4px' } }, `Station prices use ${S.data.brandBasis}.`) : h('div', { class: 'faint', style: { fontSize: '.78rem', marginTop: '4px' } }, 'DOE publishes brand-level ranges for NCR cities only; elsewhere the area price is shown.'),
        S.data.stationSource === 'stored' ? h('div', { class: 'faint', style: { fontSize: '.78rem', marginTop: '4px' } }, 'Live OpenStreetMap data is slow right now — showing stations saved earlier.') : null));
      drawList();
    } catch (e) { clear(info).append(alertBox('danger', e.message)); }
  }

  await load();
  return () => map.remove();
}

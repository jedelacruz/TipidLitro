// Trip Planner: where → vehicle → (optional extras) → a plain-language peso answer,
// with details (breakdown, history, elevation, weather, comparison) one tab away.
import { PRODUCT_LABELS, alertBox, api, brandHex, clear, debounce, downloadGpx, dropdown, fmt, getLocation, h, icon, loading, makeChart, modal, on, openInMenu, setQuery, state, store, toast } from '../lib.js';
import { helpButton, startTour, tabBar, term, tip } from '../ui.js';

const CATEGORY_GROUPS = [
  ['Motorcycles & tricycles', ['motorcycle', 'tricycle']],
  ['Cars', ['car']],
  ['SUVs, MPVs & pickups', ['suv', 'mpv', 'pickup']],
  ['Vans & trucks', ['van', 'truck']],
  ['Jeepneys', ['jeepney']],
];
const TWO_WHEEL = ['motorcycle', 'tricycle'];
const CODING_CATS = ['car', 'suv', 'mpv', 'pickup', 'van'];
const MANILA = [14.5995, 120.9842];
const PIN_B = '#1e293b';

export const PLANNER_HELP = {
  intro: 'Find out how much fuel (or electricity) a trip will cost, using this week\'s official DOE pump price for your city.',
  steps: [
    'Type where you are starting from, or tap the location button. You can also click the map.',
    'Type where you are going. Add stops for errands or deliveries.',
    'Pick your vehicle. Typical fuel economy is filled in; tap "Adjust" if you know yours.',
    'Optional: open "More options" for passengers, departure time, tolls, parking, your plate number and more.',
    'Press Calculate. You get the peso cost first; the tabs below explain how it was worked out.',
  ],
  terms: ['kmpl', 'common', 'ron', 'coding'],
};

/** Place-search box with keyboard support. onPick({lat,lng,label}) */
export function autocomplete(input, onPick, getBias) {
  const wrap = input.parentElement;
  let list = null; let items = []; let active = -1; let ctrl = null;
  const close = () => { list?.remove(); list = null; active = -1; };
  const pick = (p) => { input.value = p.label; close(); onPick(p); };
  const draw = () => {
    close();
    if (!items.length) return;
    list = h('div', { class: 'ac-list', role: 'listbox' }, items.map((p, i) => h('div', {
      class: `ac-item ${i === active ? 'on' : ''}`, role: 'option', onMousedown: (e) => { e.preventDefault(); pick(p); },
    }, p.name || p.label, h('small', { class: 'muted' }, p.label))));
    wrap.append(list);
  };
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { items = []; close(); return; }
    ctrl?.abort(); ctrl = new AbortController();
    const b = getBias?.();
    try {
      items = await api(`/geocode/search?q=${encodeURIComponent(q)}${b ? `&lat=${b.lat}&lng=${b.lng}` : ''}`, { signal: ctrl.signal });
      active = items.length ? 0 : -1; draw();
    } catch (e) { if (e.name !== 'AbortError') items = []; }
  }, 280);
  input.addEventListener('input', search);
  input.addEventListener('keydown', (e) => {
    if (!list) return;
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

export function baseMap(el, center = MANILA, zoom = 11) {
  const L = window.L;
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}
const pinIcon = (text, color) => window.L.divIcon({ className: '', html: `<div class="map-pin" style="background:${color}"><span>${text}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] });
const shortLabel = (p) => (p?.label || 'Point').split(',')[0];

const TOUR = [
  { target: '#tl-origin', title: 'Where are you starting?', text: 'Type a place (e.g. "Cubao"), tap the location button to use where you are, or simply click the map.' },
  { target: '#tl-dest', title: 'Where are you going?', text: 'Type your destination. Need to pass by somewhere? Use "Add stop".' },
  { target: '#vehicle', title: 'Pick your vehicle', text: 'Motorcycles, cars, jeepneys and electric vehicles come with typical fuel economy. Know your own km/L? Tap "Adjust".' },
  { target: '#tl-more', title: 'Optional extras', text: 'Passengers, departure time, tolls, parking, your plate number for the coding check… Skip this if you are not sure.' },
  { target: '#tl-calc', title: 'Get your peso cost', text: 'Uses this week\'s official DOE price for your city, plus traffic, hills and weather along the route.' },
  { target: '.chat-fab', title: 'Prefer to just ask?', text: 'Type a question in English or Taglish, like "Magkano from Cubao to Tagaytay by Click?"' },
  { target: () => (getComputedStyle(document.querySelector('.mainnav')).display !== 'none' ? document.querySelector('.mainnav') : document.querySelector('.bottomnav')), title: 'There\'s more', text: 'Fuel prices back to 2017, next week\'s price forecast, the cheapest stations near you, and your own garage with price alerts.' },
];

export async function render(root, params) {
  const L = window.L;
  const S = {
    points: [null, null],
    vehicleKey: store.get('vehicleKey', 'preset:honda-click-125'),
    result: null, selected: 0, charts: [], routeLayers: [], markers: [], ring: null,
    costRange: store.get('costRange', '3y'), detailTab: store.get('detailTab', 'why'), showAllWarnings: false,
  };
  let myVehicles = [];
  if (state.user) { try { myVehicles = await api('/me/vehicles'); } catch { /* ignore */ } }
  let priceWeeks = [];
  api('/prices/weeks?region=NCR').then((w) => { priceWeeks = w.weeks; fillWeeks(); }).catch(() => {});

  // ---------------------------------------------------------- form controls
  const stopsBox = h('div', { class: 'stops' });
  const placesBox = h('div', { class: 'place-chips' });
  const recentBox = h('div');
  const vehicleSel = h('select', { id: 'vehicle', 'aria-label': 'Vehicle' });
  const vehSummary = h('div', { class: 'veh-summary' });
  const kmplIn = h('input', { type: 'number', min: '1', max: '150', step: '0.1', inputmode: 'decimal', id: 'kmpl', placeholder: 'e.g. 20' });
  const kmplLabel = h('label', { for: 'kmpl' }, 'Fuel economy (km/L)');
  const productSel = h('select', { id: 'product' }, ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS'].map((p) => h('option', { value: p }, PRODUCT_LABELS[p])));
  const productField = h('div', { class: 'field' }, h('label', { for: 'product' }, 'Fuel'), productSel);
  const elecIn = h('input', { type: 'number', min: '1', max: '60', step: '0.01', inputmode: 'decimal', placeholder: String(state.status?.electricityRate ?? 12.5) });
  const elecField = h('div', { class: 'field hidden' }, h('label', null, 'Electricity ₱/kWh'), elecIn);
  const customCat = h('select', null, [['motorcycle', 'Motorcycle'], ['tricycle', 'Tricycle'], ['car', 'Car'], ['suv', 'SUV'], ['mpv', 'MPV / AUV'], ['pickup', 'Pickup'], ['van', 'Van'], ['truck', 'Truck'], ['jeepney', 'Jeepney']].map(([v, t]) => h('option', { value: v }, t)));
  const customFuel = h('select', null, [['gasoline', 'Gasoline'], ['diesel', 'Diesel'], ['electric', 'Electric']].map(([v, t]) => h('option', { value: v }, t)));
  const customRow = h('div', { class: 'two hidden' }, h('div', { class: 'field' }, h('label', null, 'Vehicle type'), customCat), h('div', { class: 'field' }, h('label', null, 'Runs on'), customFuel));
  const vehDetails = h('div', { class: 'hidden' }, customRow, h('div', { class: 'two' }, h('div', { class: 'field' }, kmplLabel, kmplIn), productField, elecField));
  const opt = {
    roundTrip: h('input', { type: 'checkbox' }),
    passengers: h('input', { type: 'number', min: '1', max: '30', value: '1' }),
    cargo: h('input', { type: 'number', min: '0', max: '5000', placeholder: '0' }),
    ac: h('input', { type: 'checkbox', checked: true }),
    depart: h('input', { type: 'datetime-local' }),
    traffic: h('select', null, [['auto', 'Automatic (from time & place)'], ['light', 'Light'], ['moderate', 'Moderate'], ['heavy', 'Heavy']].map(([v, t]) => h('option', { value: v }, t))),
    price: h('input', { type: 'number', min: '30', max: '250', step: '0.01', placeholder: 'Use DOE price' }),
    week: h('select', null, h('option', { value: '' }, 'This week (latest)')),
    trips: h('input', { type: 'number', min: '0', max: '100', placeholder: '0' }),
    split: h('input', { type: 'number', min: '1', max: '30', value: '1' }),
    earn: h('input', { type: 'number', min: '0', step: '1', placeholder: '0' }),
    toll: h('input', { type: 'number', min: '0', step: '1', placeholder: '0' }),
    parking: h('input', { type: 'number', min: '0', step: '1', placeholder: '0' }),
    other: h('input', { type: 'number', min: '0', step: '1', placeholder: '0' }),
    plate: h('input', { type: 'text', inputmode: 'numeric', maxlength: '1', pattern: '[0-9]', placeholder: '0–9' }),
  };
  const plateField = h('div', { class: 'field' }, h('label', null, 'Plate ends in', tip('For the MMDA number coding check. Only the last digit is used.')), opt.plate);
  let style = 'normal';
  const styleSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Driving style' }, ['eco', 'normal', 'aggressive'].map((s) => h('button', {
    type: 'button', class: s === style ? 'on' : '', onClick: (e) => { style = s; [...styleSeg.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); updateBadge(); autoRecalc(); },
  }, s[0].toUpperCase() + s.slice(1))));
  const acRow = h('label', { class: 'inline-check' }, opt.ac, 'Aircon on');
  const moreBadge = h('span', { class: 'count-badge hidden' });

  const field = (label, el, tipText) => h('div', { class: 'field' }, h('label', null, label, tipText ? tip(tipText) : null), el);
  const more = h('details', { class: 'more', id: 'tl-more' }, h('summary', null, 'More options', h('span', { class: 'muted', style: { fontWeight: 500 } }, ' (optional)'), moreBadge),
    h('div', { class: 'opt-group' }, h('h4', null, 'Trip'),
      h('div', { class: 'row', style: { marginBottom: '10px', gap: '18px' } }, h('label', { class: 'inline-check' }, opt.roundTrip, 'Round trip (go and come back)'), acRow),
      h('div', { class: 'two' }, field('Leaving at', opt.depart, 'Leave empty for "now". Used for traffic, weather and number coding.'), field('Traffic', opt.traffic)),
      h('div', { class: 'field' }, h('label', null, 'Driving style'), styleSeg)),
    h('div', { class: 'opt-group' }, h('h4', null, 'People & load'),
      h('div', { class: 'three' }, field('People on board', opt.passengers), field('Cargo (kg)', opt.cargo), field('Split cost by', opt.split, 'Shows how much each person pays.'))),
    h('div', { class: 'opt-group' }, h('h4', null, 'Other costs'),
      h('div', { class: 'three' }, field('Toll ₱ (one way)', opt.toll), field('Parking ₱', opt.parking), field('Other ₱', opt.other))),
    h('div', { class: 'opt-group' }, h('h4', null, 'Price & rules'),
      h('div', { class: 'three' }, field('DOE price week', opt.week, 'Price the trip with a past week to see what it would have cost then.'), field('My price ₱/L', opt.price, 'Use what your station charges instead of the DOE price.'), plateField)),
    h('div', { class: 'opt-group' }, h('h4', null, 'Commuters & riders'),
      h('div', { class: 'two' }, field('Trips per week', opt.trips, 'Shows your monthly cost.'), field('Earnings per trip ₱', opt.earn, 'For riders and drivers: shows what you keep after fuel and costs.'))));

  const calcBtn = h('button', { class: 'btn primary block', id: 'tl-calc', type: 'button', onClick: () => calculate() }, icon('fuel'), 'Calculate cost');
  const results = h('div', { class: 'stack' });
  const rangeOut = h('div');
  const budgetIn = h('input', { type: 'number', min: '10', step: '10', placeholder: '₱ 300', inputmode: 'numeric' });
  const stepLabel = (n, text, sub) => h('div', { class: 'step-label' }, h('span', { class: 'step-num' }, String(n)), text, sub ? h('span', { class: 'muted' }, sub) : null);

  const form = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { style: { margin: 0, display: 'flex', alignItems: 'center', gap: '10px' } }, 'Plan a trip', helpButton('Trip Planner', { ...PLANNER_HELP, extra: h('button', { class: 'btn small', type: 'button', style: { marginTop: '12px' }, onClick: () => { document.querySelector('.modal-back')?.remove(); runTour(); } }, 'Take the 1-minute tour') })),
      h('span', { class: 'muted', style: { fontSize: '.8rem' } }, 'or click the map')),
    stepLabel(1, 'Where?'),
    stopsBox,
    h('div', { class: 'stop-actions' },
      h('button', { class: 'btn small', type: 'button', onClick: () => { if (S.points.length >= 10) return toast('Up to 8 stops'); S.points.splice(S.points.length - 1, 0, null); drawStops(); } }, icon('plus'), 'Add stop'),
      h('button', { class: 'btn small', type: 'button', onClick: () => { S.points.reverse(); drawStops(); drawMarkers(); autoRecalc(); } }, icon('swap'), 'Swap')),
    placesBox,
    stepLabel(2, 'Vehicle'),
    h('div', { class: 'field', style: { marginBottom: '8px' } }, vehicleSel),
    vehSummary, vehDetails,
    more,
    calcBtn,
    recentBox);

  const rangeCard = h('details', { class: 'card collapsible' },
    h('summary', null, h('div', { class: 'section-head' }, h('div', null, h('h3', null, icon('wallet'), 'How far can my budget go?'), h('p', { class: 'section-desc' }, 'Enter a peso amount to see how far your vehicle can go.')))),
    h('div', { class: 'collapsible-body' },
      h('div', { class: 'row' }, h('div', { style: { flex: 1 } }, budgetIn), h('button', { class: 'btn', type: 'button', onClick: () => budgetRange() }, 'Show reach')),
      rangeOut));

  const welcome = h('div', { class: 'card welcome' },
    h('h3', { style: { margin: '0 0 4px' } }, '👋 Welcome to TipidLitro'),
    h('p', { class: 'muted', style: { margin: 0 } }, 'See how much fuel your trip will cost, based on this week\'s official DOE pump prices.'),
    h('ol', null, h('li', null, 'Type where you are starting from (or tap 📍)'), h('li', null, 'Type where you are going'), h('li', null, 'Pick your vehicle and press ', h('b', null, 'Calculate cost'))),
    h('div', { class: 'row' },
      h('button', { class: 'btn small primary', type: 'button', onClick: () => { dismissWelcome(); runTour(); } }, 'Show me around'),
      h('button', { class: 'btn small', type: 'button', onClick: dismissWelcome }, 'Got it')));
  function dismissWelcome() { store.set('welcomed', true); welcome.remove(); }

  const mapEl = h('div', { id: 'map' });
  const mapWrap = h('section', { class: 'map-wrap' }, mapEl, h('div', { class: 'map-hint' }, 'Tip: drag the A/B pins to fine-tune'));
  const panel = h('section', { class: 'panel' }, form, results, rangeCard);
  if (!store.get('welcomed') && !(params.o && params.d)) panel.prepend(welcome);
  root.append(h('div', { class: 'planner' }, panel, mapWrap));
  function runTour() { store.set('welcomed', true); welcome.remove(); startTour(TOUR, 'tourDone'); }

  // ---------------------------------------------------------- map
  const map = baseMap(mapEl);
  const firstEmpty = () => { const i = S.points.findIndex((p) => !p); return i >= 0 ? i : S.points.length - 1; };
  map.on('click', async (e) => { await setPoint(firstEmpty(), { lat: e.latlng.lat, lng: e.latlng.lng, label: null }, true); });

  function drawMarkers() {
    S.markers.forEach((m) => m.remove()); S.markers = [];
    S.points.forEach((p, i) => {
      if (!p) return;
      const last = i === S.points.length - 1;
      const m = L.marker([p.lat, p.lng], { draggable: true, icon: pinIcon(i === 0 ? 'A' : last ? 'B' : String(i), i === 0 ? brandHex() : last ? PIN_B : '#64748b'), title: p.label || '' }).addTo(map);
      m.on('dragend', () => { const ll = m.getLatLng(); setPoint(i, { lat: ll.lat, lng: ll.lng, label: null }, true); });
      S.markers.push(m);
    });
    const pts = S.points.filter(Boolean);
    if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], Math.max(map.getZoom(), 13));
    else if (pts.length > 1 && !S.result) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [40, 40] });
  }

  async function setPoint(i, p, reverse = false) {
    S.points[i] = p;
    drawStops(); drawMarkers();
    if (reverse && !p.label) {
      try { const r = await api(`/geocode/reverse?lat=${p.lat}&lng=${p.lng}`); p.label = r.label; } catch { p.label = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`; }
      drawStops();
    }
    autoRecalc();
  }

  function drawStops() {
    clear(stopsBox);
    S.points.forEach((p, i) => {
      const last = i === S.points.length - 1;
      const input = h('input', { type: 'text', value: p?.label || '', placeholder: i === 0 ? 'Starting point (e.g. Cubao)' : last ? 'Destination (e.g. Tagaytay)' : 'Stop', 'aria-label': i === 0 ? 'Origin' : last ? 'Destination' : `Stop ${i}`, autocomplete: 'off' });
      const acBox = h('div', { class: 'ac' }, input);
      autocomplete(input, (pl) => { setPoint(i, { lat: pl.lat, lng: pl.lng, label: pl.label }); }, () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; });
      const extra = [];
      if (i === 0) {
        extra.push(h('button', { class: 'icon-btn', type: 'button', title: 'Use my location', 'aria-label': 'Use my location', onClick: async () => {
          try { const loc = await getLocation(); await setPoint(0, { ...loc, label: null }, true); } catch (e) { toast(e.message, 'error'); }
        } }, icon('locate')));
      } else if (!last) {
        extra.push(h('button', { class: 'icon-btn', type: 'button', title: 'Remove stop', onClick: () => { S.points.splice(i, 1); drawStops(); drawMarkers(); autoRecalc(); } }, icon('x')));
      }
      if (p) extra.push(h('button', { class: 'icon-btn', type: 'button', title: 'Save this place', 'aria-label': 'Save this place', onClick: () => savePlace(p) }, icon('star')));
      stopsBox.append(h('div', { class: 'stop', id: i === 0 ? 'tl-origin' : last ? 'tl-dest' : undefined }, h('span', { class: `dot ${i === 0 ? 'a' : last ? 'b' : 's'}` }, i === 0 ? 'A' : last ? 'B' : String(i)), acBox, extra));
    });
  }

  // ---------------------------------------------------------- saved places & recent trips (this browser)
  function drawPlaces() {
    clear(placesBox);
    const places = store.get('places', []);
    for (const pl of places) {
      placesBox.append(h('span', { class: 'chip', style: { cursor: 'pointer' }, title: pl.label, onClick: () => setPoint(firstEmpty(), { lat: pl.lat, lng: pl.lng, label: pl.label }) },
        '★ ', pl.name,
        h('button', { type: 'button', 'aria-label': `Remove ${pl.name}`, style: { border: 0, background: 'none', cursor: 'pointer', color: 'var(--faint)', padding: '0 0 0 4px' }, onClick: (e) => { e.stopPropagation(); store.set('places', places.filter((x) => x !== pl)); drawPlaces(); } }, '×')));
    }
  }
  async function savePlace(p) {
    const nameIn = h('input', { type: 'text', maxlength: '24', placeholder: 'Home, Work, School…' });
    const quick = h('div', { class: 'chips', style: { marginTop: '8px' } }, ['Home', 'Work', 'School', 'Gym'].map((n) => h('button', { class: 'chip', type: 'button', onClick: () => { nameIn.value = n; } }, n)));
    const name = await modal('Save this place', h('div', null, h('p', { class: 'muted', style: { fontSize: '.86rem' } }, p.label), nameIn, quick, h('p', { class: 'faint', style: { fontSize: '.8rem', marginTop: '8px' } }, 'Saved on this device. Tap the ★ chip later to fill it in.')), [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, onClick: () => nameIn.value.trim() || false }]);
    if (!name) return;
    const places = store.get('places', []).filter((x) => x.name.toLowerCase() !== name.toLowerCase());
    places.push({ name, lat: p.lat, lng: p.lng, label: p.label });
    store.set('places', places.slice(-8));
    drawPlaces(); toast(`Saved "${name}"`);
  }
  function drawRecent() {
    clear(recentBox);
    const recent = store.get('recentTrips', []);
    if (!recent.length) return;
    recentBox.append(h('div', { class: 'section-title', style: { marginTop: '14px' } }, 'Recent trips'),
      h('div', { class: 'chips' }, recent.map((t) => h('a', { class: 'chip', href: `#/plan?${new URLSearchParams(Object.entries(t.params).filter(([, v]) => v != null && v !== ''))}` }, t.title))));
  }
  function rememberTrip() {
    const R = S.result;
    const title = `${shortLabel(R.points[0])} → ${shortLabel(R.points[R.points.length - 1])}`;
    const recent = store.get('recentTrips', []).filter((t) => t.title !== title);
    recent.unshift({ title, params: shareParams() });
    store.set('recentTrips', recent.slice(0, 6));
    drawRecent();
  }

  // ---------------------------------------------------------- vehicle
  function fillVehicles() {
    clear(vehicleSel);
    if (myVehicles.length) vehicleSel.append(h('optgroup', { label: 'My garage' }, myVehicles.map((v) => h('option', { value: `uv:${v.id}` }, `${v.name} · ${v.kmpl} km/${v.fuel_type === 'electric' ? 'kWh' : 'L'}`))));
    for (const [label, cats] of CATEGORY_GROUPS) {
      const list = state.presets.filter((p) => cats.includes(p.category));
      if (list.length) vehicleSel.append(h('optgroup', { label }, list.map((p) => h('option', { value: `preset:${p.slug}` }, p.name))));
    }
    vehicleSel.append(h('option', { value: 'custom' }, 'Other — I know my km/L'));
    if (![...vehicleSel.options].some((o) => o.value === S.vehicleKey)) S.vehicleKey = myVehicles[0] ? `uv:${myVehicles[0].id}` : 'preset:honda-click-125';
    vehicleSel.value = S.vehicleKey;
    onVehicle(false);
  }
  function currentVehicle() {
    const [kind, id] = S.vehicleKey.split(':');
    if (kind === 'uv') { const v = myVehicles.find((x) => String(x.id) === id); return v ? { category: v.category, fuel: v.fuel_type, product: v.product, kmpl: v.kmpl, plate: v.plate_digit } : null; }
    if (kind === 'preset') { const p = state.presets.find((x) => x.slug === id); return p ? { category: p.category, fuel: p.fuel_type, product: p.product, kmpl: (p.kmpl_city + p.kmpl_highway) / 2 } : null; }
    return { category: customCat.value, fuel: customFuel.value, product: customFuel.value === 'diesel' ? 'DIESEL' : 'RON91', kmpl: Number(kmplIn.value) || null };
  }
  function onVehicle(recalc = true) {
    S.vehicleKey = vehicleSel.value;
    store.set('vehicleKey', S.vehicleKey);
    const custom = S.vehicleKey === 'custom';
    customRow.classList.toggle('hidden', !custom);
    const v = currentVehicle();
    if (v && !custom) {
      kmplIn.value = Math.round(v.kmpl * 10) / 10;
      if (v.product !== 'ELECTRICITY') productSel.value = v.product;
      if (v.plate != null && !opt.plate.value) opt.plate.value = v.plate;
    }
    if (custom) { vehDetails.classList.remove('hidden'); if (recalc) { kmplIn.value = ''; kmplIn.focus(); } }
    syncVehicleUi();
    if (recalc) autoRecalc();
  }
  function syncVehicleUi() {
    const v = currentVehicle();
    const ev = v?.fuel === 'electric';
    kmplLabel.textContent = ev ? 'Efficiency (km/kWh)' : 'Fuel economy (km/L)';
    productField.classList.toggle('hidden', ev);
    elecField.classList.toggle('hidden', !ev);
    acRow.classList.toggle('hidden', TWO_WHEEL.includes(v?.category));
    plateField.classList.toggle('hidden', !CODING_CATS.includes(v?.category));
    const unit = ev ? 'kWh' : 'L';
    const what = ev ? `electricity ${elecIn.value ? `at ₱${elecIn.value}/kWh` : '(typical home rate)'}` : PRODUCT_LABELS[productSel.value];
    const open = !vehDetails.classList.contains('hidden');
    clear(vehSummary).append(
      h('span', null, kmplIn.value ? `≈ ${kmplIn.value} km/${unit}` : 'Enter your km/L', ' · ', what, ' ', tip(ev ? 'How far it goes on 1 kWh of electricity.' : 'How far it goes on 1 liter, from typical owner reports. Tap Adjust if you know yours.')),
      S.vehicleKey === 'custom' ? null : h('button', { class: 'link-btn', type: 'button', onClick: () => { vehDetails.classList.toggle('hidden'); syncVehicleUi(); } }, open ? 'Done' : 'Adjust'));
  }
  vehicleSel.addEventListener('change', () => onVehicle());
  customCat.addEventListener('change', () => { if (['van', 'truck', 'jeepney', 'pickup'].includes(customCat.value) && customFuel.value === 'gasoline') { customFuel.value = 'diesel'; productSel.value = 'DIESEL'; } syncVehicleUi(); autoRecalc(); });
  customFuel.addEventListener('change', () => { productSel.value = customFuel.value === 'diesel' ? 'DIESEL' : 'RON91'; syncVehicleUi(); autoRecalc(); });
  [kmplIn, productSel, elecIn].forEach((el) => el.addEventListener('input', syncVehicleUi));
  const offAuth = on('auth', async () => { myVehicles = state.user ? await api('/me/vehicles').catch(() => []) : []; fillVehicles(); });

  function fillWeeks() {
    const cur = opt.week.value || params.pw || '';
    clear(opt.week).append(h('option', { value: '' }, 'This week (latest)'), ...priceWeeks.slice(1).map((w) => h('option', { value: w.weekStart }, fmt.week(w.weekStart, w.weekEnd))));
    opt.week.value = cur;
  }

  function changedCount() {
    let n = 0;
    if (opt.roundTrip.checked) n++; if (opt.passengers.value !== '1') n++; if (+opt.cargo.value) n++; if (opt.split.value !== '1') n++;
    if (!opt.ac.checked && !acRow.classList.contains('hidden')) n++; if (style !== 'normal') n++; if (opt.depart.value) n++; if (opt.traffic.value !== 'auto') n++;
    for (const k of ['toll', 'parking', 'other', 'trips', 'earn']) if (+opt[k].value) n++;
    if (opt.week.value) n++; if (opt.price.value) n++; if (opt.plate.value && !plateField.classList.contains('hidden')) n++;
    return n;
  }
  function updateBadge() { const n = changedCount(); moreBadge.textContent = `${n} set`; moreBadge.classList.toggle('hidden', !n); }

  function vehiclePayload() {
    const [kind, id] = S.vehicleKey.split(':');
    const kmpl = Number(kmplIn.value) || undefined;
    if (kind === 'uv') return { userVehicleId: Number(id) };
    if (kind === 'preset') {
      const p = state.presets.find((x) => x.slug === id);
      const avg = p ? Math.round(((p.kmpl_city + p.kmpl_highway) / 2) * 10) / 10 : null;
      return { presetSlug: id, kmpl: kmpl && kmpl !== avg ? kmpl : undefined };
    }
    return { kmpl, category: customCat.value, fuelType: customFuel.value };
  }

  // ---------------------------------------------------------- calculate
  function shareParams() {
    const enc = (p) => (p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${p.label || ''}` : null);
    const stops = S.points.slice(1, -1).filter(Boolean).map(enc).join('|');
    const [kind, id] = S.vehicleKey.split(':');
    return {
      o: enc(S.points[0]), d: enc(S.points[S.points.length - 1]), s: stops || null,
      v: kind === 'preset' ? id : null, k: kmplIn.value || null, p: productSel.value,
      rt: opt.roundTrip.checked ? 1 : null, pax: opt.passengers.value !== '1' ? opt.passengers.value : null, st: style !== 'normal' ? style : null,
      tr: opt.traffic.value !== 'auto' ? opt.traffic.value : null, pr: opt.price.value || null, tw: opt.trips.value || null, sp: opt.split.value !== '1' ? opt.split.value : null, er: opt.earn.value || null,
      pw: opt.week.value || null, tl: opt.toll.value || null, pk: opt.parking.value || null, oc: opt.other.value || null, pd: opt.plate.value || null, el: elecIn.value || null,
    };
  }

  let busy = false;
  async function calculate(compare) {
    const pts = S.points.filter(Boolean);
    if (!S.points[0] || !S.points[S.points.length - 1]) { toast('Set a starting point and a destination first.', 'error'); document.querySelector(!S.points[0] ? '#tl-origin input' : '#tl-dest input')?.focus(); return; }
    if (S.vehicleKey === 'custom' && !(Number(kmplIn.value) > 0)) { toast('Enter your km/L.', 'error'); kmplIn.focus(); return; }
    busy = true; calcBtn.disabled = true;
    if (!S.result) clear(results).append(h('div', { class: 'card' }, loading('Finding routes and checking prices, hills and weather…')));
    else results.style.opacity = '0.55';
    try {
      const body = {
        points: pts, vehicle: vehiclePayload(), product: productSel.value,
        roundTrip: opt.roundTrip.checked, passengers: Number(opt.passengers.value) || 1, cargoKg: Number(opt.cargo.value) || 0,
        ac: opt.ac.checked, style, departAt: opt.depart.value ? new Date(opt.depart.value).toISOString() : undefined, traffic: opt.traffic.value,
        priceOverride: Number(opt.price.value) || undefined, electricityRate: Number(elecIn.value) || undefined, priceWeek: opt.week.value || undefined,
        tripsPerWeek: Number(opt.trips.value) || 0, splitWays: Number(opt.split.value) || 1, earningsPerTrip: Number(opt.earn.value) || 0,
        tollFee: Number(opt.toll.value) || 0, parkingFee: Number(opt.parking.value) || 0, otherCost: Number(opt.other.value) || 0,
        plateDigit: /^\d$/.test(opt.plate.value) ? Number(opt.plate.value) : undefined, compare,
      };
      const prevSelected = S.result ? S.selected : null;
      S.result = await api('/trip/estimate', { method: 'POST', body });
      S.selected = prevSelected != null && prevSelected < S.result.routes.length ? prevSelected : S.result.recommendedIndex;
      if (compare) S.detailTab = 'compare';
      setQuery(shareParams());
      drawResults();
      drawRoutes(prevSelected == null);
      rememberTrip();
      welcome.remove();
    } catch (e) {
      clear(results).append(h('div', { class: 'card' }, alertBox('danger', e.message)));
      S.result = null;
    } finally { busy = false; calcBtn.disabled = false; results.style.opacity = ''; }
  }
  // Changing anything after a result recalculates automatically (routes, elevation and weather are cached).
  const autoRecalc = debounce(() => { if (S.result && !busy && S.points[0] && S.points[S.points.length - 1]) calculate(); }, 700);
  [productSel, kmplIn, elecIn, ...Object.values(opt)].forEach((el) => { el.addEventListener('change', () => { updateBadge(); autoRecalc(); }); el.addEventListener('input', updateBadge); });

  function drawRoutes(fit) {
    S.routeLayers.forEach((l) => l.remove()); S.routeLayers = [];
    if (!S.result) return;
    const order = S.result.routes.map((_, i) => i).sort((a, b) => (a === S.selected) - (b === S.selected));
    for (const i of order) {
      const r = S.result.routes[i];
      const sel = i === S.selected;
      const line = L.polyline(r.geometry.map(([lng, lat]) => [lat, lng]), { color: sel ? brandHex() : '#8b8580', weight: sel ? 6 : 4, opacity: sel ? 0.95 : 0.6, dashArray: sel ? null : '6 8' }).addTo(map);
      line.bindTooltip(`${fmt.peso(r.totalCost)} · ${r.oneWayKm} km · ${fmt.dur(r.durationMin)}`, { sticky: true });
      line.on('click', (e) => { L.DomEvent.stopPropagation(e); S.selected = i; drawResults(); drawRoutes(false); });
      S.routeLayers.push(line);
    }
    if (fit) map.fitBounds(S.routeLayers[S.routeLayers.length - 1].getBounds(), { padding: [40, 40] });
  }

  function summaryText() {
    const R = S.result; const r = R.routes[S.selected]; const u = R.unit;
    const lines = [
      `TipidLitro trip: ${shortLabel(R.points[0])} → ${shortLabel(R.points[R.points.length - 1])}${R.roundTrip ? ' (round trip)' : ''}`,
      `${r.distanceKm} km · ${fmt.dur(r.durationMin)} · ${R.vehicle.name}`,
      `${u === 'kWh' ? 'Electricity' : 'Fuel'}: ${fmt.num(r.liters, 2)} ${u} × ${fmt.peso(R.price.price)} = ${fmt.peso(r.cost)}${R.price.weekStart ? ` (DOE ${R.price.basis}, week of ${fmt.week(R.price.weekStart, R.price.weekEnd)})` : ''}`,
    ];
    if (R.extras.total) lines.push(`Toll ${fmt.peso(R.extras.toll)} · Parking ${fmt.peso(R.extras.parking)}${R.extras.other ? ` · Other ${fmt.peso(R.extras.other)}` : ''}`);
    lines.push(`Total ${fmt.peso(r.totalCost)}${R.splitWays > 1 ? ` · ${fmt.peso(r.perPerson)} each (${R.splitWays} people)` : ''}`);
    lines.push(location.href);
    return lines.join('\n');
  }

  // ---------------------------------------------------------- results
  function drawResults() {
    S.charts.forEach((c) => c.destroy()); S.charts = [];
    const R = S.result; const r = R.routes[S.selected]; const u = R.unit; const p = R.price;
    clear(results);

    // Warnings: the most important two, the rest behind "show more".
    if (R.warnings.length) {
      const order = { danger: 0, warn: 1, info: 2 };
      const ws = [...R.warnings].sort((a, b) => order[a.level] - order[b.level]);
      const shown = S.showAllWarnings ? ws : ws.slice(0, 2);
      results.append(h('div', { class: 'stack', style: { gap: '8px' } }, shown.map((w) => alertBox(w.level, w.text)),
        ws.length > 2 ? h('button', { class: 'link-btn', type: 'button', style: { alignSelf: 'flex-start', fontSize: '.85rem' }, onClick: () => { S.showAllWarnings = !S.showAllWarnings; drawResults(); } }, S.showAllWarnings ? 'Show fewer notes' : `Show ${ws.length - 2} more note${ws.length - 2 > 1 ? 's' : ''}`) : null));
    }

    if (R.routes.length > 1) {
      results.append(h('div', null, h('div', { class: 'section-title' }, `${R.routes.length} routes found — tap to compare`),
        h('div', { class: 'route-opts' }, R.routes.map((x, i) => h('button', {
          type: 'button', class: `route-opt ${i === S.selected ? 'on' : ''}`, onClick: () => { S.selected = i; drawResults(); drawRoutes(false); },
        }, h('div', { class: 'chips' }, x.tags.map((t) => h('span', { class: `badge ${t === 'recommended' ? 'brand' : t === 'fastest' ? 'blue' : 'green'}` }, t)), x.motorwayIssue ? h('span', { class: 'badge red' }, 'expressway') : null),
          h('div', { class: 'cost' }, fmt.peso(x.totalCost)), h('div', { class: 'meta' }, `${x.distanceKm} km · ${fmt.dur(x.durationMin)}`))))));
    }

    // Plain-language answer
    const from = shortLabel(R.points[0]); const to = shortLabel(R.points[R.points.length - 1]);
    const amount = `${fmt.num(r.liters, r.liters < 10 ? 2 : 1)} ${u === 'kWh' ? 'kWh of electricity' : `L of ${PRODUCT_LABELS[R.product]}`}`;
    const sentence = [`Your ${R.vehicle.name} from ${from} to ${to}${R.roundTrip ? ' and back' : ''} (${r.distanceKm} km, about ${fmt.dur(r.durationMin)}) will use about ${amount} — roughly `, h('b', null, fmt.peso(r.cost)), '.'];
    if (R.extras.total) sentence.push(` With ${[R.extras.toll && 'toll', R.extras.parking && 'parking', R.extras.other && 'other costs'].filter(Boolean).join(' and ')}, the total is `, h('b', null, fmt.peso(r.totalCost)), '.');
    if (R.splitWays > 1) sentence.push(` That's `, h('b', null, fmt.peso(r.perPerson)), ` each for ${R.splitWays} people.`);
    const priceNote = p.electricity || p.custom
      ? [`${fmt.peso(p.price)}/${u} · ${p.basis}`]
      : [`${fmt.peso(p.price)}/${u} · `, p.area && p.area !== 'ALL' ? `${p.area} ` : `${p.region} `, term('common', 'common price'), ` · DOE week of ${fmt.week(p.weekStart, p.weekEnd)}${p.historical ? ' (past week)' : ''}${p.estimate ? ' (estimate)' : ''}`];
    const stat = (k, v, s) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), s ? h('div', { class: 's' }, s) : null);
    const tripName = `${from} to ${to}`;
    const moreActions = dropdown(h('button', { class: 'btn small', type: 'button' }, 'More ▾'), (menu, close) => {
      menu.append(
        h('button', { type: 'button', onClick: async () => { close(); try { await navigator.clipboard.writeText(summaryText()); toast('Summary copied — paste it in your group chat'); } catch { toast('Could not copy', 'error'); } } }, icon('copy'), 'Copy summary for group chat'),
        h('button', { type: 'button', onClick: () => { close(); compareDialog(); } }, icon('car'), 'Compare other vehicles'),
        h('button', { type: 'button', onClick: () => { close(); downloadGpx(tripName, R.points, r.geometry); } }, icon('download'), 'Download GPX'),
        h('button', { type: 'button', onClick: () => { close(); window.print(); } }, icon('print'), 'Print'));
    }, { align: 'right' });

    results.append(h('div', { class: 'card' },
      h('div', { class: 'section-title' }, `${R.points[0].label || 'Start'} → ${R.points[R.points.length - 1].label || 'Destination'}`),
      h('div', { class: 'hero-cost' }, h('span', { class: 'big' }, fmt.peso(r.totalCost)), h('span', { class: 'muted' }, R.extras.total ? 'total trip cost' : `${u === 'kWh' ? 'electricity' : 'fuel'} cost${R.roundTrip ? ', round trip' : ''}`)),
      h('p', { class: 'plain' }, sentence),
      h('p', { class: 'muted', style: { fontSize: '.82rem', margin: '4px 0 0' } }, 'Price: ', priceNote),
      h('div', { class: 'mini-stats' },
        stat(u === 'kWh' ? 'Energy' : 'Fuel', `${fmt.num(r.liters, 2)} ${u}`),
        stat('Distance', `${r.distanceKm} km`),
        stat('Time', fmt.dur(r.durationMin), `${R.conditions.traffic} traffic`),
        R.splitWays > 1 ? stat('Each person', fmt.peso(r.perPerson)) : r.monthly ? stat('Per month', fmt.peso(r.monthly, 0), `${R.tripsPerWeek} trips/week`) : stat('CO₂', `${fmt.num(r.co2Kg)} kg`)),
      R.extras.total ? h('div', { style: { margin: '0 0 12px' } },
        h('div', { class: 'cost-total' }, h('span', null, u === 'kWh' ? 'Electricity' : 'Fuel'), h('span', { class: 'num' }, fmt.peso(r.cost))),
        R.extras.toll ? h('div', { class: 'cost-total' }, h('span', null, `Toll${R.roundTrip ? ' (both ways)' : ''}`), h('span', { class: 'num' }, fmt.peso(R.extras.toll))) : null,
        R.extras.parking ? h('div', { class: 'cost-total' }, h('span', null, 'Parking'), h('span', { class: 'num' }, fmt.peso(R.extras.parking))) : null,
        R.extras.other ? h('div', { class: 'cost-total' }, h('span', null, 'Other'), h('span', { class: 'num' }, fmt.peso(R.extras.other))) : null,
        h('div', { class: 'cost-total sum' }, h('span', null, 'Total'), h('span', { class: 'num' }, fmt.peso(r.totalCost)))) : null,
      r.net != null ? alertBox(r.net >= 0 ? 'ok' : 'warn', `You keep ${fmt.peso(r.net)} of the ₱${R.earningsPerTrip} earnings (fuel and costs take ${r.fuelShare}%).`) : null,
      h('div', { class: 'row no-print', style: { gap: '6px', marginTop: '12px' } },
        openInMenu(R.points, { twoWheeler: R.vehicle.twoWheel && !R.vehicle.electric, gpx: () => downloadGpx(tripName, R.points, r.geometry) }),
        h('button', { class: 'btn small', type: 'button', onClick: share }, icon('share'), 'Share'),
        h('button', { class: 'btn small', type: 'button', onClick: save }, icon('save'), 'Save'),
        moreActions)));

    // Details, one tab at a time
    const tabs = [['why', 'Why this cost'], ...(R.costHistory?.length > 2 ? [['history', 'Over the years']] : []), ['elev', 'Hills'], ['weather', 'Weather'], ['compare', 'Compare vehicles']];
    if (!tabs.some(([k]) => k === S.detailTab)) S.detailTab = 'why';
    const detailBody = h('div');
    results.append(h('div', { class: 'card' }, tabBar(tabs, S.detailTab, (k) => { S.detailTab = k; store.set('detailTab', k); drawDetail(detailBody, R, r); }, { variant: 'inner' }), detailBody));
    drawDetail(detailBody, R, r);
  }

  function drawDetail(box, R, r) {
    S.charts.forEach((c) => c.destroy()); S.charts = [];
    clear(box);
    const u = R.unit;
    if (S.detailTab === 'why') {
      const rows = [
        h('tr', null, h('td', null, 'Typical economy', h('small', { class: 'muted' }, `${R.vehicle.name}: ${R.vehicle.kmplCity} km/${u} in the city, ${R.vehicle.kmplHighway} on the highway — blended for your ${r.avgSpeed} km/h average`)), h('td', null, `${fmt.num(r.baseKmpl)} km/${u}`)),
        ...r.factors.map((f) => h('tr', null, h('td', null, f.label, h('small', { class: 'muted' }, f.detail)), h('td', null, f.factor != null ? `${f.factor < 1 ? '−' : '+'}${Math.abs(Math.round((1 - f.factor) * 1000) / 10)}% km/${u}` : `${f.liters > 0 ? '+' : '−'}${fmt.num(Math.abs(f.liters), 2)} ${u}`))),
        h('tr', null, h('td', null, h('b', null, 'Result'), h('small', { class: 'muted' }, `Simple math (distance ÷ ${fmt.num(R.vehicle.kmplStated)} km/${u}) would say ${fmt.num(r.simple.liters, 2)} ${u} = ${fmt.peso(r.simple.cost)}.`)), h('td', null, h('b', null, `${fmt.num(r.liters, 2)} ${u} · ${fmt.num(r.effectiveKmpl)} km/${u}`))),
      ];
      box.append(h('p', { class: 'muted', style: { fontSize: '.86rem', marginTop: 0 } }, 'Real driving uses more (or less) fuel than the brochure number. Here is every adjustment we made:'),
        h('table', { class: 'breakdown' }, h('tbody', null, rows)),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Cost per km'), h('div', { class: 'v' }, fmt.peso(r.costPerKm))),
          h('div', { class: 'stat' }, h('div', { class: 'k' }, 'CO₂'), h('div', { class: 'v' }, `${fmt.num(r.co2Kg)} kg`), h('div', { class: 's' }, `≈ ${fmt.num(r.co2Kg / 21, 1)} tree-years`)),
          h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Without traffic'), h('div', { class: 'v' }, fmt.dur(r.freeFlowMin))),
          r.roads.length ? h('div', { class: 'stat', style: { gridColumn: 'span 3' } }, h('div', { class: 'k' }, 'Main roads'), h('div', { class: 'v', style: { fontSize: '.92rem' } }, r.roads.join(', '))) : null));
    } else if (S.detailTab === 'history') {
      box.append(costHistory(R, r));
    } else if (S.detailTab === 'elev') {
      const canvas = h('canvas', { 'aria-label': 'Elevation profile' });
      box.append(h('p', { class: 'muted', style: { fontSize: '.86rem', marginTop: 0 } }, `Climbing ${r.climb.climbM} m and descending ${r.climb.descentM} m along the way. Uphill costs extra fuel; some comes back going down.`), h('div', { class: 'chart-box' }, canvas));
      if (r.elevationProfile.length) {
        const c = brandHex();
        S.charts.push(makeChart(canvas, {
          type: 'line',
          data: { labels: r.elevationProfile.map((e) => e[0].toFixed(1)), datasets: [{ label: 'Elevation (m)', data: r.elevationProfile.map((e) => e[1]), fill: true, borderColor: c, backgroundColor: `${c}26`, pointRadius: 0, tension: 0.3 }] },
          options: { plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'km' }, ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: 'm' } } } },
        }));
      }
    } else if (S.detailTab === 'weather') {
      const wx = R.conditions.weather;
      box.append(h('p', { class: 'muted', style: { fontSize: '.86rem', marginTop: 0 } }, `Forecast for your departure at ${R.conditions.departLocal}. Rain and strong headwinds increase fuel use slightly.`),
        wx ? h('div', { class: 'wx' }, ['Start', 'Midway', 'End'].map((label, i) => h('div', { class: 'stat' },
          h('div', { class: 'k' }, label), h('div', { class: 'v' }, `${wx[i].text}`),
          h('div', { class: 's' }, `${Math.round(wx[i].tempC)}°C · ${wx[i].precipProb ?? 0}% chance of rain · wind ${Math.round(wx[i].windKmh)} km/h`)))) : h('p', { class: 'muted' }, 'Weather unavailable.'));
    } else if (S.detailTab === 'compare') {
      if (!R.comparison?.length) {
        box.append(h('p', { class: 'muted', style: { marginTop: 0 } }, 'See what this same trip costs with other vehicles — motorcycle vs car vs EV vs jeepney.'), h('button', { class: 'btn primary', type: 'button', onClick: compareDialog }, icon('car'), 'Choose vehicles to compare'));
      } else {
        box.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Vehicle'), h('th', null, 'Energy'), h('th', null, 'Cost'), h('th', null, 'CO₂'))),
          h('tbody', null, R.comparison.map((c, i) => h('tr', null, h('td', null, i === 0 ? '🏆 ' : '', c.name), h('td', null, `${fmt.num(c.liters, 2)} ${c.unit}`), h('td', null, fmt.peso(c.cost)), h('td', null, `${fmt.num(c.co2Kg)} kg`)))))),
          h('div', { class: 'row between', style: { marginTop: '8px' } }, h('p', { class: 'faint', style: { fontSize: '.78rem', margin: 0 } }, 'Fuel/electricity only, same route and conditions.'), h('button', { class: 'btn small', type: 'button', onClick: compareDialog }, 'Change vehicles')));
      }
    }
  }

  /** The same trip priced at every DOE week on file. */
  function costHistory(R, r) {
    const all = R.costHistory;
    const canvas = h('canvas', { 'aria-label': 'Trip cost over time' });
    const body = h('div');
    const RANGES = [['1y', '1 year', 365], ['3y', '3 years', 365 * 3], ['all', 'All', 1e6]];
    const chips = h('div', { class: 'range-chips' });
    const draw = () => {
      S.charts.forEach((c) => c.destroy()); S.charts = [];
      const days = RANGES.find((x) => x[0] === S.costRange)?.[2] || 1e6;
      const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const rows = all.filter((x) => x.week >= cutoff);
      const now = all[all.length - 1];
      const yearAgo = [...all].reverse().find((x) => x.week <= new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10));
      const lo = rows.reduce((a, b) => (b.cost < a.cost ? b : a), rows[0]);
      const hi = rows.reduce((a, b) => (b.cost > a.cost ? b : a), rows[0]);
      clear(body).append(h('p', { class: 'muted', style: { fontSize: '.86rem', margin: '0 0 8px' } },
        yearAgo ? ['A year ago this trip cost ', h('b', null, fmt.peso(yearAgo.cost)), ` (week of ${fmt.date(yearAgo.week)}); now ${fmt.peso(now.cost)} (${fmt.signedPeso(now.cost - yearAgo.cost)}). `] : null,
        rows.length ? `Cheapest week: ${fmt.peso(lo.cost)} (${fmt.date(lo.week)}). Priciest: ${fmt.peso(hi.cost)} (${fmt.date(hi.week)}).` : null));
      const c = brandHex();
      S.charts.push(makeChart(canvas, {
        type: 'line',
        data: { labels: rows.map((x) => fmt.date(x.week, { month: 'short', year: '2-digit' })), datasets: [{ label: 'Trip fuel cost', data: rows.map((x) => x.cost), borderColor: c, backgroundColor: `${c}22`, fill: true, pointRadius: rows.length > 60 ? 0 : 2, tension: 0.2 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { title: (it) => `Week of ${fmt.date(rows[it[0].dataIndex].week)}`, label: (it) => `${fmt.peso(it.raw)} (₱${rows[it.dataIndex].price.toFixed(2)}/L)` } } }, scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: '₱' } } } },
      }));
      [...chips.children].forEach((b) => b.classList.toggle('on', b.dataset.r === S.costRange));
    };
    chips.append(...RANGES.map(([k, label]) => h('button', { class: 'chip', type: 'button', dataset: { r: k }, onClick: () => { S.costRange = k; store.set('costRange', k); draw(); } }, label)));
    setTimeout(draw);
    return h('div', null, h('div', { class: 'row between', style: { marginBottom: '6px' } }, h('span', { class: 'muted', style: { fontSize: '.86rem' } }, 'What this exact trip would have cost each week:'), chips),
      body, h('div', { class: 'chart-box tall' }, canvas),
      h('p', { class: 'faint', style: { fontSize: '.78rem', margin: '6px 0 0' } }, `${fmt.num(r.liters, 2)} L × each week's DOE ${R.costHistoryBasis || `${R.price.region} common price`} · ${all.length} weeks since ${fmt.date(all[0].week)}. Toll and parking not included.`));
  }

  async function share() {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: 'TipidLitro trip', text: `Fuel estimate: ${fmt.peso(S.result.routes[S.selected].totalCost)}`, url });
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    } catch { /* cancelled */ }
  }

  async function save() {
    if (!state.user) { const u = await window.tlAuth(); if (!u) return; }
    const R = S.result; const r = R.routes[S.selected];
    const nameIn = h('input', { type: 'text', value: `${shortLabel(R.points[0])} → ${shortLabel(R.points[R.points.length - 1])}` });
    const name = await modal('Save trip', h('div', { class: 'field' }, h('label', null, 'Name'), nameIn), [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, onClick: () => nameIn.value }]);
    if (!name) return;
    await api('/me/trips', { method: 'POST', body: { name, originLabel: R.points[0].label, destinationLabel: R.points[R.points.length - 1].label, distanceKm: r.distanceKm, cost: r.totalCost, params: shareParams() } });
    toast('Trip saved to My Garage');
  }

  async function compareDialog() {
    const picks = new Set(store.get('compare', ['honda-click-125', 'toyota-vios', 'toyota-innova-diesel', 'byd-dolphin', 'jeepney-traditional']));
    const body = h('div', null, h('p', { class: 'muted', style: { fontSize: '.86rem', marginTop: 0 } }, 'Pick up to 8 vehicles.'),
      h('div', { style: { columns: '2', fontSize: '.88rem' } }, state.presets.map((p) => {
        const cb = h('input', { type: 'checkbox', checked: picks.has(p.slug), onChange: (e) => (e.target.checked ? picks.add(p.slug) : picks.delete(p.slug)) });
        return h('label', { class: 'inline-check', style: { marginBottom: '6px', breakInside: 'avoid' } }, cb, p.name);
      })));
    const ok = await modal('Compare vehicles on this route', body, [{ label: 'Cancel', value: false }, { label: 'Compare', primary: true, value: true }]);
    if (!ok) return;
    store.set('compare', [...picks]);
    await calculate([...picks].slice(0, 8));
  }

  async function budgetRange() {
    const budget = Number(budgetIn.value);
    if (!(budget > 0)) { toast('Enter a budget in pesos', 'error'); return; }
    const o = S.points[0] || state.location || { lat: map.getCenter().lat, lng: map.getCenter().lng };
    const v = vehiclePayload();
    const qs = new URLSearchParams({ budget, lat: o.lat, lng: o.lng, product: productSel.value });
    if (v.presetSlug) qs.set('preset', v.presetSlug);
    if (v.kmpl) qs.set('kmpl', v.kmpl);
    if (v.userVehicleId) qs.set('vehicleId', v.userVehicleId);
    if (v.category) qs.set('category', v.category);
    const ev = currentVehicle()?.fuel === 'electric';
    if (ev && elecIn.value) qs.set('price', elecIn.value);
    else if (!ev && opt.price.value) qs.set('price', opt.price.value);
    clear(rangeOut).append(loading());
    try {
      const r = await api(`/range?${qs}`);
      clear(rangeOut).append(
        h('p', { class: 'plain' }, `${fmt.peso(budget)} buys about ${fmt.num(r.liters, 2)} ${r.unit}. Your ${r.vehicle} can go about `, h('b', null, `${fmt.num(r.oneWayKm)} km`), `, or ${fmt.num(r.roundTripKm)} km out and back.`),
        h('p', { class: 'muted', style: { fontSize: '.82rem' } }, `At ${r.kmpl} km/${r.unit} and ${fmt.peso(r.price.price)}/${r.unit} (${r.price.basis}). The ring on the map shows roughly how far you can go and come back.`));
      S.ring?.remove();
      S.ring = L.circle([o.lat, o.lng], { radius: (r.roundTripKm / 1.3) * 1000, color: brandHex(), weight: 2, fillOpacity: 0.07 }).addTo(map);
      map.fitBounds(S.ring.getBounds(), { padding: [20, 20] });
    } catch (e) { clear(rangeOut).append(alertBox('danger', e.message)); }
  }

  // ---------------------------------------------------------- restore from URL
  const dec = (s) => { if (!s) return null; const [lat, lng, ...rest] = s.split(','); const p = { lat: Number(lat), lng: Number(lng), label: rest.join(',') || null }; return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? p : null; };
  if (params.v) S.vehicleKey = `preset:${params.v}`;
  fillVehicles();
  if (params.k) kmplIn.value = params.k;
  if (params.p) productSel.value = params.p;
  if (params.rt) opt.roundTrip.checked = true;
  if (params.pax) opt.passengers.value = params.pax;
  if (params.st) { style = params.st; [...styleSeg.children].forEach((b) => b.classList.toggle('on', b.textContent.toLowerCase() === style)); }
  const setIf = (el, v) => { if (v != null && v !== '') el.value = v; };
  setIf(opt.traffic, params.tr); setIf(opt.price, params.pr); setIf(opt.trips, params.tw); setIf(opt.split, params.sp); setIf(opt.earn, params.er);
  setIf(opt.toll, params.tl); setIf(opt.parking, params.pk); setIf(opt.other, params.oc); setIf(opt.plate, params.pd); setIf(elecIn, params.el);
  if (params.pw) { opt.week.append(h('option', { value: params.pw }, fmt.date(params.pw))); opt.week.value = params.pw; }
  syncVehicleUi(); updateBadge();
  const o = dec(params.o); const d = dec(params.d);
  const stops = (params.s || '').split('|').map(dec).filter(Boolean);
  if (o || d) S.points = [o, ...stops, d];
  drawStops(); drawMarkers(); drawPlaces(); drawRecent();
  if (o && d) calculate();
  else if (!o && navigator.permissions) {
    // Only auto-fill the origin when location access was already granted; never prompt on page load.
    navigator.permissions.query({ name: 'geolocation' }).then((perm) => {
      if (perm.state === 'granted') getLocation().then((loc) => { if (!S.points[0]) setPoint(0, { ...loc, label: null }, true); }).catch(() => {});
    }).catch(() => {});
  }
  if (params.tour) setTimeout(runTour, 600);

  return () => { offAuth(); map.remove(); S.charts.forEach((c) => c.destroy()); };
}

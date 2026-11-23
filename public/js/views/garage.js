// My Garage: vehicles, fuel log (real km/L), monthly budget, price alerts, saved trips. Requires sign-in.
import { PRODUCT_LABELS, REGIONS, alertBox, api, brandHex, clear, empty, fmt, h, icon, loading, makeChart, modal, setQuery, state, toast } from '../lib.js';
import { pageHeader, tabBar } from '../ui.js';

const HELP = {
  intro: 'Your personal space: your vehicles, a log of your fill-ups, a monthly fuel budget, price alerts and saved trips.',
  steps: ['Add your vehicle under Vehicles (start from a common model, then adjust).', 'Each time you fill up, add it under Fuel log. Fill to full and note the odometer to learn your real km/L.', 'Set a monthly budget under Settings to see how much is left.', 'Under Alerts, ask to be notified when prices drop below an amount or a rollback is coming.'],
  terms: ['tankToTank', 'kmpl', 'coding', 'rollback'],
};

const CATS = [['motorcycle', 'Motorcycle'], ['tricycle', 'Tricycle'], ['car', 'Car'], ['suv', 'SUV'], ['mpv', 'MPV / AUV'], ['pickup', 'Pickup'], ['van', 'Van'], ['truck', 'Truck'], ['jeepney', 'Jeepney']];
const FUEL_PRODUCTS = ['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS'];

export async function render(root, params = {}) {
  if (!state.user) {
    root.append(h('div', { class: 'card', style: { maxWidth: '560px', margin: '40px auto' } },
      empty('🚗', 'Your garage', 'Sign in to save vehicles, log fill-ups to measure your real km/L, set price alerts, track a monthly fuel budget, and keep your trips.',
        h('button', { class: 'btn primary', type: 'button', onClick: () => window.tlAuth() }, 'Sign in or create an account'))));
    return undefined;
  }
  const charts = [];
  const TABS = [['overview', 'Overview'], ['log', 'Fuel log'], ['vehicles', 'Vehicles'], ['alerts', 'Alerts'], ['trips', 'Saved trips'], ['settings', 'Settings']];
  let tab = TABS.some(([k]) => k === params.tab) ? params.tab : 'overview';
  const body = h('div', { class: 'stack' });
  const tabs = tabBar(TABS, tab, (k) => { tab = k; setQuery({ tab: k === 'overview' ? null : k }); draw(); });
  root.append(pageHeader({ title: `Hi, ${state.user.name.split(' ')[0]}`, subtitle: 'Your vehicles, fill-ups, budget, alerts and saved trips.', help: HELP }), tabs, body);

  let vehicles = [];
  const loadVehicles = async () => { vehicles = await api('/me/vehicles'); };

  async function draw() {
    charts.splice(0).forEach((c) => c.destroy());
    clear(body).append(loading());
    try {
      await loadVehicles();
      clear(body);
      await ({ overview, log, vehicles: vehiclesTab, alerts, trips, settings })[tab]();
    } catch (e) { clear(body).append(alertBox('danger', e.message)); }
  }

  async function overview() {
    const s = await api('/me/stats');
    const m = s.thisMonth;
    const pct = m.budget ? Math.min(100, (m.cost / m.budget) * 100) : null;
    body.append(h('div', { class: 'grid cols-3' },
      h('div', { class: 'card' }, h('div', { class: 'section-title' }, 'Spent this month'), h('div', { class: 'kpi' }, fmt.peso(m.cost)), h('div', { class: 'muted' }, `${fmt.num(m.liters, 2)} L in ${m.fills} fill-up(s)`)),
      h('div', { class: 'card' }, h('div', { class: 'section-title' }, 'Projected month-end'), h('div', { class: 'kpi' }, fmt.peso(m.projected, 0)), h('div', { class: 'muted' }, 'At your current daily pace')),
      h('div', { class: 'card' }, h('div', { class: 'section-title' }, 'Monthly budget'),
        m.budget ? [h('div', { class: 'kpi' }, fmt.peso(m.budget, 0)), h('div', { class: `progress ${m.cost > m.budget ? 'over' : ''}`, style: { margin: '8px 0 4px' } }, h('div', { style: { width: `${pct}%` } })),
          h('div', { class: 'muted', style: { fontSize: '.85rem' } }, m.cost > m.budget ? `Over by ${fmt.peso(m.cost - m.budget)}` : `${fmt.peso(m.budget - m.cost)} left`)]
          : h('button', { class: 'btn small', type: 'button', onClick: () => { tab = 'settings'; [...tabs.children].forEach((b, i) => b.classList.toggle('on', TABS[i][0] === 'settings')); draw(); } }, 'Set a budget'))));

    const chartCanvas = h('canvas');
    body.append(h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h3', null, icon('wallet'), 'Monthly fuel spending'), s.months.length ? h('div', { class: 'chart-box tall' }, chartCanvas) : h('p', { class: 'muted' }, 'Log fill-ups to see your spending trend.')),
      h('div', { class: 'card' }, h('h3', null, icon('fuel'), 'Real-world fuel economy'),
        s.efficiency.length ? s.efficiency.map((e) => h('div', { style: { padding: '8px 0', borderBottom: '1px dashed var(--border)' } },
          h('div', { class: 'row between' }, h('b', null, e.name), e.measuredKmpl ? h('span', { class: 'kpi', style: { fontSize: '1.2rem' } }, `${e.measuredKmpl} km/L`) : h('span', { class: 'muted' }, 'not enough data')),
          h('div', { class: 'row between', style: { fontSize: '.84rem' } }, h('span', { class: 'muted' }, `Set to ${e.statedKmpl} km/L · ${e.segments.length} full-tank interval(s)`),
            e.measuredKmpl && Math.abs(e.measuredKmpl - e.statedKmpl) > 0.2 ? h('button', { class: 'btn small', type: 'button', onClick: async () => {
              const v = vehicles.find((x) => x.id === e.vehicleId);
              await api(`/me/vehicles/${v.id}`, { method: 'PUT', body: { ...toBody(v), kmpl: e.measuredKmpl } });
              toast('Trip estimates now use your measured km/L'); draw();
            } }, 'Use measured') : null)))
          : h('p', { class: 'muted' }, 'Add a vehicle, then log full-tank fill-ups with odometer readings. TipidLitro computes your real km/L with the tank-to-tank method.'))));
    if (s.months.length) {
      charts.push(makeChart(chartCanvas, {
        type: 'bar',
        data: { labels: s.months.map((x) => x.month), datasets: [{ label: 'Spent (₱)', data: s.months.map((x) => x.cost), backgroundColor: brandHex(), borderRadius: 5 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmt.peso(c.raw) } } } },
      }));
    }
  }

  async function log() {
    const logs = await api('/me/logs');
    let lookup = null;
    try { lookup = await api(`/prices/lookup?region=${encodeURIComponent(state.user.homeRegion || 'NCR')}&product=${vehicles[0]?.product || 'RON91'}`); } catch { /* no price yet */ }
    const vSel = h('select', null, h('option', { value: '' }, '—'), vehicles.map((v) => h('option', { value: v.id }, v.name)));
    if (vehicles[0]) vSel.value = vehicles.find((v) => v.is_default)?.id || vehicles[0].id;
    const date = h('input', { type: 'date', value: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) });
    const odo = h('input', { type: 'number', min: '0', step: '0.1', placeholder: 'e.g. 12345' });
    const liters = h('input', { type: 'number', min: '0.1', step: '0.01', placeholder: 'e.g. 4.5' });
    const ppl = h('input', { type: 'number', min: '20', step: '0.01', value: lookup?.price ?? '' });
    const total = h('input', { type: 'number', min: '0', step: '0.01', placeholder: 'auto' });
    const full = h('input', { type: 'checkbox', checked: true });
    const station = h('input', { type: 'text', maxlength: '150', placeholder: 'e.g. Petron Katipunan' });
    const syncTotal = () => { if (liters.value && ppl.value) total.placeholder = (Number(liters.value) * Number(ppl.value)).toFixed(2); };
    [liters, ppl].forEach((el) => el.addEventListener('input', syncTotal));
    body.append(h('div', { class: 'card' }, h('h3', null, icon('plus'), 'Add a fill-up'),
      h('div', { class: 'grid cols-3', style: { gap: '10px' } },
        h('div', { class: 'field' }, h('label', null, 'Vehicle'), vSel), h('div', { class: 'field' }, h('label', null, 'Date'), date), h('div', { class: 'field' }, h('label', null, 'Odometer (km)'), odo),
        h('div', { class: 'field' }, h('label', null, 'Liters'), liters), h('div', { class: 'field' }, h('label', null, `₱ per liter${lookup ? ` (DOE ${lookup.region}: ${fmt.peso(lookup.price)})` : ''}`), ppl), h('div', { class: 'field' }, h('label', null, 'Total paid ₱'), total)),
      h('div', { class: 'row between' }, h('label', { class: 'inline-check' }, full, 'Filled to full tank'), h('div', { style: { flex: 1, minWidth: '180px' } }, station),
        h('button', { class: 'btn primary', type: 'button', onClick: async () => {
          try {
            await api('/me/logs', { method: 'POST', body: { vehicleId: vSel.value || null, filledOn: date.value, odometerKm: odo.value || null, liters: Number(liters.value), pricePerLiter: Number(ppl.value), totalCost: Number(total.value) || null, fullTank: full.checked, stationName: station.value, product: vehicles.find((v) => String(v.id) === vSel.value)?.product } });
            toast('Fill-up logged'); draw();
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Add'))));
    body.append(h('div', { class: 'card' }, h('h3', null, 'History'),
      logs.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', { class: 'left' }, 'Vehicle'), h('th', null, 'Odometer'), h('th', null, 'Liters'), h('th', null, '₱/L'), h('th', null, 'Total'), h('th', { class: 'left' }, 'Station'), h('th', null, ''))),
        h('tbody', null, logs.map((l) => h('tr', null, h('td', null, fmt.date(l.filled_on)), h('td', { class: 'left' }, vehicles.find((v) => v.id === l.vehicle_id)?.name || '—'),
          h('td', null, l.odometer_km ? fmt.int(l.odometer_km) : '—'), h('td', null, `${fmt.num(l.liters, 2)}${l.full_tank ? '' : ' (partial)'}`), h('td', null, fmt.num(l.price_per_liter, 2)), h('td', null, fmt.peso(l.total_cost)), h('td', { class: 'left' }, l.station_name || '—'),
          h('td', null, h('button', { class: 'btn small ghost danger', type: 'button', title: 'Delete', onClick: async () => { await api(`/me/logs/${l.id}`, { method: 'DELETE' }); draw(); } }, icon('trash')))))))) : h('p', { class: 'muted' }, 'No fill-ups yet.')));
  }

  const toBody = (v) => ({ name: v.name, category: v.category, fuelType: v.fuel_type, product: v.product, kmpl: v.kmpl, massKg: v.mass_kg, engineCc: v.engine_cc, tankLiters: v.tank_liters, plateDigit: v.plate_digit });
  const unitOf = (v) => (v.fuel_type === 'electric' ? 'kWh' : 'L');

  async function vehicleDialog(v) {
    const preset = h('select', null, h('option', { value: '' }, 'Start from a common model…'), state.presets.map((p) => h('option', { value: p.slug }, p.name)));
    const name = h('input', { type: 'text', value: v?.name || '', placeholder: 'e.g. My Click 125' });
    const cat = h('select', null, CATS.map(([k, t]) => h('option', { value: k }, t)));
    const fuel = h('select', null, h('option', { value: 'gasoline' }, 'Gasoline'), h('option', { value: 'diesel' }, 'Diesel'), h('option', { value: 'electric' }, 'Electric (EV)'));
    const product = h('select', null, FUEL_PRODUCTS.map((p) => h('option', { value: p }, PRODUCT_LABELS[p])));
    const kmpl = h('input', { type: 'number', min: '1', max: '150', step: '0.1', value: v?.kmpl || '' });
    const kmplLabel = h('label', null, 'km per liter');
    const cc = h('input', { type: 'number', min: '50', max: '8000', value: v?.engine_cc || '' });
    const tank = h('input', { type: 'number', min: '1', max: '400', step: '0.1', value: v?.tank_liters || '' });
    const tankLabel = h('label', null, 'Tank size (L)');
    const plate = h('input', { type: 'text', inputmode: 'numeric', maxlength: '1', placeholder: '0–9', value: v?.plate_digit ?? '' });
    const productField = h('div', { class: 'field' }, h('label', null, 'Usual product'), product);
    if (v) { cat.value = v.category; fuel.value = v.fuel_type; if (v.product !== 'ELECTRICITY') product.value = v.product; }
    const syncFuel = () => {
      const ev = fuel.value === 'electric';
      productField.classList.toggle('hidden', ev);
      kmplLabel.textContent = ev ? 'km per kWh' : 'km per liter';
      tankLabel.textContent = ev ? 'Battery (kWh)' : 'Tank size (L)';
    };
    fuel.addEventListener('change', syncFuel);
    preset.addEventListener('change', () => {
      const p = state.presets.find((x) => x.slug === preset.value); if (!p) return;
      name.value ||= p.name; cat.value = p.category; fuel.value = p.fuel_type; if (p.product !== 'ELECTRICITY') product.value = p.product;
      kmpl.value = Math.round(((p.kmpl_city + p.kmpl_highway) / 2) * 10) / 10; cc.value = p.engine_cc || '';
      syncFuel();
    });
    syncFuel();
    const body = h('div', null, v ? null : h('div', { class: 'field' }, preset),
      h('div', { class: 'field' }, h('label', null, 'Name'), name),
      h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', null, 'Type'), cat), h('div', { class: 'field' }, h('label', null, 'Engine (cc)'), cc)),
      h('div', { class: 'two' }, h('div', { class: 'field' }, h('label', null, 'Runs on'), fuel), productField),
      h('div', { class: 'two' }, h('div', { class: 'field' }, kmplLabel, kmpl), h('div', { class: 'field' }, tankLabel, tank)),
      h('div', { class: 'field' }, h('label', null, 'Plate number — last digit (for the MMDA number coding check)'), plate));
    return modal(v ? 'Edit vehicle' : 'Add a vehicle', body, [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, onClick: async () => {
      const payload = { name: name.value, category: cat.value, fuelType: fuel.value, product: product.value, kmpl: Number(kmpl.value), engineCc: Number(cc.value) || null, tankLiters: Number(tank.value) || null, presetSlug: preset.value || null, plateDigit: plate.value };
      try { await api(v ? `/me/vehicles/${v.id}` : '/me/vehicles', { method: v ? 'PUT' : 'POST', body: payload }); return true; } catch (e) { toast(e.message, 'error'); return false; }
    } }]);
  }

  async function vehiclesTab() {
    body.append(h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, 'Vehicles'), h('button', { class: 'btn primary', type: 'button', onClick: async () => { if (await vehicleDialog()) draw(); } }, icon('plus'), 'Add vehicle')));
    if (!vehicles.length) { body.append(h('div', { class: 'card' }, empty('🏍️', 'No vehicles yet', 'Add your motorcycle, car, EV or jeepney to get personal estimates.'))); return; }
    body.append(h('div', { class: 'grid cols-auto' }, vehicles.map((v) => h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('b', null, v.name), v.is_default ? h('span', { class: 'badge brand' }, 'default') : null),
      h('div', { class: 'muted', style: { fontSize: '.86rem', margin: '4px 0 8px' } }, `${CATS.find((c) => c[0] === v.category)?.[1] || v.category} · ${PRODUCT_LABELS[v.product] || v.product}${v.engine_cc ? ` · ${v.engine_cc} cc` : ''}${v.plate_digit != null ? ` · plate …${v.plate_digit}` : ''}`),
      h('div', { class: 'kpi' }, `${v.kmpl} km/${unitOf(v)}`),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('a', { class: 'btn small', href: '#/plan', onClick: () => { try { localStorage.setItem('tl.vehicleKey', JSON.stringify(`uv:${v.id}`)); } catch { /* ignore */ } } }, 'Plan a trip'),
        h('button', { class: 'btn small', type: 'button', onClick: async () => { if (await vehicleDialog(v)) draw(); } }, 'Edit'),
        v.is_default ? null : h('button', { class: 'btn small', type: 'button', onClick: async () => { await api(`/me/vehicles/${v.id}`, { method: 'PUT', body: { ...toBody(v), isDefault: true } }); draw(); } }, 'Make default'),
        h('button', { class: 'btn small ghost danger', type: 'button', onClick: async () => { if (await modal('Delete vehicle?', h('p', null, `${v.name} will be removed. Its fill-ups stay in your log.`), [{ label: 'Cancel', value: false }, { label: 'Delete', primary: true, value: true }])) { await api(`/me/vehicles/${v.id}`, { method: 'DELETE' }); draw(); } } }, icon('trash')))))));
  }

  async function alerts() {
    const list = await api('/me/alerts');
    const kind = h('select', null, [['below', 'Price drops to or below'], ['above', 'Price rises to or above'], ['rollback', 'A rollback is expected (forecast)'], ['adjustment', 'Every weekly adjustment notice']].map(([v, t]) => h('option', { value: v }, t)));
    const region = h('select', null, REGIONS.map((r) => h('option', { value: r }, r)));
    region.value = state.user.homeRegion || 'NCR';
    const product = h('select', null, [...FUEL_PRODUCTS, 'KEROSENE'].map((p) => h('option', { value: p }, PRODUCT_LABELS[p])));
    const threshold = h('input', { type: 'number', min: '20', max: '300', step: '0.01', placeholder: 'e.g. 80.00' });
    const thLabel = h('label', null, 'Price ₱/L');
    const thField = h('div', { class: 'field' }, thLabel, threshold);
    const regionField = h('div', { class: 'field' }, h('label', null, 'Region'), region);
    const productField = h('div', { class: 'field' }, h('label', null, 'Fuel'), product);
    const sync = () => {
      const k = kind.value;
      thField.classList.toggle('hidden', k === 'adjustment');
      thLabel.textContent = k === 'rollback' ? 'At least ₱/L (default 0.50)' : 'Price ₱/L';
      threshold.placeholder = k === 'rollback' ? '0.50' : 'e.g. 80.00';
      regionField.classList.toggle('hidden', k === 'adjustment' || k === 'rollback');
      productField.classList.toggle('hidden', k === 'adjustment');
    };
    kind.addEventListener('change', sync); sync();
    const notifSupported = 'Notification' in window;
    body.append(h('div', { class: 'card' }, h('h3', null, icon('bell'), 'New price alert'),
      h('p', { class: 'muted', style: { fontSize: '.86rem' } }, 'TipidLitro checks DOE every hour and the forecast every 3 hours. Matching alerts appear under the bell icon (at most once per price week).'),
      h('div', { class: 'grid cols-auto', style: { gap: '10px' } }, h('div', { class: 'field' }, h('label', null, 'Notify me when'), kind), regionField, productField, thField),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onClick: async () => {
          try {
            await api('/me/alerts', { method: 'POST', body: { kind: kind.value, region: region.value, product: product.value, threshold: Number(threshold.value) || (kind.value === 'rollback' ? 0.5 : null) } });
            toast('Alert saved'); draw();
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Add alert'),
        notifSupported && Notification.permission !== 'granted' ? h('button', { class: 'btn', type: 'button', onClick: async () => {
          const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Desktop notifications on (while TipidLitro is open)' : 'Notifications not allowed'); draw();
        } }, 'Also show desktop notifications') : notifSupported ? h('span', { class: 'badge green' }, 'Desktop notifications on') : null)));
    body.append(h('div', { class: 'card' }, h('h3', null, 'Your alerts'),
      list.length ? h('div', { class: 'stack', style: { gap: '8px' } }, list.map((a) => h('div', { class: 'row between', style: { borderBottom: '1px dashed var(--border)', paddingBottom: '8px' } },
        h('div', null, h('b', null, a.description), h('div', { class: 'faint', style: { fontSize: '.78rem' } }, a.last_triggered ? `Last fired for ${fmt.date(a.last_triggered)}` : 'Not triggered yet')),
        h('button', { class: 'btn small ghost danger', type: 'button', title: 'Delete alert', onClick: async () => { await api(`/me/alerts/${a.id}`, { method: 'DELETE' }); draw(); } }, icon('trash')))))
        : h('p', { class: 'muted' }, 'No alerts yet.')));
  }

  async function trips() {
    const list = await api('/me/trips');
    if (!list.length) { body.append(h('div', { class: 'card' }, empty('🗺️', 'No saved trips', 'Plan a trip and press Save to keep it here.', h('a', { class: 'btn primary', href: '#/plan' }, 'Plan a trip')))); return; }
    body.append(h('div', { class: 'grid cols-auto' }, list.map((t) => {
      let qs = '';
      try { qs = new URLSearchParams(Object.entries(JSON.parse(t.payload)).filter(([, v]) => v != null && v !== '')).toString(); } catch { /* bad payload */ }
      return h('div', { class: 'card' }, h('b', null, t.name), h('div', { class: 'muted', style: { fontSize: '.82rem', margin: '4px 0' } }, `${t.origin_label || '?'} → ${t.destination_label || '?'}`),
        h('div', { class: 'row between' }, h('span', { class: 'kpi', style: { fontSize: '1.3rem' } }, fmt.peso(t.cost_php)), h('span', { class: 'muted' }, `${t.distance_km} km`)),
        h('div', { class: 'faint', style: { fontSize: '.78rem' } }, `Saved ${fmt.ago(t.created_at)} — re-open to recalculate with this week's prices`),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn small primary', type: 'button', onClick: () => window.tlNavigate(`#/plan?${qs}`) }, 'Open'),
          h('button', { class: 'btn small ghost danger', type: 'button', onClick: async () => { await api(`/me/trips/${t.id}`, { method: 'DELETE' }); draw(); } }, icon('trash'))));
    })));
  }

  async function settings() {
    const name = h('input', { type: 'text', value: state.user.name });
    const budget = h('input', { type: 'number', min: '0', step: '50', value: state.user.monthlyBudget ?? '' , placeholder: 'e.g. 3000' });
    const region = h('select', null, REGIONS.map((r) => h('option', { value: r }, r)));
    region.value = state.user.homeRegion || 'NCR';
    body.append(h('div', { class: 'card', style: { maxWidth: '520px' } },
      h('div', { class: 'field' }, h('label', null, 'Name'), name),
      h('div', { class: 'field' }, h('label', null, 'Monthly fuel budget (₱)'), budget),
      h('div', { class: 'field' }, h('label', null, 'Home region (for default prices)'), region),
      h('button', { class: 'btn primary', type: 'button', onClick: async () => {
        await api('/me/settings', { method: 'PUT', body: { name: name.value, monthlyBudget: Number(budget.value) || null, homeRegion: region.value } });
        Object.assign(state.user, { name: name.value || state.user.name, monthlyBudget: Number(budget.value) || null, homeRegion: region.value });
        toast('Saved');
      } }, 'Save settings')));
  }

  await draw();
  return () => charts.forEach((c) => c.destroy());
}

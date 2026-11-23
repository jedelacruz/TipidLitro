// My Garage (port of public/js/views/garage.js): vehicles, fuel log (real km/L), monthly budget,
// price alerts and saved trips. Requires sign-in.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { BarChart } from '../components/charts';
import { DateField } from '../components/shared';
import {
  AlertBox, Badge, Btn, Card, Empty, Field, Icon, Input, Kpi, KpiGrid, Loading, PageHeader, Row, Screen, Section, Select, Sheet, Tabs, Toggle, Txt, toast,
} from '../components/ui';
import { api, prefs } from '../lib/api';
import { enableNotifications, useApp } from '../lib/app-context';
import { fmt, FUEL_PRODUCTS, isoToday, PRODUCT_LABELS, REGIONS } from '../lib/format';
import { useTheme } from '../lib/theme';

const CATS = [['motorcycle', 'Motorcycle'], ['tricycle', 'Tricycle'], ['car', 'Car'], ['suv', 'SUV'], ['mpv', 'MPV / AUV'], ['pickup', 'Pickup'], ['van', 'Van'], ['truck', 'Truck'], ['jeepney', 'Jeepney']];
const TABS = [['overview', 'Overview'], ['log', 'Fuel log'], ['vehicles', 'Vehicles'], ['alerts', 'Alerts'], ['trips', 'Saved trips'], ['settings', 'Settings']];
const ALERT_KINDS = [['below', 'Price drops to or below'], ['above', 'Price rises to or above'], ['rollback', 'A rollback is expected (forecast)'], ['adjustment', 'Every weekly adjustment notice']];
const toBody = (v) => ({ name: v.name, category: v.category, fuelType: v.fuel_type, product: v.product, kmpl: v.kmpl, massKg: v.mass_kg, engineCc: v.engine_cc, tankLiters: v.tank_liters, plateDigit: v.plate_digit });
const unitOf = (v) => (v.fuel_type === 'electric' ? 'kWh' : 'L');
const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));
const confirm = (title, message, label = 'Delete') => new Promise((resolve) => Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: label, style: 'destructive', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));

export default function Garage() {
  const { user, requireAuth } = useApp();
  const params = useLocalSearchParams();
  const [tab, setTab] = useState(TABS.some(([k]) => k === params.tab) ? params.tab : 'overview');
  const [vehicles, setVehicles] = useState([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState(null);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    if (!user) return;
    api('/me/vehicles').then((v) => { setVehicles(v); setError(null); }).catch((e) => setError(e.message));
  }, [user, version]);

  if (!user) {
    return (
      <Screen>
        <PageHeader back title="My Garage" help="garage" />
        <Card><Empty icon="🚗" title="Your garage" text="Sign in to save vehicles, log fill-ups to measure your real km/L, set price alerts, track a monthly fuel budget, and keep your trips." action={<Btn title="Sign in or create an account" variant="primary" onPress={() => requireAuth()} />} /></Card>
      </Screen>
    );
  }
  const props = { vehicles, reload, version, goTab: setTab };
  return (
    <Screen onRefresh={reload} refreshing={false}>
      <PageHeader back title={`Hi, ${user.name.split(' ')[0]}`} help="garage" subtitle="Your vehicles, fill-ups, budget, alerts and saved trips." />
      <Tabs items={TABS} value={tab} onChange={setTab} />
      {error ? <AlertBox level="danger" text={error} /> : null}
      {tab === 'overview' ? <Overview {...props} /> : tab === 'log' ? <FuelLog {...props} /> : tab === 'vehicles' ? <Vehicles {...props} /> : tab === 'alerts' ? <Alerts {...props} /> : tab === 'trips' ? <Trips {...props} /> : <Settings />}
    </Screen>
  );
}

function useLoad(path, version) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { let live = true; api(path).then((d) => live && setData(d)).catch((e) => live && setError(e.message)); return () => { live = false; }; }, [path, version]);
  return [data, error];
}

// ---------------------------------------------------------- Overview
function Overview({ vehicles, reload, version, goTab }) {
  const t = useTheme();
  const [s, error] = useLoad('/me/stats', version);
  if (error) return <AlertBox level="danger" text={error} />;
  if (!s) return <Loading />;
  const m = s.thisMonth;
  const pct = m.budget ? Math.min(100, (m.cost / m.budget) * 100) : null;
  return (
    <>
      <KpiGrid>
        <Kpi label="Spent this month" value={fmt.peso(m.cost)} sub={`${fmt.num(m.liters, 2)} L in ${m.fills} fill-up(s)`} icon="wallet" />
        <Kpi label="Projected month-end" value={fmt.peso(m.projected, 0)} sub="At your current daily pace" icon="trend" />
      </KpiGrid>
      <Card>
        <Txt variant="small" tone="muted" bold>Monthly budget</Txt>
        {m.budget ? (
          <>
            <Txt variant="h2">{fmt.peso(m.budget, 0)}</Txt>
            <View style={{ height: 10, borderRadius: 99, backgroundColor: t.surface2, overflow: 'hidden', borderWidth: 1, borderColor: t.border }}><View style={{ width: `${pct}%`, height: '100%', backgroundColor: m.cost > m.budget ? t.red : t.brand }} /></View>
            <Txt variant="small" tone={m.cost > m.budget ? 'red' : 'muted'}>{m.cost > m.budget ? `Over by ${fmt.peso(m.cost - m.budget)}` : `${fmt.peso(m.budget - m.cost)} left`}</Txt>
          </>
        ) : <Btn small title="Set a budget" onPress={() => goTab('settings')} />}
      </Card>
      <Section title="Monthly fuel spending" icon="wallet">
        {s.months.length ? <BarChart labels={s.months.map((x) => x.month)} series={[{ label: 'Spent', color: t.brand, data: s.months.map((x) => x.cost) }]} valueFormat={(v) => fmt.peso(v)} yFormat={(v) => `₱${Math.round(v)}`} /> : <Txt tone="muted">Log fill-ups to see your spending trend.</Txt>}
      </Section>
      <Section title="Real-world fuel economy" icon="fuel">
        {s.efficiency.length ? s.efficiency.map((e) => (
          <View key={e.vehicleId} style={{ gap: 4, borderBottomWidth: 1, borderColor: t.border, paddingBottom: 8 }}>
            <Row between><Txt bold>{e.name}</Txt>{e.measuredKmpl ? <Txt variant="h3">{e.measuredKmpl} km/L</Txt> : <Txt tone="muted">not enough data</Txt>}</Row>
            <Row between>
              <Txt variant="small" tone="muted" style={{ flex: 1 }}>Set to {e.statedKmpl} km/L · {e.segments.length} full-tank interval(s)</Txt>
              {e.measuredKmpl && Math.abs(e.measuredKmpl - e.statedKmpl) > 0.2 ? <Btn small title="Use measured" onPress={async () => {
                const v = vehicles.find((x) => x.id === e.vehicleId);
                try { await api(`/me/vehicles/${v.id}`, { method: 'PUT', body: { ...toBody(v), kmpl: e.measuredKmpl } }); toast('Trip estimates now use your measured km/L'); reload(); } catch (err) { toast(err.message, 'error'); }
              }} /> : null}
            </Row>
          </View>
        )) : <Txt tone="muted">Add a vehicle, then log full-tank fill-ups with odometer readings. TipidLitro computes your real km/L with the tank-to-tank method.</Txt>}
      </Section>
    </>
  );
}

// ---------------------------------------------------------- Fuel log
function FuelLog({ vehicles, reload, version }) {
  const { user } = useApp();
  const [logs, error] = useLoad('/me/logs', version);
  const def = vehicles.find((v) => v.is_default) || vehicles[0];
  const [f, setF] = useState({ vehicleId: def ? String(def.id) : '', date: isoToday(), odo: '', liters: '', ppl: '', total: '', full: true, station: '' });
  const [lookup, setLookup] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const vehicle = vehicles.find((v) => String(v.id) === f.vehicleId);
  useEffect(() => { if (def && !f.vehicleId) set('vehicleId', String(def.id)); }, [def?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const product = vehicle?.product && vehicle.product !== 'ELECTRICITY' ? vehicle.product : 'RON91';
    api(`/prices/lookup?region=${encodeURIComponent(user.homeRegion || 'NCR')}&product=${product}`).then((l) => { setLookup(l); setF((x) => (x.ppl ? x : { ...x, ppl: String(l.price ?? '') })); }).catch(() => setLookup(null));
  }, [vehicle?.product, user.homeRegion]);
  const auto = f.liters && f.ppl ? (Number(f.liters) * Number(f.ppl)).toFixed(2) : 'auto';
  const add = async () => {
    try {
      await api('/me/logs', { method: 'POST', body: { vehicleId: f.vehicleId || null, filledOn: f.date, odometerKm: f.odo || null, liters: Number(f.liters), pricePerLiter: Number(f.ppl), totalCost: Number(f.total) || null, fullTank: f.full, stationName: f.station, product: vehicle?.product } });
      toast('Fill-up logged'); setF((x) => ({ ...x, odo: '', liters: '', total: '', station: '' })); reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <Section title="Add a fill-up" icon="plus">
        <Row gap={10}>
          <Field label="Vehicle"><Select value={f.vehicleId} onChange={(v) => set('vehicleId', String(v))} title="Vehicle" options={[{ value: '', label: '—' }, ...vehicles.map((v) => ({ value: String(v.id), label: v.name }))]} /></Field>
          <Field label="Date"><DateField value={f.date} onChange={(v) => set('date', v)} /></Field>
        </Row>
        <Row gap={10}>
          <Field label="Odometer (km)" tip="Note it at every full-tank fill-up to learn your real km/L."><Input value={f.odo} onChangeText={(v) => set('odo', v)} keyboardType="decimal-pad" placeholder="e.g. 12345" /></Field>
          <Field label="Liters"><Input value={f.liters} onChangeText={(v) => set('liters', v)} keyboardType="decimal-pad" placeholder="e.g. 4.5" /></Field>
        </Row>
        <Row gap={10}>
          <Field label="₱ per liter" tip={lookup ? `DOE ${lookup.region} common price: ${fmt.peso(lookup.price)}` : undefined}><Input value={f.ppl} onChangeText={(v) => set('ppl', v)} keyboardType="decimal-pad" /></Field>
          <Field label="Total paid ₱"><Input value={f.total} onChangeText={(v) => set('total', v)} keyboardType="decimal-pad" placeholder={auto} /></Field>
        </Row>
        <Toggle label="Filled to full tank" sub="Needed to measure your real km/L" value={f.full} onChange={(v) => set('full', v)} />
        <Input value={f.station} onChangeText={(v) => set('station', v)} maxLength={150} placeholder="Station (e.g. Petron Katipunan)" />
        <Btn title="Add fill-up" variant="primary" block onPress={add} />
      </Section>
      <Section title="History">
        {error ? <AlertBox level="danger" text={error} /> : !logs ? <Loading /> : logs.length ? logs.map((l) => (
          <LogRow key={l.id} l={l} vehicle={vehicles.find((v) => v.id === l.vehicle_id)} onDelete={async () => { if (await confirm('Delete fill-up?', `${fmt.date(l.filled_on)} · ${fmt.peso(l.total_cost)}`)) { await api(`/me/logs/${l.id}`, { method: 'DELETE' }); reload(); } }} />
        )) : <Txt tone="muted">No fill-ups yet.</Txt>}
      </Section>
    </>
  );
}
function LogRow({ l, vehicle, onDelete }) {
  const t = useTheme();
  return (
    <Row between style={{ borderBottomWidth: 1, borderColor: t.border, paddingBottom: 8 }}>
      <View style={{ flex: 1 }}>
        <Row between><Txt bold>{fmt.date(l.filled_on)}</Txt><Txt bold>{fmt.peso(l.total_cost)}</Txt></Row>
        <Txt variant="small" tone="muted">{fmt.num(l.liters, 2)} L{l.full_tank ? '' : ' (partial)'} × {fmt.num(l.price_per_liter, 2)}{l.odometer_km ? ` · ${fmt.int(l.odometer_km)} km` : ''}</Txt>
        <Txt variant="tiny" tone="faint">{vehicle?.name || '—'}{l.station_name ? ` · ${l.station_name}` : ''}</Txt>
      </View>
      <Btn small variant="ghost" icon="trash" onPress={onDelete} />
    </Row>
  );
}

// ---------------------------------------------------------- Vehicles
function VehicleSheet({ vehicle, visible, onClose, onSaved }) {
  const { presets } = useApp();
  const blank = { preset: '', name: '', category: 'motorcycle', fuelType: 'gasoline', product: 'RON91', kmpl: '', cc: '', tank: '', plate: '' };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!visible) return;
    setF(vehicle ? { preset: '', name: vehicle.name, category: vehicle.category, fuelType: vehicle.fuel_type, product: vehicle.product === 'ELECTRICITY' ? 'RON91' : vehicle.product, kmpl: String(vehicle.kmpl), cc: vehicle.engine_cc ? String(vehicle.engine_cc) : '', tank: vehicle.tank_liters ? String(vehicle.tank_liters) : '', plate: vehicle.plate_digit != null ? String(vehicle.plate_digit) : '' } : blank);
  }, [visible, vehicle]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const ev = f.fuelType === 'electric';
  const fromPreset = (slug) => {
    const p = presets.find((x) => x.slug === slug); if (!p) return;
    setF((x) => ({ ...x, preset: slug, name: x.name || p.name, category: p.category, fuelType: p.fuel_type, product: p.product === 'ELECTRICITY' ? x.product : p.product, kmpl: String(Math.round(((p.kmpl_city + p.kmpl_highway) / 2) * 10) / 10), cc: p.engine_cc ? String(p.engine_cc) : '' }));
  };
  const save = async () => {
    const payload = { name: f.name, category: f.category, fuelType: f.fuelType, product: f.product, kmpl: Number(f.kmpl), engineCc: Number(f.cc) || null, tankLiters: Number(f.tank) || null, presetSlug: f.preset || null, plateDigit: f.plate };
    try { await api(vehicle ? `/me/vehicles/${vehicle.id}` : '/me/vehicles', { method: vehicle ? 'PUT' : 'POST', body: payload }); onSaved(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={vehicle ? 'Edit vehicle' : 'Add a vehicle'}>
      {!vehicle ? <Select value={f.preset} onChange={fromPreset} title="Start from a common model" placeholder="Start from a common model…" options={presets.map((p) => ({ value: p.slug, label: p.name }))} /> : null}
      <Field label="Name"><Input value={f.name} onChangeText={(v) => set('name', v)} placeholder="e.g. My Click 125" /></Field>
      <Row gap={10}>
        <Field label="Type"><Select value={f.category} onChange={(v) => set('category', v)} title="Type" options={opts(CATS)} /></Field>
        <Field label="Engine (cc)"><Input value={f.cc} onChangeText={(v) => set('cc', v)} keyboardType="number-pad" /></Field>
      </Row>
      <Row gap={10}>
        <Field label="Runs on"><Select value={f.fuelType} onChange={(v) => set('fuelType', v)} title="Runs on" options={opts([['gasoline', 'Gasoline'], ['diesel', 'Diesel'], ['electric', 'Electric (EV)']])} /></Field>
        {!ev ? <Field label="Usual product"><Select value={f.product} onChange={(v) => set('product', v)} title="Usual product" options={FUEL_PRODUCTS.map((p) => ({ value: p, label: PRODUCT_LABELS[p] }))} /></Field> : null}
      </Row>
      <Row gap={10}>
        <Field label={ev ? 'km per kWh' : 'km per liter'}><Input value={f.kmpl} onChangeText={(v) => set('kmpl', v)} keyboardType="decimal-pad" /></Field>
        <Field label={ev ? 'Battery (kWh)' : 'Tank size (L)'}><Input value={f.tank} onChangeText={(v) => set('tank', v)} keyboardType="decimal-pad" /></Field>
      </Row>
      <Field label="Plate number — last digit" tip="For the MMDA number coding check."><Input value={f.plate} onChangeText={(v) => set('plate', v.replace(/\D/g, '').slice(-1))} keyboardType="number-pad" maxLength={1} placeholder="0–9" /></Field>
      <Btn title="Save" variant="primary" block onPress={save} />
    </Sheet>
  );
}

function Vehicles({ vehicles, reload }) {
  const [editing, setEditing] = useState(null); // null | 'new' | vehicle
  return (
    <>
      <Row between><Txt variant="h2">Vehicles</Txt><Btn icon="plus" title="Add vehicle" variant="primary" small onPress={() => setEditing('new')} /></Row>
      {!vehicles.length ? <Card><Empty icon="🏍️" title="No vehicles yet" text="Add your motorcycle, car, EV or jeepney to get personal estimates." /></Card> : vehicles.map((v) => (
        <Card key={v.id}>
          <Row between><Txt bold style={{ flex: 1 }}>{v.name}</Txt>{v.is_default ? <Badge label="default" tone="brand" /> : null}</Row>
          <Txt variant="small" tone="muted">{CATS.find((c) => c[0] === v.category)?.[1] || v.category} · {PRODUCT_LABELS[v.product] || v.product}{v.engine_cc ? ` · ${v.engine_cc} cc` : ''}{v.plate_digit != null ? ` · plate …${v.plate_digit}` : ''}</Txt>
          <Txt variant="h2">{v.kmpl} km/{unitOf(v)}</Txt>
          <Row wrap gap={6}>
            <Btn small variant="primary" icon="route" title="Plan a trip" onPress={async () => { await prefs.set('vehicleKey', `uv:${v.id}`); router.navigate({ pathname: '/', params: { uv: String(v.id) } }); }} />
            <Btn small title="Edit" onPress={() => setEditing(v)} />
            {v.is_default ? null : <Btn small title="Make default" onPress={async () => { await api(`/me/vehicles/${v.id}`, { method: 'PUT', body: { ...toBody(v), isDefault: true } }); reload(); }} />}
            <Btn small variant="ghost" icon="trash" onPress={async () => { if (await confirm('Delete vehicle?', `${v.name} will be removed. Its fill-ups stay in your log.`)) { await api(`/me/vehicles/${v.id}`, { method: 'DELETE' }); reload(); } }} />
          </Row>
        </Card>
      ))}
      <VehicleSheet visible={editing != null} vehicle={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Vehicle saved'); reload(); }} />
    </>
  );
}

// ---------------------------------------------------------- Alerts
function Alerts({ reload, version }) {
  const t = useTheme();
  const { user } = useApp();
  const [list, error] = useLoad('/me/alerts', version);
  const [f, setF] = useState({ kind: 'below', region: user.homeRegion || 'NCR', product: 'RON91', threshold: '' });
  const [phone, setPhone] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { prefs.get('phoneNotifs', null).then(setPhone); }, []);
  const add = async () => {
    try {
      await api('/me/alerts', { method: 'POST', body: { kind: f.kind, region: f.region, product: f.product, threshold: Number(f.threshold) || (f.kind === 'rollback' ? 0.5 : null) } });
      toast('Alert saved'); set('threshold', ''); reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <Section title="New price alert" icon="bell" desc="TipidLitro checks DOE every hour and the forecast every 3 hours. Matching alerts appear under the bell icon (at most once per price week).">
        <Field label="Notify me when"><Select value={f.kind} onChange={(v) => set('kind', v)} title="Notify me when" options={opts(ALERT_KINDS)} /></Field>
        <Row gap={10}>
          {f.kind !== 'adjustment' && f.kind !== 'rollback' ? <Field label="Region"><Select value={f.region} onChange={(v) => set('region', v)} title="Region" options={opts(REGIONS.map((r) => [r, r]))} /></Field> : null}
          {f.kind !== 'adjustment' ? <Field label="Fuel"><Select value={f.product} onChange={(v) => set('product', v)} title="Fuel" options={[...FUEL_PRODUCTS, 'KEROSENE'].map((p) => ({ value: p, label: PRODUCT_LABELS[p] }))} /></Field> : null}
        </Row>
        {f.kind !== 'adjustment' ? <Field label={f.kind === 'rollback' ? 'At least ₱/L (default 0.50)' : 'Price ₱/L'}><Input value={f.threshold} onChangeText={(v) => set('threshold', v)} keyboardType="decimal-pad" placeholder={f.kind === 'rollback' ? '0.50' : 'e.g. 80.00'} /></Field> : null}
        <Btn title="Add alert" variant="primary" block onPress={add} />
        {phone ? <Row gap={6}><Icon name="check" color={t.green} /><Txt variant="small" tone="green">Phone notifications on (checked every 2 minutes while the app is open)</Txt></Row> : (
          <Btn icon="bell" title="Also show phone notifications" onPress={async () => {
            const ok = await enableNotifications(); await prefs.set('phoneNotifs', ok); setPhone(ok);
            toast(ok ? 'Phone notifications on' : 'Notifications not allowed — you can turn them on in your phone settings', ok ? 'info' : 'error');
          }} />
        )}
      </Section>
      <Section title="Your alerts">
        {error ? <AlertBox level="danger" text={error} /> : !list ? <Loading /> : list.length ? list.map((a) => (
          <Row key={a.id} between style={{ borderBottomWidth: 1, borderColor: t.border, paddingBottom: 8 }}>
            <View style={{ flex: 1 }}><Txt bold>{a.description}</Txt><Txt variant="tiny" tone="faint">{a.last_triggered ? `Last fired for ${fmt.date(a.last_triggered)}` : 'Not triggered yet'}</Txt></View>
            <Btn small variant="ghost" icon="trash" onPress={async () => { await api(`/me/alerts/${a.id}`, { method: 'DELETE' }); reload(); }} />
          </Row>
        )) : <Txt tone="muted">No alerts yet.</Txt>}
      </Section>
    </>
  );
}

// ---------------------------------------------------------- Saved trips
function Trips({ reload, version }) {
  const [list, error] = useLoad('/me/trips', version);
  if (error) return <AlertBox level="danger" text={error} />;
  if (!list) return <Loading />;
  if (!list.length) return <Card><Empty icon="🗺️" title="No saved trips" text="Plan a trip and press Save to keep it here." action={<Btn title="Plan a trip" variant="primary" onPress={() => router.navigate('/')} />} /></Card>;
  return list.map((tr) => {
    let p = {};
    try { p = Object.fromEntries(Object.entries(JSON.parse(tr.payload)).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])); } catch { /* bad payload */ }
    return (
      <Card key={tr.id}>
        <Txt bold>{tr.name}</Txt>
        <Txt variant="small" tone="muted">{tr.origin_label || '?'} → {tr.destination_label || '?'}</Txt>
        <Row between><Txt variant="h2">{fmt.peso(tr.cost_php)}</Txt><Txt tone="muted">{tr.distance_km} km</Txt></Row>
        <Txt variant="tiny" tone="faint">Saved {fmt.ago(tr.created_at)} — open to recalculate with this week’s prices</Txt>
        <Row gap={6}>
          <Btn small variant="primary" title="Open" onPress={() => router.navigate({ pathname: '/', params: { ...p, t: String(Date.now()) } })} />
          <Btn small variant="ghost" icon="trash" onPress={async () => { if (await confirm('Delete saved trip?', tr.name)) { await api(`/me/trips/${tr.id}`, { method: 'DELETE' }); reload(); } }} />
        </Row>
      </Card>
    );
  });
}

// ---------------------------------------------------------- Settings
function Settings() {
  const { user, setUser } = useApp();
  const [name, setName] = useState(user.name);
  const [budget, setBudget] = useState(user.monthlyBudget != null ? String(user.monthlyBudget) : '');
  const [region, setRegion] = useState(user.homeRegion || 'NCR');
  const save = useCallback(async () => {
    try {
      await api('/me/settings', { method: 'PUT', body: { name, monthlyBudget: Number(budget) || null, homeRegion: region } });
      setUser({ ...user, name: name || user.name, monthlyBudget: Number(budget) || null, homeRegion: region });
      toast('Saved');
    } catch (e) { toast(e.message, 'error'); }
  }, [name, budget, region, user, setUser]);
  return (
    <Card>
      <Field label="Name"><Input value={name} onChangeText={setName} /></Field>
      <Field label="Monthly fuel budget (₱)"><Input value={budget} onChangeText={setBudget} keyboardType="number-pad" placeholder="e.g. 3000" /></Field>
      <Field label="Home region (for default prices)"><Select value={region} onChange={setRegion} title="Home region" options={opts(REGIONS.map((r) => [r, r]))} /></Field>
      <Btn title="Save settings" variant="primary" block onPress={save} />
    </Card>
  );
}

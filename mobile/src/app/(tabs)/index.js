// Trip Planner (mobile port of public/js/views/planner.js): where → vehicle → optional extras →
// plain-language peso answer, with breakdown, history, hills, weather and comparison in tabs.
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';
import { BarChart, LineChart } from '../../components/charts';
import { DepartureField, OpenInSheet, PlacePicker, PriceStrip, UpdateBanner } from '../../components/shared';
import {
  AlertBox, Badge, Btn, Card, Chip, Field, Icon, Input, Loading, PageHeader, Row, Screen, Section, SectionTitle, Seg, Select, Sheet, Stat, StatGrid, StepLabel, Tabs, Term, Tip, Toggle, Txt, toast,
} from '../../components/ui';
import { api, getServer, prefs } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { fmt, PRODUCT_LABELS } from '../../lib/format';
import { copyText, shareText } from '../../lib/nav';
import { useTheme } from '../../lib/theme';

const CATEGORY_GROUPS = [
  ['Motorcycles & tricycles', ['motorcycle', 'tricycle']], ['Cars', ['car']], ['SUVs, MPVs & pickups', ['suv', 'mpv', 'pickup']], ['Vans & trucks', ['van', 'truck']], ['Jeepneys', ['jeepney']],
];
const TWO_WHEEL = ['motorcycle', 'tricycle'];
const CODING_CATS = ['car', 'suv', 'mpv', 'pickup', 'van'];
const MANILA = { latitude: 14.5995, longitude: 120.9842, latitudeDelta: 0.35, longitudeDelta: 0.35 };
const DEFAULT_OPTS = { roundTrip: false, ac: true, passengers: '1', cargo: '', split: '1', style: 'normal', depart: null, traffic: 'auto', toll: '', parking: '', other: '', week: '', price: '', plate: '', trips: '', earn: '' };
const shortLabel = (p) => (p?.label || 'Point').split(',')[0];
const ll = (p) => ({ latitude: p.lat, longitude: p.lng });

function FactorRow({ label, detail, value, bold }) {
  const t = useTheme();
  return (
    <Row between align="flex-start" style={{ borderBottomWidth: 1, borderColor: t.border, borderStyle: 'dashed', paddingBottom: 6 }}>
      <View style={{ flex: 1, paddingRight: 8 }}><Txt variant="small" bold={bold}>{label}</Txt>{detail ? <Txt variant="tiny" tone="muted">{detail}</Txt> : null}</View>
      <Txt variant="small" bold>{value}</Txt>
    </Row>
  );
}

export default function Planner() {
  const t = useTheme();
  const params = useLocalSearchParams();
  const { presets, user, location, locate, requireAuth } = useApp();
  const mapRef = useRef(null);

  const [points, setPoints] = useState([null, null]);
  const [vehicleKey, setVehicleKey] = useState('preset:honda-click-125');
  const [kmpl, setKmpl] = useState('');
  const [product, setProduct] = useState('RON91');
  const [elec, setElec] = useState('');
  const [customCat, setCustomCat] = useState('car');
  const [customFuel, setCustomFuel] = useState('gasoline');
  const [vehOpen, setVehOpen] = useState(false);
  const [opts, setOpts] = useState(DEFAULT_OPTS);
  const [moreOpen, setMoreOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(0);
  const [detailTab, setDetailTab] = useState('why');
  const [costRange, setCostRange] = useState('3y');
  const [allWarnings, setAllWarnings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [picker, setPicker] = useState(null); // index of the point being picked
  const [myVehicles, setMyVehicles] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [places, setPlaces] = useState([]);
  const [recent, setRecent] = useState([]);
  const [welcomed, setWelcomed] = useState(true);
  const [sheet, setSheet] = useState(null); // 'open' | 'more' | 'compare' | 'save' | 'place'
  const [comparePicks, setComparePicks] = useState(new Set(['honda-click-125', 'toyota-vios', 'toyota-innova-diesel', 'byd-dolphin', 'jeepney-traditional']));
  const [saveName, setSaveName] = useState('');
  const [placeToSave, setPlaceToSave] = useState(null);
  const [placeName, setPlaceName] = useState('');
  const [budget, setBudget] = useState('');
  const [range, setRange] = useState(null);
  const lastParams = useRef(null);
  const pendingKmpl = useRef(null); // km/L from a shared link, kept when the vehicle changes with it
  const calcRef = useRef(null);
  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }));

  // ---------------------------------------------------------- load preferences and lists
  useEffect(() => {
    (async () => {
      setVehicleKey(await prefs.get('vehicleKey', 'preset:honda-click-125'));
      setPlaces(await prefs.get('places', []));
      setRecent(await prefs.get('recentTrips', []));
      setWelcomed(await prefs.get('welcomed', false));
      setDetailTab(await prefs.get('detailTab', 'why'));
      const picks = await prefs.get('compare', null); if (picks) setComparePicks(new Set(picks));
    })();
    api('/prices/weeks?region=NCR').then((w) => setWeeks(w.weeks || [])).catch(() => {});
  }, []);
  useEffect(() => { if (user) api('/me/vehicles').then(setMyVehicles).catch(() => setMyVehicles([])); else setMyVehicles([]); }, [user]);

  // ---------------------------------------------------------- vehicle
  const current = useMemo(() => {
    const [kind, id] = vehicleKey.split(':');
    if (kind === 'uv') { const v = myVehicles.find((x) => String(x.id) === id); return v ? { category: v.category, fuel: v.fuel_type, product: v.product, kmpl: v.kmpl, plate: v.plate_digit, name: v.name } : null; }
    if (kind === 'preset') { const p = presets.find((x) => x.slug === id); return p ? { category: p.category, fuel: p.fuel_type, product: p.product, kmpl: (p.kmpl_city + p.kmpl_highway) / 2, name: p.name } : null; }
    return { category: customCat, fuel: customFuel, product: customFuel === 'diesel' ? 'DIESEL' : 'RON91', kmpl: Number(kmpl) || null, name: 'Custom' };
  }, [vehicleKey, myVehicles, presets, customCat, customFuel, kmpl]);
  const ev = current?.fuel === 'electric';
  const unit = ev ? 'kWh' : 'L';

  useEffect(() => {
    if (vehicleKey === 'custom' || !current) return;
    const keep = pendingKmpl.current; pendingKmpl.current = null;
    setKmpl(keep ?? String(Math.round(current.kmpl * 10) / 10));
    if (current.product !== 'ELECTRICITY') setProduct(current.product);
    if (current.plate != null) setOpts((o) => (o.plate ? o : { ...o, plate: String(current.plate) }));
  }, [vehicleKey, current?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseVehicle = (key) => { pendingKmpl.current = null; setVehicleKey(key); prefs.set('vehicleKey', key); if (key === 'custom') { setKmpl(''); setVehOpen(true); } };
  const vehicleGroups = [
    ...(myVehicles.length ? [{ title: 'My garage', options: myVehicles.map((v) => ({ value: `uv:${v.id}`, label: v.name, sub: `${v.kmpl} km/${v.fuel_type === 'electric' ? 'kWh' : 'L'}` })) }] : []),
    ...CATEGORY_GROUPS.map(([title, cats]) => ({ title, options: presets.filter((p) => cats.includes(p.category)).map((p) => ({ value: `preset:${p.slug}`, label: p.name, sub: `≈ ${Math.round(((p.kmpl_city + p.kmpl_highway) / 2) * 10) / 10} km/${p.fuel_type === 'electric' ? 'kWh' : 'L'}` })) })),
    { title: 'Other', options: [{ value: 'custom', label: 'Other — I know my km/L' }] },
  ];

  const vehiclePayload = () => {
    const [kind, id] = vehicleKey.split(':');
    const k = Number(kmpl) || undefined;
    if (kind === 'uv') return { userVehicleId: Number(id) };
    if (kind === 'preset') { const p = presets.find((x) => x.slug === id); const avg = p ? Math.round(((p.kmpl_city + p.kmpl_highway) / 2) * 10) / 10 : null; return { presetSlug: id, kmpl: k && k !== avg ? k : undefined }; }
    return { kmpl: k, category: customCat, fuelType: customFuel };
  };

  const changedCount = useMemo(() => {
    let n = 0; const o = opts;
    if (o.roundTrip) n++; if (o.passengers !== '1') n++; if (+o.cargo) n++; if (o.split !== '1') n++; if (!o.ac && !TWO_WHEEL.includes(current?.category)) n++;
    if (o.style !== 'normal') n++; if (o.depart) n++; if (o.traffic !== 'auto') n++;
    for (const k of ['toll', 'parking', 'other', 'trips', 'earn']) if (+o[k]) n++;
    if (o.week) n++; if (o.price) n++; if (o.plate && CODING_CATS.includes(current?.category)) n++;
    return n;
  }, [opts, current?.category]);

  // ---------------------------------------------------------- calculate
  const shareParams = useCallback(() => {
    const enc = (p) => (p ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${p.label || ''}` : null);
    const [kind, id] = vehicleKey.split(':');
    const o = opts;
    const out = {
      o: enc(points[0]), d: enc(points[points.length - 1]), s: points.slice(1, -1).filter(Boolean).map(enc).join('|') || null,
      v: kind === 'preset' ? id : null, k: kmpl || null, p: product, rt: o.roundTrip ? 1 : null, pax: o.passengers !== '1' ? o.passengers : null,
      st: o.style !== 'normal' ? o.style : null, tr: o.traffic !== 'auto' ? o.traffic : null, pr: o.price || null, tw: o.trips || null, sp: o.split !== '1' ? o.split : null,
      er: o.earn || null, pw: o.week || null, tl: o.toll || null, pk: o.parking || null, oc: o.other || null, pd: o.plate || null, el: elec || null,
    };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && v !== ''));
  }, [points, vehicleKey, kmpl, product, opts, elec]);

  const calculate = useCallback(async (compare, keepSelection = true) => {
    const pts = points.filter(Boolean);
    if (!points[0] || !points[points.length - 1]) { toast('Set a starting point and a destination first.', 'error'); return; }
    if (vehicleKey === 'custom' && !(Number(kmpl) > 0)) { toast('Enter your km/L.', 'error'); setVehOpen(true); return; }
    setBusy(true); setError(null);
    try {
      const o = opts;
      const body = {
        points: pts, vehicle: vehiclePayload(), product,
        roundTrip: o.roundTrip, passengers: Number(o.passengers) || 1, cargoKg: Number(o.cargo) || 0, ac: o.ac, style: o.style,
        departAt: o.depart ? o.depart.toISOString() : undefined, traffic: o.traffic,
        priceOverride: Number(o.price) || undefined, electricityRate: Number(elec) || undefined, priceWeek: o.week || undefined,
        tripsPerWeek: Number(o.trips) || 0, splitWays: Number(o.split) || 1, earningsPerTrip: Number(o.earn) || 0,
        tollFee: Number(o.toll) || 0, parkingFee: Number(o.parking) || 0, otherCost: Number(o.other) || 0,
        plateDigit: /^\d$/.test(o.plate) ? Number(o.plate) : undefined, compare,
      };
      const r = await api('/trip/estimate', { method: 'POST', body });
      setSelected((s) => (keepSelection && result && s < r.routes.length ? s : r.recommendedIndex));
      setResult(r);
      if (compare) setDetailTab('compare');
      // Remember the trip (this device).
      const title = `${shortLabel(r.points[0])} → ${shortLabel(r.points[r.points.length - 1])}`;
      const list = [{ title, params: shareParams() }, ...(await prefs.get('recentTrips', [])).filter((x) => x.title !== title)].slice(0, 6);
      setRecent(list); prefs.set('recentTrips', list);
      if (!welcomed) { setWelcomed(true); prefs.set('welcomed', true); }
      const coords = r.routes[r.recommendedIndex].geometry.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
      setTimeout(() => mapRef.current?.fitToCoordinates(coords, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true }), 250);
    } catch (e) { setError(e.message); setResult(null); }
    setBusy(false);
  }, [points, vehicleKey, kmpl, product, opts, elec, result, shareParams, welcomed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { calcRef.current = calculate; }, [calculate]); // timers call the latest version, after follow-up state updates settle

  // Changing anything after a result recalculates automatically (the server caches routes and weather).
  const inputsKey = JSON.stringify([points, vehicleKey, kmpl, product, elec, opts, customCat, customFuel]);
  const firstKey = useRef(inputsKey);
  useEffect(() => {
    if (inputsKey === firstKey.current || !result || busy) return undefined;
    const timer = setTimeout(() => calcRef.current(undefined, true), 700);
    return () => clearTimeout(timer);
  }, [inputsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------- open a trip from chat / saved / recent
  const applyParams = useCallback((p) => {
    const dec = (s) => { if (!s) return null; const [lat, lng, ...rest] = String(s).split(','); const v = { lat: Number(lat), lng: Number(lng), label: rest.join(',') || null }; return Number.isFinite(v.lat) && Number.isFinite(v.lng) ? v : null; };
    const o = dec(p.o); const d = dec(p.d); if (!o || !d) return;
    const stops = String(p.s || '').split('|').map(dec).filter(Boolean);
    setPoints([o, ...stops, d]);
    if (p.v) chooseVehicle(`preset:${p.v}`);
    if (p.k) { pendingKmpl.current = String(p.k); setKmpl(String(p.k)); }
    if (p.p) setProduct(p.p);
    if (p.el) setElec(String(p.el));
    setOpts({
      ...DEFAULT_OPTS, roundTrip: Boolean(p.rt), passengers: p.pax || '1', style: p.st || 'normal', traffic: p.tr || 'auto', price: p.pr || '', trips: p.tw || '',
      split: p.sp || '1', earn: p.er || '', week: p.pw || '', toll: p.tl || '', parking: p.pk || '', other: p.oc || '', plate: p.pd || '',
    });
    setResult(null);
    lastParams.current = JSON.stringify(p);
  }, []);
  // "Plan a trip" from My Garage passes the vehicle.
  useEffect(() => { if (params?.uv) chooseVehicle(`uv:${params.uv}`); }, [params?.uv]);
  useEffect(() => {
    const key = JSON.stringify(params);
    if (params?.o && params?.d && key !== lastParams.current) applyParams(params);
  }, [params, applyParams]);
  // Calculate once points are restored from params.
  const pendingAuto = useRef(false);
  useEffect(() => { if (lastParams.current && !result && points[0] && points[points.length - 1] && !pendingAuto.current) { pendingAuto.current = true; setTimeout(() => { calcRef.current(undefined, false); pendingAuto.current = false; }, 120); } }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------- points
  const firstEmpty = () => { const i = points.findIndex((p) => !p); return i >= 0 ? i : points.length - 1; };
  const setPoint = async (i, p, reverse) => {
    setPoints((cur) => { const next = [...cur]; next[i] = p; return next; });
    if (reverse && !p.label) {
      const r = await api(`/geocode/reverse?lat=${p.lat}&lng=${p.lng}`).catch(() => null);
      setPoints((cur) => { const next = [...cur]; if (next[i] && next[i].lat === p.lat) next[i] = { ...p, label: r?.label || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` }; return next; });
    }
  };
  const savePlace = async () => {
    const name = placeName.trim(); if (!name) return;
    const list = [...places.filter((x) => x.name.toLowerCase() !== name.toLowerCase()), { name, lat: placeToSave.lat, lng: placeToSave.lng, label: placeToSave.label }].slice(-8);
    setPlaces(list); prefs.set('places', list); setSheet(null); toast(`Saved "${name}"`);
  };

  // ---------------------------------------------------------- render helpers
  const R = result; const r = R?.routes[selected];
  const summaryText = () => {
    const lines = [
      `TipidLitro trip: ${shortLabel(R.points[0])} → ${shortLabel(R.points[R.points.length - 1])}${R.roundTrip ? ' (round trip)' : ''}`,
      `${r.distanceKm} km · ${fmt.dur(r.durationMin)} · ${R.vehicle.name}`,
      `${R.unit === 'kWh' ? 'Electricity' : 'Fuel'}: ${fmt.num(r.liters, 2)} ${R.unit} × ${fmt.peso(R.price.price)} = ${fmt.peso(r.cost)}${R.price.weekStart ? ` (DOE ${R.price.basis}, week of ${fmt.week(R.price.weekStart, R.price.weekEnd)})` : ''}`,
    ];
    if (R.extras.total) lines.push(`Toll ${fmt.peso(R.extras.toll)} · Parking ${fmt.peso(R.extras.parking)}${R.extras.other ? ` · Other ${fmt.peso(R.extras.other)}` : ''}`);
    lines.push(`Total ${fmt.peso(r.totalCost)}${R.splitWays > 1 ? ` · ${fmt.peso(r.perPerson)} each (${R.splitWays} people)` : ''}`);
    lines.push(`${getServer()}/#/plan?${new URLSearchParams(shareParams()).toString()}`);
    return lines.join('\n');
  };

  const mapPoints = points.filter(Boolean);
  const initialRegion = location ? { latitude: location.lat, longitude: location.lng, latitudeDelta: 0.25, longitudeDelta: 0.25 } : MANILA;

  return (
    <Screen onRefresh={() => (result ? calculate(undefined, true) : null)} refreshing={false}>
      <PageHeader title="Plan a trip" help="plan" subtitle="Fuel cost of any trip in the Philippines" />
      <UpdateBanner />
      <PriceStrip />
      {!welcomed && !result ? (
        <Card tone="welcome">
          <Txt variant="h3">👋 Welcome to TipidLitro</Txt>
          <Txt tone="muted">Get your trip’s fuel cost in 3 steps:</Txt>
          <Txt>1. Where you’re starting (or use your location){'\n'}2. Where you’re going{'\n'}3. Your vehicle — then tap <Txt bold>Calculate cost</Txt></Txt>
          <Btn small title="Got it" onPress={() => { setWelcomed(true); prefs.set('welcomed', true); }} />
        </Card>
      ) : null}

      {/* Map */}
      <View style={{ height: 260, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: t.border }}>
        <MapView ref={mapRef} style={{ flex: 1 }} initialRegion={initialRegion} userInterfaceStyle={t.dark ? 'dark' : 'light'} showsUserLocation={Boolean(location)}
          onPress={(e) => { const c = e.nativeEvent.coordinate; setPoint(firstEmpty(), { lat: c.latitude, lng: c.longitude, label: null }, true); }}>
          {R ? R.routes.map((route, i) => (
            <Polyline key={`${i}-${i === selected}`} coordinates={route.geometry.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))}
              strokeColor={i === selected ? t.brand : '#8b8580'} strokeWidth={i === selected ? 5 : 3} lineDashPattern={i === selected ? undefined : [6, 8]} tappable onPress={() => setSelected(i)} zIndex={i === selected ? 2 : 1} />
          )) : null}
          {points.map((p, i) => (p ? (
            <Marker key={`${i}-${p.lat}`} coordinate={ll(p)} draggable title={p.label || ''} pinColor={i === 0 ? 'orange' : i === points.length - 1 ? 'navy' : 'gray'}
              onDragEnd={(e) => { const c = e.nativeEvent.coordinate; setPoint(i, { lat: c.latitude, lng: c.longitude, label: null }, true); }} />
          ) : null))}
          {range ? <Circle center={ll(range.center)} radius={range.radiusM} strokeColor={t.brand} fillColor={`${t.brand}22`} strokeWidth={2} /> : null}
        </MapView>
        <View pointerEvents="none" style={{ position: 'absolute', left: 8, bottom: 8, backgroundColor: t.surface, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: t.border }}>
          <Txt variant="tiny" tone="muted">{mapPoints.length < 2 ? 'Tap the map to set A → B' : 'Drag the pins to adjust'}</Txt>
        </View>
      </View>

      {/* Form */}
      <Card>
        <StepLabel n={1}>Where?</StepLabel>
        {points.map((p, i) => {
          const last = i === points.length - 1;
          return (
            <Row key={i} gap={8}>
              <View style={{ width: 26, height: 26, borderRadius: 99, backgroundColor: i === 0 ? t.brand : last ? t.navy : '#64748b', alignItems: 'center', justifyContent: 'center' }}>
                <Txt variant="tiny" bold style={{ color: t.dark && last ? '#0f0e0d' : '#fff' }}>{i === 0 ? 'A' : last ? 'B' : i}</Txt>
              </View>
              <Pressable onPress={() => setPicker(i)} style={{ flex: 1, borderWidth: 1, borderColor: t.border, borderRadius: 9, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', backgroundColor: t.surface }}>
                <Txt numberOfLines={1} tone={p ? undefined : 'faint'}>{p?.label || (i === 0 ? 'Starting point (e.g. Cubao)' : last ? 'Destination (e.g. Tagaytay)' : 'Stop')}</Txt>
              </Pressable>
              {i === 0 ? <Pressable accessibilityLabel="Use my location" hitSlop={6} onPress={async () => { try { const loc = await locate(); setPoint(0, { ...loc, label: null }, true); mapRef.current?.animateToRegion({ latitude: loc.lat, longitude: loc.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }); } catch (e) { toast(e.message, 'error'); } }}><Icon name="locate" size={22} color={t.brandStrong} /></Pressable> : null}
              {!last && i > 0 ? <Pressable hitSlop={6} onPress={() => setPoints((cur) => cur.filter((_, k) => k !== i))}><Icon name="x" size={20} /></Pressable> : null}
              {p ? <Pressable accessibilityLabel="Save this place" hitSlop={6} onPress={() => { setPlaceToSave(p); setPlaceName(''); setSheet('place'); }}><Icon name="star" size={20} color={t.faint} /></Pressable> : null}
            </Row>
          );
        })}
        <Row gap={6} wrap>
          <Btn small icon="plus" title="Add stop" onPress={() => (points.length >= 10 ? toast('Up to 8 stops') : setPoints((cur) => [...cur.slice(0, -1), null, cur[cur.length - 1]]))} />
          <Btn small icon="swap" title="Swap" onPress={() => setPoints((cur) => [...cur].reverse())} />
        </Row>
        {places.length ? <Row wrap gap={6}>{places.map((pl) => <Chip key={pl.name} label={`★ ${pl.name}`} onPress={() => setPoint(firstEmpty(), { lat: pl.lat, lng: pl.lng, label: pl.label })} onRemove={() => { const list = places.filter((x) => x !== pl); setPlaces(list); prefs.set('places', list); }} />)}</Row> : null}

        <StepLabel n={2}>Vehicle</StepLabel>
        <Select value={vehicleKey} groups={vehicleGroups} onChange={chooseVehicle} title="Choose your vehicle" />
        <Row between>
          <Row gap={0} style={{ flex: 1 }}>
            <Txt variant="small" tone="muted">{kmpl ? `≈ ${kmpl} km/${unit}` : 'Enter your km/L'} · {ev ? `electricity${elec ? ` at ₱${elec}/kWh` : ' (typical home rate)'}` : PRODUCT_LABELS[product]}</Txt>
            <Tip title="Fuel economy" text={ev ? 'How far it goes on 1 kWh of electricity.' : 'How far it goes on 1 liter, from typical owner reports. Tap Adjust if you know yours.'} />
          </Row>
          {vehicleKey !== 'custom' ? <Pressable onPress={() => setVehOpen(!vehOpen)} hitSlop={8}><Txt variant="small" tone="brand" bold>{vehOpen ? 'Done' : 'Adjust'}</Txt></Pressable> : null}
        </Row>
        {vehOpen || vehicleKey === 'custom' ? (
          <View style={{ gap: 10 }}>
            {vehicleKey === 'custom' ? (
              <Row gap={10}>
                <Field label="Type"><Select value={customCat} onChange={setCustomCat} title="Vehicle type" options={[['motorcycle', 'Motorcycle'], ['tricycle', 'Tricycle'], ['car', 'Car'], ['suv', 'SUV'], ['mpv', 'MPV / AUV'], ['pickup', 'Pickup'], ['van', 'Van'], ['truck', 'Truck'], ['jeepney', 'Jeepney']].map(([value, label]) => ({ value, label }))} /></Field>
                <Field label="Runs on"><Select value={customFuel} onChange={(v) => { setCustomFuel(v); setProduct(v === 'diesel' ? 'DIESEL' : 'RON91'); }} title="Runs on" options={[{ value: 'gasoline', label: 'Gasoline' }, { value: 'diesel', label: 'Diesel' }, { value: 'electric', label: 'Electric' }]} /></Field>
              </Row>
            ) : null}
            <Row gap={10}>
              <Field label={ev ? 'km per kWh' : 'km per liter'}><Input value={kmpl} onChangeText={setKmpl} keyboardType="decimal-pad" placeholder="e.g. 20" /></Field>
              {ev ? <Field label="₱ per kWh"><Input value={elec} onChangeText={setElec} keyboardType="decimal-pad" placeholder="12.50" /></Field>
                : <Field label="Fuel"><Select value={product} onChange={setProduct} title="Fuel" options={['RON91', 'RON95', 'RON97_100', 'DIESEL', 'DIESEL_PLUS'].map((p) => ({ value: p, label: PRODUCT_LABELS[p] }))} /></Field>}
            </Row>
          </View>
        ) : null}

        <Pressable onPress={() => setMoreOpen(!moreOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}>
          <Icon name={moreOpen ? 'up' : 'down'} color={t.muted} />
          <Txt bold tone="muted">More options</Txt><Txt tone="faint">(optional)</Txt>
          {changedCount ? <Badge label={`${changedCount} set`} tone="brand" /> : null}
        </Pressable>
        {moreOpen ? (
          <View style={{ gap: 12 }}>
            <SectionTitle>Trip</SectionTitle>
            <Toggle label="Round trip" sub="Go and come back" value={opts.roundTrip} onChange={(v) => setOpt('roundTrip', v)} />
            {!TWO_WHEEL.includes(current?.category) ? <Toggle label="Aircon on" value={opts.ac} onChange={(v) => setOpt('ac', v)} /> : null}
            <Field label="Leaving at" tip="Used for traffic, weather and number coding. Leave on Now if you're going now."><DepartureField value={opts.depart} onChange={(v) => setOpt('depart', v)} /></Field>
            <Field label="Traffic"><Seg value={opts.traffic} onChange={(v) => setOpt('traffic', v)} items={[['auto', 'Auto'], ['light', 'Light'], ['moderate', 'Moderate'], ['heavy', 'Heavy']]} /></Field>
            <Field label="Driving style"><Seg value={opts.style} onChange={(v) => setOpt('style', v)} items={[['eco', 'Eco'], ['normal', 'Normal'], ['aggressive', 'Aggressive']]} /></Field>
            <SectionTitle>People & load</SectionTitle>
            <Row gap={10}>
              <Field label="People"><Input value={opts.passengers} onChangeText={(v) => setOpt('passengers', v)} keyboardType="number-pad" /></Field>
              <Field label="Cargo kg"><Input value={opts.cargo} onChangeText={(v) => setOpt('cargo', v)} keyboardType="number-pad" placeholder="0" /></Field>
              <Field label="Split by" tip="Shows how much each person pays."><Input value={opts.split} onChangeText={(v) => setOpt('split', v)} keyboardType="number-pad" /></Field>
            </Row>
            <SectionTitle>Other costs</SectionTitle>
            <Row gap={10}>
              <Field label="Toll ₱ (one way)"><Input value={opts.toll} onChangeText={(v) => setOpt('toll', v)} keyboardType="decimal-pad" placeholder="0" /></Field>
              <Field label="Parking ₱"><Input value={opts.parking} onChangeText={(v) => setOpt('parking', v)} keyboardType="decimal-pad" placeholder="0" /></Field>
              <Field label="Other ₱"><Input value={opts.other} onChangeText={(v) => setOpt('other', v)} keyboardType="decimal-pad" placeholder="0" /></Field>
            </Row>
            <SectionTitle>Price & rules</SectionTitle>
            <Field label="DOE price week" tip="Price the trip with a past week to see what it would have cost then."><Select value={opts.week} onChange={(v) => setOpt('week', v)} title="DOE price week" options={[{ value: '', label: 'This week (latest)' }, ...weeks.slice(1).map((w) => ({ value: w.weekStart, label: fmt.week(w.weekStart, w.weekEnd) }))]} /></Field>
            <Row gap={10}>
              <Field label="My price ₱/L" tip="Use what your station charges instead of the DOE price."><Input value={opts.price} onChangeText={(v) => setOpt('price', v)} keyboardType="decimal-pad" placeholder="DOE price" /></Field>
              {CODING_CATS.includes(current?.category) ? <Field label="Plate ends in" tip="For the MMDA number coding check. Only the last digit is used."><Input value={opts.plate} onChangeText={(v) => setOpt('plate', v.replace(/\D/g, '').slice(-1))} keyboardType="number-pad" maxLength={1} placeholder="0–9" /></Field> : null}
            </Row>
            <SectionTitle>Commuters & riders</SectionTitle>
            <Row gap={10}>
              <Field label="Trips per week" tip="Shows your monthly cost."><Input value={opts.trips} onChangeText={(v) => setOpt('trips', v)} keyboardType="number-pad" placeholder="0" /></Field>
              <Field label="Earnings/trip ₱" tip="For riders and drivers: what you keep after fuel and costs."><Input value={opts.earn} onChangeText={(v) => setOpt('earn', v)} keyboardType="decimal-pad" placeholder="0" /></Field>
            </Row>
          </View>
        ) : null}

        <Btn title="Calculate cost" icon="fuel" variant="primary" block loading={busy} onPress={() => calculate(undefined, false)} />
        {recent.length ? <><SectionTitle>Recent trips</SectionTitle><Row wrap gap={6}>{recent.map((x) => <Chip key={x.title} label={x.title} onPress={() => applyParams(x.params)} />)}</Row></> : null}
      </Card>

      {busy && !result ? <Card><Loading text="Finding routes and checking prices, hills and weather…" /></Card> : null}
      {error ? <AlertBox level="danger" text={error} /> : null}
      {R && r ? renderResults() : null}

      <Section title="How far can my budget go?" icon="wallet" desc="Enter a peso amount to see how far your vehicle can go." collapsible defaultOpen={false}>
        <Row gap={8}><View style={{ flex: 1 }}><Input value={budget} onChangeText={setBudget} keyboardType="number-pad" placeholder="₱ 300" /></View><Btn title="Show reach" onPress={async () => {
          const b = Number(budget); if (!(b > 0)) return toast('Enter a budget in pesos', 'error');
          const o = points[0] || location || { lat: MANILA.latitude, lng: MANILA.longitude };
          const v = vehiclePayload();
          const qs = new URLSearchParams({ budget: b, lat: o.lat, lng: o.lng, product, ...(v.presetSlug ? { preset: v.presetSlug } : {}), ...(v.kmpl ? { kmpl: v.kmpl } : {}), ...(v.userVehicleId ? { vehicleId: v.userVehicleId } : {}), ...(v.category ? { category: v.category } : {}), ...(ev && elec ? { price: elec } : !ev && opts.price ? { price: opts.price } : {}) });
          try {
            const res = await api(`/range?${qs}`);
            setRange({ ...res, center: o, radiusM: (res.roundTripKm / 1.3) * 1000 });
            const delta = (res.roundTripKm / 1.3 / 111) * 2.6;
            mapRef.current?.animateToRegion({ latitude: o.lat, longitude: o.lng, latitudeDelta: delta, longitudeDelta: delta });
          } catch (e) { toast(e.message, 'error'); }
        }} /></Row>
        {range ? <Txt>{fmt.peso(range.budget)} buys about {fmt.num(range.liters, 2)} {range.unit}. Your {range.vehicle} can go about <Txt bold>{fmt.num(range.oneWayKm)} km</Txt>, or {fmt.num(range.roundTripKm)} km out and back. The ring on the map shows the reach.</Txt> : null}
      </Section>

      <PlacePicker visible={picker != null} onClose={() => setPicker(null)} bias={points[0] || location} title={picker === 0 ? 'Starting point' : picker === points.length - 1 ? 'Destination' : 'Stop'}
        onPick={(p) => setPoint(picker, p)} />
      {R ? <OpenInSheet visible={sheet === 'open'} onClose={() => setSheet(null)} points={R.points} twoWheeler={R.vehicle.twoWheel && !R.vehicle.electric} gpx={{ name: `${shortLabel(R.points[0])} to ${shortLabel(R.points[R.points.length - 1])}`, geometry: r?.geometry || [] }} /> : null}
      <Sheet visible={sheet === 'more'} onClose={() => setSheet(null)} title="More">
        <Btn block icon="copy" title="Copy summary for group chat" onPress={async () => { await copyText(summaryText()); setSheet(null); toast('Summary copied'); }} />
        <Btn block icon="car" title="Compare other vehicles" onPress={() => setSheet('compare')} />
      </Sheet>
      <Sheet visible={sheet === 'compare'} onClose={() => setSheet(null)} title="Compare vehicles">
        <Txt tone="muted" variant="small">Pick up to 8 vehicles to price this same trip.</Txt>
        <Row wrap gap={6}>{presets.map((p) => <Chip key={p.slug} label={p.name} on={comparePicks.has(p.slug)} onPress={() => setComparePicks((s) => { const n = new Set(s); if (n.has(p.slug)) n.delete(p.slug); else n.add(p.slug); return n; })} />)}</Row>
        <Btn title="Compare" variant="primary" block onPress={() => { prefs.set('compare', [...comparePicks]); setSheet(null); calculate([...comparePicks].slice(0, 8), true); }} />
      </Sheet>
      <Sheet visible={sheet === 'save'} onClose={() => setSheet(null)} title="Save trip">
        <Field label="Name"><Input value={saveName} onChangeText={setSaveName} /></Field>
        <Btn title="Save" variant="primary" block onPress={async () => {
          try { await api('/me/trips', { method: 'POST', body: { name: saveName, originLabel: R.points[0].label, destinationLabel: R.points[R.points.length - 1].label, distanceKm: r.distanceKm, cost: r.totalCost, params: shareParams() } }); setSheet(null); toast('Trip saved to My Garage'); } catch (e) { toast(e.message, 'error'); }
        }} />
      </Sheet>
      <Sheet visible={sheet === 'place'} onClose={() => setSheet(null)} title="Save this place">
        <Txt tone="muted" variant="small">{placeToSave?.label}</Txt>
        <Input value={placeName} onChangeText={setPlaceName} placeholder="Home, Work, School…" />
        <Row wrap gap={6}>{['Home', 'Work', 'School', 'Gym'].map((n) => <Chip key={n} label={n} on={placeName === n} onPress={() => setPlaceName(n)} />)}</Row>
        <Btn title="Save" variant="primary" block onPress={savePlace} />
      </Sheet>
    </Screen>
  );

  // ---------------------------------------------------------- results
  function renderResults() {
    const order = { danger: 0, warn: 1, info: 2 };
    const ws = [...R.warnings].sort((a, b) => order[a.level] - order[b.level]);
    const shown = allWarnings ? ws : ws.slice(0, 2);
    const p = R.price; const u = R.unit;
    const from = shortLabel(R.points[0]); const to = shortLabel(R.points[R.points.length - 1]);
    const amount = `${fmt.num(r.liters, r.liters < 10 ? 2 : 1)} ${u === 'kWh' ? 'kWh of electricity' : `L of ${PRODUCT_LABELS[R.product]}`}`;
    const tabs = [['why', 'Why this cost'], ...(R.costHistory?.length > 2 ? [['history', 'Over the years']] : []), ['elev', 'Hills'], ['weather', 'Weather'], ['compare', 'Compare']];
    const tab = tabs.some(([k]) => k === detailTab) ? detailTab : 'why';
    return (
      <>
        {shown.map((w, i) => <AlertBox key={i} level={w.level} text={w.text} />)}
        {ws.length > 2 ? <Pressable onPress={() => setAllWarnings(!allWarnings)}><Txt variant="small" tone="brand" bold>{allWarnings ? 'Show fewer notes' : `Show ${ws.length - 2} more note${ws.length - 2 > 1 ? 's' : ''}`}</Txt></Pressable> : null}
        {R.routes.length > 1 ? (
          <View style={{ gap: 6 }}>
            <SectionTitle>{R.routes.length} routes found — tap to compare</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {R.routes.map((x, i) => (
                <Pressable key={i} onPress={() => setSelected(i)} style={{ width: 150, padding: 10, borderRadius: 10, borderWidth: 1.5, borderColor: i === selected ? t.brand : t.border, backgroundColor: i === selected ? t.brandSoft : t.surface, gap: 3 }}>
                  <Row wrap gap={4}>{x.tags.map((tg) => <Badge key={tg} label={tg} tone={tg === 'recommended' ? 'brand' : tg === 'fastest' ? 'blue' : 'green'} />)}{x.motorwayIssue ? <Badge label="expressway" tone="red" /> : null}</Row>
                  <Txt variant="h3">{fmt.peso(x.totalCost)}</Txt>
                  <Txt variant="tiny" tone="muted">{x.distanceKm} km · {fmt.dur(x.durationMin)}</Txt>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <Card>
          <SectionTitle>{`${R.points[0].label || 'Start'} → ${R.points[R.points.length - 1].label || 'Destination'}`}</SectionTitle>
          <Row gap={8} align="flex-end" wrap>
            <Txt variant="big" tone="brand" style={{ color: t.brand }}>{fmt.peso(r.totalCost)}</Txt>
            <Txt tone="muted" style={{ marginBottom: 6 }}>{R.extras.total ? 'total trip cost' : `${u === 'kWh' ? 'electricity' : 'fuel'} cost${R.roundTrip ? ', round trip' : ''}`}</Txt>
          </Row>
          <Txt style={{ fontSize: 16, lineHeight: 23 }}>
            Your {R.vehicle.name} from {from} to {to}{R.roundTrip ? ' and back' : ''} ({r.distanceKm} km, about {fmt.dur(r.durationMin)}) will use about {amount} — roughly <Txt bold>{fmt.peso(r.cost)}</Txt>.
            {R.extras.total ? <Txt> With {[R.extras.toll && 'toll', R.extras.parking && 'parking', R.extras.other && 'other costs'].filter(Boolean).join(' and ')}, the total is <Txt bold>{fmt.peso(r.totalCost)}</Txt>.</Txt> : null}
            {R.splitWays > 1 ? <Txt> That’s <Txt bold>{fmt.peso(r.perPerson)}</Txt> each for {R.splitWays} people.</Txt> : null}
          </Txt>
          <Row wrap gap={0}>
            <Txt variant="small" tone="muted">Price: {fmt.peso(p.price)}/{u} · </Txt>
            {p.electricity || p.custom ? <Txt variant="small" tone="muted">{p.basis}</Txt> : <><Txt variant="small" tone="muted">{p.area && p.area !== 'ALL' ? p.area : p.region} </Txt><Term k="common" label="common price" /><Txt variant="small" tone="muted"> · DOE week of {fmt.week(p.weekStart, p.weekEnd)}{p.historical ? ' (past week)' : ''}</Txt></>}
          </Row>
          <StatGrid>
            <Stat k={u === 'kWh' ? 'Energy' : 'Fuel'} v={`${fmt.num(r.liters, 2)} ${u}`} />
            <Stat k="Distance" v={`${r.distanceKm} km`} />
            <Stat k="Time" v={fmt.dur(r.durationMin)} s={`${R.conditions.traffic} traffic`} />
            {R.splitWays > 1 ? <Stat k="Each person" v={fmt.peso(r.perPerson)} /> : r.monthly ? <Stat k="Per month" v={fmt.peso(r.monthly, 0)} s={`${R.tripsPerWeek} trips/week`} /> : <Stat k="CO₂" v={`${fmt.num(r.co2Kg)} kg`} />}
          </StatGrid>
          {R.extras.total ? (
            <View style={{ gap: 3 }}>
              <Row between><Txt variant="small">{u === 'kWh' ? 'Electricity' : 'Fuel'}</Txt><Txt variant="small">{fmt.peso(r.cost)}</Txt></Row>
              {R.extras.toll ? <Row between><Txt variant="small">Toll{R.roundTrip ? ' (both ways)' : ''}</Txt><Txt variant="small">{fmt.peso(R.extras.toll)}</Txt></Row> : null}
              {R.extras.parking ? <Row between><Txt variant="small">Parking</Txt><Txt variant="small">{fmt.peso(R.extras.parking)}</Txt></Row> : null}
              {R.extras.other ? <Row between><Txt variant="small">Other</Txt><Txt variant="small">{fmt.peso(R.extras.other)}</Txt></Row> : null}
              <Row between><Txt variant="small" bold>Total</Txt><Txt variant="small" bold>{fmt.peso(r.totalCost)}</Txt></Row>
            </View>
          ) : null}
          {r.net != null ? <AlertBox level={r.net >= 0 ? 'ok' : 'warn'} text={`You keep ${fmt.peso(r.net)} of the ₱${R.earningsPerTrip} earnings (fuel and costs take ${r.fuelShare}%).`} /> : null}
          <Row wrap gap={6}>
            <Btn small icon="external" title="Open in…" variant="primary" onPress={() => setSheet('open')} />
            <Btn small icon="share" title="Share" onPress={() => shareText(summaryText(), 'TipidLitro trip')} />
            <Btn small icon="save" title="Save" onPress={async () => { if (!(await requireAuth())) return; setSaveName(`${from} → ${to}`); setSheet('save'); }} />
            <Btn small title="More" onPress={() => setSheet('more')} />
          </Row>
        </Card>

        <Card>
          <Tabs items={tabs} value={tab} onChange={(k) => { setDetailTab(k); prefs.set('detailTab', k); }} />
          {tab === 'why' ? renderWhy() : tab === 'history' ? renderHistory() : tab === 'elev' ? renderHills() : tab === 'weather' ? renderWeather() : renderCompare()}
        </Card>
      </>
    );
  }

  function renderWhy() {
    const u = R.unit;
    return (
      <View style={{ gap: 8 }}>
        <Txt variant="small" tone="muted">Real driving uses more (or less) fuel than the brochure number. Here is every adjustment we made:</Txt>
        <FactorRow label="Typical economy" detail={`${R.vehicle.name}: ${R.vehicle.kmplCity} km/${u} city, ${R.vehicle.kmplHighway} highway — blended for your ${r.avgSpeed} km/h average`} value={`${fmt.num(r.baseKmpl)} km/${u}`} />
        {r.factors.map((f) => <FactorRow key={f.key} label={f.label} detail={f.detail} value={f.factor != null ? `${f.factor < 1 ? '−' : '+'}${Math.abs(Math.round((1 - f.factor) * 1000) / 10)}% km/${u}` : `${f.liters > 0 ? '+' : '−'}${fmt.num(Math.abs(f.liters), 2)} ${u}`} />)}
        <FactorRow label="Result" bold detail={`Simple math (distance ÷ ${fmt.num(R.vehicle.kmplStated)} km/${u}) would say ${fmt.num(r.simple.liters, 2)} ${u} = ${fmt.peso(r.simple.cost)}.`} value={`${fmt.num(r.liters, 2)} ${u}`} />
        <StatGrid>
          <Stat k="Cost per km" v={fmt.peso(r.costPerKm)} />
          <Stat k="CO₂" v={`${fmt.num(r.co2Kg)} kg`} s={`≈ ${fmt.num(r.co2Kg / 21, 1)} tree-years`} />
          <Stat k="Without traffic" v={fmt.dur(r.freeFlowMin)} />
          {r.roads.length ? <Stat k="Main roads" v={r.roads.slice(0, 3).join(', ')} /> : null}
        </StatGrid>
      </View>
    );
  }
  function renderHistory() {
    const all = R.costHistory;
    const days = { '1y': 365, '3y': 365 * 3, all: 1e6 }[costRange];
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = all.filter((x) => x.week >= cutoff);
    const now = all[all.length - 1];
    const yearAgo = [...all].reverse().find((x) => x.week <= new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10));
    const lo = rows.reduce((a, b) => (b.cost < a.cost ? b : a), rows[0]); const hi = rows.reduce((a, b) => (b.cost > a.cost ? b : a), rows[0]);
    return (
      <View style={{ gap: 8 }}>
        <Row gap={6}>{[['1y', '1 year'], ['3y', '3 years'], ['all', 'All']].map(([k, l]) => <Chip key={k} label={l} on={costRange === k} onPress={() => setCostRange(k)} />)}</Row>
        {yearAgo ? <Txt variant="small" tone="muted">A year ago this trip cost <Txt variant="small" bold>{fmt.peso(yearAgo.cost)}</Txt>; now {fmt.peso(now.cost)} ({fmt.signedPeso(now.cost - yearAgo.cost)}).</Txt> : null}
        {rows.length ? <Txt variant="small" tone="muted">Cheapest week: {fmt.peso(lo.cost)} ({fmt.date(lo.week)}). Priciest: {fmt.peso(hi.cost)} ({fmt.date(hi.week)}).</Txt> : null}
        <LineChart labels={rows.map((x) => fmt.date(x.week, { shortYear: true }))} series={[{ label: 'Trip cost', color: t.brand, data: rows.map((x) => x.cost), fill: true }]} valueFormat={(v) => fmt.peso(v)} yFormat={(v) => `₱${Math.round(v)}`} />
        <Txt variant="tiny" tone="faint">{fmt.num(r.liters, 2)} L × each week’s DOE {R.costHistoryBasis || 'common price'} · {all.length} weeks since {fmt.date(all[0].week)}. Toll and parking not included.</Txt>
      </View>
    );
  }
  function renderHills() {
    const prof = r.elevationProfile;
    return (
      <View style={{ gap: 8 }}>
        <Txt variant="small" tone="muted">Climbing {r.climb.climbM} m and descending {r.climb.descentM} m along the way. Uphill costs extra fuel; some comes back going down.</Txt>
        {prof.length ? <LineChart labels={prof.map((e) => `${e[0].toFixed(0)} km`)} series={[{ label: 'Elevation (m)', color: t.brand, data: prof.map((e) => e[1]), fill: true }]} yFormat={(v) => `${Math.round(v)}m`} /> : null}
      </View>
    );
  }
  function renderWeather() {
    const wx = R.conditions.weather;
    return (
      <View style={{ gap: 8 }}>
        <Txt variant="small" tone="muted">Forecast for your departure at {R.conditions.departLocal}. Rain and strong headwinds increase fuel use slightly.</Txt>
        {wx ? <StatGrid>{['Start', 'Midway', 'End'].map((label, i) => <Stat key={label} k={label} v={wx[i].text} s={`${Math.round(wx[i].tempC)}°C · ${wx[i].precipProb ?? 0}% rain · wind ${Math.round(wx[i].windKmh)} km/h`} />)}</StatGrid> : <Txt tone="muted">Weather unavailable.</Txt>}
      </View>
    );
  }
  function renderCompare() {
    if (!R.comparison?.length) {
      return (
        <View style={{ gap: 8 }}>
          <Txt variant="small" tone="muted">See what this same trip costs with other vehicles — motorcycle vs car vs EV vs jeepney.</Txt>
          <Btn title="Choose vehicles to compare" icon="car" variant="primary" onPress={() => setSheet('compare')} />
        </View>
      );
    }
    return (
      <View style={{ gap: 8 }}>
        <BarChart labels={R.comparison.map((c) => c.name.split(' ').slice(0, 2).join(' '))} series={[{ label: 'Cost', color: t.brand, data: R.comparison.map((c) => c.cost) }]} valueFormat={(v) => fmt.peso(v)} yFormat={(v) => `₱${Math.round(v)}`} height={180} />
        {R.comparison.map((c, i) => (
          <Row key={c.slug} between style={{ borderBottomWidth: 1, borderColor: t.border, paddingBottom: 6 }}>
            <Txt variant="small" style={{ flex: 1 }}>{i === 0 ? '🏆 ' : ''}{c.name}</Txt>
            <Txt variant="small" tone="muted">{fmt.num(c.liters, 2)} {c.unit} · </Txt><Txt variant="small" bold>{fmt.peso(c.cost)}</Txt>
          </Row>
        ))}
        <Btn small title="Change vehicles" onPress={() => setSheet('compare')} />
      </View>
    );
  }
}

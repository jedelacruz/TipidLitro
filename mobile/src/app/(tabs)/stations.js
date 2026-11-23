// Nearby stations (port of public/js/views/stations.js): OpenStreetMap stations with DOE brand price
// ranges, community reports, and the real cost of driving to each one (fill-up + detour fuel).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { OpenInSheet, PlacePicker } from '../../components/shared';
import {
  AlertBox, Badge, Btn, Card, Field, Icon, Input, Loading, PageHeader, Row, Screen, Seg, Select, Sheet, Term, Txt, toast,
} from '../../components/ui';
import { api, prefs } from '../../lib/api';
import { useApp } from '../../lib/app-context';
import { fmt, FUEL_PRODUCTS, PRODUCT_LABELS } from '../../lib/format';
import { brandColor, useTheme } from '../../lib/theme';

const CUBAO = { lat: 14.6199, lng: 121.0509, label: 'Cubao, Quezon City' };
const RADII = [[1500, '1.5 km'], [3000, '3 km'], [5000, '5 km'], [10000, '10 km']];
const deltaFor = (radius) => (radius / 1000 / 111) * 2.8;

export default function Stations() {
  const t = useTheme();
  const { presets, location, locate, requireAuth } = useApp();
  const mapRef = useRef(null);
  const [center, setCenter] = useState(location || CUBAO);
  const [product, setProduct] = useState('RON91');
  const [radius, setRadius] = useState(3000);
  const [liters, setLiters] = useState('30');
  const [kmpl, setKmpl] = useState('12');
  const [twoWheel, setTwoWheel] = useState(false);
  const [sort, setSort] = useState('value');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [openIn, setOpenIn] = useState(null);
  const [report, setReport] = useState(null);
  const [tracks, setTracks] = useState(true);

  // Defaults follow the vehicle chosen in the planner.
  useEffect(() => {
    (async () => {
      const key = await prefs.get('vehicleKey', 'preset:honda-click-125');
      const p = presets.find((x) => `preset:${x.slug}` === key);
      const two = p ? ['motorcycle', 'tricycle'].includes(p.category) : true;
      setTwoWheel(two);
      setLiters(two ? '4' : '30');
      if (p) { setKmpl(String(Math.round(((p.kmpl_city + p.kmpl_highway) / 2) * 10) / 10)); if (p.product !== 'ELECTRICITY') setProduct(p.product); } else setKmpl('45');
    })();
  }, [presets]);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const d = await api(`/stations?lat=${center.lat}&lng=${center.lng}&radius=${radius}&product=${product}`);
      setData(d); setTracks(true); setTimeout(() => setTracks(false), 800);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }, [center, radius, product]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { mapRef.current?.animateToRegion({ latitude: center.lat, longitude: center.lng, latitudeDelta: deltaFor(radius), longitudeDelta: deltaFor(radius) }); }, [center, radius]);

  const rows = useMemo(() => {
    if (!data) return [];
    const fallback = data.areaPrice?.price ?? null;
    const L = Number(liters) || 0; const k = Number(kmpl) || 1;
    return data.stations.map((s) => {
      const price = s.bestPrice ?? fallback;
      const detourKm = s.distanceKm * 2 * 1.3;
      const detourCost = price != null ? (detourKm / k) * price : null;
      return { ...s, price, basis: s.community ? 'community' : s.doeMid != null ? 'doe' : 'area', detourKm, detourCost, total: price != null ? L * price + detourCost : null };
    });
  }, [data, liters, kmpl]);
  const sorted = useMemo(() => [...rows].sort((a, b) => (sort === 'distance' ? a.distanceKm - b.distanceKm : (a.total ?? 1e9) - (b.total ?? 1e9))), [rows, sort]);
  const nearest = rows[0];
  const best = sorted.find((r) => r.total != null);
  const sel = rows.find((r) => r.osmId === selected);

  const useMine = async () => { try { const loc = await locate(); setCenter({ ...loc, label: 'Your location' }); } catch (e) { toast(e.message, 'error'); } };
  const focus = (s) => { setSelected(s.osmId); mapRef.current?.animateToRegion({ latitude: s.lat, longitude: s.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }); };
  const startReport = async (s) => { if (!(await requireAuth())) return; setReport({ station: s, product, price: '', note: '' }); };
  const submitReport = async () => {
    try {
      await api(`/stations/${report.station.osmId}/report`, { method: 'POST', body: { product: report.product, price: Number(report.price), note: report.note } });
      setReport(null); toast('Thanks! Price reported.'); load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const a = data?.areaPrice;
  return (
    <Screen onRefresh={load} refreshing={false}>
      <PageHeader title="Nearby stations" help="stations" subtitle="The station that is really cheapest: the fill-up plus the fuel to get there and back." />
      <Row gap={8}>
        <Btn small variant="primary" icon="locate" title="Use my location" onPress={useMine} />
        <Pressable onPress={() => setSearch(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: t.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, backgroundColor: t.surface }}>
          <Icon name="search" size={16} color={t.faint} /><Txt variant="small" tone="faint" numberOfLines={1} style={{ flex: 1 }}>{center.label || 'Search an area (e.g. Makati)'}</Txt>
        </Pressable>
      </Row>

      <View style={{ height: 280, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: t.border }}>
        <MapView ref={mapRef} style={{ flex: 1 }} userInterfaceStyle={t.dark ? 'dark' : 'light'} showsUserLocation={Boolean(location)}
          initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: deltaFor(radius), longitudeDelta: deltaFor(radius) }}
          onLongPress={(e) => { const c = e.nativeEvent.coordinate; setCenter({ lat: c.latitude, lng: c.longitude, label: 'Pinned spot' }); }}>
          <Circle center={{ latitude: center.lat, longitude: center.lng }} radius={radius} strokeColor={t.brand} fillColor={`${t.brand}14`} strokeWidth={1.5} />
          <Marker coordinate={{ latitude: center.lat, longitude: center.lng }} title="Search center" pinColor="blue" />
          {rows.map((s) => (
            <Marker key={s.osmId} coordinate={{ latitude: s.lat, longitude: s.lng }} onPress={() => setSelected(s.osmId)} tracksViewChanges={tracks || s.osmId === selected} title={s.name} description={`${s.brand} · ${fmt.num(s.distanceKm, 2)} km`}>
              <View style={{ backgroundColor: brandColor(s.brand), borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, borderWidth: s.osmId === selected ? 2 : 1, borderColor: s.osmId === selected ? t.text : '#fff' }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{s.price != null ? `₱${s.price.toFixed(2)}` : s.brand.slice(0, 8)}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
        <View pointerEvents="none" style={{ position: 'absolute', left: 8, bottom: 8, backgroundColor: t.surface, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: t.border }}>
          <Txt variant="tiny" tone="muted">Long-press the map to search there</Txt>
        </View>
      </View>

      <Card>
        <Row gap={10}>
          <Field label="Fuel"><Select value={product} onChange={setProduct} title="Fuel" options={FUEL_PRODUCTS.map((p) => ({ value: p, label: PRODUCT_LABELS[p] }))} /></Field>
          <Field label="Radius"><Select value={radius} onChange={(v) => setRadius(Number(v))} title="Search radius" options={RADII.map(([value, label]) => ({ value, label }))} /></Field>
        </Row>
        <Pressable onPress={() => setFillOpen(!fillOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name={fillOpen ? 'up' : 'down'} color={t.muted} /><Txt bold tone="muted">My fill-up:</Txt><Txt tone="faint">{liters} L · {kmpl} km/L</Txt>
        </Pressable>
        {fillOpen ? (
          <Row gap={10}>
            <Field label="Liters to buy"><Input value={liters} onChangeText={setLiters} keyboardType="decimal-pad" /></Field>
            <Field label="Your km/L"><Input value={kmpl} onChangeText={setKmpl} keyboardType="decimal-pad" /></Field>
          </Row>
        ) : null}
        <Row between>
          <Seg value={sort} onChange={setSort} items={[['value', 'Best value'], ['distance', 'Nearest']]} />
          <Btn small icon="refresh" title="Refresh" onPress={load} loading={busy} />
        </Row>
      </Card>

      {error ? <AlertBox level="danger" text={error} action={<Btn small title="Retry" onPress={load} />} /> : null}
      {busy && !data ? <Card><Loading text="Finding stations (OpenStreetMap) and DOE brand prices…" /></Card> : null}
      {data ? (
        <Card tone="flat" style={{ padding: 12, gap: 4 }}>
          <Txt variant="small" bold>{data.place?.label || 'Selected area'}</Txt>
          <Txt variant="small" tone="muted">{data.stations.length} stations · {data.region}{a ? ` · ${PRODUCT_LABELS[data.product]} ${fmt.peso(a.price)} (${a.basis})` : ''}</Txt>
          <Txt variant="tiny" tone="faint">{data.brandBasis ? `Station prices use ${data.brandBasis}.` : 'DOE publishes brand-level ranges for NCR cities only; elsewhere the area price is shown.'}</Txt>
          {data.stationSource === 'stored' ? <Txt variant="tiny" tone="faint">Live OpenStreetMap data is slow right now — showing stations saved earlier.</Txt> : null}
          <Row wrap gap={10}><Term k="trueCost" /><Term k="brandRange" /><Term k="community" /></Row>
        </Card>
      ) : null}

      {data && !rows.length ? <Card><Txt tone="muted">No fuel stations mapped within this radius. Try a larger radius.</Txt></Card> : null}
      {sel ? <Txt variant="tiny" tone="faint">Selected on the map: {sel.name}</Txt> : null}
      {sorted.map((s) => {
        const save = nearest?.total != null && s.total != null ? nearest.total - s.total : null;
        const on = s.osmId === selected;
        return (
          <Card key={s.osmId} onPress={() => focus(s)} style={on ? { borderColor: t.brand, borderWidth: 2 } : null}>
            <Row between align="flex-start">
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Txt bold numberOfLines={1}>{s.name}</Txt>
                <Row gap={5}><View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: brandColor(s.brand) }} /><Txt variant="small" tone="muted">{s.brand} · {fmt.num(s.distanceKm, 2)} km away</Txt></Row>
                {s.openingHours ? <Txt variant="tiny" tone="faint" numberOfLines={1}>{s.openingHours}</Txt> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                <Txt variant="h2">{s.price != null ? fmt.peso(s.price) : '—'}</Txt>
                <Badge tone={s.basis === 'community' ? 'blue' : s.basis === 'doe' ? 'green' : 'gray'} label={s.basis === 'community' ? `reported ${fmt.ago(s.community.reportedAt)}` : s.basis === 'doe' ? 'DOE brand range' : 'area avg'} />
              </View>
            </Row>
            <Row between>
              <Txt variant="small" tone="muted">{s.total != null ? <>{liters} L + detour {fmt.peso(s.detourCost)} = <Txt variant="small" bold>{fmt.peso(s.total)}</Txt></> : ''}</Txt>
              {s === best ? <Badge tone="green" label="best value" /> : save != null && Math.abs(save) >= 1 && s !== nearest ? <Txt variant="small" bold tone={save > 0 ? 'down' : 'up'}>{save > 0 ? `saves ${fmt.peso(save)}` : `costs ${fmt.peso(-save)} more`}</Txt> : null}
            </Row>
            {s.community?.note ? <Txt variant="tiny" tone="muted">“{s.community.note}”</Txt> : null}
            {s.doeRange && s.basis !== 'doe' ? <Txt variant="tiny" tone="faint">DOE {s.brand} range: {fmt.peso(s.doeRange.min)}–{fmt.peso(s.doeRange.max)}</Txt> : null}
            <Row gap={6}>
              <Btn small icon="external" title="Directions" onPress={() => setOpenIn([{ ...center, label: 'You' }, { lat: s.lat, lng: s.lng, label: s.name }])} />
              <Btn small icon="plus" title="Report price" onPress={() => startReport(s)} />
            </Row>
          </Card>
        );
      })}

      <PlacePicker visible={search} onClose={() => setSearch(false)} title="Search an area" bias={center} onPick={(p) => setCenter(p)} />
      <OpenInSheet visible={Boolean(openIn)} onClose={() => setOpenIn(null)} points={openIn || []} twoWheeler={twoWheel} />
      <Sheet visible={Boolean(report)} onClose={() => setReport(null)} title={report ? `Report a price at ${report.station.name}` : ''}>
        {report ? (
          <>
            <Row gap={10}>
              <Field label="Fuel"><Select value={report.product} onChange={(v) => setReport({ ...report, product: v })} title="Fuel" options={FUEL_PRODUCTS.map((p) => ({ value: p, label: PRODUCT_LABELS[p] }))} /></Field>
              <Field label="₱ per liter"><Input value={report.price} onChangeText={(v) => setReport({ ...report, price: v })} keyboardType="decimal-pad" placeholder="e.g. 88.90" /></Field>
            </Row>
            <Field label="Note"><Input value={report.note} onChangeText={(v) => setReport({ ...report, note: v })} maxLength={200} placeholder='Optional (e.g. "promo for riders")' /></Field>
            <Txt variant="small" tone="muted">Reports are shown to everyone for 14 days next to the DOE range.</Txt>
            <Btn title="Submit" variant="primary" block onPress={submitReport} />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

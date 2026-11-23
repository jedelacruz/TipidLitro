// Feature components used on several screens: place picker, price strip + "new from DOE"
// banner, sign-in sheet, "Open in…" navigation sheet, departure time picker.
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { api, prefs } from '../lib/api';
import { useApp } from '../lib/app-context';
import { fmt } from '../lib/format';
import { coordinatesText, copyText, navApps, openUrl, shareGpx } from '../lib/nav';
import { useTheme } from '../lib/theme';
import { AlertBox, Btn, Chip, Icon, Input, Row, SectionTitle, Sheet, Txt } from './ui';

/** Search a place (Photon via the server), use GPS, or pick a saved place. onPick({ lat, lng, label }) */
export function PlacePicker({ visible, onClose, onPick, title = 'Choose a place', bias }) {
  const t = useTheme();
  const { locate } = useApp();
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [places, setPlaces] = useState([]);
  const timer = useRef(null);
  useEffect(() => { if (visible) { setQ(''); setItems([]); setError(null); prefs.get('places', []).then(setPlaces); } }, [visible]);
  const search = (text) => {
    setQ(text);
    clearTimeout(timer.current);
    if (text.trim().length < 2) { setItems([]); return; }
    timer.current = setTimeout(async () => {
      setBusy(true); setError(null);
      try { setItems(await api(`/geocode/search?q=${encodeURIComponent(text.trim())}${bias ? `&lat=${bias.lat}&lng=${bias.lng}` : ''}`)); } catch (e) { setError(e.message); }
      setBusy(false);
    }, 300);
  };
  const pick = (p) => { onPick(p); onClose(); };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Input autoFocus value={q} onChangeText={search} placeholder="Search a place, e.g. SM North EDSA" returnKeyType="search" />
      <Pressable onPress={async () => { try { const loc = await locate(); const r = await api(`/geocode/reverse?lat=${loc.lat}&lng=${loc.lng}`).catch(() => null); pick({ ...loc, label: r?.label || 'My location' }); } catch (e) { setError(e.message); } }}
        style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10 }}>
        <Icon name="locate" color={t.brandStrong} /><Txt bold tone="brand">Use my current location</Txt>
      </Pressable>
      {error ? <AlertBox level="danger" text={error} /> : null}
      {busy ? <ActivityIndicator color={t.brand} /> : null}
      {items.map((p, i) => (
        <Pressable key={i} onPress={() => pick({ lat: p.lat, lng: p.lng, label: p.label })} style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: t.border }}>
          <Txt bold>{p.name || p.label}</Txt><Txt variant="small" tone="muted">{p.label}</Txt>
        </Pressable>
      ))}
      {!q && places.length ? <><SectionTitle>Saved places</SectionTitle><Row wrap gap={6}>{places.map((pl) => <Chip key={pl.name} label={`★ ${pl.name}`} onPress={() => pick({ lat: pl.lat, lng: pl.lng, label: pl.label })} />)}</Row></> : null}
    </Sheet>
  );
}

/** Compact ticker with this week's NCR prices and the latest adjustment (the web's price bar). */
export function PriceStrip() {
  const t = useTheme();
  const { status } = useApp();
  const [sum, setSum] = useState(null);
  useEffect(() => { api('/prices/summary').then(setSum).catch(() => {}); }, [status?.doe?.latestNcrWeek]);
  const ncr = sum?.regions?.find((r) => r.region === 'NCR');
  if (!ncr?.weekStart) return null;
  const adj = sum.latestAdjustment;
  const pick = (k) => ncr.products.find((p) => p.product === k);
  return (
    <Pressable onPress={() => router.navigate('/prices')} style={{ backgroundColor: t.surface2, borderRadius: 12, borderWidth: 1, borderColor: t.border, padding: 10, gap: 4 }}>
      <Row between><Row gap={6}><Icon name="fuel" size={15} color={t.brandStrong} /><Txt variant="small" bold>NCR · week of {fmt.week(ncr.weekStart, ncr.weekEnd)}</Txt></Row>{sum._offline ? <Txt variant="tiny" tone="amber" bold>OFFLINE</Txt> : <Icon name="right" size={16} color={t.faint} />}</Row>
      <Row wrap gap={12}>
        {['RON91', 'RON95', 'DIESEL'].map((k) => pick(k) ? <Txt key={k} variant="small" tone="muted">{k === 'DIESEL' ? 'Diesel' : k} <Txt variant="small" bold>{fmt.peso(pick(k).common)}</Txt></Txt> : null)}
        {adj ? <Txt variant="small" tone="muted">Adj {fmt.date(adj.weekStart, { year: false })}: <Txt variant="small" bold tone={adj.GASOLINE > 0 ? 'up' : 'down'}>Gas {fmt.signedPeso(adj.GASOLINE)}</Txt> · <Txt variant="small" bold tone={adj.DIESEL > 0 ? 'up' : 'down'}>Diesel {fmt.signedPeso(adj.DIESEL)}</Txt></Txt> : null}
      </Row>
    </Pressable>
  );
}

/** "New from DOE" banner for returning users (same rule as the web). */
export function UpdateBanner() {
  const { status } = useApp();
  const [show, setShow] = useState(null);
  useEffect(() => {
    if (!status?.doe) return;
    const key = `${status.doe.latestNcrWeek || ''}|${status.doe.latestAdjustment || ''}`;
    prefs.get('seenData', null).then((seen) => {
      if (seen === null) { prefs.set('seenData', key); return; }
      if (seen !== key) setShow(key);
    });
  }, [status]);
  if (!show) return null;
  const dismiss = () => { prefs.set('seenData', show); setShow(null); };
  return (
    <AlertBox level="ok" text={`New from DOE: prices for the week of ${fmt.date(status.doe.latestNcrWeek)}${status.doe.latestAdjustment ? ` and the ${fmt.date(status.doe.latestAdjustment, { year: false })} adjustment` : ''}.`}>
      <Row gap={6}><Btn small variant="primary" title="See prices" onPress={() => { dismiss(); router.navigate('/prices'); }} /><Btn small variant="ghost" title="Dismiss" onPress={dismiss} /></Row>
    </AlertBox>
  );
}

/** Sign-in / register sheet, opened by requireAuth() from anywhere. */
export function AuthSheet() {
  const { authOpen, closeAuth, signIn } = useApp();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  useEffect(() => { if (authOpen) { setError(null); setPassword(''); } }, [authOpen]);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await signIn({ mode, name, email, password }); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Sheet visible={authOpen} onClose={closeAuth} title={mode === 'login' ? 'Sign in to TipidLitro' : 'Create an account'}>
      <Txt tone="muted" variant="small">The same account works on the website and the app. It lets you save vehicles, trips, fill-ups, a budget and price alerts.</Txt>
      {mode === 'register' ? <Input value={name} onChangeText={setName} placeholder="Your name" autoComplete="name" /> : null}
      <Input value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Input value={password} onChangeText={setPassword} placeholder="Password (at least 8 characters)" secureTextEntry autoComplete={mode === 'login' ? 'password' : 'new-password'} />
      {error ? <AlertBox level="danger" text={error} /> : null}
      <Btn title="Continue" variant="primary" block loading={busy} onPress={submit} />
      <Btn title={mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'} variant="ghost" block onPress={() => setMode(mode === 'login' ? 'register' : 'login')} />
    </Sheet>
  );
}

/** Navigation apps + copy coordinates + GPX. */
export function OpenInSheet({ visible, onClose, points, twoWheeler, gpx }) {
  const t = useTheme();
  if (!points?.length) return null;
  const apps = navApps(points, { twoWheeler });
  return (
    <Sheet visible={visible} onClose={onClose} title="Open in…">
      {apps.map((a) => (
        <Pressable key={a.key} onPress={() => { onClose(); prefs.set('navApp', a.key); openUrl(a.url); }} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: a.color, alignItems: 'center', justifyContent: 'center' }}><Txt bold style={{ color: '#fff' }}>{a.short || ''}</Txt></View>
          <View style={{ flex: 1 }}><Txt bold>{a.name}</Txt><Txt variant="small" tone="muted">{a.note}</Txt></View>
          <Icon name="external" color={t.faint} />
        </Pressable>
      ))}
      <Pressable onPress={async () => { await copyText(coordinatesText(points)); onClose(); }} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#64748b', alignItems: 'center', justifyContent: 'center' }}><Icon name="copy" color="#fff" /></View>
        <View style={{ flex: 1 }}><Txt bold>Copy coordinates</Txt><Txt variant="small" tone="muted">Paste into any app or chat</Txt></View>
      </Pressable>
      {gpx ? (
        <Pressable onPress={async () => { onClose(); await shareGpx(gpx.name, points, gpx.geometry); }} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: '#0f766e', alignItems: 'center', justifyContent: 'center' }}><Txt variant="tiny" bold style={{ color: '#fff' }}>GPX</Txt></View>
          <View style={{ flex: 1 }}><Txt bold>Share GPX file</Txt><Txt variant="small" tone="muted">OsmAnd, Organic Maps, Garmin…</Txt></View>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

/** Departure time: "Now" or a picked date/time. value: Date | null */
export function DepartureField({ value, onChange }) {
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState(new Date());
  const open = () => {
    const start = value || new Date();
    if (Platform.OS === 'android') {
      // Android has separate date and time dialogs.
      DateTimePickerAndroid.open({
        value: start, mode: 'date',
        onValueChange: (_e, d) => {
          DateTimePickerAndroid.open({ value: d, mode: 'time', is24Hour: false, onValueChange: (_e2, d2) => onChange(d2) });
        },
      });
    } else { setDraft(start); setIosOpen(true); }
  };
  const label = value ? `${fmt.date(new Date(value.getTime() + 8 * 3600e3).toISOString(), { weekday: 'short', year: false })}, ${value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Now';
  return (
    <>
      <Row gap={6}>
        <Chip label="Now" on={!value} onPress={() => onChange(null)} />
        <Chip label={value ? label : 'Pick a time'} on={Boolean(value)} onPress={open} />
      </Row>
      {Platform.OS === 'ios' ? (
        <Sheet visible={iosOpen} onClose={() => setIosOpen(false)} title="Leaving at" scroll={false}>
          <DateTimePicker value={draft} mode="datetime" display="spinner" onValueChange={(_e, d) => setDraft(d)} />
          <Btn title="Use this time" variant="primary" block onPress={() => { onChange(draft); setIosOpen(false); }} />
        </Sheet>
      ) : null}
    </>
  );
}

/** A calendar date as 'YYYY-MM-DD' (fuel log). */
export function DateField({ value, onChange }) {
  const t = useTheme();
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState(new Date());
  const asDate = () => (value ? new Date(`${value}T12:00:00`) : new Date());
  const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const open = () => {
    if (Platform.OS === 'android') DateTimePickerAndroid.open({ value: asDate(), mode: 'date', maximumDate: new Date(), onValueChange: (_e, d) => onChange(toIso(d)) });
    else { setDraft(asDate()); setIosOpen(true); }
  };
  return (
    <>
      <Pressable onPress={open} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 9, paddingHorizontal: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface }}>
        <Txt>{value ? fmt.date(value) : 'Today'}</Txt><Icon name="calendar" color={t.faint} />
      </Pressable>
      {Platform.OS === 'ios' ? (
        <Sheet visible={iosOpen} onClose={() => setIosOpen(false)} title="Date" scroll={false}>
          <DateTimePicker value={draft} mode="date" display="inline" maximumDate={new Date()} onValueChange={(_e, d) => setDraft(d)} />
          <Btn title="Use this date" variant="primary" block onPress={() => { onChange(toIso(draft)); setIosOpen(false); }} />
        </Sheet>
      ) : null}
    </>
  );
}

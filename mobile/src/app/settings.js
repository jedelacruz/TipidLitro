// Settings: which TipidLitro server to use (with a connection test), theme, account,
// phone notifications, offline data, and app info.
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { AlertBox, Btn, Card, Field, Input, PageHeader, Row, Screen, Section, Seg, Toggle, Txt, toast } from '../components/ui';
import { clearCache, guessServer, prefs, testServer } from '../lib/api';
import { enableNotifications, useApp } from '../lib/app-context';
import { fmt } from '../lib/format';

export default function Settings() {
  const { themePref, setTheme, user, requireAuth, signOut, changeServer, serverUrl, status, connectionError, refreshStatus } = useApp();
  const [url, setUrl] = useState(serverUrl());
  const [test, setTest] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(false);
  useEffect(() => { prefs.get('phoneNotifs', false).then(setPhone); }, []);

  const runTest = async () => {
    setBusy(true); setTest(null);
    try {
      const s = await testServer(url);
      setTest({ ok: true, text: `Connected. ${s.hasPrices ? `Latest NCR prices: week of ${fmt.date(s.doe?.latestNcrWeek)}.` : 'No prices downloaded yet.'} Database: ${s.database}.` });
    } catch (e) { setTest({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const save = async (value) => {
    setBusy(true);
    const s = await changeServer(value);
    setUrl(s); setBusy(false); setTest(null);
    const st = await refreshStatus();
    toast(st && !st._offline ? 'Connected to the server' : 'Saved — but the server is not answering yet', st && !st._offline ? 'info' : 'error');
  };

  return (
    <Screen>
      <PageHeader back title="Settings" />
      <Section title="Server" icon="server" desc="The app reads everything from your TipidLitro server — the same one the website runs on.">
        {connectionError ? <AlertBox level="warn" text={`Not connected: ${connectionError === 'offline' ? 'showing saved data.' : connectionError}`} /> : status ? <AlertBox level="ok" text={`Connected to ${serverUrl()}`} /> : null}
        <Field label="Server address" tip="Your computer's Wi-Fi IP address and port, for example http://192.168.1.23:3000. Run ipconfig (Windows) or ifconfig (Mac) on the computer to find it.">
          <Input value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.23:3000" />
        </Field>
        <Row wrap gap={6}>
          <Btn small title="Test" icon="check" loading={busy && !test} onPress={runTest} />
          <Btn small variant="primary" title="Save" onPress={() => save(url)} />
          <Btn small variant="ghost" title="Use automatic" onPress={() => save('')} />
        </Row>
        {test ? <AlertBox level={test.ok ? 'ok' : 'danger'} text={test.text} /> : null}
        <Txt variant="tiny" tone="faint">Automatic address: {guessServer()} (your computer’s address from the Expo dev server, port 3000). The phone and computer must be on the same Wi-Fi, and Windows Firewall must allow port 3000.</Txt>
      </Section>

      <Section title="Appearance" icon="sun">
        <Seg value={themePref} onChange={setTheme} items={[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']]} />
      </Section>

      <Section title="Account" icon="user">
        {user ? (
          <>
            <Txt>Signed in as <Txt bold>{user.name}</Txt> ({user.email})</Txt>
            <Row wrap gap={6}><Btn small title="My Garage" onPress={() => router.push('/garage')} /><Btn small title="Sign out" variant="danger" onPress={signOut} /></Row>
          </>
        ) : (
          <>
            <Txt tone="muted">Not signed in. Everything works without an account; signing in keeps your vehicles, fill-ups, alerts and trips.</Txt>
            <Btn small variant="primary" title="Sign in or create account" onPress={() => requireAuth()} />
          </>
        )}
      </Section>

      <Section title="Notifications" icon="bell" desc="Price alerts you set in My Garage, and new DOE data, as phone notifications.">
        <Toggle label="Phone notifications" sub={phone ? 'On — checked every 2 minutes while the app is open' : 'Off'} value={phone} onChange={async (v) => {
          if (!v) { await prefs.set('phoneNotifs', false); setPhone(false); toast('You can also turn them off in your phone settings'); return; }
          const ok = await enableNotifications(); await prefs.set('phoneNotifs', ok); setPhone(ok);
          if (!ok) toast('Notifications not allowed — turn them on in your phone settings', 'error');
        }} />
      </Section>

      <Section title="Offline data" icon="download" desc="The app keeps the last prices, forecast and news so you can still check them without a connection.">
        <Btn small title="Clear saved data" onPress={async () => { const n = await clearCache(); toast(`Removed ${n} saved item${n === 1 ? '' : 's'}`); }} />
      </Section>

      <Card tone="flat">
        <View style={{ gap: 2 }}>
          <Txt bold>TipidLitro {Constants.expoConfig?.version || ''}</Txt>
          <Txt variant="small" tone="muted">Integrated fuel cost planning for the Philippines · SDG 11</Txt>
          <Txt variant="tiny" tone="faint">{Platform.OS === 'ios' ? 'iOS' : 'Android'} · Expo SDK {Constants.expoConfig?.sdkVersion || ''} · Prices from the Department of Energy · Maps © OpenStreetMap contributors</Txt>
        </View>
      </Card>
    </Screen>
  );
}

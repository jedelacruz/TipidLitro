// Notifications (the web app's bell menu): price alerts and new-data notices; opening marks them read.
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Btn, Card, Empty, PageHeader, Row, Screen, Txt } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../lib/app-context';
import { fmt } from '../lib/format';
import { useTheme } from '../lib/theme';

/** Web links look like "#/prices?region=NCR"; open the matching screen. */
function openLink(link) {
  const m = String(link || '').match(/^#\/(\w+)(?:\?(.*))?$/);
  if (!m) return;
  const params = Object.fromEntries(new URLSearchParams(m[2] || ''));
  const path = { plan: '/', prices: '/prices', watch: '/watch', stations: '/stations', news: '/news', garage: '/garage' }[m[1]];
  if (path) router.navigate({ pathname: path, params });
}

export default function Notifications() {
  const t = useTheme();
  const { user, notifications, refreshNotifications, requireAuth } = useApp();
  useEffect(() => {
    if (!user) return undefined;
    refreshNotifications();
    // Mark everything read shortly after opening (same as opening the web bell menu).
    const timer = setTimeout(() => api('/me/notifications/read', { method: 'POST' }).then(refreshNotifications).catch(() => {}), 1500);
    return () => clearTimeout(timer);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return <Screen><PageHeader back bell={false} title="Notifications" /><Card><Empty icon="🔔" title="Sign in for alerts" text="Set price alerts in My Garage and they appear here." action={<Btn variant="primary" title="Sign in" onPress={() => requireAuth()} />} /></Card></Screen>;
  return (
    <Screen onRefresh={refreshNotifications} refreshing={false}>
      <PageHeader back bell={false} title="Notifications" subtitle="Price alerts and new DOE data." actions={<Btn small title="Alerts" onPress={() => router.push({ pathname: '/garage', params: { tab: 'alerts' } })} />} />
      {!notifications.items.length ? <Card><Empty icon="🔔" title="Nothing yet" text="Set price alerts in My Garage → Alerts. Matching alerts show up here (at most once per price week)." /></Card> : null}
      {notifications.items.map((n) => (
        <Pressable key={n.id} onPress={() => openLink(n.link)}>
          <Card style={!n.read_at ? { borderColor: t.brand } : null}>
            <Row between align="flex-start">
              <View style={{ flex: 1 }}><Txt bold>{n.title}</Txt>{n.body ? <Txt variant="small" tone="muted">{n.body}</Txt> : null}</View>
              {!n.read_at ? <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: t.brand, marginTop: 6 }} /> : null}
            </Row>
            <Txt variant="tiny" tone="faint">{fmt.ago(n.created_at)}</Txt>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

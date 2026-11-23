// "More" tab: account, the rest of the app (news, garage, assistant, help, admin) and settings —
// the same destinations as the web app's top menu.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { AlertBox, Btn, Card, Icon, PageHeader, Row, Screen, SectionTitle, Txt } from '../../components/ui';
import { useApp } from '../../lib/app-context';
import { fmt } from '../../lib/format';
import { useTheme } from '../../lib/theme';

function Item({ icon, title, sub, onPress, badge }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: t.brandSoft, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={20} color={t.brandStrong} /></View>
      <View style={{ flex: 1 }}><Txt bold>{title}</Txt>{sub ? <Txt variant="small" tone="muted">{sub}</Txt> : null}</View>
      {badge ? <View style={{ backgroundColor: t.red, borderRadius: 99, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' }}><Txt variant="tiny" bold style={{ color: '#fff' }}>{badge}</Txt></View> : null}
      <Icon name="right" color={t.faint} />
    </Pressable>
  );
}

export default function More() {
  const t = useTheme();
  const { user, requireAuth, signOut, notifications, status, connectionError, serverUrl } = useApp();
  const doe = status?.doe;
  return (
    <Screen>
      <PageHeader title="More" subtitle="Everything else in TipidLitro." />
      {connectionError ? (
        <AlertBox level="warn" text={`Can't reach the TipidLitro server at ${serverUrl()}. Some screens show saved data.`} action={<Btn small title="Fix" onPress={() => router.push('/settings')} />} />
      ) : null}

      <Card>
        {user ? (
          <Row gap={12}>
            <View style={{ width: 46, height: 46, borderRadius: 99, backgroundColor: t.brandStrong, alignItems: 'center', justifyContent: 'center' }}><Txt variant="h2" style={{ color: t.brandInk }}>{(user.name || '?')[0].toUpperCase()}</Txt></View>
            <View style={{ flex: 1 }}><Txt bold>{user.name}</Txt><Txt variant="small" tone="muted">{user.email}{user.role === 'admin' ? ' · admin' : ''}</Txt></View>
            <Btn small title="Sign out" onPress={signOut} />
          </Row>
        ) : (
          <View style={{ gap: 8 }}>
            <Txt variant="h3">Sign in to save more</Txt>
            <Txt variant="small" tone="muted">Your vehicles, fuel log, price alerts and saved trips — the same account as the website.</Txt>
            <Btn title="Sign in or create account" icon="user" variant="primary" onPress={() => requireAuth()} />
          </View>
        )}
      </Card>

      <Card style={{ paddingVertical: 4 }}>
        <Item icon="news" title="Fuel news" sub="Headlines that move pump prices" onPress={() => router.push('/news')} />
        <Item icon="car" title="My Garage" sub="Vehicles, fuel log, alerts, saved trips" onPress={() => router.push('/garage')} />
        <Item icon="chat" title="Ask TipidLitro" sub="Assistant for trips and prices" onPress={() => router.push('/chat')} />
        {user ? <Item icon="bell" title="Notifications" sub="Price alerts and new DOE data" badge={notifications.unread || null} onPress={() => router.push('/notifications')} /> : null}
        {user?.role === 'admin' ? <Item icon="shield" title="Admin dashboard" sub="Data health, integrations, users" onPress={() => router.push('/admin')} /> : null}
      </Card>

      <Card style={{ paddingVertical: 4 }}>
        <Item icon="help" title="Help & FAQ" sub="How it works, words to know, show the intro again" onPress={() => router.push('/help')} />
        <Item icon="gear" title="Settings" sub="Server, theme, notifications, about" onPress={() => router.push('/settings')} />
      </Card>

      {doe ? (
        <View style={{ gap: 2, paddingHorizontal: 4 }}>
          <SectionTitle>Data</SectionTitle>
          <Txt variant="small" tone="muted">Latest DOE prices: week of {fmt.date(doe.latestNcrWeek)}{doe.latestAdjustment ? ` · adjustment ${fmt.date(doe.latestAdjustment, { year: false })}` : ''}</Txt>
          {doe.checkedAt ? <Txt variant="small" tone="muted">Checked DOE {fmt.ago(doe.checkedAt)}</Txt> : null}
        </View>
      ) : null}
    </Screen>
  );
}

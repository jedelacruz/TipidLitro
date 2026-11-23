// Shared building blocks so every screen looks and behaves the same (mirrors public/js/ui.js):
// page header with help, cards, collapsible sections, tabs, chips, KPI tiles, tips, alerts,
// bottom sheets, select lists and tables.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../lib/app-context';
import { GLOSSARY, HELP } from '../lib/glossary';
import { RADIUS, RADIUS_SM, TYPE, useTheme } from '../lib/theme';

const ICONS = {
  route: 'map-marker-path', fuel: 'gas-station', trend: 'chart-line', pin: 'map-marker-outline', car: 'car-outline', news: 'newspaper-variant-outline',
  chat: 'chat-processing-outline', sun: 'white-balance-sunny', moon: 'weather-night', locate: 'crosshairs-gps', swap: 'swap-vertical', plus: 'plus', x: 'close',
  alert: 'alert-outline', info: 'information-outline', external: 'open-in-new', save: 'content-save-outline', share: 'share-variant-outline', send: 'send',
  leaf: 'leaf', wallet: 'wallet-outline', gear: 'cog-outline', bolt: 'lightning-bolt-outline', trash: 'delete-outline', refresh: 'refresh', user: 'account-outline',
  bell: 'bell-outline', menu: 'menu', download: 'download-outline', calendar: 'calendar-month-outline', star: 'star-outline', copy: 'content-copy',
  help: 'help-circle-outline', back: 'chevron-left', down: 'chevron-down', right: 'chevron-right', up: 'chevron-up', check: 'check', server: 'server-network',
  map: 'map-outline', history: 'history', shield: 'shield-account-outline', grid: 'view-grid-outline', search: 'magnify', drop: 'water-outline',
};
export function Icon({ name, size = 18, color, style }) {
  const t = useTheme();
  return <MaterialCommunityIcons name={ICONS[name] || name} size={size} color={color || t.text} style={style} />;
}

/** Themed text. variant: h1 | h2 | h3 | body | small | tiny | big. tone: muted | faint | brand | up | down | red | green */
export function Txt({ variant = 'body', tone, bold, style, children, ...rest }) {
  const t = useTheme();
  const size = TYPE[variant] || TYPE.body;
  const color = tone ? ({ muted: t.muted, faint: t.faint, brand: t.brandStrong, up: t.up, down: t.down, red: t.red, green: t.green, amber: t.amber, ink: t.brandInk }[tone] || t.text) : t.text;
  const weight = bold ? '700' : variant.startsWith('h') || variant === 'big' ? '800' : '400';
  return <Text style={[{ fontSize: size, color, fontWeight: weight, lineHeight: size * (variant === 'big' ? 1.15 : 1.42) }, style]} {...rest}>{children}</Text>;
}

export const Row = ({ children, gap = 8, wrap, between, align = 'center', style }) => (
  <View style={[{ flexDirection: 'row', alignItems: align, gap, flexWrap: wrap ? 'wrap' : 'nowrap', justifyContent: between ? 'space-between' : 'flex-start' }, style]}>{children}</View>
);

/** Screen wrapper: safe area, background, scrolling with pull-to-refresh. */
export function Screen({ children, scroll = true, refreshing = false, onRefresh, padded = true, footer, fab = true }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const content = (
    <View style={{ padding: padded ? 16 : 0, paddingTop: padded ? 8 : 0, gap: 14, paddingBottom: 96 }}>{children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brand} colors={[t.brand]} /> : undefined}>{content}</ScrollView>
        ) : content}
      </KeyboardAvoidingView>
      {footer}
      {fab ? <ChatFab /> : null}
    </View>
  );
}

export function ChatFab() {
  const t = useTheme();
  return (
    <Pressable accessibilityLabel="Ask TipidLitro" onPress={() => router.push('/chat')} style={{ position: 'absolute', right: 16, bottom: 18, backgroundColor: t.brandStrong, borderRadius: 999, width: 54, height: 54, alignItems: 'center', justifyContent: 'center', shadowColor: '#ea580c', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
      <Icon name="chat" size={24} color={t.brandInk} />
    </Pressable>
  );
}

/** Same header on every screen: back (optional), title + "?" help, subtitle, bell and actions. */
export function PageHeader({ title, subtitle, help, back, actions, bell = true }) {
  const t = useTheme();
  const { user, notifications } = useApp();
  return (
    <View style={{ gap: 4 }}>
      <Row between>
        <Row gap={6} style={{ flex: 1 }}>
          {back ? <Pressable hitSlop={10} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}><Icon name="back" size={28} /></Pressable> : null}
          <Txt variant="h1" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</Txt>
          {help ? <HelpButton helpKey={help} /> : null}
        </Row>
        <Row gap={8}>
          {actions}
          {bell && user ? (
            <Pressable accessibilityLabel={`Notifications, ${notifications.unread} unread`} onPress={() => router.push('/notifications')} style={iconBtn(t)}>
              <Icon name="bell" />
              {notifications.unread ? <View style={{ position: 'absolute', top: -3, right: -3, backgroundColor: t.red, borderRadius: 99, minWidth: 17, height: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{notifications.unread}</Text></View> : null}
            </Pressable>
          ) : null}
        </Row>
      </Row>
      {subtitle ? <Txt tone="muted">{subtitle}</Txt> : null}
    </View>
  );
}
export const iconBtn = (t) => ({ width: 38, height: 38, borderRadius: 99, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' });
export function IconButton({ icon, onPress, label }) {
  const t = useTheme();
  return <Pressable accessibilityLabel={label} onPress={onPress} style={iconBtn(t)} hitSlop={6}><Icon name={icon} /></Pressable>;
}

export function Card({ children, style, tone, onPress }) {
  const t = useTheme();
  const bg = tone === 'welcome' ? t.brandSoft : tone === 'flat' ? t.surface2 : t.surface;
  const Comp = onPress ? Pressable : View;
  return (
    <Comp onPress={onPress} style={[{ backgroundColor: bg, borderRadius: RADIUS, borderWidth: 1, borderColor: tone === 'welcome' ? 'transparent' : t.border, padding: 16, gap: 10, shadowColor: '#000', shadowOpacity: t.dark ? 0.25 : 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 }, style]}>
      {children}
    </Comp>
  );
}

/** Card with a consistent header (title, icon, one-line description). Collapsible if asked. */
export function Section({ title, icon, desc, actions, collapsible, defaultOpen = true, children, style }) {
  const [open, setOpen] = useState(defaultOpen);
  const t = useTheme();
  const head = (
    <Row between align="flex-start">
      <View style={{ flex: 1, gap: 2 }}>
        <Row gap={8}>
          {icon ? <Icon name={icon} size={18} color={t.brandStrong} /> : null}
          <Txt variant="h3" style={{ flexShrink: 1 }}>{title}</Txt>
          {collapsible ? <Icon name={open ? 'up' : 'down'} size={18} color={t.faint} /> : null}
        </Row>
        {desc ? <Txt variant="small" tone="muted">{desc}</Txt> : null}
      </View>
      {actions ? <Row gap={6}>{actions}</Row> : null}
    </Row>
  );
  return (
    <Card style={style}>
      {collapsible ? <Pressable onPress={() => setOpen(!open)}>{head}</Pressable> : head}
      {!collapsible || open ? children : null}
    </Card>
  );
}

export function Btn({ title, icon, onPress, variant = 'default', small, block, disabled, loading, style }) {
  const t = useTheme();
  const primary = variant === 'primary';
  const bg = primary ? t.brandStrong : variant === 'ghost' ? 'transparent' : t.surface;
  const fg = primary ? t.brandInk : variant === 'danger' ? t.red : t.text;
  return (
    <Pressable disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: small ? 7 : 11, paddingHorizontal: small ? 12 : 16,
      minHeight: small ? 34 : 44, borderRadius: 999, backgroundColor: bg, borderWidth: primary || variant === 'ghost' ? 0 : 1, borderColor: t.border,
      opacity: disabled ? 0.5 : pressed ? 0.8 : 1, alignSelf: block ? 'stretch' : 'flex-start',
    }, style]}>
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} /> : null}
      {title ? <Text style={{ color: fg, fontWeight: '700', fontSize: small ? 13 : 15 }}>{title}</Text> : null}
    </Pressable>
  );
}

export function Chip({ label, on, onPress, onRemove }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: on ? t.brandSoft : t.surface2, borderWidth: 1, borderColor: on ? 'transparent' : t.border }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: on ? t.brandStrong : t.muted }}>{label}</Text>
      {onRemove ? <Pressable hitSlop={8} onPress={onRemove}><Icon name="x" size={14} color={t.faint} /></Pressable> : null}
    </Pressable>
  );
}

export function Badge({ label, tone = 'gray' }) {
  const t = useTheme();
  const c = { green: [t.greenSoft, t.green], amber: [t.amberSoft, t.amber], red: [t.redSoft, t.red], blue: [t.blueSoft, t.blue], brand: [t.brandSoft, t.brandStrong], gray: [t.surface2, t.muted] }[tone] || [t.surface2, t.muted];
  return <View style={{ backgroundColor: c[0], borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={{ color: c[1], fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Text></View>;
}

/** Small "i" that explains a word when tapped. */
export function Tip({ text, title }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable hitSlop={10} accessibilityLabel={text} onPress={() => setOpen(true)} style={{ width: 17, height: 17, borderRadius: 99, borderWidth: 1, borderColor: t.faint, alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
        <Text style={{ fontSize: 10, fontStyle: 'italic', fontWeight: '700', color: t.muted }}>i</Text>
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: t.overlay, justifyContent: 'center', padding: 28 }}>
          <View style={{ backgroundColor: t.surface, borderRadius: RADIUS, padding: 18, gap: 6 }}>
            {title ? <Txt variant="h3">{title}</Txt> : null}
            <Txt>{text}</Txt>
            <Txt variant="small" tone="faint">Tap anywhere to close</Txt>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
/** A glossary word with its tip. */
export function Term({ k, label, variant = 'small', tone = 'muted' }) {
  return <Row gap={0}><Txt variant={variant} tone={tone}>{label ?? GLOSSARY[k][0]}</Txt><Tip title={GLOSSARY[k][0]} text={GLOSSARY[k][1]} /></Row>;
}

export function HelpButton({ helpKey }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const h = HELP[helpKey];
  return (
    <>
      <Pressable hitSlop={8} accessibilityLabel={`Help: ${h.title}`} onPress={() => setOpen(true)} style={{ width: 26, height: 26, borderRadius: 99, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: t.muted, fontWeight: '800' }}>?</Text>
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={h.title}>
        <Txt>{h.intro}</Txt>
        {h.steps?.length ? <><SectionTitle>How to use it</SectionTitle>{h.steps.map((s, i) => <Row key={i} align="flex-start" gap={8}><Txt tone="brand" bold>{i + 1}.</Txt><Txt style={{ flex: 1 }}>{s}</Txt></Row>)}</> : null}
        {h.terms?.length ? <><SectionTitle>Words to know</SectionTitle>{h.terms.map((k) => <View key={k}><Txt bold>{GLOSSARY[k][0]}</Txt><Txt tone="muted" variant="small">{GLOSSARY[k][1]}</Txt></View>)}</> : null}
        <Btn title="Got it" variant="primary" block onPress={() => setOpen(false)} style={{ marginTop: 8 }} />
      </Sheet>
    </>
  );
}

export const SectionTitle = ({ children, style }) => <Txt variant="tiny" tone="faint" bold style={[{ textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 6 }, style]}>{children}</Txt>;

/** Bottom sheet modal. */
export function Sheet({ visible, onClose, title, children, scroll = true }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: t.overlay }} />
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%', paddingBottom: insets.bottom + 12 }}>
          <Row between style={{ padding: 16, paddingBottom: 8 }}>
            <Txt variant="h2" style={{ flex: 1 }}>{title}</Txt>
            <IconButton icon="x" label="Close" onPress={onClose} />
          </Row>
          {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10 }}>{children}</ScrollView> : <View style={{ padding: 16, paddingTop: 4, gap: 10, flexShrink: 1 }}>{children}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Tab bar (underline) or pills. items: [[key, label]] */
export function Tabs({ items, value, onChange, pills }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: pills ? 6 : 2, paddingRight: 8 }} style={{ flexGrow: 0, borderBottomWidth: pills ? 0 : 1, borderColor: t.border }}>
      {items.map(([k, label]) => {
        const on = k === value;
        return (
          <Pressable key={k} onPress={() => onChange(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={pills ? { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: on ? 'transparent' : t.border, backgroundColor: on ? t.brandSoft : t.surface }
              : { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 2, borderColor: on ? t.brandStrong : 'transparent' }}>
            <Text style={{ fontWeight: '700', fontSize: 14, color: on ? t.brandStrong : t.muted }}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Segmented control. items: [[key, label]] */
export function Seg({ items, value, onChange }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border, borderRadius: 999, padding: 3, alignSelf: 'flex-start' }}>
      {items.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: k === value ? t.surface : 'transparent' }}>
          <Text style={{ fontWeight: '700', fontSize: 13, color: k === value ? t.brandStrong : t.muted }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Kpi({ label, value, sub, tone, icon, tip }) {
  const t = useTheme();
  const color = { good: t.green, warn: t.amber, bad: t.red }[tone] || t.text;
  return (
    <View style={{ flexGrow: 1, flexBasis: '46%', backgroundColor: t.surface, borderRadius: RADIUS, borderWidth: 1, borderColor: t.border, padding: 12, gap: 2 }}>
      <Row gap={5}>{icon ? <Icon name={icon} size={14} color={t.muted} /> : null}<Txt variant="tiny" tone="muted" bold style={{ flexShrink: 1 }}>{label}</Txt>{tip ? <Tip text={tip} /> : null}</Row>
      <Text style={{ fontSize: 21, fontWeight: '800', color }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Txt variant="tiny" tone="faint">{sub}</Txt> : null}
    </View>
  );
}
export const KpiGrid = ({ children }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{children}</View>;

export function Stat({ k, v, s }) {
  const t = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: '46%', backgroundColor: t.surface2, borderRadius: RADIUS_SM, borderWidth: 1, borderColor: t.border, padding: 10 }}>
      <Txt variant="tiny" tone="faint" bold style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{k}</Txt>
      <Txt variant="h3" style={{ fontWeight: '700' }}>{v}</Txt>
      {s ? <Txt variant="tiny" tone="muted">{s}</Txt> : null}
    </View>
  );
}
export const StatGrid = ({ children }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;

export function AlertBox({ level = 'info', text, children, action }) {
  const t = useTheme();
  const bg = { info: t.blueSoft, warn: t.amberSoft, danger: t.redSoft, ok: t.greenSoft }[level] || t.blueSoft;
  return (
    <View style={{ flexDirection: 'row', gap: 10, backgroundColor: bg, borderRadius: RADIUS_SM, padding: 12, alignItems: 'flex-start' }}>
      <Icon name={level === 'info' || level === 'ok' ? 'info' : 'alert'} size={18} />
      <View style={{ flex: 1, gap: 6 }}>{text ? <Txt variant="small">{text}</Txt> : null}{children}</View>
      {action}
    </View>
  );
}

export function Empty({ icon = '⛽', title, text, action }) {
  return (
    <View style={{ alignItems: 'center', padding: 24, gap: 6 }}>
      <Text style={{ fontSize: 32 }}>{icon}</Text>
      <Txt variant="h3" style={{ textAlign: 'center' }}>{title}</Txt>
      {text ? <Txt tone="muted" style={{ textAlign: 'center' }}>{text}</Txt> : null}
      {action}
    </View>
  );
}

export function Loading({ text = 'Loading…' }) {
  const t = useTheme();
  return <Row style={{ padding: 16 }}><ActivityIndicator color={t.brand} /><Txt tone="muted">{text}</Txt></Row>;
}

export function Field({ label, tip, children, style }) {
  return (
    <View style={[{ gap: 5, flexGrow: 1, flexBasis: 0, minWidth: 100 }, style]}>
      <Row gap={0}><Txt variant="small" tone="muted" bold>{label}</Txt>{tip ? <Tip text={tip} title={label} /> : null}</Row>
      {children}
    </View>
  );
}

export function Input(props) {
  const t = useTheme();
  return <TextInput placeholderTextColor={t.faint} {...props} style={[{ borderWidth: 1, borderColor: t.border, borderRadius: RADIUS_SM, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, color: t.text, backgroundColor: t.surface, fontSize: 15 }, props.multiline ? { minHeight: 110, textAlignVertical: 'top' } : null, props.style]} />;
}

/**
 * Picker that opens a sheet. options: [{ value, label, sub? }] or groups: [{ title, options }].
 */
export function Select({ value, options, groups, onChange, placeholder = 'Choose…', title = 'Choose', style, testID }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const all = groups ? groups.flatMap((g) => g.options) : options || [];
  const current = all.find((o) => String(o.value) === String(value));
  const renderOption = (o) => (
    <Pressable key={String(o.value)} onPress={() => { setOpen(false); onChange(o.value); }} style={{ paddingVertical: 12, paddingHorizontal: 10, borderRadius: RADIUS_SM, backgroundColor: String(o.value) === String(value) ? t.brandSoft : 'transparent' }}>
      <Row between><Txt style={{ flex: 1 }} bold={String(o.value) === String(value)}>{o.label}</Txt>{String(o.value) === String(value) ? <Icon name="check" color={t.brandStrong} /> : null}</Row>
      {o.sub ? <Txt variant="small" tone="muted">{o.sub}</Txt> : null}
    </Pressable>
  );
  return (
    <>
      <Pressable testID={testID} onPress={() => setOpen(true)} style={[{ borderWidth: 1, borderColor: t.border, borderRadius: RADIUS_SM, paddingHorizontal: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface }, style]}>
        <Txt numberOfLines={1} style={{ flex: 1 }} tone={current ? undefined : 'faint'}>{current?.label || placeholder}</Txt>
        <Icon name="down" color={t.faint} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        {groups ? groups.filter((g) => g.options.length).map((g) => <View key={g.title}><SectionTitle style={{ marginBottom: 4 }}>{g.title}</SectionTitle>{g.options.map(renderOption)}</View>) : all.map(renderOption)}
      </Sheet>
    </>
  );
}

export function Toggle({ label, value, onChange, sub }) {
  const t = useTheme();
  return (
    <Row between>
      <View style={{ flex: 1 }}><Txt>{label}</Txt>{sub ? <Txt variant="small" tone="muted">{sub}</Txt> : null}</View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.brand, false: t.border }} thumbColor="#fff" />
    </Row>
  );
}

export const Divider = () => { const t = useTheme(); return <View style={{ height: 1, backgroundColor: t.border, marginVertical: 2 }} />; };

/** Horizontally scrollable table. columns: [{ key, label, align, width, render? }] */
export function Table({ columns, rows, onRowPress, selectedIndex }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderWidth: 1, borderColor: t.border, borderRadius: RADIUS_SM }}>
      <View>
        <View style={{ flexDirection: 'row', backgroundColor: t.surface2, borderBottomWidth: 1, borderColor: t.border }}>
          {columns.map((c) => <Text key={c.key} style={{ width: c.width || 90, padding: 8, fontSize: 11, fontWeight: '700', color: t.faint, textTransform: 'uppercase', textAlign: c.align || 'right' }}>{c.label}</Text>)}
        </View>
        {rows.map((r, i) => (
          <Pressable key={i} onPress={onRowPress ? () => onRowPress(r, i) : undefined} style={{ flexDirection: 'row', borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderColor: t.border, backgroundColor: i === selectedIndex ? t.brandSoft : 'transparent' }}>
            {columns.map((c) => (
              <View key={c.key} style={{ width: c.width || 90, padding: 8, justifyContent: 'center', alignItems: c.align === 'left' ? 'flex-start' : 'flex-end' }}>
                {c.render ? c.render(r) : <Text style={{ color: t.text, fontSize: 13, fontVariant: ['tabular-nums'] }}>{r[c.key] ?? '—'}</Text>}
              </View>
            ))}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

/** Two-color gauge (e.g. news pressure up vs down). */
export function Gauge({ up, down }) {
  const t = useTheme();
  const total = up + down;
  return (
    <View style={{ height: 12, borderRadius: 99, overflow: 'hidden', flexDirection: 'row', backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border }}>
      <View style={{ width: `${total ? (up / total) * 100 : 50}%`, backgroundColor: t.up }} />
      <View style={{ flex: 1, backgroundColor: t.down }} />
    </View>
  );
}

export function StepLabel({ n, children }) {
  const t = useTheme();
  return (
    <Row gap={8}>
      <View style={{ width: 22, height: 22, borderRadius: 99, backgroundColor: t.brandStrong, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.brandInk, fontWeight: '800', fontSize: 12 }}>{n}</Text></View>
      <Txt bold>{children}</Txt>
    </Row>
  );
}

// ---------------------------------------------------------------- toast
const toastListeners = new Set();
/** Short confirmation message at the bottom of the screen. */
export function toast(message, tone = 'info') { toastListeners.forEach((fn) => fn({ message, tone, id: Date.now() })); }
export function ToastHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let timer;
    const fn = (m) => { setMsg(m); clearTimeout(timer); timer = setTimeout(() => setMsg(null), 2800); };
    toastListeners.add(fn);
    return () => { toastListeners.delete(fn); clearTimeout(timer); };
  }, []);
  if (!msg) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 80, alignItems: 'center' }}>
      <View style={{ backgroundColor: msg.tone === 'error' ? t.red : t.text, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 }}>
        <Text style={{ color: msg.tone === 'error' ? '#fff' : t.bg, fontWeight: '700' }}>{msg.message}</Text>
      </View>
    </View>
  );
}

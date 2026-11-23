// App-wide state: server connection, signed-in user, theme, vehicle presets, data status,
// notifications, location — plus the shared sign-in sheet.
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, useColorScheme } from 'react-native';
import { api, getServer, hasToken, initApi, prefs, setServer, setToken } from './api';
import { DARK, LIGHT } from './theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export async function currentLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location permission was denied. You can allow it in your phone settings.');
  const pos = await Location.getCurrentPositionAsync({});
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

export async function enableNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', { name: 'Price alerts', importance: Notifications.AndroidImportance.DEFAULT /* eslint-disable-line import/namespace -- exported at runtime; the lint resolver misses the enum */ });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.status === 'granted';
}

export function AppProvider({ children }) {
  const system = useColorScheme();
  const [ready, setReady] = useState(false);
  const [themePref, setThemePref] = useState('system');
  const [user, setUser] = useState(null);
  const [presets, setPresets] = useState([]);
  const [status, setStatus] = useState(null);
  const [server, setServerState] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [location, setLocation] = useState(null);
  const [notifications, setNotifications] = useState({ unread: 0, items: [] });
  const [onboarded, setOnboarded] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const authResolver = useRef(null);
  const seenNotifs = useRef(new Set());

  const theme = themePref === 'dark' ? DARK : themePref === 'light' ? LIGHT : system === 'dark' ? DARK : LIGHT;

  const refreshStatus = useCallback(async () => {
    try { const s = await api('/status'); setStatus(s); setConnectionError(s._offline ? 'offline' : null); return s; } catch (e) { setConnectionError(e.message); return null; }
  }, []);

  const loadBasics = useCallback(async () => {
    setConnectionError(null);
    const [p] = await Promise.all([
      api('/vehicles').catch(() => null),
      refreshStatus(),
      hasToken() ? api('/auth/me').then(setUser).catch(() => setUser(null)) : Promise.resolve(setUser(null)),
    ]);
    if (Array.isArray(p)) setPresets(p);
  }, [refreshStatus]);

  useEffect(() => {
    (async () => {
      setServerState(await initApi());
      setThemePref(await prefs.get('theme', 'system'));
      setOnboarded(await prefs.get('onboarded', false));
      await loadBasics();
      setReady(true);
    })();
  }, [loadBasics]);

  const refreshNotifications = useCallback(async () => {
    if (!hasToken()) { setNotifications({ unread: 0, items: [] }); return; }
    try {
      const n = await api('/me/notifications');
      setNotifications(n);
      // Show a phone notification for anything new (only if the user allowed notifications).
      const fresh = n.items.filter((x) => !x.read_at && !seenNotifs.current.has(x.id));
      const perm = await Notifications.getPermissionsAsync().catch(() => ({ status: 'denied' }));
      if (seenNotifs.current.size && perm.status === 'granted' && (await prefs.get('phoneNotifs', false))) {
        for (const x of fresh.slice(0, 3)) Notifications.scheduleNotificationAsync({ content: { title: x.title, body: x.body || '' }, trigger: null }).catch(() => {});
      }
      n.items.forEach((x) => seenNotifs.current.add(x.id));
      if (!n.items.length) seenNotifs.current.add(-1);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    refreshNotifications();
    const t = setInterval(refreshNotifications, 2 * 60 * 1000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') { refreshNotifications(); refreshStatus(); } });
    return () => { clearInterval(t); sub.remove(); };
  }, [user, refreshNotifications, refreshStatus]);

  const value = useMemo(() => ({
    ready, theme, themePref, user, presets, status, server, connectionError, location, notifications, onboarded,
    setTheme: async (t) => { setThemePref(t); await prefs.set('theme', t); },
    finishOnboarding: async () => { setOnboarded(true); await prefs.set('onboarded', true); },
    resetOnboarding: async () => { setOnboarded(false); await prefs.set('onboarded', false); },
    refreshStatus, refreshNotifications, reload: loadBasics,
    changeServer: async (url) => { const s = await setServer(url); setServerState(s); await loadBasics(); return s; },
    serverUrl: () => getServer(),
    locate: async () => { const loc = await currentLocation(); setLocation(loc); return loc; },
    setUser,
    async signIn({ mode, name, email, password }) {
      const res = await api(mode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', body: { name, email, password } });
      await setToken(res.token);
      const { token: _t, ...u } = res;
      setUser(u);
      authResolver.current?.(u); authResolver.current = null; setAuthOpen(false);
      return u;
    },
    async signOut() {
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
      await setToken(null); setUser(null); setNotifications({ unread: 0, items: [] });
    },
    /** Opens the sign-in sheet; resolves with the user, or null if cancelled. */
    requireAuth() {
      if (user) return Promise.resolve(user);
      setAuthOpen(true);
      return new Promise((resolve) => { authResolver.current = resolve; });
    },
    authOpen,
    closeAuth() { setAuthOpen(false); authResolver.current?.(null); authResolver.current = null; },
  }), [ready, theme, themePref, user, presets, status, server, connectionError, location, notifications, onboarded, authOpen, refreshStatus, refreshNotifications, loadBasics]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

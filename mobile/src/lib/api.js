// API client for the TipidLitro server (the same REST API the web app uses).
// - Server address: saved in Settings, or EXPO_PUBLIC_API_URL, or guessed from the Expo dev
//   server (your computer's LAN IP, port 3000).
// - Signed-in session token lives in SecureStore and is sent as "Authorization: Bearer".
// - GET responses for key screens are cached so the app still shows the last prices offline.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'tl_session_token';
const SERVER_KEY = 'tl.server';
const CACHE_PREFIX = 'tl.cache:';
const CACHEABLE = ['/prices/summary', '/prices/region/', '/prices/weeks', '/forecast', '/news', '/vehicles', '/status', '/market'];

let baseUrl = null;
let token = null;

export function guessServer() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  const host = (Constants.expoConfig?.hostUri || '').split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') return `http://${host}:3000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

export async function initApi() {
  baseUrl = (await AsyncStorage.getItem(SERVER_KEY)) || guessServer();
  try { token = await SecureStore.getItemAsync(TOKEN_KEY); } catch { token = null; }
  return baseUrl;
}

export const getServer = () => baseUrl || guessServer();
export async function setServer(url) {
  const clean = String(url || '').trim().replace(/\/$/, '');
  if (clean) { baseUrl = /^https?:\/\//.test(clean) ? clean : `http://${clean}`; await AsyncStorage.setItem(SERVER_KEY, baseUrl); }
  else { baseUrl = guessServer(); await AsyncStorage.removeItem(SERVER_KEY); }
  return baseUrl;
}

export async function setToken(t) {
  token = t || null;
  try { if (t) await SecureStore.setItemAsync(TOKEN_KEY, t); else await SecureStore.deleteItemAsync(TOKEN_KEY); } catch { /* keep in memory */ }
}
export const hasToken = () => Boolean(token);

export class ApiError extends Error { constructor(msg, status, offline = false) { super(msg); this.status = status; this.offline = offline; } }

/**
 * @param {string} path e.g. '/prices/summary'
 * @param {{method?: string, body?: any, timeout?: number}} opts
 */
export async function api(path, { method = 'GET', body, timeout = 45000 } = {}) {
  const url = `${getServer()}/api${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const cacheable = method === 'GET' && CACHEABLE.some((p) => path.startsWith(p));
  try {
    const res = await fetch(url, {
      method, signal: ctrl.signal,
      headers: { Accept: 'application/json', 'x-client': 'tipidlitro-mobile', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401 && token && path !== '/auth/login') await setToken(null);
      throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
    }
    if (cacheable) AsyncStorage.setItem(CACHE_PREFIX + path, JSON.stringify({ at: Date.now(), data })).catch(() => {});
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (cacheable) {
      const hit = await AsyncStorage.getItem(CACHE_PREFIX + path).catch(() => null);
      if (hit) { const { data } = JSON.parse(hit); if (data && typeof data === 'object') { data._offline = true; return data; } }
    }
    const reason = err.name === 'AbortError' ? 'The server took too long to answer.' : `Can't reach the TipidLitro server at ${getServer()}.`;
    throw new ApiError(`${reason} Check that it is running and that your phone is on the same Wi-Fi (Settings → Server).`, 0, true);
  } finally {
    clearTimeout(timer);
  }
}

/** Full URL for downloads (CSV export). */
export const apiUrl = (path) => `${getServer()}/api${path}`;

/** Small JSON preference store. */
export const prefs = {
  async get(key, def = null) { try { const v = await AsyncStorage.getItem(`tl.${key}`); return v == null ? def : JSON.parse(v); } catch { return def; } },
  async set(key, value) { try { await AsyncStorage.setItem(`tl.${key}`, JSON.stringify(value)); } catch { /* ignore */ } },
  async remove(key) { try { await AsyncStorage.removeItem(`tl.${key}`); } catch { /* ignore */ } },
};

/** Forget saved offline copies of prices, news etc. Returns how many were removed. */
export async function clearCache() {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(CACHE_PREFIX));
  await AsyncStorage.multiRemove(keys);
  return keys.length;
}

/** Check a server address without changing anything. */
export async function testServer(url) {
  const clean = String(url || '').trim().replace(/\/$/, '');
  const base = /^https?:\/\//.test(clean) ? clean : `http://${clean}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${base}/api/status`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (!data?.ok) throw new Error('That address answered, but it is not a TipidLitro server.');
    return data;
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'No answer after 8 seconds.' : e.message.includes('TipidLitro') ? e.message : 'Could not connect to that address.');
  } finally { clearTimeout(timer); }
}

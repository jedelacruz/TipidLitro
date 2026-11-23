// Design tokens shared with the web app (public/css/app.css): orange brand, warm neutrals,
// green for savings/rollbacks, red for hikes. Light and dark variants.
import { createContext, useContext } from 'react';

export const LIGHT = {
  dark: false,
  brand: '#ea580c', brandStrong: '#c2410c', brand2: '#f97316', brandInk: '#ffffff', brandSoft: '#fff0e5',
  green: '#15803d', greenSoft: '#e4f5ea', amber: '#d97706', amberSoft: '#fff4dc', red: '#dc2626', redSoft: '#fde8e8',
  blue: '#2563eb', blueSoft: '#e5edff', navy: '#1e293b',
  bg: '#f7f5f2', surface: '#ffffff', surface2: '#faf8f5', text: '#1c1917', muted: '#625b55', faint: '#8c847d', border: '#e8e2db',
  up: '#dc2626', down: '#15803d', overlay: 'rgba(12,9,6,0.55)',
};

export const DARK = {
  dark: true,
  brand: '#fb923c', brandStrong: '#fb923c', brand2: '#fdba74', brandInk: '#1f0e02', brandSoft: '#33200f',
  green: '#4ade80', greenSoft: '#10291a', amber: '#fbbf24', amberSoft: '#2e2410', red: '#f87171', redSoft: '#351a1a',
  blue: '#60a5fa', blueSoft: '#16213b', navy: '#cbd5e1',
  bg: '#0f0e0d', surface: '#181614', surface2: '#201d1a', text: '#f1ede8', muted: '#a9a19a', faint: '#7d756e', border: '#2f2a26',
  up: '#f87171', down: '#4ade80', overlay: 'rgba(0,0,0,0.65)',
};

/** Chart series colors (same order as the web app). */
export const SERIES = ['#ea580c', '#0ea5e9', '#7c3aed', '#16a34a', '#e11d48', '#64748b', '#ca8a04', '#0f766e'];

export const BRAND_COLORS = {
  Petron: '#1d4ed8', Shell: '#e5a000', Caltex: '#d32f2f', Phoenix: '#f97316', Total: '#c2185b', 'Flying V': '#7c3aed', Unioil: '#0e7490',
  Seaoil: '#0284c7', PTT: '#2563eb', Cleanfuel: '#16a34a', Jetti: '#ea580c', 'Petro Gazz': '#be123c', Independent: '#64748b',
};
export const brandColor = (b) => BRAND_COLORS[b] || '#64748b';

export const RADIUS = 14;
export const RADIUS_SM = 9;

export const ThemeContext = createContext(LIGHT);
export const useTheme = () => useContext(ThemeContext);

/** Font sizes used across screens, so every page reads the same. */
export const TYPE = { h1: 26, h2: 20, h3: 16, body: 15, small: 13, tiny: 11.5, big: 38 };

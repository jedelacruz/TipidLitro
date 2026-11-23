// App shell: routing, header (auth, theme, notifications, mobile menu), live price ticker,
// "new DOE prices" banner, chat widget.
import { $, $$, api, clear, dropdown, emit, fmt, h, icon, modal, parseHash, state, store, toast, vendorsReady } from './lib.js';
import { initChat } from './chat.js';

const VIEWS = {
  plan: () => import('./views/planner.js'),
  prices: () => import('./views/prices.js'),
  watch: () => import('./views/forecast.js'),
  stations: () => import('./views/stations.js'),
  news: () => import('./views/news.js'),
  garage: () => import('./views/garage.js'),
  admin: () => import('./views/admin.js'),
  about: () => import('./views/about.js'),
};
const TITLES = { plan: 'Trip Planner', prices: 'Fuel Prices', watch: 'Price Watch', stations: 'Stations', news: 'Fuel News', garage: 'My Garage', admin: 'Integration Monitor', about: 'Help' };

let cleanup = null;
let currentRoute = null;
let renderSeq = 0;

async function render() {
  const { route, params } = parseHash();
  const name = VIEWS[route] ? route : 'plan';
  const seq = ++renderSeq;
  currentRoute = name;
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  // Each view gets a fresh container: if the user navigates away while a view is still loading,
  // its late updates land in a detached node instead of the new page.
  const root = h('div', { class: 'view' });
  clear($('#main')).append(root);
  await vendorsReady();
  try {
    const mod = await VIEWS[name]();
    if (seq !== renderSeq) return; // a newer navigation started meanwhile
    cleanup = await mod.render(root, params);
  } catch (err) {
    console.error(err);
    root.append(h('div', { class: 'card' }, h('h2', null, 'Something went wrong'), h('p', { class: 'muted' }, err.message)));
  }
  document.title = `${TITLES[name]} · TipidLitro`;
}

// Views update their own query string with history.replaceState (no event), so every hashchange
// is a real navigation: links, back/forward, or a pasted share link.
window.addEventListener('hashchange', render);
export function navigate(hash) { history.pushState(null, '', hash); render(); }
window.tlNavigate = navigate;

// ---------------------------------------------------------------- theme
const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark'
  || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
function applyThemeIcon() { clear($('#themeBtn')).append(icon(isDark() ? 'sun' : 'moon')); }
$('#themeBtn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('tl.theme', next); } catch { /* ignore */ }
  applyThemeIcon();
  emit('theme');
  render(); // charts and map tiles pick up the new colors
});
applyThemeIcon();
$$('[data-icon]').forEach((el) => el.replaceWith(icon(el.dataset.icon)));

// ---------------------------------------------------------------- mobile "more" menu
function renderMoreMenu() {
  const box = clear($('#moreBox'));
  const links = [
    ['plan', 'Trip Planner', 'Fuel cost of any trip'], ['prices', 'Fuel Prices', 'This week and history since 2017'], ['watch', 'Price Watch', 'Next Tuesday\'s price change'],
    ['stations', 'Stations', 'Cheapest station near you'], ['news', 'News', 'Why prices are moving'], ['garage', 'My Garage', 'Vehicles, budget, alerts'], ['about', 'Help', 'FAQ, glossary, how it works'],
  ];
  if (state.user?.role === 'admin') links.push(['admin', 'Integration Monitor', 'Admin dashboard']);
  box.append(dropdown(h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Menu', title: 'Menu' }, icon('menu')), (menu, close) => {
    for (const [r, label, desc] of links) menu.append(h('a', { href: `#/${r}`, onClick: close }, h('span', null, label, h('small', null, desc))));
  }, { align: 'right' }));
}

// ---------------------------------------------------------------- auth
export function renderUserBox() {
  const box = clear($('#userBox'));
  renderMoreMenu();
  renderBell();
  if (!state.user) {
    box.append(h('button', { class: 'btn small primary', type: 'button', onClick: () => authDialog() }, 'Sign in'));
    return;
  }
  const initials = state.user.name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  box.append(h('div', { class: 'user-chip' },
    state.user.role === 'admin' ? h('a', { class: 'btn small hide-sm', href: '#/admin', title: 'Integration Monitor' }, icon('gear'), 'Monitor') : null,
    dropdown(h('button', { class: 'avatar', type: 'button', title: state.user.name, style: { border: 0, cursor: 'pointer' } }, initials), (menu, close) => {
      menu.append(
        h('div', { style: { padding: '6px 10px' } }, h('b', null, state.user.name), h('small', { class: 'muted', style: { display: 'block' } }, state.user.email)),
        h('hr'),
        h('a', { href: '#/garage', onClick: close }, icon('car'), 'My Garage'),
        state.user.role === 'admin' ? h('a', { href: '#/admin', onClick: close }, icon('gear'), 'Integration Monitor') : null,
        h('button', { type: 'button', onClick: async () => {
          close();
          await api('/auth/logout', { method: 'POST' });
          state.user = null; renderUserBox(); emit('auth'); toast('Signed out');
          if (['garage', 'admin'].includes(currentRoute)) render();
        } }, icon('x'), 'Sign out'));
    }, { align: 'right' })));
}

export async function authDialog(mode = 'login') {
  let current = mode;
  const err = h('div', { class: 'alert danger hidden' });
  const name = h('input', { type: 'text', autocomplete: 'name', placeholder: 'Juan Dela Cruz' });
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'At least 8 characters' });
  const nameField = h('div', { class: 'field hidden' }, h('label', null, 'Name'), name);
  const switcher = h('p', { class: 'muted', style: { marginTop: '10px', fontSize: '.88rem' } });
  const body = h('form', { onSubmit: (e) => e.preventDefault() }, nameField,
    h('div', { class: 'field' }, h('label', null, 'Email'), email),
    h('div', { class: 'field' }, h('label', null, 'Password'), pass), err, switcher);
  const sync = () => {
    nameField.classList.toggle('hidden', current !== 'register');
    pass.autocomplete = current === 'register' ? 'new-password' : 'current-password';
    clear(switcher).append(current === 'login' ? 'New here? ' : 'Have an account? ',
      h('a', { href: '#', onClick: (e) => { e.preventDefault(); current = current === 'login' ? 'register' : 'login'; sync(); } }, current === 'login' ? 'Create an account' : 'Sign in'),
      current === 'register' ? ' The first account becomes the admin.' : '');
  };
  sync();
  const result = await modal('Sign in to TipidLitro', body, [
    { label: 'Cancel', value: null },
    { label: 'Continue', primary: true, onClick: async () => {
      try {
        return await api(current === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body: { name: name.value, email: email.value, password: pass.value } });
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); return false; }
    } },
  ]);
  if (result) {
    state.user = result; renderUserBox(); emit('auth'); toast(`Welcome, ${result.name.split(' ')[0]}!`);
    // Only pages that are entirely about the account re-render; the planner keeps your trip.
    if (['garage', 'admin'].includes(currentRoute)) render();
  }
  return result;
}
window.tlAuth = authDialog;

// ---------------------------------------------------------------- notifications
let bellTimer = null;
let lastUnreadIds = new Set(store.get('seenNotifs', []));
async function renderBell() {
  const box = clear($('#bellBox'));
  clearTimeout(bellTimer);
  if (!state.user) return;
  let data = { unread: 0, items: [] };
  try { data = await api('/me/notifications'); } catch { return; }
  const btn = h('button', { class: 'icon-btn bell', type: 'button', 'aria-label': `Notifications (${data.unread} unread)`, title: 'Notifications' }, icon('bell'), data.unread ? h('span', { class: 'count' }, String(data.unread)) : null);
  box.append(dropdown(btn, (menu) => {
    menu.classList.add('notif-list');
    if (!data.items.length) menu.append(h('div', { class: 'notif muted' }, 'No notifications yet. Set price alerts in My Garage → Alerts.'));
    for (const n of data.items) {
      menu.append(h(n.link ? 'a' : 'div', { class: `notif ${n.read_at ? '' : 'unread'}`, href: n.link || undefined, style: { display: 'block' } },
        h('b', null, n.title), n.body ? h('span', { class: 'muted' }, n.body) : null, h('small', { class: 'faint', style: { display: 'block' } }, fmt.ago(n.created_at))));
    }
    menu.append(h('hr'), h('a', { href: '#/garage?tab=alerts' }, icon('bell'), 'Manage price alerts'));
    if (data.unread) api('/me/notifications/read', { method: 'POST' }).then(() => { btn.querySelector('.count')?.remove(); }).catch(() => {});
  }, { align: 'right' }));
  // Desktop notification for anything new since last time (only if the user allowed it).
  const fresh = data.items.filter((n) => !n.read_at && !lastUnreadIds.has(n.id));
  if (fresh.length && 'Notification' in window && Notification.permission === 'granted') {
    for (const n of fresh.slice(0, 3)) { try { new Notification(n.title, { body: n.body || '', icon: '/icon.svg' }); } catch { /* unsupported */ } }
  }
  lastUnreadIds = new Set(data.items.map((n) => n.id));
  store.set('seenNotifs', [...lastUnreadIds]);
  bellTimer = setTimeout(renderBell, 2 * 60 * 1000);
}

// ---------------------------------------------------------------- ticker + "new prices" banner
let tickerTimer = null;
async function refreshTicker() {
  const el = $('#ticker');
  try {
    const [sum, status] = await Promise.all([api('/prices/summary'), api('/status')]);
    state.status = status;
    const ncr = sum.regions.find((r) => r.region === 'NCR');
    clear(el);
    if (!ncr?.weekStart) {
      el.append(h('span', { class: 'tk' }, h('span', { class: 'spinner', style: { width: '14px', height: '14px', borderWidth: '2px' } }), ' Fetching the latest DOE pump prices… (first run takes about a minute)'));
      clearTimeout(tickerTimer); tickerTimer = setTimeout(refreshTicker, 15000);
      return;
    }
    el.append(h('span', { class: 'tk' }, icon('fuel'), h('b', null, 'NCR'), `week of ${fmt.week(ncr.weekStart, ncr.weekEnd)}`));
    for (const p of ncr.products.filter((x) => ['RON91', 'RON95', 'DIESEL'].includes(x.product))) {
      el.append(h('span', { class: 'sep' }, '|'), h('span', { class: 'tk' }, ({ RON91: 'RON91', RON95: 'RON95', DIESEL: 'Diesel' })[p.product], h('b', { class: 'num' }, fmt.peso(p.common))));
    }
    const adj = sum.latestAdjustment;
    if (adj) {
      el.append(h('span', { class: 'sep' }, '|'), h('span', { class: 'tk' }, `Adjustment ${fmt.date(adj.weekStart, { month: 'short', day: 'numeric' })}:`));
      for (const [k, label] of [['GASOLINE', 'Gas'], ['DIESEL', 'Diesel'], ['KEROSENE', 'Kero']]) {
        if (adj[k] == null) continue;
        el.append(h('span', { class: 'tk' }, label, h('b', { class: adj[k] > 0 ? 'up' : adj[k] < 0 ? 'down' : '' }, `${adj[k] > 0 ? '▲' : adj[k] < 0 ? '▼' : ''}${fmt.signedPeso(adj[k])}`)));
      }
    }
    if (status.doe?.checkedAt) el.append(h('span', { class: 'sep' }, '|'), h('span', { class: 'tk faint', title: 'TipidLitro checks the DOE website every hour' }, `DOE checked ${fmt.ago(status.doe.checkedAt)}`));
    if (ncr.stale) el.append(h('span', { class: 'badge amber' }, `${ncr.ageDays} days old`));
    showUpdateBanner(sum, status);
    clearTimeout(tickerTimer); tickerTimer = setTimeout(refreshTicker, 10 * 60 * 1000);
  } catch (e) {
    clear(el).append(h('span', null, navigator.onLine ? `Price service unavailable: ${e.message}` : 'You are offline — showing saved data where available.'));
    clearTimeout(tickerTimer); tickerTimer = setTimeout(refreshTicker, 30000);
  }
}

/** Tells returning visitors when DOE published something new since their last visit. */
function showUpdateBanner(sum, status) {
  const box = clear($('#updateBanner'));
  const key = `${status.doe?.latestNcrWeek || ''}|${status.doe?.latestAdjustment || ''}`;
  const seen = store.get('seenData', null);
  if (seen === null) { store.set('seenData', key); return; } // first visit: nothing is "new" yet
  if (seen === key) return;
  const [seenNcr, seenAdj] = seen.split('|');
  const parts = [];
  const ncr = sum.regions.find((r) => r.region === 'NCR');
  if (status.doe.latestNcrWeek && status.doe.latestNcrWeek !== seenNcr && ncr) {
    const pick = ncr.products.filter((p) => ['RON91', 'DIESEL'].includes(p.product)).map((p) => `${p.product === 'RON91' ? 'RON91' : 'Diesel'} ${fmt.peso(p.common)}${p.change ? ` (${p.change > 0 ? '▲' : '▼'}${Math.abs(p.change).toFixed(2)})` : ''}`);
    parts.push(`NCR prices for ${fmt.week(ncr.weekStart, ncr.weekEnd)}: ${pick.join(', ')}`);
  }
  const adj = sum.latestAdjustment;
  if (status.doe.latestAdjustment && status.doe.latestAdjustment !== seenAdj && adj) {
    parts.push(`adjustment from ${fmt.date(adj.weekStart, { month: 'short', day: 'numeric' })}: gasoline ${fmt.signedPeso(adj.GASOLINE)}, diesel ${fmt.signedPeso(adj.DIESEL)}`);
  }
  if (!parts.length) { store.set('seenData', key); return; }
  const dismiss = () => { store.set('seenData', key); clear(box); };
  box.append(h('div', { class: 'update-banner', role: 'status' }, icon('bell'), h('span', null, h('b', null, 'New from DOE: '), parts.join(' · ')), h('span', { class: 'spacer' }),
    h('a', { class: 'btn small primary', href: '#/prices', onClick: dismiss }, 'See prices'), h('button', { class: 'btn small ghost', type: 'button', onClick: dismiss }, 'Dismiss')));
}
window.tlRefreshTicker = refreshTicker;

// ---------------------------------------------------------------- boot
async function boot() {
  try { state.user = await api('/auth/me'); } catch { state.user = null; }
  renderUserBox();
  try { state.presets = await api('/vehicles'); } catch { state.presets = []; }
  refreshTicker();
  initChat($('#chatRoot'));
  await render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
boot();

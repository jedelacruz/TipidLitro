// Shared UI building blocks so every page looks and behaves the same:
// page headers with a help button, plain-language tips for jargon, tabs, sections, KPI tiles,
// and a short guided tour for first-time visitors.
import { h, icon, modal, store } from './lib.js';

/** Plain-language explanations of the words people see around the app. */
export const GLOSSARY = {
  common: ['Common price', 'The price most stations in an area charge that week, from the Department of Energy\'s weekly price monitoring.'],
  range: ['Price range', 'The cheapest and most expensive prices DOE saw at stations in the area that week.'],
  ron: ['RON 91 / 95 / 97', 'Gasoline grades. RON 91 is regular unleaded (most motorcycles and cars). RON 95 is premium. RON 97/100 is premium plus.'],
  dieselPlus: ['Diesel Plus', 'Premium diesel with additives. Costs a few pesos more than regular diesel.'],
  adjustment: ['Price adjustment', 'Oil companies change pump prices every Tuesday at 6 AM. They announce the change (per liter) on Monday.'],
  rollback: ['Rollback / hike', 'A rollback is a price decrease; a hike is an increase.'],
  kmpl: ['km/L (fuel economy)', 'How many kilometers your vehicle goes on one liter. Higher is cheaper. For electric vehicles we use km per kWh.'],
  estimate: ['Estimate', 'Calculated by TipidLitro (for example from a regional report), not a single number published by DOE.'],
  coding: ['Number coding', 'MMDA bans private cars from Metro Manila roads on one weekday (based on the plate\'s last digit), 7–10 AM and 5–8 PM.'],
  brent: ['Brent crude', 'The world benchmark price of crude oil, in US dollars per barrel. Philippine pump prices follow world oil prices with about a week\'s delay.'],
  mops: ['MOPS', 'Mean of Platts Singapore — the regional fuel price oil companies base weekly adjustments on. It is paid data, so we use Brent as a free stand-in.'],
  confidence: ['Confidence', 'How much to trust the estimate: based on how well the model matched past adjustments and how fresh the oil data is.'],
  trueCost: ['True cost', 'What you pay for the fill-up plus the fuel used to drive to the station and back.'],
  brandRange: ['DOE brand range', 'The lowest and highest price DOE recorded for that brand in your city this week.'],
  community: ['Community price', 'A price reported by a TipidLitro user at that station in the last 14 days.'],
  pressure: ['News pressure', 'Whether recent headlines point to higher prices (e.g. "hike", "OPEC cuts output") or lower prices ("rollback").'],
  tankToTank: ['Tank-to-tank', 'Fill up to full, note the odometer, then at the next full fill-up divide kilometers driven by liters added. That is your real km/L.'],
  integration: ['Integration', 'An outside system TipidLitro talks to (DOE website, map services, weather, news…).'],
  latency: ['Latency', 'How long an outside service took to answer, in milliseconds. Lower is better.'],
  cacheHit: ['Cache hit', 'An answer reused from TipidLitro\'s own copy instead of calling the outside service again. Saves time and free-tier limits.'],
  job: ['Scheduled job', 'A task the server runs automatically on a timer, like checking DOE for new prices every hour.'],
};

/** Small "i" bubble that explains a word on hover, focus or tap. */
export function tip(text) {
  return h('span', { class: 'tip', tabindex: '0', role: 'note', 'aria-label': text, 'data-tip': text, onClick: (e) => { e.stopPropagation(); e.currentTarget.classList.toggle('open'); } }, 'i');
}
/** A glossary word with its tip: term('common') → "Common price ⓘ". */
export const term = (key, label) => h('span', { class: 'term' }, label ?? GLOSSARY[key][0], tip(GLOSSARY[key][1]));

/** Help modal: what the page is for, how to use it, words to know. */
export function showHelp(title, { intro, steps = [], terms = [], extra = null }) {
  const body = h('div', { class: 'help' },
    intro ? h('p', null, intro) : null,
    steps.length ? [h('div', { class: 'section-title' }, 'How to use it'), h('ol', null, steps.map((s) => h('li', null, s)))] : null,
    terms.length ? [h('div', { class: 'section-title' }, 'Words to know'), h('dl', { class: 'glossary' }, terms.map((k) => [h('dt', null, GLOSSARY[k][0]), h('dd', null, GLOSSARY[k][1])]))] : null,
    extra);
  return modal(title, body, [{ label: 'Got it', primary: true, value: true }]);
}

export const helpButton = (title, help) => h('button', { class: 'help-btn', type: 'button', 'aria-label': `Help: ${title}`, title: 'How to use this page', onClick: () => showHelp(title, help) }, '?');

/** Same header on every page: title, one-line description, optional actions, help button. */
export function pageHeader({ title, subtitle, actions = null, help = null }) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'ph-text' }, h('h1', null, title, help ? helpButton(title, help) : null), subtitle ? h('p', null, subtitle) : null),
    actions ? h('div', { class: 'ph-actions' }, actions) : null);
}

/** Tab bar. items: [key, label, badge?]. Returns the element; onChange(key) runs on click. */
export function tabBar(items, active, onChange, { variant = '' } = {}) {
  const bar = h('div', { class: `tabs ${variant}`, role: 'tablist' });
  for (const [key, label, badge] of items) {
    bar.append(h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(key === active), class: key === active ? 'on' : '', dataset: { key },
      onClick: (e) => { for (const b of bar.children) { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-selected', String(b === e.currentTarget)); } onChange(key); },
    }, label, badge != null && badge !== '' ? h('span', { class: 'tab-badge' }, String(badge)) : null));
  }
  return bar;
}

/** Card with a consistent header. collapsible → <details>. */
export function section({ title, icon: ico, desc, actions, collapsible = false, open = true, className = '' }, ...children) {
  const head = h('div', { class: 'section-head' },
    h('div', null, h('h3', null, ico ? icon(ico) : null, title), desc ? h('p', { class: 'section-desc' }, desc) : null),
    actions ? h('div', { class: 'row', style: { gap: '6px' } }, actions) : null);
  if (!collapsible) return h('section', { class: `card ${className}` }, head, children);
  const d = h('details', { class: `card collapsible ${className}` }, h('summary', null, head), h('div', { class: 'collapsible-body' }, children));
  if (open) d.open = true;
  return d;
}

/** KPI tile: label, big value, small line, optional tone (good | warn | bad). */
export function kpi({ label, value, sub, tone, ico, tipText }) {
  return h('div', { class: `kpi-tile ${tone || ''}` },
    h('div', { class: 'kpi-label' }, ico ? icon(ico) : null, label, tipText ? tip(tipText) : null),
    h('div', { class: 'kpi-value' }, value),
    sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

/**
 * Guided tour. steps: [{ target: selector | () => Element, title, text, before?: () => void }]
 * Steps whose target is missing or hidden (e.g. on phones) are skipped.
 */
export function startTour(steps, key = 'tour') {
  let i = 0;
  const back = h('div', { class: 'tour-back' });
  const spot = h('div', { class: 'tour-spot' });
  const pop = h('div', { class: 'tour-pop', role: 'dialog', 'aria-live': 'polite' });
  document.body.append(back, spot, pop);
  // getBoundingClientRect (not offsetParent) so fixed-position targets like the chat button count as visible.
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const find = (s) => (typeof s.target === 'function' ? s.target() : document.querySelector(s.target));
  const end = () => { back.remove(); spot.remove(); pop.remove(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place); document.removeEventListener('keydown', onKey); store.set(key, true); };
  const onKey = (e) => { if (e.key === 'Escape') end(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
  let current = null;
  function place() {
    if (!current) return;
    const r = current.getBoundingClientRect();
    const pad = 6;
    Object.assign(spot.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const pw = Math.min(330, window.innerWidth - 24);
    const below = r.bottom + 12 + 180 < window.innerHeight;
    const top = below ? r.bottom + 12 : Math.max(12, r.top - 12 - pop.offsetHeight);
    const left = Math.min(Math.max(12, r.left), window.innerWidth - pw - 12);
    Object.assign(pop.style, { top: `${top}px`, left: `${left}px`, width: `${pw}px` });
  }
  function show() {
    const s = steps[i];
    s.before?.();
    current = find(s);
    if (!visible(current)) { if (i < steps.length - 1) { i++; show(); } else end(); return; }
    current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    pop.replaceChildren(
      h('div', { class: 'tour-step' }, `Step ${i + 1} of ${steps.length}`),
      h('h3', null, s.title), h('p', null, s.text),
      h('div', { class: 'row between' },
        h('button', { class: 'btn small ghost', type: 'button', onClick: end }, 'Skip tour'),
        h('div', { class: 'row', style: { gap: '6px' } },
          i > 0 ? h('button', { class: 'btn small', type: 'button', onClick: () => go(-1) }, 'Back') : null,
          h('button', { class: 'btn small primary', type: 'button', onClick: () => go(1) }, i === steps.length - 1 ? 'Done' : 'Next'))));
    setTimeout(place, 320);
    place();
  }
  function go(d) { const n = i + d; if (n < 0) return; if (n >= steps.length) { end(); return; } i = n; show(); }
  back.addEventListener('click', end);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  document.addEventListener('keydown', onKey);
  show();
}

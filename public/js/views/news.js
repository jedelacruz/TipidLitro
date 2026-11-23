// Fuel news: headlines from Google News RSS, PH outlets, GDELT (and optional APIs), tagged by topic.
import { alertBox, api, clear, empty, fmt, h, icon, loading } from '../lib.js';
import { pageHeader } from '../ui.js';

const HELP = {
  intro: 'Fuel-related headlines from several Philippine and global sources, collected every hour, so you can see why prices are moving.',
  steps: ['Tap a topic (pump prices, supply, conflict, policy, peso, oil market) to filter.', 'The ▲ / ▼ mark shows whether a headline points to higher or lower pump prices.', 'Tap a headline to read the full article on the publisher\'s site.'],
  terms: ['pressure', 'rollback', 'brent'],
};

const DIR = { up: ['▲', 'upward pressure'], down: ['▼', 'downward pressure'], mixed: ['◆', 'mixed'], neutral: ['•', 'neutral'] };

export async function render(root) {
  let category = '';
  const chips = h('div', { class: 'chips' });
  const list = h('div', { class: 'news-list' });
  const summary = h('div');
  root.append(
    pageHeader({ title: 'Fuel news', subtitle: 'Why are prices moving? Oil supply, conflict, taxes and the peso — refreshed hourly.', help: HELP }),
    summary, h('div', { class: 'card flat', style: { padding: '12px', marginBottom: '14px' } }, chips), list);

  async function load() {
    clear(list).append(loading());
    try {
      const d = await api(`/news?limit=80${category ? `&category=${category}` : ''}`);
      if (!chips.children.length) {
        const all = [['', 'All'], ...Object.entries(d.categories)];
        chips.append(...all.map(([k, label]) => h('button', { class: `chip ${k === category ? 'on' : ''}`, type: 'button', onClick: (e) => { category = k; [...chips.children].forEach((c) => c.classList.toggle('on', c === e.currentTarget)); load(); } }, label)));
        const p = d.pressure;
        const tot = p.up + p.down;
        clear(summary).append(h('div', { class: 'card', style: { marginBottom: '14px' } },
          h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, icon('trend'), 'Headline pressure, last 7 days'), h('span', { class: 'muted', style: { fontSize: '.85rem' } }, `${p.up} point up · ${p.down} point down · ${p.mixed} mixed`)),
          h('div', { class: 'gauge', style: { marginTop: '10px' } }, h('div', { class: 'g-up', style: { width: `${tot ? (p.up / tot) * 100 : 50}%` } }), h('div', { class: 'g-down', style: { flex: 1 } })),
          h('p', { class: 'muted', style: { fontSize: '.8rem', margin: '6px 0 0' } }, tot ? (p.score > 0.2 ? 'More headlines point to higher prices.' : p.score < -0.2 ? 'More headlines point to lower prices.' : 'Headlines are balanced.') : 'Not enough tagged headlines yet.')));
      }
      clear(list);
      if (!d.items.length) { list.append(empty('📰', 'No headlines yet', 'The news job runs hourly.')); return; }
      for (const n of d.items) {
        const [sym, label] = DIR[n.direction] || DIR.neutral;
        list.append(h('article', { class: 'card news-item' },
          h('a', { class: 'title', href: /^https?:\/\//i.test(n.url) ? n.url : undefined, target: '_blank', rel: 'noopener noreferrer' }, n.title),
          n.summary && n.summary !== n.title ? h('p', { class: 'muted', style: { fontSize: '.85rem', margin: 0 } }, n.summary.slice(0, 180)) : null,
          h('div', { class: 'meta' }, h('span', null, n.source || n.provider), h('span', null, '·'), h('span', null, fmt.ago(n.published_at)),
            h('span', { class: `dir ${n.direction}`, title: label }, sym, ' ', label)),
          n.categories.length ? h('div', { class: 'chips' }, n.categories.map((c) => h('span', { class: 'chip' }, d.categories[c] || c))) : null));
      }
    } catch (e) { clear(list).append(alertBox('danger', e.message)); }
  }
  await load();
}

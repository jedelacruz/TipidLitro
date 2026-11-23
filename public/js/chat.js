// Floating chat assistant ("Ask TipidLitro").
import { api, clear, h, icon, renderMarkdown, state, store } from './lib.js';

const SUGGESTIONS = [
  'Magkano from Cubao to Tagaytay by Vios?',
  '₱300 budget sa Click 125, gaano kalayo?',
  'Diesel price in Quezon City?',
  'Will gas go up next week?',
  'Bakit tumataas ang presyo ng diesel?',
  'Vios vs Click vs jeepney for 40 km',
  'Worth it ba 3 km away for ₱2 cheaper per liter, 30 liters?',
];

export function initChat(root) {
  let open = false; let busy = false;
  const history = store.get('chat', []).slice(-20);
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', placeholder: 'Ask about a trip, budget or prices…', maxlength: '500', 'aria-label': 'Message' });
  const provider = h('small', { class: 'muted' }, 'Answers from TipidLitro data');
  const fab = h('button', { class: 'chat-fab', type: 'button', 'aria-label': 'Open assistant', onClick: () => toggle(true) }, icon('chat'), h('span', { class: 'lbl' }, 'Ask TipidLitro'));
  const panel = h('section', { class: 'chat-panel hidden', role: 'dialog', 'aria-label': 'TipidLitro assistant' },
    h('div', { class: 'chat-head' }, h('img', { src: '/icon.svg', alt: '', width: 30, height: 30 }), h('div', { class: 't' }, h('b', null, 'TipidLitro Assistant'), provider),
      h('button', { class: 'icon-btn', type: 'button', title: 'Clear conversation', onClick: () => { history.length = 0; store.set('chat', []); drawAll(); } }, icon('trash')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: () => toggle(false) }, icon('x'))),
    log,
    h('div', { class: 'chat-suggest' }, SUGGESTIONS.map((s) => h('button', { class: 'chip', type: 'button', onClick: () => send(s) }, s))),
    h('form', { class: 'chat-form', onSubmit: (e) => { e.preventDefault(); send(input.value); } }, input, h('button', { class: 'btn primary', type: 'submit', 'aria-label': 'Send' }, icon('send'))));
  root.append(fab, panel);

  function toggle(v) {
    open = v;
    panel.classList.toggle('hidden', !open); fab.classList.toggle('hidden', open);
    if (open) { drawAll(); setTimeout(() => input.focus(), 30); }
  }

  function bubble(m) {
    if (m.role === 'user') return h('div', { class: 'msg user' }, m.text);
    const el = h('div', { class: 'msg bot' }, renderMarkdown(m.text));
    if (m.action?.type === 'open_trip') {
      const p = m.action.params;
      const enc = (x) => `${x[0]},${x[1]},${x[2] || ''}`;
      const qs = new URLSearchParams({ o: enc(p.o), d: enc(p.d), ...(p.v ? { v: p.v } : {}), ...(p.k ? { k: p.k } : {}), ...(p.rt ? { rt: '1' } : {}) });
      el.append(h('div', { class: 'act' }, h('button', { class: 'btn small', type: 'button', onClick: () => { window.tlNavigate(`#/plan?${qs}`); if (innerWidth < 900) toggle(false); } }, icon('route'), 'Open in Trip Planner')));
    }
    return el;
  }

  function drawAll() {
    clear(log);
    if (!history.length) {
      log.append(h('div', { class: 'msg bot' }, renderMarkdown('Hi! 👋 Ask me in English or Taglish:\n• trip fuel cost ("Magkano from Cubao to Tagaytay?")\n• how far a budget goes\n• DOE pump prices and next week\'s rollback/hike\n• why prices are moving')));
    }
    history.forEach((m) => log.append(bubble(m)));
    log.scrollTop = log.scrollHeight;
  }

  function plannerVehicle() {
    const key = store.get('vehicleKey', null);
    if (!key) return undefined;
    const [kind, id] = key.split(':');
    if (kind === 'preset') return { presetSlug: id };
    if (kind === 'uv') return { userVehicleId: Number(id) };
    return undefined;
  }

  async function send(text) {
    const msg = String(text || '').trim();
    if (!msg || busy) return;
    busy = true; input.value = '';
    history.push({ role: 'user', text: msg });
    drawAll();
    const typing = h('div', { class: 'msg bot' }, h('span', { class: 'typing' }, h('i'), h('i'), h('i')));
    log.append(typing); log.scrollTop = log.scrollHeight;
    try {
      const res = await api('/chat', { method: 'POST', body: { message: msg, history: history.slice(-7, -1), context: { location: state.location || undefined, vehicle: plannerVehicle(), region: state.user?.homeRegion || undefined } } });
      history.push({ role: 'assistant', text: res.reply, action: res.action });
      provider.textContent = res.provider.startsWith('gemini') ? 'Gemini · answers from TipidLitro data' : 'Offline mode (no Gemini key) · TipidLitro data';
    } catch (e) {
      history.push({ role: 'assistant', text: `Sorry — ${e.message}` });
    } finally {
      busy = false;
      store.set('chat', history.slice(-20));
      drawAll();
    }
  }
}

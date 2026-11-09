// 版式切换：桌面右下角两个小图标（简版 / 完整版）。阅读版暂停。
// 实际显示的版式（mode）= 选的版式；缩放 < 0.75 时无论选了哪个都显示简版。
// 用户点图标切换时播「纸面浮起」动画（morph.js）；缩放 < 0.75 的自动切换、开机恢复上次版式都不播。
import { store } from '../data/storage.js';
import { h } from './dom.js';

export const PRESETS = [
  { id: 'glance', name: '简约版', icon: '<path d="M5 7h14M5 12h10M5 17h12"/>' },
  { id: 'full', name: '详细版', icon: '<rect x="3" y="5" width="5" height="14" rx="1.5"/><rect x="9.5" y="5" width="5" height="14" rx="1.5"/><rect x="16" y="5" width="5" height="14" rx="1.5"/>' },
];

const stage = () => document.getElementById('stage');
let current = 'glance';
let mode = 'glance';
const listeners = new Set();
const modeListeners = new Set();

const isCompact = () => document.documentElement.classList.contains('compact');

/** 重新算实际显示的版式；变了就通知（缩放变化后也要调用）。animate：用户点图标切换时为 true，缩放引起的自动切换不播动画。 */
export function refreshMode(animate = false) {
  const next = isCompact() ? 'glance' : current;
  if (next === mode && stage().dataset.mode === next) return;
  const prev = mode;
  mode = next;
  stage().dataset.mode = mode;
  modeListeners.forEach((fn) => fn(mode, animate, prev));
}

export function setPreset(id, persist = true) {
  if (!PRESETS.some((x) => x.id === id)) return false;
  current = id;
  stage().dataset.preset = id;
  if (persist) store.set('preset', id);
  listeners.forEach((fn) => fn(id));
  refreshMode(persist);
  return true;
}
export const getPreset = () => current;
/** 实际显示的版式：'glance' | 'full'。 */
export const getMode = () => mode;
export const onModeChange = (fn) => modeListeners.add(fn);

class NcPreset extends HTMLElement {
  connectedCallback() {
    if (this.btns) return;
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', '预设');
    this.btns = PRESETS.map((p) => {
      const b = h('button', { class: 'ps-btn', 'aria-label': p.name, title: p.name, onclick: () => setPreset(p.id) });
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p.icon + '</svg>'; // 写死的图标
      b.dataset.id = p.id;
      return b;
    });
    this.append(...this.btns);
    const paint = (id) => this.btns.forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    listeners.add(paint);
    const saved = store.get('preset');
    setPreset(PRESETS.some((x) => x.id === saved) ? saved : 'glance', false);
    paint(current);
  }
}
customElements.define('nc-preset', NcPreset);

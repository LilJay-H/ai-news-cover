// <nc-hot> 热点 TOP 5：名次变化 ↑ 绿 / 新 橙 / ↓ 与持平 灰。新条目从顶部滑入，旧条目下推。
import { hot } from '../data/feeds.js';
import { h, clear, staticHTML, prefersReducedMotion, onTap } from './dom.js';
import { openDetail, openList } from './open.js';
import { BOARD } from '../host/opener.js';

const TOP = 5;

function deltaTag(d) {
  if (d == null) return null; // 还没有上一轮可比，不显示
  if (d === 'new') return h('span', { class: 'dl nw' }, '新');
  if (d > 0) return h('span', { class: 'dl up' }, '↑' + d);
  if (d < 0) return h('span', { class: 'dl' }, '↓' + -d);
  return h('span', { class: 'dl' }, '—');
}

class NcHot extends HTMLElement {
  connectedCallback() {
    if (this.listEl) return;
    this.classList.add('col');
    staticHTML(
      this,
      `<div class="rule"></div><div class="tick"></div>
       <div class="head e" style="--d:360ms"><span class="t serif">热点</span><div class="head-r"><span class="top5">TOP 5</span><button class="expand" aria-label="放大热点"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></div></div>
       <div class="hot-list"></div>
       <button class="more e" style="--d:760ms" data-href="${BOARD.hot}">查看全部 →</button>`
    );
    this.listEl = this.querySelector('.hot-list');
    onTap(this.querySelector('.expand'), () => openList('hot'));
    this.shown = null; // 上一次渲染的 id 集合
    this.unsub = hot.subscribe((s) => this.render(s));
  }

  disconnectedCallback() {
    if (this.unsub) this.unsub();
  }

  render(state) {
    this.classList.toggle('is-offline', state.status === 'offline' && !!state.data);
    clear(this.listEl);
    if (!state.data) {
      const sk = h('div', { class: 'hot-skel' });
      for (let i = 0; i < TOP; i++) sk.append(h('div', { class: 'skel' }));
      this.listEl.append(sk);
      return;
    }
    const items = state.data.items.slice(0, TOP);
    const prev = this.shown;
    const rows = items.map((it, i) => {
      const isNewcomer = prev && prev.size > 0 && !prev.has(it.id);
      const cls = 'item hot-row' + (!prev ? ' e' : '') + (isNewcomer ? ' newin flash' : '');
      return h(
        'button',
        { class: cls, style: !prev ? '--d:' + (480 + i * 40) + 'ms' : null, 'data-id': it.id, onclick: (e) => openDetail('hot', it.id, e.currentTarget) },
        h('span', { class: 'rk fr' + (i > 2 ? ' g' : '') }, String(i + 1)),
        h('span', { class: 'tt serif clamp2', title: it.title }, it.title),
        deltaTag(it.delta)
      );
    });
    this.listEl.append(...rows);
    // 有新条目挤进来：其余条目整体下推一下，不闪烁
    if (prev && prev.size > 0 && !prefersReducedMotion() && rows.some((r) => r.classList.contains('newin'))) {
      rows.filter((r) => !r.classList.contains('newin')).forEach((r) => {
        r.animate([{ transform: 'translateY(-60px)' }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.9,.25,1.08)' });
      });
    }
    this.shown = new Set(items.map((i) => i.id));
  }
}
customElements.define('nc-hot', NcHot);

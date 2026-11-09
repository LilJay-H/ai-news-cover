// <nc-featured> 精选：7 条 + 24 小时热力图 + 离线/加载状态。
import { featured, FEATURED_COUNT } from '../data/feeds.js';
import { h, clear, staticHTML, onTap } from './dom.js';
import { ago, catLabel, catColor, hhmm } from './format.js';
import { openDetail, openList } from './open.js';
import { titleWithHighlights } from './hl.js';
import { BOARD } from '../host/opener.js';

const HOUR = 3600000;
class NcFeatured extends HTMLElement {
  connectedCallback() {
    if (this.listEl) return;
    this.classList.add('col');
    staticHTML(
      this,
      `<div class="rule"></div><div class="tick"></div>
       <div class="head e" style="--d:300ms">
         <span class="t serif">精选</span>
         <div class="head-r">
           <div class="heat" title="近 24 小时更新量"></div>
           <span class="cnt"></span>
           <span class="offline-tag"><i></i><span class="off-text"></span></span>
           <button class="expand" aria-label="放大精选"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button>
         </div>
       </div>
       <div class="items"></div>
       <div class="retry-box e" style="--d:760ms"><span>暂时连不上 AIHOT，<br>每 5 分钟自动重试一次。</span><button class="more retry">现在重试 →</button></div>
       <button class="more all e" style="--d:760ms" data-href="${BOARD.featured}">查看全部 →</button>`
    );
    this.listEl = this.querySelector('.items');
    this.heatEl = this.querySelector('.heat');
    this.cntEl = this.querySelector('.cnt');
    this.offText = this.querySelector('.off-text');
    onTap(this.querySelector('.retry'), () => featured.refresh());
    onTap(this.querySelector('.expand'), () => openList('featured'));
    this.shown = new Set();
    this.rows = [];
    this.unsub = featured.subscribe((s) => this.render(s));
  }

  disconnectedCallback() {
    if (this.unsub) this.unsub();
  }

  render(state) {
    this.classList.toggle('is-offline', state.status === 'offline' && !!state.data);
    if (state.status === 'offline' && state.contentAt) {
      this.offText.textContent = '离线 · ' + hhmm(state.contentAt) + ' 的内容';
    }
    if (!state.data) return this.renderLoading(state.status === 'offline');
    this.draw(state.data.list);
  }

  renderLoading(failed) {
    this.classList.toggle('is-offline', false);
    clear(this.listEl);
    this.rows = [];
    if (failed) {
      this.offText.textContent = '离线';
      this.classList.add('is-offline'); // 显示重试提示
      this.listEl.style.opacity = '0';
      return;
    }
    this.listEl.style.opacity = '';
    for (let i = 0; i < 5; i++) this.listEl.append(h('div', { class: 'skel-row' }, h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel' })));
    this.listEl.append(h('div', { class: 'loading-note' }, '正在取今天的新闻…'));
  }

  draw(list) {
    this.listEl.style.opacity = '';
    clear(this.listEl);
    this.rows = [];
    const now = Date.now();
    const top = list.slice(0, FEATURED_COUNT);
    top.forEach((it, i) => {
      const isNew = now - it.publishedAt < HOUR;
      const lab = h('span', { class: 'lab' });
      const time = document.createTextNode('');
      lab.append(
        h('span', { class: 'dot', style: 'background:' + catColor(it.category) }),
        catLabel(it.category) + ' · ',
        time
      );
      if (isNew) lab.append(h('span', { class: 'new' }, h('i'), 'NEW'));
      const tt = h('p', { class: 'tt serif clamp2', title: it.title });
      if (i === 0) tt.append(...titleWithHighlights(it.title));
      else tt.append(it.title);
      const fresh = !this.shown.has(it.id);
      const row = h('button', { class: 'item feat-row' + (i === 0 ? ' hero' : '') + (fresh ? ' e' : ''), style: '--d:' + (420 + i * 40) + 'ms', 'data-id': it.id, onclick: (e) => openDetail('featured', it.id, e.currentTarget) }, lab, tt);
      this.listEl.append(row);
      this.rows.push({ time, at: it.publishedAt });
      this.shown.add(it.id);
    });
    this.updateTimes();
    this.drawHeat(list, now);
  }

  drawHeat(list, now) {
    const buckets = new Array(24).fill(0);
    let total = 0;
    for (const it of list) {
      const age = now - it.publishedAt;
      if (age < 0 || age >= 24 * HOUR) continue;
      buckets[23 - Math.floor(age / HOUR)]++;
      total++;
    }
    const max = Math.max(1, ...buckets);
    clear(this.heatEl);
    buckets.forEach((c, i) => {
      const bar = h('span', { class: i >= 20 ? 'hi' : '' });
      bar.style.height = Math.round(2 + (c / max) * 14) + 'px';
      this.heatEl.append(bar);
    });
    this.cntEl.textContent = '近 24 小时 · ' + total + ' 条';
  }

  /** 每分钟刷新“N 分钟前”，不重建节点。 */
  updateTimes() {
    const now = Date.now();
    for (const r of this.rows) r.time.nodeValue = ago(r.at, now);
  }
}
customElements.define('nc-featured', NcFeatured);

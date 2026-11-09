// <nc-daily> AI 日报卡：日期、头条、“另有……”。展开全文在第 4 步做。
import { daily } from '../data/feeds.js';
import { h, clear, staticHTML, onTap } from './dom.js';
import { openDaily } from './open.js';
import { foldButton, requestFlip } from './fold.js';

class NcDaily extends HTMLElement {
  connectedCallback() {
    if (this.bodyEl) return;
    this.classList.add('col');
    staticHTML(
      this,
      `<div class="rule"></div><div class="tick"></div>
       <div class="dh e" style="--d:600ms"><span class="t serif">AI 日报</span><span class="d"></span></div>
       <button class="body item"></button>
       <button class="more e" style="--d:740ms">查看全部 →</button>`
    );
    this.append(foldButton('front', '翻到一个月前的今天', requestFlip));
    this.dateEl = this.querySelector('.d');
    this.moreEl = this.querySelector('.more');
    this.bodyEl = this.querySelector('.body');
    onTap(this.bodyEl, () => openDaily(undefined, this));
    this.unsub = daily.subscribe((s) => this.render(s));
  }

  disconnectedCallback() {
    if (this.unsub) this.unsub();
  }

  render(state) {
    this.classList.toggle('is-offline', state.status === 'offline' && !!state.data);
    clear(this.bodyEl);
    if (!state.data) {
      this.dateEl.textContent = '';
      this.bodyEl.append(h('div', { class: 'skel', style: 'height:22px;width:92%' }), h('div', { class: 'skel', style: 'height:22px;width:70%' }), h('div', { class: 'skel', style: 'height:13px;width:80%;margin-top:6px' }));
      return;
    }
    const d = state.data;
    if (d.link) this.moreEl.dataset.href = d.link;
    this.dateEl.textContent = d.date.slice(5).replace('-', '.');
    this.bodyEl.append(h('p', { class: 'lead clamp3 e', style: '--d:660ms', title: d.lead }, d.lead));
    if (d.others.length) {
      this.bodyEl.append(h('p', { class: 'also clamp2 e', style: '--d:700ms' }, '另有 ' + d.others.join('、') + (d.others.length > 2 ? ' 等' : '')));
    }
  }
}
customElements.define('nc-daily', NcDaily);

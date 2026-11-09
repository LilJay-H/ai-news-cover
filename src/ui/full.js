// <nc-full> 完整版主线（卡片风）：报头两块（时间 / 名言）+ 精选卡 + 热点卡 + 日报卡。
// 数据和简版共用同一份（feeds.js），点开后的界面走 open.js → panel.js（居中卡片）。
// 趣味组件（留言条、深夜劝睡、一个月前）的逻辑在 fun.js，这里只提供它们要用的显示位置。
import { featured, hot, daily } from '../data/feeds.js';
import { h, clear, staticHTML, prefersReducedMotion, onTap } from './dom.js';
import { ago, catLabel, catColor, hhmm, cnDate, isoWeek, pad2 } from './format.js';
import { quoteAt } from './quotes.js';
import { now as getNow, quoteNow } from './clock-source.js';
import { openDetail, openList, openDaily } from './open.js';
import { titleWithHighlights } from './hl.js';
import { BOARD } from '../host/opener.js';
import { springMs, springPair, createSpringValue } from './motion.js';
import { foldButton, requestFlip } from './fold.js';

const HOUR = 3600000;
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const EXPAND_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

/** 翻面状态的标记（哪一面可点、给读屏看的 aria）。 */
function flipClass(card, flipped) {
  const e = card.el;
  e.flip.classList.toggle('flipped', flipped);
  e.front.setAttribute('aria-hidden', String(flipped));
  e.back.setAttribute('aria-hidden', String(!flipped));
  e.back.classList.toggle('live', flipped);
}

/** 今年第几天、今年共几天。 */
function dayOfYear(d) {
  const y0 = new Date(d.getFullYear(), 0, 1);
  const day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - y0) / 86400000) + 1;
  const total = (d.getFullYear() % 4 === 0 && d.getFullYear() % 100 !== 0) || d.getFullYear() % 400 === 0 ? 366 : 365;
  return { day, total };
}

/** 署名拆成：小标签（姓氏大写）/ 页脚全名 / 年份。 */
function splitBy(by) {
  const m = /^(.*?),?\s*((?:c\.\s*)?\d{4})$/.exec(by);
  const name = (m ? m[1] : by).trim();
  const year = m ? m[2] : '';
  let label = name;
  if (/^[\x00-\x7f\s.,&'-]*[A-Za-z]/.test(name) && /[A-Za-z]/.test(name)) {
    const parts = name.split(/\s*(?:,|&)\s*/).filter(Boolean);
    const last = (s) => s.trim().split(/\s+/).pop();
    label = (parts.length > 2 ? last(parts[0]) + ' ET AL.' : parts.map(last).join(' & ')).toUpperCase();
  }
  return { label, name, year };
}

const deltaTag = (d) => {
  if (d == null) return null;
  if (d === 'new') return h('span', { class: 'dl nw' }, '新');
  if (d > 0) return h('span', { class: 'dl up' }, '↑' + d);
  if (d < 0) return h('span', { class: 'dl' }, '↓' + -d);
  return h('span', { class: 'dl' }, '—');
};

class NcFull extends HTMLElement {
  connectedCallback() {
    if (this.built) return;
    this.built = true;
    this.nightOn = false;
    this.nightText = '';
    staticHTML(
      this,
      `<div class="fh">
         <div class="fh-col fh-left">
           <i class="r1"></i><i class="r3"></i>
           <div class="fh-body">
             <div class="fh-top"><span class="fh-time fr"></span>
               <div class="fh-dates"><span class="fh-mon fr"></span><span class="fh-cn serif"></span><span class="fh-wk"></span></div></div>
             <div class="fh-prog"><div class="fh-track"><i class="fill"></i><i class="dot"></i></div><span class="fh-pct"></span></div>
           </div>
           <i class="r1"></i>
           <div class="fh-foot"><span class="fh-yr"></span><span class="fh-slot"></span></div>
         </div>
         <div class="fh-col fh-right">
           <i class="r1"></i><i class="r3"></i>
           <div class="fh-body fh-q">
             <span class="fh-mark fr" aria-hidden="true">“</span>
             <div class="fh-qt"><span class="fh-lab fr"></span><p class="fh-qp serif"></p></div>
           </div>
           <i class="r1"></i>
           <div class="fh-foot"><span class="fh-by"></span><span class="fh-yr2"></span></div>
         </div>
       </div>
       <section class="fcard ff"></section>
       <section class="fcard fhot"></section>
       <div class="fd-wrap"><div class="fd-flip">
         <article class="fcard fd-face front"></article>
         <article class="fcard fd-face back" aria-hidden="true"></article>
       </div></div>
       <div class="note-slot"></div>
       <div class="night-glow" aria-hidden="true"></div>`
    );
    const q = (s) => this.querySelector(s);
    this.el = {
      time: q('.fh-time'), mon: q('.fh-mon'), cn: q('.fh-cn'), wk: q('.fh-wk'),
      fill: q('.fill'), dot: q('.dot'), pct: q('.fh-pct'), yr: q('.fh-yr'), slot: q('.fh-slot'),
      qBox: q('.fh-qt'), lab: q('.fh-lab'), qp: q('.fh-qp'), by: q('.fh-by'), yr2: q('.fh-yr2'),
      ff: q('.ff'), fhot: q('.fhot'), front: q('.fd-face.front'), back: q('.fd-face.back'), flip: q('.fd-flip'), note: q('.note-slot'),
    };
    this.filter = null;
    this.firstFeat = true;
    this.times = [];
    this.hotShown = null;
    this.quoteSlot = null;
    this.dirtyFit = false;

    this.buildHot();
    this.buildDaily();
    this.unsubs = [featured.subscribe((s) => this.renderFeat(s)), hot.subscribe((s) => this.renderHot(s)), daily.subscribe((s) => this.renderDaily(s))];
    this.update(getNow(), false);
  }

  disconnectedCallback() {
    (this.unsubs || []).forEach((u) => u());
  }

  // ---------- 报头 ----------
  /** 每分钟调用一次。animate：名言换句时淡出淡入。 */
  update(now = getNow(), animate = true) {
    const e = this.el;
    e.time.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    const p = (now.getHours() * 60 + now.getMinutes()) / 1440;
    e.fill.style.width = p * 100 + '%';
    e.dot.style.left = p * 100 + '%';
    e.pct.textContent = '今天走过了 ' + Math.round(p * 100) + '%';
    if (this.lastDay !== now.getDate()) {
      this.lastDay = now.getDate();
      e.mon.textContent = MON[now.getMonth()] + ' ' + pad2(now.getDate());
      e.cn.textContent = cnDate(now);
      e.wk.textContent = '第 ' + isoWeek(now) + ' 周';
      const { day, total } = dayOfYear(now);
      e.yr.textContent = now.getFullYear() + ' 年第 ' + day + ' 天 · 余 ' + (total - day) + ' 天';
    }
    if (this.nightOn) e.slot.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    this.updateQuote(animate);
    this.updateTimes();
  }

  updateQuote(animate) {
    if (this.nightOn) return;
    const { slot, quote } = quoteAt(quoteNow());
    if (slot === this.quoteSlot) return;
    const first = this.quoteSlot === null;
    this.quoteSlot = slot;
    if (first || !animate || prefersReducedMotion()) return this.renderQuote(quote);
    this.el.qBox.classList.add('swap');
    setTimeout(() => {
      this.renderQuote(quote);
      this.el.qBox.classList.remove('swap');
    }, 700);
  }

  renderQuote(q) {
    const { label, name, year } = splitBy(q.by);
    this.el.lab.textContent = label;
    this.setQuoteText(q.zh);
    this.el.by.textContent = q.source ? name + ' · ' + q.source : name;
    this.el.yr2.textContent = year;
  }

  setQuoteText(zh) {
    const p = this.el.qp;
    clear(p);
    zh.split('\n').forEach((l, i) => {
      if (i) p.append(document.createElement('br'));
      p.append(l);
    });
    this.fitQuote();
  }

  /** 名言字号自适应：从 30px 往小试，直到两行半以内放得下（报头高度固定）。看不见时先标记，显示后再算。 */
  fitQuote() {
    const p = this.el.qp;
    if (!p.offsetParent) {
      this.dirtyFit = true;
      return;
    }
    this.dirtyFit = false;
    for (const size of [30, 26, 23, 20, 18, 16]) {
      p.style.fontSize = size + 'px';
      if (p.offsetHeight <= 86) break;
    }
  }

  /**
   * 开机进场（只在开机 / 首次加载时播一次，切版式、刷新数据都不播）。节奏：
   * 报头双线从左画出 0.30–0.75s → 时间上浮 0.55–0.95s → 日期侧栏 0.70–1.05s → 进度线涨到当前 0.85–1.35s、名言 0.90–1.25s
   * → 三张卡片依次上浮（间隔 60ms，各 0.5s），卡内内容晚 0.35s → 右下版式图标与 AIHOT 胶囊最后淡入 1.6–1.9s。
   * 减少动态效果：只淡入 150ms。
   */
  playBoot() {
    const all = (sel, root = this) => [...root.querySelectorAll(sel)];
    const out = [];
    // 各元素用「柔和进场」弹簧，起始时刻不变
    const go = (els, frames, delay) => {
      for (const el of [].concat(els)) if (el) out.push(el.animate(frames, { duration: springMs('soft'), delay, fill: 'backwards' }));
    };
    const fade = springPair('soft', { opacity: 0 }, { opacity: 1 });
    const ends = [document.querySelector('nc-preset'), document.getElementById('aihot-link')];
    if (prefersReducedMotion()) {
      for (const el of [this, ...ends]) if (el) out.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'backwards' }));
      return out;
    }
    const rise = (dy) => springPair('soft', { opacity: 0, y: dy }, { opacity: 1, y: 0 });
    go(all('.fh .r1, .fh .r3'), springPair('soft', { sx: 0 }, { sx: 1 }), 300);
    go(this.el.time, rise(10), 550);
    go(all('.fh-dates'), springPair('soft', { opacity: 0, x: -8 }, { opacity: 1, x: 0 }), 700);
    go(this.el.fill, springPair('soft', { sx: 0 }, { sx: 1 }), 850);
    go(this.el.dot, springPair('soft', { opacity: 0, s: 0.3 }, { opacity: 1, s: 1 }), 1250);
    go([this.el.pct, ...all('.fh-foot')], fade, 950);
    go(all('.fh-right .fh-body'), rise(8), 900);
    [this.el.ff, this.el.fhot, this.querySelector('.fd-wrap')].forEach((card, i) => {
      go(card, rise(28), 1000 + i * 60);
      const kids = card === this.querySelector('.fd-wrap') ? this.el.front.children : card.children;
      go([...kids], rise(8), 1350 + i * 60);
    });
    go(ends, fade, 1600);
    return out;
  }

  /** 版式切到完整版、或字体加载完后调用。 */
  onShown() {
    if (this.dirtyFit) this.fitQuote();
  }

  /** 深夜劝睡：换掉名言区。on=false 还原名言。 */
  setNight(on, text, instant = false) {
    this.nightOn = on;
    this.nightText = on ? text : '';
    document.getElementById('stage').classList.toggle('night', on);
    document.documentElement.classList.toggle('night', on);
    const e = this.el;
    if (!instant) e.qBox.classList.add('swap');
    const apply = () => {
      if (on) {
        e.lab.textContent = 'GOOD NIGHT';
        this.setQuoteText(text);
        e.by.textContent = '深夜 · 今晚只说这一次';
        e.slot.textContent = pad2(getNow().getHours()) + ':' + pad2(getNow().getMinutes());
        e.yr2.textContent = '';
      } else {
        e.slot.textContent = '';
        this.quoteSlot = null;
        this.updateQuote(false);
      }
      e.qBox.classList.remove('swap');
    };
    if (instant || prefersReducedMotion()) apply();
    else setTimeout(apply, 700);
  }

  // ---------- 精选卡 ----------
  renderFeat(state) {
    const card = this.el.ff;
    card.classList.toggle('is-offline', state.status === 'offline' && !!state.data);
    this.featState = state;
    if (!card.firstChild) this.buildFeat();
    const off = card.querySelector('.off-text');
    if (state.status === 'offline' && state.contentAt) off.textContent = '离线 · ' + hhmm(state.contentAt) + ' 的内容';
    this.drawFeat();
  }

  buildFeat() {
    const card = this.el.ff;
    staticHTML(
      card,
      `<div class="ff-head e" style="--d:300ms">
         <div class="ff-title"><span class="ct serif">精选</span><div class="heat" title="近 24 小时更新量"></div>
           <span class="cnt"></span><span class="offline-tag"><i></i><span class="off-text"></span></span></div>
         <div class="ff-tools"><div class="chips"></div><button class="ex" aria-label="放大精选">${EXPAND_ICON}</button></div>
       </div>
       <div class="ff-body"></div>`
    );
    this.heatEl = card.querySelector('.heat');
    this.cntEl = card.querySelector('.cnt');
    this.chipsEl = card.querySelector('.chips');
    this.bodyEl = card.querySelector('.ff-body');
    onTap(card.querySelector('.ex'), () => openList('featured'));
  }

  drawFeat() {
    const state = this.featState;
    clear(this.bodyEl);
    this.times = [];
    if (!state.data) {
      clear(this.chipsEl);
      clear(this.heatEl);
      this.cntEl.textContent = '';
      const sk = h('div', { class: 'ff-skel' }, h('div', { class: 'skel', style: 'height:230px;border-radius:20px' }));
      const g = h('div', { class: 'ff-grid' });
      for (let i = 0; i < 5; i++) g.append(h('div', { class: 'skel-row' }, h('div', { class: 'skel' }), h('div', { class: 'skel' }), h('div', { class: 'skel' })));
      sk.append(g);
      this.bodyEl.append(sk, h('div', { class: 'loading-note' }, state.status === 'offline' ? '暂时连不上 AIHOT，每 5 分钟自动重试。' : '正在取今天的新闻…'));
      return;
    }
    const now = Date.now();
    const list = state.data.list;
    const recent = list.filter((it) => now - it.publishedAt < 24 * HOUR && now - it.publishedAt > -HOUR);
    const pool = recent.length >= 6 ? recent : list;

    // 分类标签：全部 + 条数最多的 4 类
    const counts = new Map();
    for (const it of pool) counts.set(it.category, (counts.get(it.category) || 0) + 1);
    const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
    if (this.filter && !cats.includes(this.filter)) this.filter = null;
    clear(this.chipsEl);
    this.chipsEl.append(this.chip(null, '全部'), ...cats.map((c) => this.chip(c, catLabel(c))));

    this.drawHeat(list, now);
    this.cntEl.textContent = '近 24 小时 · ' + recent.length + ' 条';

    const shown = this.filter ? pool.filter((it) => it.category === this.filter) : pool;
    const sorted = shown.slice().sort((a, b) => (b.score || 0) - (a.score || 0) || b.publishedAt - a.publishedAt);
    const hero = sorted[0];
    const rest = sorted.slice(1, 6);
    const fresh = this.firstFeat;
    this.firstFeat = false;
    if (!hero) {
      this.bodyEl.append(h('p', { class: 'ff-empty' }, '这一类暂时没有新内容。'));
      return;
    }
    this.bodyEl.append(this.heroEl(hero, now, fresh));
    const grid = h('div', { class: 'ff-grid' });
    rest.forEach((it, i) => {
      const lab = h('span', { class: 'lab' }, h('span', { class: 'dot', style: 'background:' + catColor(it.category) }));
      const t = document.createTextNode('');
      lab.append(catLabel(it.category) + ' · ', t);
      this.times.push({ node: t, at: it.publishedAt });
      grid.append(
        h('button', { class: 'ff-item' + (fresh ? ' e' : ''), style: fresh ? '--d:' + (520 + i * 40) + 'ms' : null, 'data-id': it.id, onclick: (e) => openDetail('featured', it.id, e.currentTarget) }, lab, h('p', { class: 'tt serif clamp3', title: it.title }, it.title))
      );
    });
    grid.append(h('button', { class: 'ff-more serif', 'data-href': BOARD.featured }, '查看近 7 天全部 →'));
    this.bodyEl.append(grid);
    this.updateTimes();
  }

  heroEl(it, now, fresh) {
    const t = document.createTextNode('');
    this.times.push({ node: t, at: it.publishedAt });
    const pill = h('span', { class: 'pill-l' }, catLabel(it.category) + ' · ' + (it.source ? it.source + ' · ' : ''), t);
    const size = it.title.length > 50 ? ' s30' : it.title.length > 34 ? ' s36' : '';
    const h2 = h('h2', { class: 'ff-hero-t serif' + size, title: it.title }, ...titleWithHighlights(it.title));
    if (now - it.publishedAt < HOUR) h2.append(h('span', { class: 'new' }, h('i'), 'NEW'));
    return h(
      'button',
      { class: 'ff-hero' + (fresh ? ' e' : ''), style: fresh ? '--d:440ms' : null, 'data-id': it.id, onclick: (e) => openDetail('featured', it.id, e.currentTarget) },
      pill,
      h2,
      it.summary ? h('p', { class: 'sum clamp2' }, it.summary) : null
    );
  }

  chip(cat, text) {
    const on = this.filter === cat;
    const b = h('button', { class: 'chip' + (on ? ' on' : ''), style: cat ? '--cc:' + catColor(cat) : null, onclick: () => ((this.filter = cat), this.drawFeat()) });
    if (cat) b.append(h('i', { class: 'cd' }));
    b.append(text);
    return b;
  }

  drawHeat(list, now) {
    const buckets = new Array(24).fill(0);
    for (const it of list) {
      const age = now - it.publishedAt;
      if (age < 0 || age >= 24 * HOUR) continue;
      buckets[23 - Math.floor(age / HOUR)]++;
    }
    const max = Math.max(1, ...buckets);
    clear(this.heatEl);
    buckets.forEach((c, i) => {
      const bar = h('span', { class: i >= 20 ? 'hi' : '' });
      bar.style.height = Math.round(2 + (c / max) * 14) + 'px';
      this.heatEl.append(bar);
    });
  }

  updateTimes() {
    const now = Date.now();
    for (const r of this.times) r.node.nodeValue = ago(r.at, now);
  }

  // ---------- 热点卡 ----------
  buildHot() {
    const card = this.el.fhot;
    staticHTML(
      card,
      `<div class="fk-head e" style="--d:360ms"><span class="ct serif">热点</span><button class="ex" aria-label="放大热点">${EXPAND_ICON}</button></div>
       <div class="fk-list"></div>
       <button class="fk-more e" style="--d:700ms" data-href="${BOARD.hot}">查看全部 →</button>`
    );
    this.hotList = card.querySelector('.fk-list');
    onTap(card.querySelector('.ex'), () => openList('hot'));
  }

  renderHot(state) {
    const card = this.el.fhot;
    card.classList.toggle('is-offline', state.status === 'offline' && !!state.data);
    clear(this.hotList);
    if (!state.data) {
      for (let i = 0; i < 5; i++) this.hotList.append(h('div', { class: 'skel', style: 'height:22px;margin:12px 0' }));
      return;
    }
    const items = state.data.items.slice(0, 5);
    const prev = this.hotShown;
    const rows = items.map((it, i) => {
      const isNew = prev && prev.size > 0 && !prev.has(it.id);
      return h(
        'button',
        { class: 'fk-row' + (i === 0 ? ' first' : '') + (!prev ? ' e' : '') + (isNew ? ' newin flash' : ''), style: !prev ? '--d:' + (440 + i * 40) + 'ms' : null, 'data-id': it.id, onclick: (e) => openDetail('hot', it.id, e.currentTarget) },
        h('span', { class: 'rk fr' + (i > 2 ? ' g' : '') }, String(i + 1)),
        h('span', { class: 'tt serif', title: it.title }, it.title),
        deltaTag(it.delta)
      );
    });
    this.hotList.append(...rows);
    if (prev && prev.size > 0 && !prefersReducedMotion() && rows.some((r) => r.classList.contains('newin'))) {
      rows.filter((r) => !r.classList.contains('newin')).forEach((r) => r.animate([{ transform: 'translateY(-60px)' }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.9,.25,1.08)' }));
    }
    this.hotShown = new Set(items.map((i) => i.id));
  }

  // ---------- 日报卡（正面今天，背面一个月前） ----------
  buildDaily() {
    staticHTML(
      this.el.front,
      `<div class="fd-h e" style="--d:560ms"><span class="serif fd-t">AI 日报</span><span class="fd-d fr"></span></div>
       <button class="fd-body"></button>
       <button class="fd-more e" style="--d:700ms">查看全部 →</button>`
    );
    this.dBody = this.el.front.querySelector('.fd-body');
    this.dDate = this.el.front.querySelector('.fd-d');
    this.dMore = this.el.front.querySelector('.fd-more');
    onTap(this.dBody, () => openDaily(undefined, this.el.front));
    staticHTML(
      this.el.back,
      `<div class="fm-h"><span class="serif fm-t">一个月前的今天</span><span class="fm-d"></span></div>
       <p class="fm-lead serif clamp3"></p>
       <p class="fm-sub">那时，它是头条。</p>
       <button class="fm-back">翻回今天 →</button>`
    );
    this.el.front.append(foldButton('front', '翻到一个月前的今天', requestFlip));
    this.el.back.append(foldButton('back', '翻回今天', () => this.showMonth(false)));
    onTap(this.el.back, (e) => {
      if (e.target.closest && e.target.closest('.dfold, .fm-back')) return;
      if (this.monthInfo && this.monthInfo.iso) openDaily(this.monthInfo.iso, this.el.back);
    });
    this.mSub = this.el.back.querySelector('.fm-sub');
    this.mDate = this.el.back.querySelector('.fm-d');
    this.mLead = this.el.back.querySelector('.fm-lead');
    onTap(this.el.back.querySelector('.fm-back'), () => this.showMonth(false));
  }

  renderDaily(state) {
    const card = this.el.front;
    card.classList.toggle('is-offline', state.status === 'offline' && !!state.data);
    clear(this.dBody);
    if (!state.data) {
      this.dDate.textContent = '';
      this.dBody.append(h('div', { class: 'skel', style: 'height:26px;width:92%' }), h('div', { class: 'skel', style: 'height:26px;width:70%;margin-top:8px' }), h('div', { class: 'skel', style: 'height:14px;width:80%;margin-top:12px' }));
      return;
    }
    const d = state.data;
    if (d.link) this.dMore.dataset.href = d.link;
    this.dDate.textContent = d.date.slice(5).replace('-', '.');
    this.dBody.append(h('p', { class: 'lead serif clamp2', title: d.lead }, d.lead));
    if (d.others.length) this.dBody.append(h('p', { class: 'also clamp1' }, '另有 ' + d.others.join('、') + (d.others.length > 2 ? ' 等' : '')));
  }

  /** 一个月前的今天：翻到背面（info = { date: '10.07', title, missed?, none? }）或翻回今天。沿竖直中线转 180°，中等弹簧，途中再点会掉头。 */
  showMonth(on, info, instant = false) {
    if (on && info) {
      this.mDate.textContent = info.date;
      this.mLead.textContent = info.title || '';
      this.mSub.textContent = info.none ? '那天没有出刊' : info.missed ? '那天没有出刊，这是最近的一期' : '那时，它是头条。';
    }
    this.monthInfo = on ? info || this.monthInfo : null;
    const flip = this.el.flip;
    flipClass(this, !!on);
    if (!this.flipSp) this.flipSp = createSpringValue(0, (p) => (flip.style.transform = p === 0 ? '' : `rotateY(${180 * p}deg)`));
    const sp = this.flipSp;
    if (instant || prefersReducedMotion()) {
      sp.set(on ? 1 : 0);
      if (!instant) flip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 }); // 减少动态效果：不翻转，150ms 淡入
    } else sp.to(on ? 1 : 0, 'mid');
    if (!on && this.onMonthBack) this.onMonthBack();
  }
  get monthShown() {
    return this.el.flip.classList.contains('flipped');
  }

  // ---------- 留言条 ----------
  /** note = { head, lines: [], tail }；点一下揉成纸团消失。 */
  showNote(note, instant = false) {
    this.hideNote(true);
    this.noteData = note;
    const el = h(
      'div',
      { class: 'note', 'aria-label': '留言条，点一下收起', role: 'button' },
      h('div', { class: 'note-flutter' },
        h('div', { class: 'note-shadow', 'aria-hidden': 'true' }),
        h('div', { class: 'note-paper' },
          h('i', { class: 'note-line', 'aria-hidden': 'true' }),
          h('i', { class: 'note-shade', 'aria-hidden': 'true' }),
          h('div', { class: 'n-head' }, note.head),
          h('div', { class: 'n-lines' }, ...note.lines.map((l) => h('div', { class: 'clamp2' }, '· ' + l))),
          h('div', { class: 'n-tail' }, note.tail)),
        h('i', { class: 'tape l', 'aria-hidden': 'true' }),
        h('i', { class: 'tape r', 'aria-hidden': 'true' }))
    );
    onTap(el, () => this.hideNote());
    this.el.note.append(el);
    this.noteEl = el;
    if (instant) {
      el.style.transition = 'none';
      el.classList.add('show');
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  }

  hideNote(instant = false) {
    const el = this.noteEl;
    if (!el) return;
    this.noteEl = null;
    this.noteData = null;
    if (instant || prefersReducedMotion()) return el.remove();
    el.classList.add('crumple');
    setTimeout(() => el.remove(), 520);
  }
  get noteShown() {
    return !!this.noteEl;
  }
}
customElements.define('nc-full', NcFull);

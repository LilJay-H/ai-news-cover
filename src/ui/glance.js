// 简版（印纸风）点开后的四种形态，全部留在同一张纸上：
//   精选放大   → 精选在纸面上就地铺开，大时钟收成顶部一行        （states/GlanceExpand）
//   热点放大   → 热点单列占进精选原位，精选缩进热点原位，日报不动  （states/HotAll）
//   点条目     → 右侧印纸详情面板                              （states/Detail_Glance）
//   点日报整块 → 印纸日报全文，可翻前后一天                    （states/DailyFullGlance）
// 居中卡片（panel.js）留给阅读版 / 完整版，这里不调用它。
// 所有元素都放进 #stage，跟着整体等比缩放；点击一律用 onTap（按下即触发）。
import { featured, hot, daily, loadStory, loadDailyIndex, loadDaily } from '../data/feeds.js';
import { BOARD } from '../host/opener.js';
import { h, clear, onTap, prefersReducedMotion } from './dom.js';
import { ago, catLabel, catColor, hhmm, pad2, cnDate } from './format.js';
import { titleWithHighlights } from './hl.js';
import { scrollable } from './scrollable.js';
import { now as clockNow } from './clock-source.js';
import { boxFrames, riseIn, springMs, springFrames, createSpringValue } from './motion.js';
import { waterLevel } from './water.js';

const stage = document.getElementById('stage');
const HOUR = 3600000;
const SPRING = 'cubic-bezier(0.2, 0.9, 0.25, 1.08)';
const SOFT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const FEAT_MAX = 11; // 铺开后：1 条头条 + 10 条
const FEAT_MINI = 5; // 热点全部时，精选缩进去显示的条数
const CAT_ORDER = ['ai-models', 'ai-products', 'industry', 'paper', 'opinion', 'tip'];
// 日报分组名是「模型发布/更新」「行业动态」这类，按开头两个字认分类色
const LABEL_CAT = { 模型: 'ai-models', 产品: 'ai-products', 行业: 'industry', 论文: 'paper', 观点: 'opinion', 教程: 'tip' };
const labelCat = (label) => LABEL_CAT[label.slice(0, 2)];

const ICON = {
  collapse: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>',
  expand: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>',
};
// 只用于写死的图标，不含接口数据
function iconBtn(cls, label, svg, fn) {
  const b = h('button', { class: cls, 'aria-label': label, onclick: fn });
  b.innerHTML = svg;
  return b;
}

// ---------- 小工具 ----------
const scaleNow = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
/** 元素在 1920×1080 舞台坐标里的位置。 */
function stageRect(el) {
  const s = scaleNow();
  const sr = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: (r.left - sr.left) / s, y: (r.top - sr.top) / s, w: r.width / s, h: r.height / s };
}
/** 把 el 从 from 位置变到它自己现在的位置所需的 transform（transform-origin 为左上角）。 */
function fromRect(from, to) {
  return `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w}, ${from.h / to.h})`;
}
function play(el, frames, ms, easing = SPRING) {
  if (prefersReducedMotion()) return Promise.resolve();
  const a = el.animate(frames, { duration: ms, easing, fill: 'both' });
  return a.finished.then(
    () => a,
    () => a
  );
}
const fin = (a) => a && a.cancel && a.cancel();
function stagger(root, sel, base = 90, gap = 40) {
  root.querySelectorAll(sel).forEach((el, i) => {
    el.classList.add('g-in');
    el.style.setProperty('--d', base + i * gap + 'ms');
  });
}
const weekday = (date) => '星期' + '日一二三四五六'[new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)).getDay()];
const mdDot = (s) => s.slice(5).replace('-', '.');
function deltaTag(d) {
  if (d == null) return null;
  if (d === 'new') return h('span', { class: 'dl nw' }, '新');
  if (d > 0) return h('span', { class: 'dl up' }, '↑' + d);
  if (d < 0) return h('span', { class: 'dl' }, '↓' + -d);
  return h('span', { class: 'dl' }, '—');
}
function lab(it, withNew) {
  const el = h('span', { class: 'lab' }, h('span', { class: 'dot', style: 'background:' + catColor(it.category) }), catLabel(it.category) + ' · ' + ago(it.publishedAt));
  if (withNew && Date.now() - it.publishedAt < HOUR) el.append(h('span', { class: 'new' }, h('i'), 'NEW'));
  return el;
}
const updatedAt = (state) => (state.contentAt ? hhmm(state.contentAt) + ' 更新' : '');
function rule() {
  return [h('div', { class: 'rule' }), h('div', { class: 'tick' })];
}

// ---------- 舞台上的固定件：遮罩、点外部收回的接球层、顶部小时钟 ----------
const scrim = h('div', { id: 'g-scrim' });
const catcher = h('div', { id: 'g-catch' });
const mini = h(
  'div',
  { class: 'g-mini' },
  h('div', { class: 'gm-time fr' }, h('span', { class: 'gm-out' }), h('span', { class: 'gm-in', 'aria-hidden': 'true' })),
  h('div', { class: 'gm-r' }, h('span', { class: 'gm-date serif' }), h('div', { class: 'gm-bar' }, h('i', { class: 'gm-track' }, h('b')), h('span', { class: 'gm-pct' })))
);
stage.append(catcher, mini, scrim);
const mOut = mini.querySelector('.gm-out');
const mIn = mini.querySelector('.gm-in');
const mDate = mini.querySelector('.gm-date');
const mFill = mini.querySelector('.gm-track b');
const mPct = mini.querySelector('.gm-pct');

/** 顶部小时钟：和大时钟同一个水位映射（按 64/196 缩小）。每分钟由 main.js 调一次，打开时也调。 */
export function tickMini(d = clockNow()) {
  const text = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  const p = (d.getHours() * 60 + d.getMinutes()) / 1440;
  mOut.textContent = mIn.textContent = text;
  mIn.style.clipPath = `inset(${(waterLevel(p) * 64) / 196}px 0 0 0)`;
  mDate.textContent = cnDate(d);
  mFill.style.width = Math.round(p * 100) + '%';
  mPct.textContent = '今天走过了 ' + Math.round(p * 100) + '%';
}

// ---------- 铺开状态：'' | 'feat' | 'hot' ----------
// 动效标准：位置过渡（原来的条目直接挪过去）、弹簧驱动、可打断。
// 铺开 / 收回由一个「弹簧值」p 驱动（0 = 收起，1 = 铺开）：点收起时从当前位置和速度掉头，不跳帧。
let mode = '';
let fx = null; // 精选铺开
let hx = null; // 热点铺开
let closingNow = null; // 正在收回时，用来立刻收尾
let closingObj = null; // 正在收回的那一个（同一栏再点开时接着用）

function setMode(m) {
  mode = m;
  stage.dataset.g = m; // CSS 据此藏起被换掉的栏
  catcher.classList.toggle('on', !!m);
}
function finishClosing() {
  if (closingNow) closingNow();
}
const late = (p, a, b) => Math.max(0, Math.min(1, (p - a) / (b - a)));
const ease3 = (u) => 1 - Math.pow(1 - u, 3);
/** 浮入：opacity + 小位移；到位后把行内样式清干净（悬停效果才不被盖住）。 */
function rise(el, u, dy, rm) {
  if (!el) return;
  if (u >= 0.999) {
    el.style.opacity = '';
    el.style.transform = '';
    return;
  }
  el.style.opacity = String(Math.max(0, u));
  el.style.transform = rm ? '' : `translateY(${(1 - u) * dy}px)`;
}
/** 位置过渡：元素从 from 位置（设计坐标）挪回它自己的位置。 */
function moveFrom(el, from, to, p, rm) {
  if (rm || Math.abs(p - 1) < 0.0005) return void (el.style.transform = '');
  el.style.transform = `translate(${(from.x - to.x) * (1 - p)}px, ${(from.y - to.y) * (1 - p)}px)`;
}
/** 栏上沿的横线：从来源栏的宽度和位置长（缩）成铺开后的样子。 */
function ruleFrom(el, from, to, p, rm) {
  if (rm || Math.abs(p - 1) < 0.0005) return void (el.style.transform = '');
  el.style.transformOrigin = '0 0';
  el.style.transform = `translate(${(from.x - to.x) * (1 - p)}px, 0) scaleX(${from.w / to.w + (1 - from.w / to.w) * p})`;
}
/** 要被「挪过去」的来源条目的位置：id → 设计坐标里的矩形。 */
function sourceRects(sel) {
  const m = new Map();
  stage.querySelectorAll(sel).forEach((el) => m.set(String(el.dataset.id), stageRect(el)));
  return m;
}

// ---- 精选铺开 ----
function buildFeat() {
  const o = { cat: '', shown: [], head: null, scroll: null, foot: null, el: null, firstPaint: true };
  const chips = h('div', { class: 'gf-chips' });
  const heat = h('div', { class: 'gf-heat' });
  const cnt = h('span', { class: 'gf-24' }, '近 24 小时');
  const scroll = h('div', { class: 'g-scroll' });
  const upd = h('span', { class: 'gf-upd' });
  o.chips = chips;
  o.heat = heat;
  o.scroll = scroll;
  o.upd = upd;
  o.el = h(
    'section',
    { class: 'g-feat', 'aria-label': '精选（展开）' },
    ...rule(),
    h('div', { class: 'gf-head' }, h('div', { class: 'gf-l' }, h('span', { class: 'gf-t serif' }, '精选'), chips), h('div', { class: 'gf-r' }, heat, cnt, iconBtn('g-btn', '收起精选', ICON.collapse, () => collapse()))),
    h('div', { class: 'g-scroll-w g-fit' }, scroll), // 桌面上的铺开不滚动：版面按固定行高排满，不出现滚动条和 ▲▼
    h('div', { class: 'gf-foot' }, h('button', { class: 'more', 'data-href': BOARD.featured }, '查看近 7 天全部 →'), upd)
  );
  return o;
}

function paintHeat(box, list) {
  const buckets = new Array(24).fill(0);
  const t = Date.now();
  for (const it of list) {
    const age = t - it.publishedAt;
    if (age >= 0 && age < 24 * HOUR) buckets[23 - Math.floor(age / HOUR)]++;
  }
  const max = Math.max(1, ...buckets);
  clear(box);
  buckets.forEach((c, i) => {
    const s = h('span', { class: i >= 20 ? 'hi' : '' });
    s.style.height = Math.round(2 + (c / max) * 14) + 'px';
    box.append(s);
  });
}

function renderFeat(animate) {
  const state = featured.state;
  if (!fx || !state.data) return;
  const all = state.data.list;
  const cats = CAT_ORDER.filter((c) => all.some((it) => it.category === c));
  if (fx.cat && !cats.includes(fx.cat)) fx.cat = '';
  const list = fx.cat ? all.filter((it) => it.category === fx.cat) : all;
  fx.shown = list.slice(0, FEAT_MAX);

  clear(fx.chips);
  const chip = (id, content, cls) => h('button', { class: 'gf-chip' + (fx.cat === id ? ' on' : '') + (cls || ''), onclick: () => ((fx.cat = id), renderFeat(true)) }, content);
  fx.chips.append(chip('', ['全部 ', h('i', null, String(all.length))]));
  for (const c of cats) fx.chips.append(chip(c, [h('span', { class: 'dot', style: 'background:' + catColor(c) }), catLabel(c)]));
  paintHeat(fx.heat, all);
  fx.upd.textContent = updatedAt(state);

  clear(fx.scroll);
  const [top, ...rest] = fx.shown;
  if (top) {
    const tt = h('h2', { class: 'serif' });
    tt.append(...titleWithHighlights(top.title));
    fx.scroll.append(
      h(
        'button',
        { class: 'gf-hero', 'data-id': top.id, onclick: (e) => openDetail('featured', top.id, e.currentTarget) },
        h('span', { class: 'gf-no fr' }, '01'),
        h('span', { class: 'gf-mid' }, h('span', { class: 'lab hl-lab' }, h('span', { class: 'dot', style: 'background:' + catColor(top.category) }), [catLabel(top.category), top.source, ago(top.publishedAt)].filter(Boolean).join(' · ')), tt),
        h('span', { class: 'gf-side' }, top.summary ? h('span', { class: 'gf-sum clamp3' }, top.summary) : null)
      )
    );
  }
  const grid = h('div', { class: 'gf-grid' });
  rest.forEach((it, i) => {
    grid.append(
      h(
        'button',
        { class: 'gf-row', 'data-id': it.id, onclick: (e) => openDetail('featured', it.id, e.currentTarget) },
        h('span', { class: 'n fr' }, pad2(i + 2)),
        h('span', { class: 'b' }, lab(it, true), h('span', { class: 'tt serif clamp1', title: it.title }, it.title), it.summary ? h('span', { class: 'sm clamp1' }, it.summary) : null),
        h('span', { class: 'arr', 'aria-hidden': 'true' }, '→')
      )
    );
  });
  fx.scroll.append(grid);
  if (!fx.shown.length) fx.scroll.append(h('p', { class: 'g-empty' }, '这一类近期没有新闻。'));
  if (animate) stagger(fx.scroll, '.gf-hero, .gf-row', fx.firstPaint ? 380 : 0, 30);
  fx.firstPaint = false;
}

// 精选铺开：原来的 7 条直接挪到两列里的新位置，大时间飞到顶部一行，栏上沿的线向左延伸；
// 只有新增的条目、摘要、分类标签、页脚浮入（先结构、后细节）。
// Plash（Mac）版式：各栏左右镜像，位置照画布 Mac_Glance（热点 / 日报在左，精选居中，时间在右）
const MAC = document.documentElement.classList.contains('plash');
const X_BIG = MAC ? 407 : 500; // 铺开后的大栏左边
const X_FEAT = MAC ? 407 : 1147; // 精选栏左边
const X_SIDE = MAC ? 120 : 1541; // 热点 / 日报栏左边
const X_DETAIL = MAC ? 120 : 1147; // 印纸详情左边
const FEAT_FROM = { x: X_FEAT, y: 106, w: 366, h: 771 };
const MINI_TIME = { tx: MAC ? 407 - 860 : 0, ty: -214, s: 0.3265 }; // 196px 大时间 → 64px 顶部小时钟

/** 大时间飞向顶部小时钟：p 0→1。 */
function timeFly(p, rm) {
  const time = stage.querySelector('#center .time');
  if (!time) return;
  if (rm) {
    time.style.opacity = String(1 - late(p, 0, 1));
    time.style.transform = '';
    return;
  }
  const q = Math.min(p, 1.02);
  time.style.transformOrigin = '0 0';
  time.style.transform = Math.abs(p) < 0.0005 ? '' : `translate(${MINI_TIME.tx * q}px, ${MINI_TIME.ty * q}px) scale(${1 + (MINI_TIME.s - 1) * q})`;
  time.style.opacity = String(1 - late(p, 0.62, 0.9));
}
function timeReset() {
  const time = stage.querySelector('#center .time');
  if (time) time.style.transform = time.style.opacity = '';
}

function featApply(o, p, rm) {
  // 收回到快到位时，把原来的栏放回来（它会淡入），铺开里挪动的条目同时淡出
  if (o.closing && !o.revealed && p < 0.3) {
    o.revealed = true;
    stage.dataset.g = mode;
  }
  const el = o.el;
  ruleFrom(el.querySelector('.rule'), FEAT_FROM, { x: X_BIG, y: 106, w: 1013, h: 1 }, p, rm);
  el.querySelector('.tick').style.transform = rm || Math.abs(p - 1) < 0.0005 ? '' : `translateX(${647 * (1 - p)}px)`;
  const head = el.querySelector('.gf-head');
  rise(head.querySelector('.gf-t'), late(p, 0.3, 0.65), 10, rm);
  rise(head.querySelector('.gf-r'), late(p, 0.34, 0.7), 10, rm);
  rise(o.chips, late(p, 0.62, 0.95), 8, rm);
  rise(el.querySelector('.gf-foot'), late(p, 0.4, 0.75), 8, rm);
  rise(o.scroll.parentElement, late(p, 0.3, 0.6), 0, rm);
  timeFly(p, rm);
  if (!o.moved) return;
  o.moved.forEach((m, i) => {
    if (m.from) {
      moveFrom(m.el, m.from, m.to, p, rm);
      m.el.style.opacity = p >= 0.999 ? '' : String(Math.min(1, p * 8));
      // 摘要、箭头这些来源栏里没有的细节，等位置到了再浮入
      m.extra.forEach((x) => rise(x, late(p, 0.55, 0.9), 0, rm));
    } else {
      rise(m.el, ease3(late(p, 0.3 + i * 0.012, 0.75 + i * 0.012)), 14, rm);
    }
  });
}

/** 建好精选铺开（不播动画）：p0 = 弹簧的起点（0 收起 / 1 已铺开）。 */
function makeFeat(p0) {
  const src = sourceRects('nc-featured .items [data-id]');
  const o = buildFeat();
  o.kind = 'feat';
  fx = o;
  stage.append(o.el);
  let first = true;
  o.unsub = featured.subscribe(() => {
    renderFeat(false);
    if (!first) o.moved = null; // 数据刷新重绘了条目：这次动画就不再挪它们（此时通常已落定）
    first = false;
  });
  // 量好每一条的新位置，配上来源位置
  o.moved = [];
  o.el.querySelectorAll('[data-id]').forEach((el) => {
    const from = src.get(String(el.dataset.id));
    const extra = [...el.querySelectorAll('.sm, .arr, .gf-side, .gf-no')];
    o.moved.push({ el, from: from || null, to: from ? stageRect(el) : null, extra: from ? extra : [] });
  });
  o.sp = createSpringValue(p0, (p, rm) => featApply(o, p, rm));
  o.sp.set(p0);
  return o;
}

function openFeat() {
  if (!featured.state.data) return;
  if (sw) return void (sw.target !== 'feat' && startSwap('feat')); // 互换途中点了另一边：掉头
  if (mode === 'feat') return;
  if (mode === 'hot') return startSwap('feat');
  if (closingObj && closingObj.kind === 'feat') {
    // 正在收回时又点了放大：从当前位置掉头
    const o = closingObj;
    closingObj = closingNow = null;
    fx = o;
    o.closing = false;
    setMode('feat');
    stage.classList.add('g-mini-on');
    o.el.classList.remove('g-leaving');
    o.el.classList.add('g-anim');
    o.sp.to(1, 'big', () => o.el.classList.remove('g-anim'));
    return;
  }
  finishClosing();
  stage.classList.add('booted'); // 开机的浮起不再重播
  setMode('feat');
  stage.classList.add('g-mini-on');
  tickMini();
  const o = makeFeat(0);
  o.el.classList.add('g-anim');
  o.sp.to(1, 'big', () => o.el.classList.remove('g-anim'));
}

function closeFeat(instant) {
  const o = fx;
  if (!o) return;
  fx = null;
  o.unsub && o.unsub();
  setMode('');
  stage.classList.remove('g-mini-on');
  const done = () => {
    o.sp.stop();
    closingNow = closingObj = null;
    o.el.remove();
    timeReset();
    stage.dataset.g = mode; // 此时才把原来的精选栏放回来
  };
  if (instant) return done();
  o.closing = true;
  o.revealed = false;
  stage.dataset.g = 'feat'; // 收回快到位之前，原栏继续藏着
  o.el.classList.add('g-leaving', 'g-anim');
  closingObj = o;
  closingNow = done;
  o.sp.to(0, 'back', done);
}

// ---- 热点铺开（states/HotExpand） ----
function buildHot() {
  const list = h('div', { class: 'gh-list' });
  const upd = h('span', { class: 'gh-upd' });
  const hotEl = h(
    'section',
    { class: 'g-hot', 'aria-label': '热点（铺开）' },
    ...rule(),
    h('div', { class: 'gh-head' }, h('div', { class: 'gh-l' }, h('span', { class: 'gh-t serif' }, '热点'), h('span', { class: 'gh-top' }, 'TOP 10'), upd), iconBtn('g-btn', '收起热点', ICON.collapse, () => collapse())),
    list,
    h('button', { class: 'more', 'data-href': BOARD.hot }, '在 AIHOT 查看完整热榜 →')
  );
  const miniList = h('div', { class: 'gm-list' });
  const miniEl = h('section', { class: 'g-fmini', 'aria-label': '精选（收起）' }, ...rule(), h('div', { class: 'gx-head' }, h('span', { class: 'gx-t serif' }, '精选'), iconBtn('g-btn s', '放大精选', ICON.expand, () => openFeat())), miniList, h('button', { class: 'more', 'data-href': BOARD.featured }, '查看全部 →'));
  return { hotEl, miniEl, list, upd, miniList };
}

const srcLine = (it) => [it.sourceCount ? it.sourceCount + ' 个来源' : '', it.sourceNames && it.sourceNames.length ? it.sourceNames.slice(0, 3).join('、') : '', it.latestAt ? ago(it.latestAt) : ''].filter(Boolean).join(' · ');

function renderHot() {
  if (!hx) return;
  const hs = hot.state;
  if (hs.data) {
    hx.upd.textContent = updatedAt(hs);
    clear(hx.list);
    const items = hs.data.items.slice(0, 10);
    const top = Math.max(1, items[0] ? items[0].signalCount : 1);
    items.forEach((it, i) => {
      // 热度底色长度 = 本条 signalCount ÷ 第 1 名（没有 signalCount 时按名次递减，保证有梯度）
      const ratio = it.signalCount ? it.signalCount / top : 1 - i * 0.075;
      const w = Math.max(0.12, Math.min(1, ratio)) * 100;
      hx.list.append(
        h(
          'button',
          { class: 'gh-row' + (i > 2 ? ' lo' : ''), 'data-id': it.id, style: '--w:' + w.toFixed(1) + '%', onclick: (e) => openDetail('hot', it.id, e.currentTarget) },
          h('i', { class: 'gh-bar' }),
          h('i', { class: 'gh-line' }),
          h('span', { class: 'rk fr' }, String(i + 1)),
          h('span', { class: 'gh-mid' }, h('span', { class: 'tt serif', title: it.title }, it.title), h('span', { class: 'gh-sub' }, srcLine(it))),
          deltaTag(it.delta)
        )
      );
    });
  }
  const fs = featured.state;
  if (fs.data) {
    clear(hx.miniList);
    fs.data.list.slice(0, FEAT_MINI).forEach((it, i) => {
      hx.miniList.append(
        h(
          'button',
          { class: 'gm-row' + (i === 0 ? ' top' : ''), 'data-id': it.id, onclick: (e) => openDetail('featured', it.id, e.currentTarget) },
          h('span', { class: 'lab' }, h('span', { class: 'dot', style: 'background:' + catColor(it.category) }), catLabel(it.category) + ' · ' + ago(it.publishedAt)),
          h('span', { class: 'tt serif clamp2', title: it.title }, it.title)
        )
      );
    });
  }
}

function hotApply(o, p, rm) {
  if (o.closing && !o.revealed && p < 0.3) {
    o.revealed = true;
    stage.dataset.g = mode;
  }
  const hotEl = o.hotEl;
  const miniEl = o.miniEl;
  const settled = rm || Math.abs(p - 1) < 0.0005;
  ruleFrom(hotEl.querySelector('.rule'), o.srcHotRule, { x: X_BIG, y: 106, w: 1013, h: 1 }, p, rm);
  hotEl.querySelector('.tick').style.transform = settled ? '' : `translateX(${(o.srcHotRule.x - X_BIG) * (1 - p)}px)`;
  ruleFrom(miniEl.querySelector('.rule'), o.srcFeatRule, { x: X_SIDE, y: 106, w: 259, h: 1 }, p, rm);
  miniEl.querySelector('.tick').style.transform = settled ? '' : `translateX(${(o.srcFeatRule.x - X_SIDE) * (1 - p)}px)`;
  const head = hotEl.querySelector('.gh-head');
  rise(head.querySelector('.gh-l'), late(p, 0.3, 0.65), 8, rm);
  rise(head.querySelector('.g-btn'), late(p, 0.34, 0.7), 8, rm);
  rise(hotEl.querySelector('.more'), late(p, 0.55, 0.9), 8, rm);
  rise(miniEl.querySelector('.gx-head'), late(p, 0.3, 0.65), 8, rm);
  rise(miniEl.querySelector('.more'), late(p, 0.45, 0.8), 8, rm);
  timeFly(p, rm);
  if (!o.rows) return;
  o.rows.forEach((m, i) => {
    if (m.from) {
      moveFrom(m.el, m.from, m.to, p, rm);
      m.el.style.opacity = p >= 0.999 ? '' : String(Math.min(1, p * 8));
      if (m.rk) m.rk.style.transform = rm || p >= 0.999 ? '' : `scale(${0.65 + 0.35 * Math.min(p, 1)})`;
      m.hide.forEach((x) => rise(x, late(p, 0.5, 0.85), 0, rm));
    } else {
      // 6–10 名随后依次浮入（约 35ms 一条）
      rise(m.el, ease3(late(p, 0.3 + (i - 5) * 0.05, 0.62 + (i - 5) * 0.05)), 14, rm);
    }
    // 热度底色：落定后从左往右依次长出
    const u = ease3(late(p, 0.62 + i * 0.015, Math.min(0.99, 0.98 + i * 0.01)));
    m.bars.forEach((b) => {
      b.style.transform = u >= 0.999 ? '' : `scaleX(${u})`;
      b.style.opacity = u >= 0.999 ? '' : String(Math.min(1, u * 4));
    });
  });
  o.mini.forEach((m) => {
    if (m.from) {
      moveFrom(m.el, m.from, m.to, p, rm);
      m.el.style.opacity = p >= 0.999 ? '' : String(Math.min(1, p * 8));
    } else rise(m.el, late(p, 0.4, 0.8), 8, rm);
  });
}

/** 建好热点铺开（不播动画）：p0 = 弹簧的起点。 */
function makeHot(p0) {
  const srcHot = sourceRects('nc-hot .hot-list [data-id]');
  const srcFeat = sourceRects('nc-featured .items [data-id]');
  const rr = (sel) => {
    const e = stage.querySelector(sel);
    return e ? stageRect(e) : { x: 0, y: 0, w: 1, h: 1 };
  };
  const srcHotRule = rr('nc-hot .rule');
  const srcFeatRule = rr('nc-featured .rule');
  const o = buildHot();
  o.kind = 'hot';
  o.srcHotRule = srcHotRule;
  o.srcFeatRule = srcFeatRule;
  hx = o;
  stage.append(o.hotEl, o.miniEl);
  renderHot();
  o.unsubs = [hot.subscribe(renderHot), featured.subscribe(renderHot)];
  // 配对：前 5 条热点从热点栏挪到中间对应行；精选前 5 条从精选栏挪到右侧
  o.rows = [...o.list.children].map((el) => {
    const from = srcHot.get(String(el.dataset.id)) || null;
    return { el, from, to: from ? stageRect(el) : null, rk: el.querySelector('.rk'), hide: from ? [...el.querySelectorAll('.gh-sub')] : [], bars: [...el.querySelectorAll('.gh-bar, .gh-line')] };
  });
  o.mini = [...o.miniList.children].map((el) => {
    const from = srcFeat.get(String(el.dataset.id)) || null;
    return { el, from, to: from ? stageRect(el) : null };
  });
  o.sp = createSpringValue(p0, (p, rm) => hotApply(o, p, rm));
  o.sp.set(p0);
  return o;
}

function openHot() {
  if (!hot.state.data) return;
  if (sw) return void (sw.target !== 'hot' && startSwap('hot'));
  if (mode === 'hot') return;
  if (mode === 'feat') return startSwap('hot');
  if (closingObj && closingObj.kind === 'hot') {
    const o = closingObj;
    closingObj = closingNow = null;
    hx = o;
    o.closing = false;
    setMode('hot');
    stage.classList.add('g-mini-on');
    o.hotEl.classList.add('g-anim');
    o.miniEl.classList.add('g-anim');
    o.sp.to(1, 'big', () => (o.hotEl.classList.remove('g-anim'), o.miniEl.classList.remove('g-anim')));
    return;
  }
  finishClosing();
  stage.classList.add('booted');
  setMode('hot');
  stage.classList.add('g-mini-on');
  tickMini();
  const o = makeHot(0);
  o.hotEl.classList.add('g-anim');
  o.miniEl.classList.add('g-anim');
  o.sp.to(1, 'big', () => (o.hotEl.classList.remove('g-anim'), o.miniEl.classList.remove('g-anim')));
}

function closeHot(instant) {
  const o = hx;
  if (!o) return;
  hx = null;
  o.unsubs.forEach((u) => u());
  setMode('');
  stage.classList.remove('g-mini-on');
  const done = () => {
    o.sp.stop();
    closingNow = closingObj = null;
    o.hotEl.remove();
    o.miniEl.remove();
    timeReset();
    stage.dataset.g = mode;
  };
  if (instant) return done();
  o.closing = true;
  o.revealed = false;
  stage.dataset.g = 'hot';
  o.hotEl.classList.add('g-anim');
  o.miniEl.classList.add('g-anim');
  closingObj = o;
  closingNow = done;
  o.sp.to(0, 'back', done);
}

// ---- 精选铺开 ⇄ 热点铺开：连续互换 ----
// 一个弹簧值 p 管两个方向：0 = 精选铺开，1 = 热点铺开。顶部时间行和两条栏线不动，当作视线锚点。
//   精选 → 热点：精选 01–05 缩回右侧变成 5 条（01 的头条卡缩成第 1 条，橙底淡掉），06–11 下沉淡出，
//               摘要和标签最先淡出；热点 1–5 从右侧飞到中间 1–5 行，6–10 随后浮入，热度底色最后长出；栏头文字原地换字。
//   热点 → 精选：反过来（同一个 p 倒着走）。大展开弹簧，可打断：途中点另一边的放大按钮，从当前位置和速度掉头。
let sw = null;
const cf = (p) => Math.min(1, p * 5); // 配对元素的交叉淡入：很快，位置过渡才是主角

function startSwap(target) {
  if (sw) {
    if (sw.target === target) return;
    sw.target = target;
    setMode(target);
    stage.dataset.g = 'swap';
    sw.sp.to(target === 'hot' ? 1 : 0, 'big', endSwap);
    return;
  }
  const from = target === 'hot' ? 'feat' : 'hot';
  const cur = from === 'feat' ? fx : hx;
  if (!cur) return;
  finishClosing();
  if (cur.sp.running) cur.sp.set(1); // 还在铺开途中就换：先让它落定
  setMode(target);
  stage.dataset.g = 'swap'; // 精选栏继续藏着，右侧热点栏暂时留着当来源 / 去处
  stage.classList.add('g-swapping');
  if (target === 'hot') makeHot(1);
  else makeFeat(1);
  const fo = fx;
  const ho = hx;
  const hotCol = stage.querySelector('nc-hot');
  const idMap = (els) => new Map([...els].map((e) => [String(e.dataset.id), e]));
  const s = { target, fo, ho, hotCol, touched: new Set(), pairs: [], featOnly: [], miniOnly: [], hotOnly: [], colOnly: [], hotRows: [] };
  // 精选行 ↔ 缩进去的精选行
  const miniBy = idMap(ho.miniList.children);
  fo.el.querySelectorAll('[data-id]').forEach((a) => {
    const b = miniBy.get(String(a.dataset.id));
    if (!b) return void s.featOnly.push(a);
    miniBy.delete(String(a.dataset.id));
    s.pairs.push({ kind: 'feat', hero: a.classList.contains('gf-hero'), a, b, A: stageRect(a), B: stageRect(b), subs: [...a.querySelectorAll('.sm, .arr, .n, .gf-side, .gf-no')] });
  });
  s.miniOnly = [...miniBy.values()];
  // 右侧热点行 ↔ 热点铺开的行
  const hotBy = idMap(ho.list.children);
  [...stage.querySelectorAll('nc-hot .hot-list [data-id]')].forEach((a) => {
    const b = hotBy.get(String(a.dataset.id));
    if (!b) return void s.colOnly.push(a);
    hotBy.delete(String(a.dataset.id));
    s.pairs.push({ kind: 'hot', a, b, A: stageRect(a), B: stageRect(b) });
  });
  s.hotOnly = [...hotBy.values()];
  s.hotRows = [...ho.list.children];
  sw = s;
  [fo.el, ho.hotEl, ho.miniEl, hotCol].forEach((e) => e && e.classList.add('g-anim'));
  const p0 = target === 'hot' ? 0 : 1;
  s.sp = createSpringValue(p0, swapApply);
  s.sp.set(p0);
  s.sp.to(target === 'hot' ? 1 : 0, 'big', endSwap);
}

function swapApply(P, rm) {
  const p = P;
  const s = sw;
  if (!s) return;
  const { fo, ho, hotCol } = s;
  const setO = (el, v) => {
    if (!el) return;
    s.touched.add(el);
    el.style.opacity = v >= 0.999 ? '' : String(Math.max(0, v));
  };
  const setT = (el, v) => {
    if (!el) return;
    s.touched.add(el);
    el.style.transform = v;
  };
  const rise2 = (el, u, dy) => {
    // 淡入 + 小位移：u 0→1；dy 为负时是向上走
    setO(el, u);
    setT(el, rm || u >= 0.999 ? '' : `translateY(${(1 - u) * dy}px)`);
  };
  const L = (a, b) => late(p, a, b);
  const fe = fo.el;
  const he = ho.hotEl;
  const me = ho.miniEl;
  // 栏头：旧字上移淡出，新字从下方浮入
  rise2(fe.querySelector('.gf-t'), 1 - L(0, 0.3), -8);
  setO(fo.chips, 1 - L(0, 0.25));
  setO(fe.querySelector('.gf-r'), 1 - L(0, 0.25));
  setO(fe.querySelector('.gf-foot'), 1 - L(0, 0.25));
  rise2(he.querySelector('.gh-l'), L(0.3, 0.65), 8);
  setO(he.querySelector('.gh-head .g-btn'), L(0.2, 0.5));
  setO(he.querySelector(':scope > .more'), L(0.55, 0.9));
  rise2(hotCol.querySelector('.head .t'), 1 - L(0, 0.3), -8);
  setO(hotCol.querySelector('.head-r'), 1 - L(0, 0.25));
  setO(hotCol.querySelector('.more'), 1 - L(0, 0.25));
  rise2(me.querySelector('.gx-t'), L(0.3, 0.65), 8);
  setO(me.querySelector('.gx-head .g-btn'), L(0.2, 0.5));
  setO(me.querySelector('.more'), L(0.45, 0.8));
  // 配对的条目：位置过渡，来源和去处沿同一条路走，交叉淡入
  s.pairs.forEach((m, idx) => {
    // 条目依次出发（约 25ms 一条），位置过渡有先后，不是一整块平移
    const p = late(P, Math.min(idx, 8) * 0.03, 1);
    const cf = (v) => Math.min(1, v * 5);
    const L = (a, b) => late(p, a, b);
    const dx = m.B.x - m.A.x;
    const dy = m.B.y - m.A.y;
    const bt = rm ? '' : `translate(${-dx * (1 - p)}px, ${-dy * (1 - p)}px)`;
    const at = rm ? '' : `translate(${dx * p}px, ${dy * p}px)`;
    if (m.kind === 'hot') {
      setT(m.a, at);
      setO(m.a, 1 - cf(p));
      setT(m.b, bt);
      setO(m.b, cf(p));
    } else if (m.hero) {
      // 头条卡缩成第 1 条：橙底先淡掉，标题跟着缩进去
      m.a.style.transformOrigin = '0 0';
      setT(m.a, rm ? '' : `${at} scale(${1 + (m.B.w / m.A.w - 1) * p}, ${1 + (m.B.h / m.A.h - 1) * p})`);
      setO(m.a, 1 - L(0.05, 0.5));
      m.subs.forEach((x) => setO(x, 1 - L(0, 0.2)));
      setT(m.b, bt);
      setO(m.b, L(0.2, 0.5));
    } else {
      setT(m.a, at);
      setO(m.a, 1 - L(0.08, 0.3));
      m.subs.forEach((x) => setO(x, 1 - L(0, 0.14))); // 摘要、标签最先淡出
      setT(m.b, bt);
      setO(m.b, L(0.08, 0.3));
    }
  });
  s.featOnly.forEach((a) => {
    // 06–11：下沉淡出
    setO(a, 1 - L(0, 0.3));
    setT(a, rm ? '' : `translateY(${14 * L(0, 0.5)}px)`);
  });
  s.colOnly.forEach((a) => setO(a, 1 - L(0, 0.3)));
  s.miniOnly.forEach((a) => rise2(a, L(0.4, 0.8), 8));
  s.hotRows.forEach((el, i) => {
    const paired = !s.hotOnly.includes(el);
    if (!paired) rise2(el, ease3(L(0.3 + (i - 5) * 0.05, 0.62 + (i - 5) * 0.05)), 14); // 6–10 名随后依次浮入
    if (paired) {
      setT(el.querySelector('.rk'), rm || p >= 0.999 ? '' : `scale(${0.65 + 0.35 * Math.min(p, 1)})`);
      el.querySelectorAll('.gh-sub').forEach((x) => setO(x, L(0.5, 0.85)));
    }
    // 热度底色：落定后从左往右依次长出
    const u = ease3(L(0.62 + i * 0.015, Math.min(0.99, 0.98 + i * 0.01)));
    el.querySelectorAll('.gh-bar, .gh-line').forEach((b) => {
      setT(b, u >= 0.999 ? '' : `scaleX(${u})`);
      setO(b, Math.min(1, u * 4));
    });
  });
}

/** 互换落定（或被收起打断时立刻落定）：清掉行内样式，拆掉退场的那一边，把右侧热点栏按结果显示 / 藏起。 */
function endSwap(instant = false) {
  const s = sw;
  if (!s) return;
  if (instant === true) s.sp.set(s.target === 'hot' ? 1 : 0);
  sw = null;
  s.sp.stop();
  s.touched.forEach((el) => {
    el.style.opacity = '';
    el.style.transform = '';
  });
  s.pairs.forEach((m) => m.hero && (m.a.style.transformOrigin = ''));
  if (s.target === 'hot') {
    const o = fx;
    fx = null;
    o.unsub && o.unsub();
    o.sp.stop();
    o.el.remove();
  } else {
    const o = hx;
    hx = null;
    o.unsubs.forEach((u) => u());
    o.sp.stop();
    o.hotEl.remove();
    o.miniEl.remove();
  }
  const keep = s.target === 'hot' ? hx : fx;
  [keep.el, keep.hotEl, keep.miniEl, s.hotCol].forEach((e) => e && e.classList.remove('g-anim'));
  stage.classList.remove('g-swapping');
  stage.dataset.g = mode;
}

/** 收回当前铺开的栏（收起按钮 / 点外部）。 */
export function collapse(instant = false) {
  if (sw) endSwap(true);
  if (mode === 'feat') closeFeat(instant);
  else if (mode === 'hot') closeHot(instant);
}

onTap(catcher, () => collapse());

export function openList(kind) {
  if (layer) return;
  kind === 'hot' ? openHot() : openFeat();
}

// ---------- 上层：详情 / 日报全文 ----------
let layer = null; // { type, el, ... }
let layerOpenedAt = 0;
let token = 0;

function mountLayer(el, scrimClass) {
  layerOpenedAt = performance.now();
  scrim.className = scrimClass;
  stage.append(el);
  requestAnimationFrame(() => scrim.classList.add('open'));
}

// 印纸上层（详情 / 日报全文）的动效：
//   点开：被点的块从原位「抽」成一张纸（只有细阴影，不长圆角卡片）→ 弹簧展开到面板位置（标题字号同一元素放大）→ 内容依次进场。
//   详情用「中等」弹簧，日报全文用「大展开」（标题也跟着放大）；收回用「收回」弹簧，同一条路倒着走。周围版面只淡化到约 38%，不虚化。
const plateOf = (el, frames, ms, delay = 0) => el.animate(frames, { duration: ms, delay, fill: 'both', pseudoElement: '::before' });

/** 从 fromEl 里找标题元素，返回它的位置与字号。 */
function titleOf(fromEl, pick) {
  const t = fromEl && (pick ? fromEl.querySelector(pick) : fromEl.querySelector('.tt, h2, .lead, .t'));
  if (!t) return null;
  return { rect: stageRect(t), size: parseFloat(getComputedStyle(t).fontSize) || 17 };
}

/** 打开时的动效。from：被点块的位置；titleEl：面板里的大标题；src：原标题（位置 + 字号）；spring：'mid'（详情）或 'big'（日报全文）。 */
function playLayerOpen(el, from, to, titleEl, src, spring = 'mid') {
  const reduce = prefersReducedMotion();
  const inTitle = (c) => titleEl && c.contains(titleEl);
  const kids = [...el.children].filter((c) => c !== titleEl && !inTitle(c));
  if (reduce || !from) {
    riseIn([el], { dy: reduce ? 0 : 14 });
    return;
  }
  const ms = springMs(spring);
  plateOf(el, boxFrames(from, to, spring, { o0: 0.2 }), ms);
  if (titleEl && src) {
    const k = src.size / (parseFloat(getComputedStyle(titleEl).fontSize) || 34);
    const dst = stageRect(titleEl);
    titleEl.style.transformOrigin = '0 0';
    titleEl.animate(boxFrames({ x: src.rect.x, y: src.rect.y, w: dst.w * k, h: dst.h * k }, dst, spring), { duration: ms, fill: 'backwards' });
  }
  riseIn(kids, { delay: spring === 'big' ? 300 : 240, gap: 30, dy: 8 });
}

function unmountLayer(target, ms = 280) {
  const l = layer;
  if (!l) return;
  layer = null;
  token++;
  scrim.classList.remove('open');
  const done = () => {
    l.el.remove();
    if (l.lifted) l.lifted.classList.remove('g-lifted');
  };
  if (prefersReducedMotion()) {
    const a = l.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
    return void a.finished.then(done, done);
  }
  const to = stageRect(l.el);
  const from = target && target.rect;
  if (!from) {
    const a = l.el.animate(springFrames('back', (p) => ({ transform: `translateY(${14 * p}px) scale(${1 - 0.03 * p})`, opacity: Math.max(0, 1 - p) })), { duration: springMs('back'), fill: 'both' });
    return void a.finished.then(done, done);
  }
  // 内容先淡出，纸再缩回原位（收回比点开快约 30%）
  const kids = [...l.el.children];
  kids.forEach((c) => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' }));
  const bm = springMs('back');
  const a = plateOf(l.el, boxFrames(from, to, 'back', { o0: 0.2, reverse: true }), bm, 50);
  if (target.title && l.titleEl) {
    const t = l.titleEl;
    const dst = stageRect(t);
    const k = target.title.size / (parseFloat(getComputedStyle(t).fontSize) || 34);
    t.style.transformOrigin = '0 0';
    t.animate(boxFrames({ x: target.title.rect.x, y: target.title.rect.y, w: dst.w * k, h: dst.h * k }, dst, 'back', { reverse: true, fadeOut: false }), { duration: bm, delay: 50, fill: 'forwards' });
  }
  a.finished.then(done, done);
}

/** 找到被点块现在的位置（它可能已经重绘 / 移位）；找不到就用点开时记下的。 */
function liveTarget(id, fallback) {
  const live = [...stage.querySelectorAll(`[data-id="${CSS.escape(String(id))}"]`)].find((e) => getComputedStyle(e).visibility !== 'hidden' || e.classList.contains('g-lifted'));
  const el = live || null;
  if (!el) return { rect: fallback, title: null };
  return { rect: stageRect(el), title: titleOf(el) };
}

export function closeLayer() {
  if (!layer) return;
  if (layer.type === 'detail') {
    const { items, index, origin } = layer;
    unmountLayer(liveTarget(items[index].id, origin));
  } else {
    unmountLayer({ rect: layer_dailyOrigin, title: layer_dailyTitle });
  }
}
let layer_dailyOrigin = null;
let layer_dailyTitle = null; // 日报卡里头条标题的位置与字号（收回时标题缩回去）

onTap(scrim, () => performance.now() - layerOpenedAt > 450 && closeLayer());

// ---- 详情 ----
function listFor(kind) {
  if (kind === 'hot') return (hot.state.data ? hot.state.data.items : []).slice(0, 10);
  if (mode === 'feat' && fx && fx.shown.length) return fx.shown;
  return (featured.state.data ? featured.state.data.list : []).slice(0, FEAT_MAX);
}

export function openDetail(kind, id, fromEl) {
  const items = listFor(kind);
  let index = items.findIndex((i) => i.id === id);
  if (index < 0) return;
  if (layer) return;
  const origin = fromEl ? stageRect(fromEl) : null;
  const src = titleOf(fromEl);
  const el = h('article', { class: 'g-detail', 'aria-label': '新闻详情' });
  layer = { type: 'detail', kind, items, index, origin, el, lifted: fromEl || null };
  mountLayer(el, 'detail');
  renderDetail(false);
  if (fromEl) fromEl.classList.add('g-lifted'); // 原位留空：这一条被「抽」走了
  layer.titleEl = el.querySelector('.gd-title');
  playLayerOpen(el, origin, { x: X_DETAIL, y: 106, w: 653, h: 771 }, layer.titleEl, src);
}

function stepDetail(d) {
  if (!layer || layer.type !== 'detail') return;
  const i = layer.index + d;
  if (i < 0 || i >= layer.items.length) return;
  layer.index = i;
  renderDetail(true);
}

const pillBtn = (text, enabled, fn) => h('button', { class: 'g-pill', disabled: !enabled, onclick: fn }, text);

function renderDetail(swap) {
  const l = layer;
  const { kind, items, index, el } = l;
  const it = items[index];
  const my = ++token;
  const isHot = kind === 'hot';
  const meta = isHot ? ['热点', '第 ' + it.rank + ' 名', it.sourceCount + ' 个来源', it.participantCount + ' 人参与'].join(' · ') : [catLabel(it.category), it.source, ago(it.publishedAt)].filter(Boolean).join(' · ');
  const body = h('div', { class: 'g-scroll gd-body' });
  const fill = () => {
    clear(el);
    el.append(
      h('div', { class: 'gd-rule1' }),
      h('div', { class: 'gd-rule2' }),
      h('div', { class: 'gd-top' }, h('span', { class: 'gd-meta' }, meta), iconBtn('g-btn', '关闭', ICON.close, closeLayer)),
      h('h2', { class: 'gd-title serif' }, it.title),
      scrollable(body),
      h(
        'footer',
        { class: 'gd-foot' },
        h('button', { class: 'g-link', 'data-href': isHot ? it.links.story || it.links.aihot : it.links.aihot }, '在 AIHOT 阅读原文 →'),
        h('span', { class: 'gd-navs' }, pillBtn('← 上一条', index > 0, () => stepDetail(-1)), pillBtn('下一条 →', index < items.length - 1, () => stepDetail(1)))
      )
    );
  };
  if (!isHot) {
    if (it.summary) body.append(h('p', { class: 'gd-sum' }, it.summary));
    if (it.reason) body.append(h('div', { class: 'gd-reason' }, h('b', null, '推荐理由'), '　' + it.reason));
    // 接口没有精选条目的事件时间线：这里补同类近期
    const peers = (featured.state.data ? featured.state.data.list : []).filter((o) => o.category === it.category && o.id !== it.id).slice(0, 3);
    if (peers.length) {
      const box = h('div', { class: 'gd-sec' }, h('div', { class: 'gd-h' }, '同类近期'));
      for (const o of peers) box.append(h('button', { class: 'gd-rel', 'data-href': o.links.aihot }, h('span', { class: 'tt serif clamp1' }, o.title), h('span', { class: 'when' }, ago(o.publishedAt))));
      body.append(box);
    }
  } else {
    for (const w of [92, 86, 60]) body.append(h('div', { class: 'skel', style: `height:18px;width:${w}%;margin-bottom:12px` }));
    const m = /\/story\/([^/?#]+)/.exec(it.links.story || '');
    if (m) {
      loadStory(m[1])
        .then((s) => my === token && fillStory(body, s))
        .catch(() => my === token && fillStory(body, null));
    } else fillStory(body, null);
  }
  if (swap) {
    el.classList.add('swapping');
    setTimeout(() => {
      if (my !== token) return;
      fill();
      l.titleEl = el.querySelector('.gd-title');
      el.classList.remove('swapping');
    }, 120);
  } else fill();
}

function fillStory(body, s) {
  clear(body);
  if (!s) {
    body.append(h('p', { class: 'gd-sum mute' }, '这条热点暂时没有更多综述，可以去 AIHOT 看看。'));
    return;
  }
  for (const para of (s.digest || '').split(/\n{2,}/).filter(Boolean)) body.append(h('p', { class: 'gd-sum' }, para));
  const reports = (s.reports || []).slice().sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  if (reports.length) {
    const days = new Set(reports.map((r) => new Date(r.publishedAt).toDateString()));
    const tl = h('div', { class: 'gd-tl' });
    for (const r of reports) {
      const d = new Date(r.publishedAt);
      tl.append(
        h(
          'button',
          { class: 'gd-tr', 'data-href': r.links.aihot },
          h('span', { class: 'tm' }, hhmm(d.getTime()), days.size > 1 ? h('small', null, pad2(d.getMonth() + 1) + '.' + pad2(d.getDate())) : null),
          h('span', { class: 'tx' }, r.title, r.source && r.source.name ? h('em', null, ' · ' + r.source.name) : null)
        )
      );
    }
    body.append(h('div', { class: 'gd-sec' }, h('div', { class: 'gd-h' }, '事件时间线'), tl));
  }
  const related = s.related || [];
  if (related.length) {
    const box = h('div', { class: 'gd-sec' }, h('div', { class: 'gd-h' }, '相关报道'));
    for (const r of related) box.append(h('button', { class: 'gd-rel', 'data-href': r.links.aihot }, h('span', { class: 'tt serif clamp1' }, r.title)));
    body.append(box);
  }
}

// ---- 日报全文 ----
let dailyDates = null;

export async function openDaily(date, fromEl) {
  const d0 = daily.state.data;
  if (!d0 && !date) return;
  const want = date || d0.date;
  let opening = false;
  if (layer && layer.type === 'daily') {
    layer.date = want;
  } else {
    if (layer) return;
    const src = fromEl || document.querySelector('nc-daily');
    layer_dailyOrigin = stageRect(src);
    layer_dailyTitle = titleOf(src, '.lead');
    const el = h('article', { class: 'g-daily', 'aria-label': 'AI 日报全文' });
    layer = { type: 'daily', el, date: want };
    mountLayer(el, 'daily');
    opening = true;
  }
  const my = ++token;
  renderDaily(want, undefined, opening);
  if (opening) {
    const pre = layer.el.querySelector('.gdl-pre');
    playLayerOpen(layer.el, layer_dailyOrigin, { x: 510, y: 96, w: 900, h: 880 }, pre, pre ? layer_dailyTitle : null, 'big');
    // 标题从日报卡里飞过来时会越出滚动区，飞行期间先不裁切
    const sc = layer.el.querySelector('.g-scroll');
    if (pre && sc) {
      sc.style.overflow = 'visible';
      setTimeout(() => ((sc.style.overflow = ''), sc.dispatchEvent(new Event('sc-sync'))), springMs('big') * 0.9);
    }
  }
  try {
    if (!dailyDates) dailyDates = await loadDailyIndex();
  } catch {
    /* 没有索引就不显示翻页 */
  }
  let rep;
  try {
    rep = await loadDaily(want);
  } catch {
    rep = undefined;
  }
  // 放大中的标题还在飞：等它落定再换成完整内容，免得标题中途跳位置
  const flying = springMs('big') * 0.85 - (performance.now() - layerOpenedAt);
  if (opening && flying > 0) await new Promise((r) => setTimeout(r, flying));
  if (my === token && layer && layer.type === 'daily') {
    renderDaily(want, rep);
    // 数据回来得比进场动画还早：内容照原来的节奏晚点出现；标题已经在了，不再重复浮入
    const wait = performance.now() - layerOpenedAt;
    const els = [];
    for (const c of layer.el.children) {
      if (c.classList.contains('gdl-body') || c.querySelector('.gdl-lead')) els.push(...[...c.querySelectorAll('.gdl-lead > p, .gdl-grid')]);
      else els.push(c);
    }
    riseIn(els, { delay: Math.max(0, 300 - wait), gap: 30, dy: 6 });
  }
}

function renderDaily(date, rep, pre) {
  const el = layer.el;
  clear(el);
  const dates = dailyDates || [];
  const i = dates.indexOf(date);
  const prev = i >= 0 && i < dates.length - 1 ? dates[i + 1] : null;
  const next = i > 0 ? dates[i - 1] : null;
  const scroll = h('div', { class: 'g-scroll gdl-body' });
  let link = 'https://aihot.news/daily/' + date;
  if (rep === undefined && pre && daily.state.data && daily.state.data.date === date) {
    // 先放上日报卡里已有的头条标题，让它从卡里放大过来；其余等全文回来
    scroll.append(h('div', { class: 'gdl-lead' }, h('div', { class: 'gdl-l' }, h('span', { class: 'gdl-k' }, '头条'), h('h2', { class: 'serif gdl-pre' }, daily.state.data.lead))));
  } else if (rep === undefined) {
    scroll.append(h('div', { class: 'skel', style: 'height:34px;width:60%;margin-bottom:16px' }), h('div', { class: 'skel', style: 'height:16px;width:90%;margin-bottom:10px' }), h('div', { class: 'skel', style: 'height:16px;width:76%' }));
  } else if (rep === null) {
    scroll.append(h('p', { class: 'gd-sum mute' }, '这一天的日报还没有出刊。'));
  } else {
    link = (rep.links && rep.links.aihot) || link;
    const t = h('h2', { class: 'serif' });
    t.append(...titleWithHighlights(rep.lead.title));
    scroll.append(h('div', { class: 'gdl-lead' }, h('div', { class: 'gdl-l' }, h('span', { class: 'gdl-k' }, '头条'), t), rep.lead.leadParagraph ? h('p', null, rep.lead.leadParagraph) : null));
    // 两列各自上下连着排（第 1、3、5 块在左列，第 2、4 块在右列），不再按行对齐，内容多少不一也不会留大空白
    const cols = [h('div', { class: 'gdl-col' }), h('div', { class: 'gdl-col' })];
    const grid = h('div', { class: 'gdl-grid' }, ...cols);
    let nSec = 0;
    const addSec = (label, items) => {
      if (!items.length) return;
      const c = labelCat(label);
      const color = c ? `var(--c-${c})` : 'var(--terra-text)';
      const sec = h('div', { class: 'gdl-sec' }, h('div', { class: 'gdl-lab', style: 'color:' + color }, h('i', { style: 'background:' + color }), label));
      items.forEach((it, n) => sec.append(h('button', { class: 'gdl-li', 'data-href': it.links.aihot }, h('span', { class: 'n fr' }, pad2(n + 1)), h('span', { class: 'tt serif' }, it.title))));
      cols[nSec++ % 2].append(sec);
    };
    for (const s of rep.sections) addSec(s.label, s.items);
    addSec('快讯', (rep.flashes || []).slice(0, 6));
    scroll.append(grid);
  }
  el.append(
    h('header', { class: 'gdl-head' }, h('div', { class: 'gdl-ti' }, h('span', { class: 'gdl-name serif' }, 'AI 日报'), h('span', { class: 'gdl-date' }, mdDot(date))), h('div', { class: 'gdl-r' }, h('span', { class: 'gdl-meta' }, weekday(date)), iconBtn('g-btn', '关闭', ICON.close, closeLayer))),
    h('div', { class: 'gdl-rules' }, h('i'), h('i')),
    scrollable(scroll),
    h(
      'footer',
      { class: 'gdl-foot' },
      h('span', { class: 'gdl-navs' }, h('button', { class: 'g-nav', disabled: !prev, onclick: () => openDaily(prev) }, '← ' + (prev ? mdDot(prev) : '')), h('button', { class: 'g-nav', disabled: !next, onclick: () => openDaily(next) }, (next ? mdDot(next) : '') + ' →')),
      h('button', { class: 'g-link', 'data-href': link }, '在 AIHOT 阅读完整日报 ↗')
    )
  );
}

// ---------- 总开关 ----------
/** 收掉所有印纸弹层和铺开（切版式、宿主暂停时用）。 */
export function closeAll() {
  if (layer) {
    layer = null;
    token++;
    scrim.classList.remove('open');
    stage.querySelectorAll('.g-detail, .g-daily').forEach((e) => e.remove());
    stage.querySelectorAll('.g-lifted').forEach((e) => e.classList.remove('g-lifted'));
  }
  collapse(true);
}
export const isOpen = () => !!layer || !!mode;

// Esc、←→ 只是辅助（Lively 收不到键盘），所有操作都有可点的入口
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (layer) closeLayer();
    else collapse();
  } else if (layer && layer.type === 'detail' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    stepDetail(e.key === 'ArrowLeft' ? -1 : 1);
  } else if (layer && layer.type === 'daily') {
    const dates = dailyDates || [];
    const i = dates.indexOf(layer.date);
    if (e.key === 'ArrowLeft' && i >= 0 && i < dates.length - 1) openDaily(dates[i + 1]);
    if (e.key === 'ArrowRight' && i > 0) openDaily(dates[i - 1]);
  }
});

tickMini();

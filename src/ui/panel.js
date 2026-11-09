// 居中大卡片：同一张卡片，三种内容。
//   detail  点任意一条新闻 → 摘要 / 推荐理由；热点条目再加 AI 综述与事件时间线
//   list    精选 / 热点的放大 → 整栏铺开；点条目在同一张卡片内切成详情（左上「← 返回列表」）
//   daily   AI 日报全文，可翻前后一天
// 关闭：点卡片外 / × / Esc。←→ 在详情里切换上一条/下一条，也用来在日报里翻天。
// 卡片里所有“跳网页”的元素都带 data-href，由 main.js 统一交给跳转助手。
import { featured, hot, daily, loadStory, loadDailyIndex, loadDaily } from '../data/feeds.js';
import { BOARD } from '../host/opener.js';
import { h, clear, onTap, prefersReducedMotion } from './dom.js';
import { ago, catLabel, catColor, hhmm, pad2 } from './format.js';
import { scrollable } from './scrollable.js';
import { designRect, boxFrames, riseIn, springMs } from './motion.js';

// 动效：卡片从被点的条目长出、原路回去；先形状后内容，收回反过来；
// 几何用弹簧：点开「大展开」0.55 / 0.86，收回「收回」0.42 / 0.90，列表转详情「中等」0.45 / 0.88；
// 背景淡化 + 虚化 4px + 后退 1.5% 保留。
const root = document.getElementById('panel');
const scrim = document.getElementById('scrim');
const stageEl = document.getElementById('stage');
const overlayEl = document.getElementById('overlay');
let state = null; // { mode, kind, items, index }
let token = 0; // 异步内容回来时，确认还是同一张卡
let closeTimer = 0;
let openedAt = 0;
let origin = { sel: null, rect: null }; // 卡片长出来的地方（收回时回到这里）
let live = []; // 正在播的动画，换场时一并取消

const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function closeBtn() {
  const b = h('button', { class: 'p-x', 'aria-label': '关闭', onclick: close });
  b.innerHTML = CLOSE_ICON; // 写死的图标，不含接口数据
  return b;
}

const track = (a) => (live.push(a), a);
function cancelLive() {
  live.forEach((a) => a.cancel());
  live = [];
}
/** 卡片本身的位置（设计坐标）。 */
function cardRect() {
  const daily = root.classList.contains('daily');
  return { x: 510, y: daily ? 96 : 130, w: 900, h: daily ? 880 : 820 };
}
/** 点开前先记下：卡片从哪里长出来。sel 用来在收回时重新找到那个元素（它可能已经重绘或移位）。 */
function show(cls, rect, sel) {
  clearTimeout(closeTimer);
  cancelLive();
  openedAt = performance.now();
  origin = { sel: sel || null, rect: rect || null };
  root.className = 'p-card ' + cls + ' open';
  scrim.classList.add('open');
  document.documentElement.classList.add('panel-open');
  stageEl.classList.add('recede');
}
const liveRect = (sel) => {
  const el = sel && document.querySelector(sel);
  return el && el.offsetParent ? designRect(el, stageEl) : null;
};
const fallbackFrom = (to) => ({ x: to.x + to.w * 0.04, y: to.y + 28, w: to.w * 0.92, h: to.h * 0.92 });

/** 内容已经放进卡片后调用：先长形状（大展开弹簧），内容晚 200ms 起依次浮起。 */
function playOpen() {
  if (prefersReducedMotion()) {
    track(root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'backwards' }));
    return;
  }
  const to = cardRect();
  const from = origin.rect || fallbackFrom(to);
  track(root.animate(boxFrames(from, to, 'big', { o0: 0.35 }), { duration: springMs('big'), fill: 'both', pseudoElement: '::before' }));
  riseIn(root.children, { delay: 200, gap: 40 }).forEach(track);
}

export function close() {
  if (!state) return;
  const cur = state;
  state = null;
  token++;
  scrim.classList.remove('open');
  stageEl.classList.remove('recede');
  document.documentElement.classList.remove('panel-open');
  cancelLive();
  const done = () => {
    cancelLive();
    root.classList.remove('open');
    clear(root);
  };
  if (prefersReducedMotion()) {
    track(root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' })).finished.then(done, () => {});
    return;
  }
  const to = cardRect();
  let rect = null;
  if (cur.mode === 'detail') rect = liveRect(originFor(cur.kind, cur.items[cur.index].id));
  const from = rect || origin.rect || fallbackFrom(to);
  // 收回：内容先淡出，形状再缩回原位（比点开快）
  [...root.children].forEach((c) => track(c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })));
  const a = track(root.animate(boxFrames(from, to, 'back', { o0: 0.35, reverse: true }), { duration: springMs('back'), delay: 80, fill: 'both', pseudoElement: '::before' }));
  a.finished.then(done, () => {});
  closeTimer = setTimeout(done, springMs('back') + 160);
}

export const isOpen = () => !!state;

/** 精选 / 热点条目在完整版卡片里的选择器（收回时靠它找回原位）。 */
const originFor = (kind, id) => `nc-full ${kind === 'hot' ? '.fhot' : '.ff'} [data-id="${CSS.escape(String(id))}"]`;

// ---------- 通用小件 ----------
function linkRow(href, cls, ...kids) {
  return h('button', { class: 'item ' + cls, 'data-href': href }, ...kids);
}
function navBtn(label, enabled, fn) {
  return h('button', { class: 'p-nav', disabled: !enabled, onclick: fn }, label);
}
function readLink(text, href) {
  return h('button', { class: 'p-link', 'data-href': href }, text);
}
function lab(it, withTime = true) {
  const parts = [catLabel(it.category)];
  if (it.source) parts.push(it.source);
  if (withTime) parts.push(ago(it.publishedAt));
  return h('span', { class: 'lab' }, h('span', { class: 'dot', style: 'background:' + catColor(it.category) }), parts.join(' · '));
}

// ---------- 详情 ----------
export function openDetail(kind, id, fromEl) {
  const feed = kind === 'hot' ? hot : featured;
  const data = feed.state.data;
  if (!data) return;
  const items = (kind === 'hot' ? data.items : data.list).slice(0, kind === 'hot' ? 10 : 30);
  const index = Math.max(0, items.findIndex((i) => i.id === id));
  const rect = fromEl ? designRect(fromEl, stageEl) : null;
  state = { mode: 'detail', kind, items, index };
  show('detail', rect, originFor(kind, id));
  fillRoot(buildDetail());
  playOpen();
}

function fillRoot(nodes) {
  clear(root);
  root.append(...nodes);
}

/** 放大列表里点条目：被点的那一行从原位放大、铺满整张卡片，再换成详情内容。 */
function openFromList(index, rowEl) {
  if (!state || state.mode !== 'list') return;
  const prev = state;
  const next = { mode: 'detail', kind: prev.kind, items: prev.items, index, fromList: true, listScroll: prev.scrollEl ? prev.scrollEl.scrollTop : 0 };
  if (prefersReducedMotion() || !rowEl) {
    state = next;
    fillRoot(buildDetail());
    riseIn(root.children, {}).forEach(track);
    return;
  }
  const c = cardRect();
  const r = designRect(rowEl, overlayEl);
  sheetSwap(
    { x: r.x - c.x, y: r.y - c.y, w: r.w, h: r.h },
    { x: 0, y: 0, w: c.w, h: c.h },
    () => {
      state = next;
      return buildDetail();
    },
    false
  );
}

/**
 * 卡片内换内容的动效：一块「纸片」在 from → to 之间长大（展开）或缩回（返回），
 * 长满的那一刻换内容，纸片再褪去、新内容浮起。
 */
function sheetSwap(from, to, makeNodes, shrinking) {
  const sheet = h('i', { class: 'p-sheet', 'aria-hidden': 'true' });
  root.append(sheet);
  const mine = ++token;
  const swapAt = shrinking ? 130 : 230;
  if (shrinking) {
    track(sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: swapAt, fill: 'both' }));
  } else {
    track(sheet.animate(boxFrames(from, to, 'mid', { o0: 0.9 }), { duration: springMs('mid'), fill: 'both' }));
  }
  setTimeout(() => {
    if (!root.contains(sheet) || mine !== token) return;
    const nodes = makeNodes();
    fillRoot(nodes);
    root.append(sheet);
    riseIn(nodes, {delay: 30, gap: 30}).forEach(track);
    if (shrinking) {
      const rowEl = state && state.scrollEl && state.scrollEl.querySelector(`[data-idx="${state.focusIdx}"]`);
      const c = cardRect();
      const r = rowEl ? designRect(rowEl, overlayEl) : null;
      const target = r ? { x: r.x - c.x, y: r.y - c.y, w: r.w, h: r.h } : { x: to.w / 2 - 120, y: to.h / 2 - 40, w: 240, h: 80 };
      const a = track(sheet.animate(boxFrames(target, { x: 0, y: 0, w: to.w, h: to.h }, 'back', { o0: 0, reverse: true }), { duration: springMs('back'), fill: 'both' }));
      a.finished.then(() => sheet.remove(), () => {});
    } else {
      const a = track(sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }));
      a.finished.then(() => sheet.remove(), () => {});
    }
  }, swapAt);
}

function backToList() {
  if (!state || !state.fromList) return;
  const kind = state.kind;
  const scroll = state.listScroll || 0;
  const idx = state.index;
  if (prefersReducedMotion()) {
    renderList(kind, scroll);
    riseIn(root.children, {}).forEach(track);
    return;
  }
  const c = cardRect();
  sheetSwap(null, { x: 0, y: 0, w: c.w, h: c.h }, () => buildList(kind, scroll, idx), true);
}

function step(d) {
  if (!state || state.mode !== 'detail') return;
  const i = state.index + d;
  if (i < 0 || i >= state.items.length) return;
  state.index = i;
  fillRoot(buildDetail());
  riseIn(root.children, {gap: 20, dy: 6}).forEach(track);
}

function buildDetail() {
  const { kind, items, index } = state;
  const it = items[index];
  const my = ++token;

  const isHot = kind === 'hot';
  const pill = isHot
    ? ['热点', '第 ' + it.rank + ' 名', it.sourceCount + ' 个来源', it.participantCount + ' 人参与'].join(' · ')
    : [catLabel(it.category), it.source, ago(it.publishedAt)].filter(Boolean).join(' · ');

  const main = h('div', { class: 'p-main' });
  const side = h('aside', { class: 'p-side' });
  const body = h('div', { class: 'p-body' + (isHot ? ' two' : '') }, scrollable(main), isHot ? scrollable(side) : null);

  if (!isHot) {
    if (it.summary) main.append(h('p', { class: 'p-sum' }, it.summary));
    if (it.reason) main.append(h('div', { class: 'p-reason' }, h('b', null, '推荐理由'), it.reason));
  } else {
    // 热点：先放骨架，综述与时间线回来再换
    main.append(h('div', { class: 'skel', style: 'height:18px;width:92%' }), h('div', { class: 'skel', style: 'height:18px;width:86%' }), h('div', { class: 'skel', style: 'height:18px;width:60%' }));
    const m = /\/story\/([^/?#]+)/.exec(it.links.story || '');
    if (m) {
      loadStory(m[1])
        .then((s) => my === token && fillStory(main, side, s))
        .catch(() => my === token && fillStory(main, side, null));
    } else fillStory(main, side, null);
  }

  const href = isHot ? it.links.story || it.links.aihot : it.links.aihot;
  if (!isHot) addSimilar(main, items, it);
  const back = state.fromList ? h('button', { class: 'p-back', onclick: backToList }, '‹ 返回列表') : null;
  return [
    h('header', { class: 'p-top' }, back, h('span', { class: 'pill' }, pill), closeBtn()),
    h('h2', { class: 'p-title serif' }, it.title),
    body,
    h('footer', { class: 'p-foot' }, h('span', { class: 'p-navs' }, navBtn('← 上一条', index > 0, () => step(-1)), navBtn('下一条 →', index < items.length - 1, () => step(1)), h('span', { class: 'p-count' }, index + 1 + ' / ' + items.length)), readLink('在 AIHOT 阅读原文 →', href)),
  ];
}

/** 精选条目没有事件数据：用「同类近期」（同分类的其他 3 条）顶替时间线。 */
function addSimilar(main, items, it) {
  const sim = items.filter((x) => x.id !== it.id && x.category === it.category).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 3);
  if (!sim.length) return;
  main.append(h('div', { class: 'p-h p-simh' }, '同类近期 · ' + catLabel(it.category)));
  for (const x of sim) main.append(linkRow(x.links.aihot, 'p-sim', h('span', { class: 'sim-t' }, ago(x.publishedAt)), h('span', { class: 'tt serif' }, x.title), h('span', { class: 'sim-a' }, '→')));
}

function fillStory(main, side, s) {
  clear(main);
  clear(side);
  if (!s) {
    main.append(h('p', { class: 'p-sum mute' }, '这条热点暂时没有更多综述，可以去 AIHOT 看看。'));
    side.closest('.sc').remove();
    return;
  }
  for (const para of (s.digest || '').split(/\n{2,}/).filter(Boolean)) main.append(h('p', { class: 'p-sum' }, para));

  // 时间线：全部报道，按时间正序（最早在上）；内容多时卡片里可以滚动
  const reports = (s.reports || []).slice().sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  if (reports.length) {
    side.append(h('div', { class: 'p-h' }, '事件时间线 · 共 ' + reports.length + ' 条'));
    for (const r of reports) {
      const d = new Date(r.publishedAt);
      side.append(
        linkRow(
          r.links.aihot,
          'tl-row',
          h('i', { class: 'tl-t fr' }, h('b', null, pad2(d.getMonth() + 1) + '.' + pad2(d.getDate())), h('small', null, hhmm(d.getTime()))),
          h('span', { class: 'tl-x' }, h('span', { class: 'tt' }, r.title), h('em', null, r.source.name))
        )
      );
    }
  }
  const related = s.related || [];
  if (related.length) {
    side.append(h('div', { class: 'p-h', style: 'margin-top:18px' }, '相关报道'));
    for (const r of related) side.append(linkRow(r.links.aihot, 'rel-row', h('span', { class: 'tt serif' }, r.title)));
  }
}

// ---------- 放大列表 ----------
export function openList(kind) {
  const data = (kind === 'hot' ? hot : featured).state.data;
  if (!data) return;
  const sel = 'nc-full ' + (kind === 'hot' ? '.fhot' : '.ff');
  show('list', liveRect(sel), sel);
  renderList(kind, 0);
  playOpen();
}

function renderList(kind, scrollTop) {
  const nodes = buildList(kind, scrollTop);
  if (nodes) fillRoot(nodes);
}

/** 生成列表内容并记下状态（focusIdx：从详情返回时，纸片要缩回的那一行）。 */
function buildList(kind, scrollTop, focusIdx) {
  const isHot = kind === 'hot';
  const data = (isHot ? hot : featured).state.data;
  if (!data) return void close();
  const items = isHot ? data.items.slice(0, 10) : data.list.slice(0, 30);
  const sc = h('div', { class: 'p-scroll' });
  state = { mode: 'list', kind, items, scrollEl: sc, focusIdx };
  const grid = h('div', { class: 'p-grid' });
  if (isHot) {
    items.forEach((it, i) => {
      const d = it.delta;
      const tag = d == null ? null : d === 'new' ? h('span', { class: 'dl nw' }, '新') : d > 0 ? h('span', { class: 'dl up' }, '↑' + d) : d < 0 ? h('span', { class: 'dl' }, '↓' + -d) : h('span', { class: 'dl' }, '—');
      grid.append(
        h(
          'button',
          { class: 'item p-hotrow', 'data-idx': i, onclick: (e) => openFromList(i, e.currentTarget) },
          h('span', { class: 'rk fr' + (i > 2 ? ' g' : '') }, String(i + 1)),
          h('span', { class: 'p-hx' }, h('span', { class: 'tt serif clamp2' }, it.title), h('em', null, it.sourceCount + ' 个来源 · ' + it.participantCount + ' 人参与')),
          tag
        )
      );
    });
  } else {
    items.forEach((it, i) => {
      grid.append(h('button', { class: 'item p-featrow', 'data-idx': i, onclick: (e) => openFromList(i, e.currentTarget) }, lab(it), h('span', { class: 'tt serif clamp2' }, it.title), it.summary ? h('span', { class: 'sm clamp2' }, it.summary) : null));
    });
  }
  sc.append(grid);
  const nodes = [
    h('header', { class: 'p-top' }, h('span', { class: 'p-name serif' }, isHot ? '热点' : '精选'), h('span', { class: 'p-sub' }, isHot ? 'TOP 10' : (items.every((x) => Date.now() - x.publishedAt < 24 * 3600000) ? '近 24 小时' : '近期') + ' · 共 ' + items.length + ' 条'), closeBtn()),
    scrollable(sc),
    h('footer', { class: 'p-foot' }, h('span'), readLink('查看全部 →', isHot ? BOARD.hot : BOARD.featured)),
  ];
  // 滚动位置要等内容进了页面才能设
  if (scrollTop) requestAnimationFrame(() => (sc.scrollTop = scrollTop));
  return nodes;
}

// ---------- 日报全文 ----------
let dailyDates = null;

export async function openDaily(date, fromEl) {
  const d0 = daily.state.data;
  if (!d0 && !date) return;
  const want = date || d0.date;
  const again = state && state.mode === 'daily'; // 卡片已经开着：只是翻到前后一天
  state = { mode: 'daily', date: want };
  const my = ++token;
  if (!again) {
    const sel = 'nc-full .fd-face.front';
    show('daily', fromEl ? designRect(fromEl, stageEl) : liveRect(sel), sel);
  }
  renderDaily(want, undefined);
  if (!again) playOpen();
  else riseIn(root.children, {gap: 20, dy: 6}).forEach(track);
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
  if (my === token) {
    renderDaily(want, rep);
    riseIn(root.querySelectorAll('.p-scroll, .p-foot'), {dy: 6}).forEach(track);
  }
}

function renderDaily(date, rep) {
  clear(root);
  const dates = dailyDates || [];
  const i = dates.indexOf(date);
  const prev = i >= 0 && i < dates.length - 1 ? dates[i + 1] : null;
  const next = i > 0 ? dates[i - 1] : null;
  const md = (s) => s.slice(5).replace('-', '.');
  const scroll = h('div', { class: 'p-scroll' });
  let link = 'https://aihot.news/daily/' + date;

  if (rep === undefined) {
    scroll.append(h('div', { class: 'skel', style: 'height:30px;width:70%;margin-bottom:14px' }), h('div', { class: 'skel', style: 'height:16px;width:95%;margin-bottom:8px' }), h('div', { class: 'skel', style: 'height:16px;width:80%' }));
  } else if (rep === null) {
    scroll.append(h('p', { class: 'p-sum mute' }, '这一天的日报还没有出刊。'));
  } else {
    link = (rep.links && rep.links.aihot) || link;
    scroll.append(
      h('div', { class: 'p-h' }, '头条'),
      h('h2', { class: 'p-title serif sm' }, rep.lead.title),
      h('p', { class: 'p-sum' }, rep.lead.leadParagraph),
      h('div', { class: 'p-rule' })
    );
    const cols = h('div', { class: 'p-cols' });
    for (const s of rep.sections) {
      const ul = h('div', { class: 'p-sec' }, h('div', { class: 'p-h' }, s.label));
      for (const it of s.items) ul.append(linkRow(it.links.aihot, 'p-li', h('span', { class: 'tt serif' }, it.title)));
      cols.append(ul);
    }
    if (rep.flashes && rep.flashes.length) {
      const ul = h('div', { class: 'p-sec' }, h('div', { class: 'p-h' }, '快讯'));
      for (const it of rep.flashes.slice(0, 6)) ul.append(linkRow(it.links.aihot, 'p-li', h('span', { class: 'tt serif' }, it.title)));
      cols.append(ul);
    }
    scroll.append(cols);
  }

  root.append(
    h('header', { class: 'p-top' }, h('span', { class: 'p-name serif', style: 'color:var(--terra-text)' }, 'AI 日报'), h('span', { class: 'p-date' }, md(date)), closeBtn()),
    scrollable(scroll),
    h('footer', { class: 'p-foot' }, h('span', { class: 'p-navs' }, navBtn('← ' + (prev ? md(prev) : ''), !!prev, () => openDaily(prev)), navBtn((next ? md(next) : '') + ' →', !!next, () => openDaily(next))), readLink('在 AIHOT 阅读完整日报 →', link))
  );
}

// ---------- 全局事件 ----------
// 刚弹出的 450ms 内不响应背景点击：避免“按下就弹卡片”的同一次点按又把它关掉
onTap(scrim, () => performance.now() - openedAt > 450 && close());
document.addEventListener('keydown', (e) => {
  if (!state) return;
  if (e.key === 'Escape') close();
  else if (state.mode === 'detail' && e.key === 'ArrowLeft') (e.preventDefault(), step(-1));
  else if (state.mode === 'detail' && e.key === 'ArrowRight') (e.preventDefault(), step(1));
  else if (state.mode === 'daily') {
    const dates = dailyDates || [];
    const i = dates.indexOf(state.date);
    if (e.key === 'ArrowLeft' && i >= 0 && i < dates.length - 1) openDaily(dates[i + 1]);
    if (e.key === 'ArrowRight' && i > 0) openDaily(dates[i - 1]);
  }
});

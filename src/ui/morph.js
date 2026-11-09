// 版式切换动画（方案 A · 纸面浮起）。
//   简版 → 完整版用「大展开」弹簧（约 0.77s 落定），完整版 → 简版用「收回」弹簧（约 0.47s）；
//   可打断：播到一半再点，所有动画从当前位置倒着走回去。
//   三栏外框连续移位，同时长出 / 褪去米白底与阴影；时间在简版大号描边与报头实心之间缩放飞行；
//   名言在时间下方与报头右侧之间移动；报头横线从左画出；文字只交叉淡入淡出，不逐条对应。
// 做法：切换瞬间两套版式同时显示（#stage.morph），先量好各自位置，再用 transform / opacity 动画搬过去，播完收掉 morph。
// 缩放 < 0.75 的自动切换、减少动态效果时不走这里的位移，只做 150ms 淡入。
import { prefersReducedMotion } from './dom.js';
import { designRect, boxFrames, riseIn, springMs, springFrames } from './motion.js';

const stage = document.getElementById('stage');
let current = null; // 正在播的一次切换 { toFull, anims, end, reverse }

const COLS = [
  { col: 'nc-featured', card: '.ff' },
  { col: 'nc-hot', card: '.fhot' },
  { col: 'nc-daily', card: '.fd-wrap' },
];

export function morphMode(to) {
  const toFull = to === 'full';
  if (current && !current.reversed) {
    // 打断：中途再点，同一批动画从当前位置掉头（此时 data-mode 已经是新的版式，倒走完成后正好显示它）
    if (current.toFull !== toFull) return current.reverse();
    return;
  }
  if (current) current.end();
  const full = document.querySelector('nc-full');
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)];

  if (prefersReducedMotion()) {
    const els = toFull ? [full] : [q('#center'), ...COLS.map((c) => q(c.col))];
    els.forEach((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'backwards' }));
    return;
  }

  const anims = [];
  const A = (el, frames, opts) => {
    if (!el) return null;
    const a = el.animate(frames, { fill: 'both', ...opts });
    anims.push(a);
    return a;
  };
  stage.classList.add('morph');
  const BIG = springMs('big');
  const BACK = springMs('back');
  const G = toFull ? 'big' : 'back'; // 几何用的弹簧
  const GMS = toFull ? BIG : BACK;

  // ---- 三栏 ↔ 三张卡：外框移位 + 米白底与阴影长出 / 褪去 ----
  COLS.forEach(({ col, card }, i) => {
    const colEl = q(col);
    const cardEl = q(card, full);
    const face = card === '.fd-wrap' ? q('.fd-face.front', cardEl) : cardEl;
    const gr = designRect(colEl, stage);
    const cr = designRect(cardEl, stage);
    if (toFull) {
      const delay = i * 40;
      A(colEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 170, delay });
      A(face, boxFrames(gr, cr, 'big', { o0: 0 }), { duration: BIG, delay, pseudoElement: '::before' });
      const sh = boxFrames(gr, cr, 'big', { o0: 0 }).map((f) => ({ ...f, opacity: Math.sin(Math.PI * Math.min(1, f.offset)) * 0.9 }));
      A(face, sh, { duration: BIG, delay, pseudoElement: '::after' });
      riseIn(face.children, { delay: 280 + i * 50, gap: 40 }).forEach((a) => anims.push(a));
    } else {
      const delay = 60 + i * 30;
      [...face.children].forEach((c) => A(c, [{ opacity: 1 }, { opacity: 0 }], { duration: 150 }));
      A(face, boxFrames(gr, cr, 'back', { o0: 0, reverse: true }), { duration: BACK, delay, pseudoElement: '::before' });
      const sh = boxFrames(gr, cr, 'back', { o0: 0, reverse: true }).map((f) => ({ ...f, opacity: Math.sin(Math.PI * (1 - f.offset)) * 0.9 }));
      A(face, sh, { duration: BACK, delay, pseudoElement: '::after' });
      riseIn([colEl], { delay: 200 + i * 40, dy: 12 }).forEach((a) => anims.push(a));
    }
  });

  // ---- 时间：简版大号描边 ↔ 报头实心，缩放飞行 ----
  const gTime = q('#center .time');
  const fTime = q('.fh-time', full);
  const gt = designRect(gTime, stage);
  const ft = designRect(fTime, stage);
  const k = ft.h / gt.h; // 两边行高都是 1，所以等于字号之比
  const gBox = { x: gt.x, y: gt.y, w: ft.w / k, h: ft.h / k }; // 报头时间「放大到简版大小」时的样子
  const sBox = { x: ft.x, y: ft.y, w: gt.w * k, h: gt.h * k }; // 简版时间「缩到报头大小」时的样子
  if (toFull) {
    A(gTime, boxFrames(sBox, gt, G, { o0: 0, reverse: true }), { duration: GMS });
    A(fTime, boxFrames(gBox, ft, G, { o0: 0 }), { duration: GMS });
  } else {
    A(fTime, boxFrames(gBox, ft, G, { o0: 0, reverse: true }), { duration: GMS });
    A(gTime, boxFrames(sBox, gt, G, { o0: 0 }), { duration: GMS });
  }

  // ---- 名言：时间下方 ↔ 报头右侧，只平移 ----
  const gQuote = q('nc-quote .quote');
  const fQuote = q('.fh-q', full);
  if (gQuote && fQuote) {
    const gq = designRect(gQuote, stage);
    const fq = designRect(fQuote, stage);
    const gBoxQ = { x: gq.x, y: gq.y, w: fq.w, h: fq.h };
    const fBoxQ = { x: fq.x, y: fq.y, w: gq.w, h: gq.h };
    if (toFull) {
      A(gQuote, boxFrames(fBoxQ, gq, G, { o0: 0, reverse: true }), { duration: GMS });
      A(fQuote, boxFrames(gBoxQ, fq, G, { o0: 0 }), { duration: GMS });
    } else {
      A(fQuote, boxFrames(gBoxQ, fq, G, { o0: 0, reverse: true }), { duration: GMS });
      A(gQuote, boxFrames(fBoxQ, gq, G, { o0: 0 }), { duration: GMS });
    }
  }

  // ---- 简版的日期 / 说明行：只淡入淡出 ----
  [q('#center .date'), q('#center .meta')].forEach((el) => {
    if (toFull) A(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
    else A(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 280 });
  });

  // ---- 完整版报头：横线从左画出，进度线涨到当前，其余淡入（柔和进场弹簧） ----
  const rules = qa('.fh .r1, .fh .r3', full);
  const fadeIns = [...qa('.fh-dates', full), ...qa('.fh-pct', full), ...qa('.fh-foot', full)];
  const draw = (out) => springFrames(out ? 'back' : 'soft', (p) => ({ transform: `scaleX(${Math.max(0, out ? 1 - p : p)})` }), { steps: 16 });
  if (toFull) {
    rules.forEach((el) => A(el, draw(false), { duration: springMs('soft'), delay: 100 }));
    A(q('.fh .fill', full), draw(false), { duration: springMs('soft'), delay: 340 });
    A(q('.fh .dot', full), [{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 1, transform: 'none' }], { duration: 140, delay: 700 });
    fadeIns.forEach((el) => A(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 300 }));
  } else {
    rules.forEach((el) => A(el, draw(true), { duration: BACK }));
    A(q('.fh .fill', full), draw(true), { duration: BACK });
    A(q('.fh .dot', full), [{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
    fadeIns.forEach((el) => A(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }));
  }

  // ---- 收尾与打断 ----
  let ended = false;
  let timer = 0;
  const run = { toFull, anims, reversed: false };
  run.end = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    anims.forEach((a) => a.cancel());
    stage.classList.remove('morph');
    if (current === run) current = null;
  };
  run.reverse = () => {
    run.reversed = true;
    clearTimeout(timer);
    let left = 0;
    anims.forEach((a) => {
      const t = a.currentTime || 0;
      left = Math.max(left, t);
      a.reverse();
    });
    timer = setTimeout(run.end, left + 40);
  };
  current = run;
  const total = anims.reduce((m, a) => Math.max(m, a.effect.getComputedTiming().endTime), 0);
  timer = setTimeout(run.end, total + 40);
}

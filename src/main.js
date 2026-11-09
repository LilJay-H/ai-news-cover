import './styles.css';
import './ui/clock.js';
import './ui/quotes.js';
import './ui/featured.js';
import './ui/hot.js';
import './ui/daily.js';
import { onLivelyPlayback } from './host/lively.js';
import './host/we.js';
import { mountScale } from './ui/scale.js';
import { openExternal, pingHelper } from './host/opener.js';
import './ui/panel.js';
import './ui/full.js';
import { tickMini } from './ui/glance.js';
import { refreshMode, onModeChange, getMode } from './ui/preset.js';
import { initFun } from './ui/fun.js';
import { morphMode } from './ui/morph.js';
import { createGlanceFun } from './ui/glance-fun.js';
import { closeAll } from './ui/open.js';
import { mountDev } from './ui/dev.js';
import { now } from './ui/clock-source.js';
import { onTapDelegate } from './ui/dom.js';
import { refreshTheme } from './ui/theme.js';
import { warmFonts, warmLayout } from './ui/warm.js';
import { startFeeds, pauseFeeds, resumeFeeds } from './data/feeds.js';

const stage = document.getElementById('stage');
const clock = document.querySelector('nc-clock');
const quote = document.querySelector('nc-quote');
const featuredEl = document.querySelector('nc-featured');
const full = document.querySelector('nc-full');

mountScale([stage, document.getElementById('overlay')], () => refreshMode());

// 外链：所有带 data-href 的元素点了都交给 openExternal（只放行 https://aihot.news/，
// 优先走本地助手把浏览器拉到前台）。
onTapDelegate(document, '[data-href]', (el, e) => {
  e.preventDefault();
  openExternal(el.dataset.href);
});

// 创意工坊构建：不跳外部网页。跳转按钮（查看全部、阅读原文、日报跳转等）整个藏起来，
// 内容行（相关报道、时间线、日报条目）只摘掉跳转、保留文字。
if (typeof __WORKSHOP__ !== 'undefined' && __WORKSHOP__) {
  const HIDE = /(^|\s)(more|g-link|p-link|ff-more|fk-more|fd-more)(\s|$)/;
  const strip = (el) => {
    if (el.id === 'aihot-link' || HIDE.test(el.getAttribute('class') || '')) el.style.display = 'none';
    else el.classList.add('nolink');
    el.removeAttribute('data-href');
    el.removeAttribute('href');
  };
  const sweep = (root) => {
    if (root.nodeType !== 1) return;
    if (root.hasAttribute('data-href')) strip(root);
    root.querySelectorAll('[data-href]').forEach(strip);
  };
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'attributes') sweep(m.target);
      else m.addedNodes.forEach(sweep);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-href'] });
  sweep(document.documentElement);
}

const fun = initFun(full, createGlanceFun());

// 切版式：两种风格的弹层都收掉；完整版里不显示的时钟停掉涨水动画（静置不耗 CPU）
let paused = false;
onModeChange((mode, animate) => {
  closeAll();
  if (mode === 'full') {
    clock.pause();
    full.update(now(), false);
    full.onShown();
  } else if (!paused) {
    if (animate) clock.fill(240); // 时间飞回来的同时，水从空慢慢涨起
    else clock.resume();
  }
  if (animate) {
    stage.classList.add('booted'); // 之后不再重播开机的浮起，版式切换只走 morph
    morphMode(mode);
  }
});

// ---- 每分钟：时间、水位、“N 分钟前”、名言 ----
let minuteTimer = 0;
let lastTick = Date.now();
function tick() {
  // 两次整点之间隔了很久（电脑睡眠后唤醒）：立刻刷新一次数据
  if (Date.now() - lastTick > 3 * 60000) resumeFeeds();
  lastTick = Date.now();
  clock.update(now());
  quote.update(true);
  full.update(now());
  fun.tick();
  tickMini();
  refreshTheme();
  pingHelper();
  featuredEl.updateTimes();
  minuteTimer = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
}

// ---- 暂停 / 恢复（全屏应用遮挡、屏幕关闭）----
function setPaused(p) {
  if (p === paused) return;
  paused = p;
  if (p) {
    pauseFeeds();
    clock.pause();
    clearTimeout(minuteTimer);
    stage.classList.add('paused');
  } else {
    stage.classList.remove('paused');
    lastTick = Date.now();
    resumeFeeds();
    if (getMode() === 'glance') clock.resume();
    fun.resume();
    tick();
  }
}
document.addEventListener('visibilitychange', () => setPaused(document.hidden));
onLivelyPlayback(setPaused);
addEventListener('online', () => !paused && resumeFeeds());

// ---- 开机 ----
async function boot() {
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* 字体 API 不可用就直接开 */
  }
  full.fitQuote();
  startFeeds();
  warmFonts();
  warmLayout();
  requestAnimationFrame(() => {
    stage.classList.add('on');
    clock.fill(500);
    if (getMode() === 'full') {
      clock.pause();
      full.playBoot(); // 完整版开机进场：只在这里播一次
    }
    minuteTimer = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
  });
}
mountDev({
  clock,
  quote,
  full,
  fun,
  replay() {
    stage.classList.remove('on', 'booted');
    void stage.offsetWidth;
    requestAnimationFrame(() => {
      stage.classList.add('on');
      clock.fill(500);
      if (getMode() === 'full') {
        clock.pause();
        full.playBoot();
      }
    });
  },
});
pingHelper();
boot();

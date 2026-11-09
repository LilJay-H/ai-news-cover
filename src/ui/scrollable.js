// 可滚动区的 ▲▼ 按钮（Lively 不转发滚轮）。印纸风和卡片风共用。
import { h } from './dom.js';

/** 给可滚动区加 ▲▼ 按钮：Lively 不转发滚轮，拖滚动条也不可靠，所以必须有能点的滚动入口。内容没超出时按钮隐藏。 */
export function scrollable(el) {
  // 点一下：翻约 0.8 屏；按住 0.35 秒后：连续滚动。
  // Lively 可能丢掉“松开”事件，所以另有三道保险：鼠标一动且已没按着就停、到头就停、最长 6 秒。
  const step = (dir) => el.scrollBy({ top: dir * Math.max(120, el.clientHeight * 0.8), behavior: 'smooth' });
  let holdTimer = 0;
  let raf = 0;
  const stop = () => {
    clearTimeout(holdTimer);
    cancelAnimationFrame(raf);
    raf = 0;
    removeEventListener('pointerup', stop, true);
    removeEventListener('pointercancel', stop, true);
    removeEventListener('pointermove', onMove, true);
  };
  function onMove(e) {
    if (raf && e.buttons === 0) stop();
  }
  const bind = (btn, dir) => {
    let downAt = -1e9;
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || btn.disabled) return;
      downAt = performance.now();
      step(dir);
      stop();
      addEventListener('pointerup', stop, true);
      addEventListener('pointercancel', stop, true);
      holdTimer = setTimeout(() => {
        addEventListener('pointermove', onMove, true);
        const t0 = performance.now();
        let last = t0;
        const tick = (now) => {
          const dt = now - last;
          last = now;
          const before = el.scrollTop;
          el.scrollTop += dir * 0.9 * dt; // 约 900px/秒
          if (el.scrollTop === before || now - t0 > 6000) return stop();
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }, 350);
    });
    btn.addEventListener('pointerleave', stop);
    // 备用：只收到 click（按下丢了）时，也翻一页
    btn.addEventListener('click', () => {
      if (performance.now() - downAt > 10000) step(dir);
    });
  };
  const up = h('button', { class: 'sc-b', 'aria-label': '向上' }, '▲');
  const dn = h('button', { class: 'sc-b', 'aria-label': '向下' }, '▼');
  bind(up, -1);
  bind(dn, 1);
  const box = h('div', { class: 'sc-btns' }, up, dn);
  const wrap = h('div', { class: 'sc ' + el.className.split(' ')[0] + '-w' }, el, box);
  // 内容是否真的超出：用排版高度（offsetTop / offsetHeight）算，不用 scrollHeight——
  // 后者会把进场动画里的位移（translateY 等）也算进去，导致没超出也出现滚动条和 ▲▼。
  const contentHeight = () => {
    const last = el.lastElementChild;
    if (!last) return 0;
    const pb = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    return last.offsetTop - el.offsetTop + last.offsetHeight + pb;
  };
  const sync = () => {
    const over = contentHeight() > el.clientHeight + 2;
    box.hidden = !over;
    el.style.overflowY = over ? '' : 'hidden'; // 没超出就连原生细滚动条也不留
    up.disabled = el.scrollTop <= 2;
    dn.disabled = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
  };
  el.addEventListener('scroll', sync, { passive: true });
  el.addEventListener('sc-sync', sync); // 外面改了 overflow 之后，叫它重新判断
  new MutationObserver(sync).observe(el, { childList: true, subtree: true });
  if (window.ResizeObserver) new ResizeObserver(sync).observe(el);
  el.style.overflowX = 'hidden'; // 任何列表都不出横向滚动条
  el.style.overflowY = 'hidden';
  requestAnimationFrame(sync);
  return wrap;
}

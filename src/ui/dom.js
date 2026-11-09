// 极小的 DOM 构造器。接口返回的文字一律走 textContent，不拼 HTML。
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'onclick') onTap(el, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// 点按：按下的瞬间就触发，不等松开。
// 原因：壁纸宿主（Lively）转发鼠标时，一个“按下 + 松开”有时只有一半能送到页面，
// 等 click 的话，第一下经常没反应。同一次点按只触发一次（click 仅作为兜底）。
const pressed = new WeakMap();
function tapLogic(el, fn) {
  return {
    down(e) {
      if (e.button !== 0) return;
      pressed.set(el, performance.now());
      fn(e);
    },
    click(e) {
      const t = pressed.get(el);
      if (t != null && performance.now() - t < 10000) {
        pressed.delete(el);
        return; // 这一下已经在按下时处理过了
      }
      fn(e);
    },
  };
}

export function onTap(el, fn) {
  const t = tapLogic(el, fn);
  el.addEventListener('pointerdown', t.down);
  el.addEventListener('click', t.click);
}

/** 事件委托版：root 内所有匹配 selector 的元素。fn(el, event) */
export function onTapDelegate(root, selector, fn) {
  const pick = (e) => (e.target.closest ? e.target.closest(selector) : null);
  root.addEventListener('pointerdown', (e) => {
    const el = pick(e);
    if (!el || e.button !== 0) return;
    pressed.set(el, performance.now());
    fn(el, e);
  });
  root.addEventListener('click', (e) => {
    const el = pick(e);
    if (!el) return;
    const t = pressed.get(el);
    if (t != null && performance.now() - t < 10000) {
      pressed.delete(el);
      e.preventDefault();
      return;
    }
    fn(el, e);
  });
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** 受信任的静态 HTML（只用于写死在代码里的外壳，不用于接口数据）。 */
export function staticHTML(el, html) {
  el.innerHTML = html;
}

export function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------- 按下就有回应：所有可点的东西按下缩到 97%，松手弹回（按下弹簧 0.30 / 0.75） ----------
// 用独立的 scale 属性，不和悬停时的 transform 位移冲突。点击本身仍在按下时触发（见 onTap）。
let pressedEl = null;
let pressAnim = null;
const PRESSABLE = 'button, [data-href], .more, .g-link, .p-li, .item, nc-featured .expand, nc-hot .expand';
function pressDown(e) {
  if (e.button !== 0 || prefersReducedMotion()) return;
  const el = e.target.closest ? e.target.closest(PRESSABLE) : null;
  if (!el || el.disabled) return;
  pressRelease();
  pressedEl = el;
  pressAnim = el.animate([{ scale: '1' }, { scale: '0.97' }], { duration: 90, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'forwards' });
}
function pressRelease() {
  const el = pressedEl;
  if (!el) return;
  pressedEl = null;
  const cur = getComputedStyle(el).scale;
  const from = cur && cur !== 'none' ? parseFloat(cur) || 0.97 : 0.97;
  if (pressAnim) pressAnim.cancel();
  // 按下弹簧：松手后轻轻回弹过 1 一点点再落定
  const N = 14;
  const [r, z] = [0.3, 0.75];
  const w = (2 * Math.PI) / r;
  const wd = w * Math.sqrt(1 - z * z);
  const frames = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * 0.43;
    const p = i === N ? 1 : 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
    frames.push({ scale: String(from + (1 - from) * p), offset: i / N });
  }
  const a = el.animate(frames, { duration: 430, fill: 'none' });
  a.finished.then(() => {}, () => {});
  pressAnim = null;
}
document.addEventListener('pointerdown', pressDown, true);
document.addEventListener('pointerup', pressRelease, true);
document.addEventListener('pointercancel', pressRelease, true);
window.addEventListener('blur', pressRelease);

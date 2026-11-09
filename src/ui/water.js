// 时间“涨水”：
// 水面是双层波纹（前层实色、后层 38% 透明），欠阻尼弹簧上涨、冲过头再回落；
// 停住后只保留不到 2px 的微动，并降到约 15 帧/秒，静置时几乎不占 CPU。
import { prefersReducedMotion } from './dom.js';

const W = 640;
const H = 200;
const START = H + 12;

// 水位映射：按数字字形实际的上下沿（196px 字号、行高 1 的盒子里，墨迹约在 y=27 到 y=171，用浏览器逐像素量出）。
// p = 0（0 点）水面在字形底边，p = 1（24 点）在字形顶边，12 点正好一半。大时钟、顶部小时钟、开机注水共用。
const GLYPH_TOP = 27;
const GLYPH_BOTTOM = 171;
export const waterLevel = (p) => GLYPH_BOTTOM - p * (GLYPH_BOTTOM - GLYPH_TOP);

export function createWater(front, back) {
  const reduced = prefersReducedMotion();
  let y = START;
  let v = 0;
  let target = START;
  let amp = 0;
  let ph = 0;
  let last = 0;
  let raf = 0;
  let timer = 0;
  let on = false;

  function path(level, a, phase, k, off) {
    let d = `M0 ${H + 20} L0 ${level}`;
    for (let x = 0; x <= W; x += 16) {
      const yy = level + a * Math.sin(x * k + phase + off) + a * 0.45 * Math.sin(x * k * 2.3 - phase * 1.6 + off);
      d += ` L${x} ${yy.toFixed(2)}`;
    }
    return `path('${d} L${W} ${H + 20} Z')`;
  }

  function draw() {
    front.style.clipPath = path(y, amp + 1.2, ph, 0.022, 0);
    back.style.clipPath = path(y - 7, amp * 1.1 + 1.4, -ph * 0.8, 0.017, 1.7);
  }

  function frame() {
    raf = 0;
    timer = 0;
    if (!on) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    // 欠阻尼弹簧
    const acc = 9 * (target - y) - 3.2 * v;
    v += acc * dt;
    y += v * dt;
    amp += (Math.min(14, Math.abs(v) * 0.09) - amp) * Math.min(1, dt * 3);
    ph += dt * (2.2 + Math.abs(v) * 0.02);
    draw();
    const settled = Math.abs(v) < 0.4 && Math.abs(target - y) < 0.4;
    if (settled) timer = setTimeout(frame, 66);
    else raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!on || raf || timer) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  return {
    /** 水面目标高度（px，0 = 满，196 = 空）。 */
    to(level) {
      target = level;
      if (reduced) {
        y = level;
        amp = 0;
        draw();
        return;
      }
      kick();
    },
    reset() {
      y = START;
      v = 0;
      amp = 0;
      target = START;
      draw();
    },
    start() {
      on = true;
      if (!reduced) kick();
    },
    stop() {
      on = false;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = 0;
      timer = 0;
    },
  };
}

// 动效公共件：五种弹簧、位置过渡的关键帧、可打断的弹簧驱动、元素在 1920×1080 设计坐标里的位置。
// 标准：连续（能对应的元素做位置过渡）、用弹簧不用固定时长、可打断、
// 有分量不赶、按下就有回应、先结构后细节。只产生 transform / opacity。减少动态效果时由调用方改用 150ms 淡入淡出。
import { prefersReducedMotion } from './dom.js';

/** 全项目只用这五种弹簧：[response（快慢，秒）, damping（回弹，1 = 不回弹）]。 */
export const SPRINGS = {
  big: [0.55, 0.86], // 大展开：精选 / 热点铺开、日报全文、卡片点开、版式切换
  mid: [0.45, 0.88], // 中等：印纸详情、卡片内列表→详情、翻页
  back: [0.42, 0.9], // 收回：所有收回
  press: [0.3, 0.75], // 按下缩放 97%
  soft: [0.6, 1.0], // 柔和进场：新内容浮入、热度底色、开机进场各元素
};

// 兼容旧的写法：CSS 里不方便用弹簧的纯淡入淡出
export const SOFT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** 弹簧位置：0 → 1（可能过冲）。sec 为秒。 */
export function springAt(name, sec) {
  if (sec <= 0) return 0;
  const [r, z] = SPRINGS[name];
  const w = (2 * Math.PI) / r;
  if (z >= 1) return 1 - Math.exp(-w * sec) * (1 + w * sec);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * sec) * (Math.cos(wd * sec) + ((z * w) / wd) * Math.sin(wd * sec));
}

const msCache = {};
/** 落定时间（毫秒）：离终点不到 0.1%。大展开约 770ms。 */
export function springMs(name) {
  if (msCache[name]) return msCache[name];
  const total = 3000;
  let last = 0;
  for (let t = 0; t < total; t += 5) if (Math.abs(springAt(name, t / 1000) - 1) > 0.001) last = t;
  return (msCache[name] = last + 10);
}

/** 把弹簧采样成关键帧：fn(p) 返回 { transform, opacity }（p 可能略大于 1）。 */
export function springFrames(name, fn, { steps = 28 } = {}) {
  const ms = springMs(name);
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const p = i === steps ? 1 : springAt(name, (u * ms) / 1000);
    frames.push({ offset: u, ...fn(p) });
  }
  return frames;
}

/**
 * 元素在设计坐标（1920×1080）里的位置。root 是 #stage 或 #overlay：
 * 用 root 自己的宽度算缩放，所以 root 被整体缩放、后退时也准确。
 */
export function designRect(el, root) {
  const rr = root.getBoundingClientRect();
  const k = rr.width / 1920 || 1;
  const r = el.getBoundingClientRect();
  return { x: (r.left - rr.left) / k, y: (r.top - rr.top) / k, w: r.width / k, h: r.height / k };
}

/** 把 transform-origin 为左上角的元素，从 from 位置变到它自己所在的 to 位置所需的 transform（p：0 在 from，1 在 to）。 */
export function boxTransform(from, to, p) {
  const sx = from.w / to.w + (1 - from.w / to.w) * p;
  const sy = from.h / to.h + (1 - from.h / to.h) * p;
  const x = (from.x - to.x) * (1 - p);
  const y = (from.y - to.y) * (1 - p);
  return `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * from → to 的弹簧关键帧（采样成折线，任何 Chromium 都能跑）。动画时长请用 springMs(name)。
 * name：弹簧名（'big' | 'mid' | 'back' …）。opts.o0：起始不透明度，前 1/3 渐变到 1；
 * opts.reverse：倒放（收回，同一条路径倒着走，末尾淡出；fadeOut:false 则不淡出）。
 */
export function boxFrames(from, to, name = 'big', opts = {}) {
  const o0 = opts.o0 == null ? 1 : opts.o0;
  const frames = springFrames(name, (p) => ({ transform: boxTransform(from, to, p) }), { steps: 24 });
  frames.forEach((f) => (f.opacity = clamp01(o0 + (1 - o0) * Math.min(1, f.offset * 3))));
  if (!opts.reverse) return frames;
  const N = frames.length - 1;
  return frames
    .slice()
    .reverse()
    .map((f, i) => ({ offset: i / N, transform: f.transform, opacity: opts.fadeOut === false ? 1 : 1 - (1 - o0) * clamp01((i / N - 0.6) / 0.4) }));
}

/** 一组元素依次浮起（opacity + 小位移），柔和进场弹簧。 */
export function riseIn(els, { delay = 0, gap = 30, dy = 10, spring = 'soft', ms } = {}) {
  const out = [];
  const reduce = prefersReducedMotion();
  [...els].forEach((el, i) => {
    if (!el) return;
    const frames = reduce
      ? [{ opacity: 0 }, { opacity: 1 }]
      : springFrames(spring, (p) => ({ opacity: clamp01(p * 1.6), transform: `translateY(${(1 - p) * dy}px)` }), { steps: 16 });
    out.push(el.animate(frames, { duration: reduce ? 150 : ms || springMs(spring), delay: reduce ? 0 : delay + i * gap, fill: 'backwards' }));
  });
  return out;
}

/**
 * 可打断的弹簧值：真实弹簧模拟（保留速度），中途改目标就从当前位置和速度接着走，不跳帧。
 * apply(x, reduced)：每帧把 x 写到元素上（只写 transform / opacity）。减少动态效果时 150ms 线性走完，reduced 为 true。
 */
export function createSpringValue(initial, apply) {
  let x = initial;
  let v = 0;
  let target = initial;
  let cfg = SPRINGS.big;
  let raf = 0;
  let last = 0;
  let onDone = null;
  let tween = null;
  const finish = () => {
    raf = 0;
    const cb = onDone;
    onDone = null;
    cb && cb();
  };
  function step() {
    const now = performance.now(); // 不用 rAF 的时间戳：它可能比 to() 里记下的时刻更早，算出负的 dt
    const dt = Math.max(0, Math.min(0.034, (now - last) / 1000));
    last = now;
    if (tween) {
      const u = Math.min(1, (now - tween.t0) / 150);
      x = tween.a + (target - tween.a) * u;
      apply(x, true);
      if (u >= 1) return ((tween = null), finish());
    } else {
      const w = (2 * Math.PI) / cfg[0];
      const k = w * w;
      const c = 2 * cfg[1] * w;
      const n = 4;
      for (let i = 0; i < n; i++) {
        v += (k * (target - x) - c * v) * (dt / n);
        x += v * (dt / n);
      }
      apply(x, false);
      if (Math.abs(x - target) < 0.0005 && Math.abs(v) < 0.003) {
        x = target;
        v = 0;
        apply(x, false);
        return finish();
      }
    }
    raf = requestAnimationFrame(step);
  }
  return {
    get value() {
      return x;
    },
    get target() {
      return target;
    },
    get running() {
      return !!raf;
    },
    /** 走向 t；name 是弹簧名。 */
    to(t, name = 'big', done) {
      target = t;
      cfg = SPRINGS[name];
      onDone = done || null;
      if (prefersReducedMotion()) tween = { a: x, t0: performance.now() };
      else tween = null;
      v = tween ? 0 : v;
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    },
    /** 直接放到 t，不动画。 */
    set(t) {
      cancelAnimationFrame(raf);
      raf = 0;
      x = target = t;
      v = 0;
      tween = null;
      onDone = null;
      apply(x, false);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      onDone = null;
    },
  };
}

/**
 * 两组数值之间的弹簧关键帧。from / to 可用：opacity、x、y（px）、sx（scaleX）、s（scale）。
 * 例：springPair('soft', { opacity: 0, y: 10 }, { opacity: 1, y: 0 })
 */
export function springPair(name, from, to, opts) {
  const DEF = { opacity: 1, x: 0, y: 0, sx: 1, s: 1 };
  const val = (o, k) => (o[k] == null ? DEF[k] : o[k]);
  return springFrames(
    name,
    (p) => {
      const v = (k) => val(from, k) + (val(to, k) - val(from, k)) * p;
      const f = {};
      if ('opacity' in from || 'opacity' in to) f.opacity = clamp01(v('opacity'));
      const t = [];
      if ('x' in from || 'y' in from || 'x' in to || 'y' in to) t.push(`translate(${v('x')}px, ${v('y')}px)`);
      if ('sx' in from || 'sx' in to) t.push(`scaleX(${Math.max(0, v('sx'))})`);
      if ('s' in from || 's' in to) t.push(`scale(${v('s')})`);
      if (t.length) f.transform = t.join(' ');
      return f;
    },
    opts
  );
}

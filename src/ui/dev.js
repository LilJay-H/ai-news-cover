// 开发预览开关：桌面上默认完全不出现。
// 打开方式：Ctrl+Shift+D，或用浏览器打开 index.html?dev=1。
// 用途：把时间拖到白天看涨水、翻名言、重放进场。
import { h } from './dom.js';
import { override, now } from './clock-source.js';
import { systemIsDark } from './theme.js';
import { helperIsUp } from '../host/opener.js';

let toggleFn = () => {};
/** Lively 属性面板里的“开发预览条”开关调用它（壁纸收不到键盘，所以不能只靠快捷键）。 */
export const setDevVisible = (on) => toggleFn(on);

// 点击诊断：统计页面实际收到的鼠标事件，用来查“第一下点击没反应”
const diag = { move: 0, down: 0, up: 0, click: 0, last: '' };
const diagEvents = { pointermove: 'move', pointerdown: 'down', pointerup: 'up', click: 'click' };
function diagListener(e) {
  diag[diagEvents[e.type]]++;
  if (e.type !== 'pointermove') diag.last = e.type + '→' + (e.target.tagName || '') + '.' + String(e.target.className || '').slice(0, 24);
}

export function mountDev({ clock, quote, full, fun, replay }) {
  let bar = null;
  let bar_timer = 0;
  const sync = () => {
    clock.update(now());
    quote.update(true);
    full.update(now());
    fun.tick();
  };
  function build() {
    const d = now();
    const range = h('input', { type: 'range', min: 0, max: 1439, step: 10, value: d.getHours() * 60 + d.getMinutes(), style: 'width:260px' });
    const label = h('span', { style: 'min-width:44px;text-align:center' }, '');
    const show = () => {
      const m = +range.value;
      label.textContent = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    };
    show();
    range.addEventListener('input', () => {
      override.setMinute(+range.value);
      show();
      sync();
    });
    const btn = (text, fn) => h('button', { onclick: fn }, text);
    const info = h('span', { style: 'font-size:12px;opacity:.8;white-space:nowrap' }, '');
    const paintInfo = () => (info.textContent = `事件 移动${diag.move} 按下${diag.down} 松开${diag.up} 点击${diag.click} ｜ ${diag.last || '—'} ｜ 系统暗色:${systemIsDark() ? '是' : '否'} ｜ 来源:${location.origin} ｜ 助手:${helperIsUp() ? '在线' : '离线'}`);
    paintInfo();
    bar_timer = setInterval(paintInfo, 500);
    for (const t in diagEvents) addEventListener(t, diagListener, true);
    return h(
      'div',
      { id: 'devbar' },
      h('span', null, '预览'),
      range,
      label,
      btn('上一句名言', () => (override.bumpQuote(-1), sync())),
      btn('下一句名言', () => (override.bumpQuote(1), sync())),
      btn('回到现在', () => (override.reset(), range.value = now().getHours() * 60 + now().getMinutes(), show(), sync())),
      btn('重放进场', replay),
      btn('留言条', () => fun.force.note()),
      btn('深夜', () => fun.force.night()),
      btn('一个月前', () => fun.force.month()),
      info,
      btn('关闭', () => toggle(false))
    );
  }
  function toggle(on) {
    if (on === undefined) on = !bar;
    if (on && !bar) document.body.append((bar = build()));
    else if (!on && bar) {
      bar.remove();
      bar = null;
      clearInterval(bar_timer);
      for (const t in diagEvents) removeEventListener(t, diagListener, true);
    }
  }
  toggleFn = toggle;
  addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') toggle();
  });
  if (/[?&]dev=1/.test(location.search)) toggle(true);
}

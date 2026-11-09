// 日报折角：正面右上角的小折角（点它翻到「一个月前的今天」），背面同样位置的折角（点它翻回今天）。
// 折角只是一张纸的语言，不加文字；可点范围 44×44，视觉很小。
// 悬停掀起、按下压回一点（按下 97% 由 dom.js 统一处理）。尺寸和颜色在 styles.css 的 .dfold。
import { h, onTap } from './dom.js';

/** kind：'front'（正面，翻过去）或 'back'（背面，翻回来）。 */
export function foldButton(kind, label, fn) {
  const b = h('button', { class: 'dfold ' + kind, 'aria-label': label }, h('i', { 'aria-hidden': 'true' }));
  onTap(b, (e) => {
    e && e.stopPropagation && e.stopPropagation();
    fn();
  });
  return b;
}

/** 正面折角点一下：通知 fun.js 去翻面（手动翻）。 */
export const requestFlip = () => document.dispatchEvent(new CustomEvent('nc:fold'));

// 头条标题里的关键数字划线。
import { h } from './dom.js';

// 头条里的关键数字：数字 + 单位，最多划两处
const KEY_NUM = /\d[\d.,]*(?:[–-]\d[\d.,]*)?\s?(?:万亿美元|亿美元|万美元|亿元|万元|万亿|亿|万|%|倍|秒|分钟|小时|美元|[BMKT]\b)/g;

export function titleWithHighlights(title) {
  const out = [];
  let last = 0;
  let count = 0;
  for (const m of title.matchAll(KEY_NUM)) {
    if (count === 2) break;
    if (m.index > last) out.push(title.slice(last, m.index));
    out.push(h('span', { class: 'hl' }, m[0]));
    last = m.index + m[0].length;
    count++;
  }
  out.push(title.slice(last));
  return out;
}

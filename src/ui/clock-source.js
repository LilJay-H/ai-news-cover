// “现在”的来源。平时就是系统时间；开发预览开关（Ctrl+Shift+D 或网址加 ?dev=1）
// 可以把时间固定在某一分钟、把名言往前后翻，用来在白天 / 夜里之间随意看效果。
import quotesData from '../../assets/quotes.json';
const SLOT_MS = quotesData.rotation.slotHours * 3600000;
let fixedMin = null;
let quoteSlots = 0;

export function now() {
  const d = new Date();
  if (fixedMin != null) d.setHours(Math.floor(fixedMin / 60), fixedMin % 60, 0, 0);
  return d;
}
export function quoteNow() {
  return new Date(now().getTime() + quoteSlots * SLOT_MS);
}
export const override = {
  setMinute(m) {
    fixedMin = m;
  },
  bumpQuote(n) {
    quoteSlots += n;
  },
  reset() {
    fixedMin = null;
    quoteSlots = 0;
  },
};

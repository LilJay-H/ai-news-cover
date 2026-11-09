// 名言轮换：规则见 assets/quotes.json 的 rotation。
// 每 slotHours（1）小时一句；一轮 59 句不重复、相邻两句不同类；
// 轮与轮的交界处任意连续 noRepeatWithinHours（12）小时内不重复；同一时刻所有设备显示同一句。
import data from '../../assets/quotes.json';

const SLOT_HOURS = data.rotation.slotHours;
const NO_REPEAT = Math.ceil(data.rotation.noRepeatWithinHours / SLOT_HOURS); // 12 句内不重复
const quotes = data.quotes;
const n = quotes.length;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const orderCache = new Map();
const rawCache = new Map();

// 每轮的原始顺序只依赖自己的随机种子；轮与轮的交界再单独修开头的 11 句：
// 不能和上一轮最后 11 句重复，也不能和上一句同类。只改开头、不碰结尾，
// 所以上一轮的结尾永远能由 rawOrder 直接得到，没有递归。
export function orderFor(cycle) {
  if (orderCache.has(cycle)) return orderCache.get(cycle);
  const order = rawOrder(cycle).slice();
  if (cycle > 0) {
    const prev = rawOrder(cycle - 1);
    const tail = new Set(prev.slice(n - (NO_REPEAT - 1)).map((q) => q.id));
    const head = NO_REPEAT - 1; // 开头要修的范围 [0, head)
    const same = (a, b) => a && b && a.cat === b.cat;
    const okAt = (j, q) => !same(q, order[j - 1] || prev[n - 1]) && !same(q, order[j + 1]);
    for (let j = 0; j < head; j++) {
      if (!tail.has(order[j].id) && okAt(j, order[j])) continue;
      // 从中间段（不碰开头 head 句和结尾 11 句）找一个能换进来的
      for (let k = head; k < n - (NO_REPEAT - 1); k++) {
        const c = order[k];
        if (tail.has(c.id) || !okAt(j, c)) continue;
        // 换出去的那一句放到 k 的位置，也不能撞同类
        const out = order[j];
        if (same(out, order[k - 1]) || same(out, order[k + 1])) continue;
        order[j] = c;
        order[k] = out;
        break;
      }
    }
  }
  orderCache.clear();
  orderCache.set(cycle, order);
  return order;
}

function rawOrder(cycle) {
  if (rawCache.has(cycle)) return rawCache.get(cycle);
  const rnd = mulberry32(cycle * 2654435761 + 12345);
  // 各类别内部确定性洗牌
  const buckets = new Map();
  for (const q of quotes) {
    if (!buckets.has(q.cat)) buckets.set(q.cat, []);
    buckets.get(q.cat).push(q);
  }
  for (const list of buckets.values()) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  // 按“剩余数量加权交错”：每次从剩余最多且不同于上一句的类别里取
  const order = [];
  let lastCat = null;
  while (order.length < n) {
    const cands = [...buckets.entries()].filter(([, l]) => l.length > 0);
    let pool = cands.filter(([c]) => c !== lastCat);
    if (!pool.length) pool = cands; // 只剩同类时无法避免
    const most = Math.max(...pool.map(([, l]) => l.length));
    const top = pool.filter(([, l]) => l.length === most);
    const [cat, list] = top[Math.floor(rnd() * top.length)];
    order.push(list.pop());
    lastCat = cat;
  }
  rawCache.clear();
  rawCache.set(cycle, order);
  return order;
}

export function quoteAt(date = new Date()) {
  const localHours = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 3600000);
  const slot = Math.floor(localHours / SLOT_HOURS);
  const cycle = Math.floor(slot / n);
  return { slot, quote: orderFor(cycle)[slot % n] };
}

// 文案格式化：相对时间、中文日期、分类。

export function ago(ts, now = Date.now()) {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return '刚刚';
  const m = s / 60;
  if (m < 60) return Math.floor(m) + ' 分钟前';
  const hr = m / 60;
  if (hr < 24) return Math.floor(hr) + ' 小时前';
  if (hr < 48) return '昨天';
  return Math.floor(hr / 24) + ' 天前';
}

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function cnNumber(n) {
  if (n <= 10) return CN[n];
  if (n < 20) return '十' + CN[n - 10];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return CN[t] + '十' + (u ? CN[u] : '');
}
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export function cnDate(d) {
  return cnNumber(d.getMonth() + 1) + '月' + cnNumber(d.getDate()) + '日 · 星期' + WEEK[d.getDay()];
}

/** ISO 周数（周一为一周之始，含 1 月 4 日的那周为第 1 周）。 */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const hhmm = (ts) => {
  const d = new Date(ts);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};

// 接口只有 6 类。
const CATS = {
  'ai-models': '模型',
  'ai-products': '产品',
  industry: '行业',
  paper: '论文',
  tip: '教程',
  opinion: '观点',
};
export function catLabel(c) {
  return CATS[c] || '其他';
}
export function catColor(c) {
  return CATS[c] ? 'var(--c-' + c + ')' : 'var(--c-other)';
}

/** 外链白名单：只放行 https://aihot.news/ 开头。 */
export function isAllowedLink(url) {
  return typeof url === 'string' && url.startsWith('https://aihot.news/');
}

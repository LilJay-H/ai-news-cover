// 三个数据源：精选 / 热点 / AI 日报。字段以实测为准。
import { get, peek, getDetail } from './client.js';
import { createFeed } from './feed.js';
import { store } from './storage.js';

const MIN = 60 * 1000;
const ITEMS_24H = '/items?window=24h&limit=100';
const ITEMS_7D = '/items?window=7d&limit=20';
const HOT = '/hot-topics';
const DAILY = '/dailies/latest';
export const FEATURED_COUNT = 7;

// ---- 精选 ----
function buildItems(a, b) {
  const seen = new Set();
  const list = [];
  for (const it of [...a.items, ...(b ? b.items : [])]) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    list.push({
      id: it.id,
      title: it.title,
      summary: it.summary,
      reason: it.reason,
      score: it.score,
      category: it.category,
      publishedAt: Date.parse(it.publishedAt),
      source: it.source && it.source.name,
      links: it.links,
    });
  }
  return { list };
}

export const featured = createFeed({
  interval: 1 * MIN,
  async fetchData() {
    const a = await get(ITEMS_24H);
    // 24 小时内不足 7 条（深夜、周末）：补 7 天里的，保证版面不空
    const b = a.body.items.length < FEATURED_COUNT ? await get(ITEMS_7D) : null;
    return { data: buildItems(a.body, b && b.body), changed: a.changed || (b ? b.changed : false), at: a.at };
  },
  restore() {
    const a = peek(ITEMS_24H);
    if (!a) return null;
    const b = a.body.items.length < FEATURED_COUNT ? peek(ITEMS_7D) : null;
    return { data: buildItems(a.body, b && b.body), at: a.at };
  },
});

// ---- 热点 ----
// 接口没有名次变化：本地存上一轮名次自己算。榜单变了才推进“上一轮”，
// 所以 304 / 重复刷新不会把变化冲掉。第一次运行没有上一轮，不显示变化。
function applyDeltas(items) {
  const sig = items.map((i) => i.id).join(',');
  const rounds = store.get('hot:rounds') || { sig: '', cur: null, prev: null };
  if (rounds.sig !== sig) {
    rounds.prev = rounds.cur;
    rounds.cur = Object.fromEntries(items.map((i) => [i.id, i.rank]));
    rounds.sig = sig;
    store.set('hot:rounds', rounds);
  }
  return items.map((i) => {
    let delta = null; // null：没有上一轮可比
    if (rounds.prev) {
      const was = rounds.prev[i.id];
      delta = was == null ? 'new' : was - i.rank; // 正数：上升
    }
    return { ...i, delta };
  });
}

function buildHot(body) {
  const items = body.items.map((h) => ({
    rank: h.rank,
    id: h.id,
    title: h.title,
    sourceCount: h.sourceCount,
    participantCount: h.participantCount,
    signalCount: h.signalCount || 0, // 热点铺开的热度底色（本条 ÷ 第 1 名）
    sourceNames: Array.isArray(h.sourceNames) ? h.sourceNames : [],
    latestAt: h.latestAt ? Date.parse(h.latestAt) || null : null,
    links: h.links,
  }));
  return { items: applyDeltas(items) };
}

export const hot = createFeed({
  interval: 1 * MIN,
  async fetchData() {
    const r = await get(HOT);
    return { data: buildHot(r.body), changed: r.changed, at: r.at };
  },
  restore() {
    const r = peek(HOT);
    return r ? { data: buildHot(r.body), at: r.at } : null;
  },
});

// ---- AI 日报 ----
function buildDaily(body) {
  const rep = body.report;
  const lead = rep.lead.title;
  const fromSections = rep.sections.flatMap((s) => s.items.map((i) => i.title)).filter((t) => t !== lead);
  const others = fromSections.length ? fromSections : rep.flashes.map((f) => f.title).filter((t) => t !== lead);
  return { date: rep.date, lead, others, link: rep.links && rep.links.aihot };
}

export const daily = createFeed({
  interval: 10 * MIN,
  async fetchData() {
    const r = await get(DAILY);
    return { data: buildDaily(r.body), changed: r.changed, at: r.at };
  },
  restore() {
    const r = peek(DAILY);
    return r ? { data: buildDaily(r.body), at: r.at } : null;
  },
});

// ---- 点开才取的详情 ----
export async function loadStory(publicId) {
  return (await getDetail('/stories/' + encodeURIComponent(publicId))).story;
}
export async function loadDailyIndex() {
  return (await getDetail('/dailies?limit=30')).items.map((i) => i.date);
}
/** 某一天的日报；还没出刊返回 null。 */
export async function loadDaily(date) {
  try {
    return (await getDetail('/dailies/' + date)).report;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export const feeds = [featured, hot, daily];
export const startFeeds = () => feeds.forEach((f, i) => setTimeout(() => f.start(), i * 400));
export const pauseFeeds = () => feeds.forEach((f) => f.pause());
export const resumeFeeds = () => feeds.forEach((f) => f.resume());

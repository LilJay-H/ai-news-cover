// 趣味组件：留言条、深夜劝睡、一个月前的今天。显示位置在 full.js（完整版）和 glance-fun.js（简版），
// 这里只管「什么时候出现、说什么」。两种版式共用同一套触发规则，
// 切换版式时正在显示的组件会瞬间搬到另一种版式里。
import { store } from '../data/storage.js';
import { featured, hot, daily, loadDaily } from '../data/feeds.js';
import { now as getNow } from './clock-source.js';
import { getMode, onModeChange } from './preset.js';
import { pad2 } from './format.js';

const HOUR = 3600000;

// 深夜劝睡 8 句：设计稿里的原文，换行是按语气断的，不改字。
// 第 1 句的 {h}{m} 换成当前时刻（凌晨一点二十）。
export const NIGHT_LINES = [
  '凌晨{h}点{m}。\n今天的新闻，明天还在。\n去睡吧。',
  '模型不睡觉，\n但你需要。',
  '剩下的热点，\n交给明天的你。',
  '今晚的 AI 圈，\n我替你守着。',
  '最好的推理，\n发生在睡醒以后。',
  '明天的日报八点出刊，\n你九点看也不迟。',
  '合上屏幕吧，\n梦里没有上下文窗口。',
  '再看一条就睡——\n这句话今晚你说过几次了？',
];
const CN_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 小时：一、两、三…；分钟：整、零五、十、十五、二十、二十三。 */
export function cnClock(d) {
  const hh = d.getHours();
  const mm = d.getMinutes();
  const h = hh === 2 ? '两' : CN_NUM[hh] || String(hh);
  let m;
  if (mm === 0) m = '整';
  else if (mm < 10) m = '零' + CN_NUM[mm];
  else if (mm < 20) m = '十' + (mm % 10 ? CN_NUM[mm % 10] : '');
  else m = CN_NUM[Math.floor(mm / 10)] + '十' + (mm % 10 ? CN_NUM[mm % 10] : '');
  return { h, m };
}
export function fillNight(line, d) {
  const { h, m } = cnClock(d);
  return line.replace('{h}', h).replace('{m}', m);
}

const dayKey = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

/** 一个月前的同一天（月底取该月最后一天）。 */
function monthAgo(d) {
  const last = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), last));
}

export function initFun(full, glance) {
  const host = () => (getMode() === 'full' ? full : glance); // 当前版式的显示位置
  let evaluated = false; // 留言条判断完之前，不更新「上次有人在」
  let monthTimer = 0;
  let monthBusy = false;

  const seenNow = () => ({ at: Date.now(), daily: daily.state.data ? daily.state.data.date : null, hotTop: hot.state.data && hot.state.data.items[0] ? hot.state.data.items[0].id : null });
  const markSeen = () => {
    if (!evaluated) return;
    const prev = store.get('seen') || {};
    const cur = seenNow();
    store.set('seen', { at: cur.at, daily: cur.daily || prev.daily || null, hotTop: cur.hotTop || prev.hotTop || null });
  };

  // ---------- 留言条 ----------
  function buildNote(seen) {
    const away = Date.now() - seen.at;
    const lines = [];
    const fl = featured.state.data ? featured.state.data.list.filter((it) => it.publishedAt > seen.at) : [];
    if (fl.length) {
      const top = fl.slice().sort((a, b) => (b.score || 0) - (a.score || 0) || b.publishedAt - a.publishedAt)[0];
      lines.push(top.title);
    }
    const d = daily.state.data;
    const hd = hot.state.data;
    if (d && seen.daily && d.date !== seen.daily) lines.push('今日 AI news 已备好~');
    else if (hd && hd.items[0] && seen.hotTop && hd.items[0].id !== seen.hotTop) lines.push('热点榜首换成了「' + hd.items[0].title + '」');
    if (!lines.length) return null;
    const n = Math.max(1, Math.round(away / HOUR));
    const hrSeen = new Date(seen.at).getHours();
    const hrNow = getNow().getHours();
    const slept = away >= 4 * HOUR && (hrSeen >= 21 || hrSeen < 4) && hrNow >= 4 && hrNow < 13;
    const span = n >= 48 ? Math.round(n / 24) + ' 天' : n + ' 个小时';
    return { head: (slept ? '你睡着的 ' : '你离开的 ') + span + '里——', lines: lines.slice(0, 2), tail: slept ? '早安。' : '欢迎回来。' };
  }

  /** 等三路数据都在开机 / 唤醒之后刷新过一次（最多等 15 秒），再判断要不要放留言条。 */
  function whenFresh(t0) {
    return new Promise((resolve) => {
      const t = setInterval(() => {
        const ok = [featured, hot, daily].every((f) => f.state.status === 'ok' && f.state.contentAt >= t0);
        if (ok || Date.now() - t0 > 15000) {
          clearInterval(t);
          resolve();
        }
      }, 500);
    });
  }

  async function checkReturn() {
    evaluated = false;
    const t0 = Date.now();
    const seen = store.get('seen');
    if (!seen || t0 - seen.at < HOUR) {
      evaluated = true;
      markSeen();
      return;
    }
    await whenFresh(t0);
    if (!host().noteShown) {
      const note = buildNote(seen);
      if (note) host().showNote(note);
    }
    evaluated = true;
    markSeen();
  }

  // ---------- 深夜劝睡 ----------
  function nightLine() {
    const last = store.get('night:last');
    let i;
    do i = Math.floor(Math.random() * NIGHT_LINES.length);
    while (i === last && NIGHT_LINES.length > 1);
    store.set('night:last', i);
    return fillNight(NIGHT_LINES[i], getNow());
  }

  function checkNight() {
    const d = getNow();
    const inWindow = d.getHours() >= 1 && d.getHours() < 4;
    if (!inWindow && host().nightOn) return host().setNight(false);
    if (inWindow && !host().nightOn) {
      const key = 'night:' + dayKey(d);
      if (store.get(key)) return; // 今晚已经说过一次了
      store.set(key, true);
      host().setNight(true, nightLine());
    }
  }

  // ---------- 一个月前的今天 ----------
  function planFor(day) {
    let plan = store.get('month:plan');
    if (!plan || plan.day !== day) {
      plan = { day, at: 9 * 60 + Math.floor(Math.random() * 13 * 60) }; // 9:00–22:00 之间随机
      store.set('month:plan', plan);
    }
    return plan;
  }

  /** 往前找最近一期有刊的日报（最多 7 天）。target 那天没出刊时返回 missed: true。网络出错会抛。 */
  async function findIssue(target) {
    for (let i = 0; i <= 7; i++) {
      const d = new Date(target.getFullYear(), target.getMonth(), target.getDate() - i);
      const rep = await loadDaily(dayKey(d));
      if (rep && rep.lead && rep.lead.title) return { d, rep, missed: i > 0 };
    }
    return null;
  }

  /**
   * 翻到背面。manual = 用户点了折角：不自动翻回（离开桌面再回来时才翻回正面），也不占「今天已经翻过」的名额；
   * 否则是每天一次的彩蛋，30 秒后自动翻回。
   */
  async function flipMonth(manual = false, force = false) {
    if (monthBusy) return;
    if (host().monthShown) return manual ? host().showMonth(false) : undefined;
    monthBusy = true;
    const d = getNow();
    const ago = monthAgo(d);
    const md = (x) => pad2(x.getMonth() + 1) + '.' + pad2(x.getDate());
    try {
      const found = await findIssue(ago);
      if (found) host().showMonth(true, { date: md(found.d), iso: dayKey(found.d), title: found.rep.lead.title, missed: found.missed });
      else if (manual) host().showMonth(true, { date: md(ago), title: '', none: true });
      if (found || manual) {
        clearTimeout(monthTimer);
        if (!manual) monthTimer = setTimeout(() => host().showMonth(false), 30000);
      }
    } catch {
      // 取不到：手动翻的话，背面照常翻出来并写明；自动翻的今天不再试
      if (manual) host().showMonth(true, { date: md(ago), title: '', none: true });
    } finally {
      monthBusy = false;
    }
    if (!manual && !force) store.set('month:done', dayKey(d));
  }
  full.onMonthBack = glance.onMonthBack = () => clearTimeout(monthTimer);
  document.addEventListener('nc:fold', () => flipMonth(true)); // 点了日报右上角的折角

  function checkMonth() {
    const d = getNow();
    const day = dayKey(d);
    if (store.get('month:done') === day) return;
    const plan = planFor(day);
    if (d.getHours() * 60 + d.getMinutes() < plan.at) return;
    if (host().nightOn || host().monthShown) return;
    flipMonth(false);
  }

  // ---------- 对外 ----------
  onModeChange((mode) => {
    const from = mode === 'full' ? glance : full;
    const to = host();
    // 正在显示的组件瞬间搬到新版式里（不重放动画）
    if (from.noteShown) {
      const n = from.noteData;
      from.hideNote(true);
      to.showNote(n, true);
    }
    if (from.nightOn) {
      const t = from.nightText;
      from.setNight(false, '', true);
      to.setNight(true, t, true);
    }
    if (from.monthShown) {
      const info = from.monthInfo;
      from.showMonth(false, undefined, true);
      to.showMonth(true, info, true);
    }
    if (mode === 'full') full.onShown();
    checkNight();
  });
  checkReturn();
  checkNight(); // 开机时正好在 01:00–04:00：第一次亮屏，直接说一次

  return {
    /** 每分钟（页面可见时）调用。 */
    tick() {
      markSeen();
      checkNight();
      checkMonth();
    },
    /** 暂停结束（全屏退出、唤醒）：判断要不要放留言条。 */
    resume() {
      if (host().monthShown) host().showMonth(false, undefined, true); // 离开桌面再回来：翻回正面
      checkReturn();
      checkNight();
    },
    /** 开发预览条用：强制出现。 */
    force: {
      note() {
        if (host().noteShown) return host().hideNote();
        const list = featured.state.data ? featured.state.data.list : [];
        const top = list[0];
        host().showNote({ head: '你睡着的 9 个小时里——', lines: [top ? top.title : 'OpenAI 发了 GPT-6 Cyber', '今日 AI news 已备好~'], tail: '早安。' });
      },
      night() {
        if (host().nightOn) host().setNight(false);
        else host().setNight(true, nightLine());
      },
      month() {
        if (host().monthShown) host().showMonth(false);
        else flipMonth(false, true);
      },
    },
  };
}

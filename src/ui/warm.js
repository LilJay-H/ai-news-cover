// 开机预热：第一次点开条目 / 切版式比第二次卡，原因之一是中文字体按字符分成上百个小文件，
// 第一次出现某些字时才临时去加载、解码，正好撞在动画中间。这里在开机后趁空闲，把会用到的字提前加载好：
// 名言、深夜劝睡、所有已拿到的新闻文字（精选 / 热点 / 日报，数据刷新后新出现的字也会补），
// 再加一份常用字（详情、事件综述这类还没取回来的文字，多半用的也是这些字）。
// 分批、每批隔一会儿、放在浏览器空闲时，不抢动画；全部做完后什么都不再做，静置不耗 CPU。
import { featured, hot, daily } from '../data/feeds.js';
import quotes from '../../assets/quotes.json';
import { NIGHT_LINES } from './fun.js';
import { openList, collapse, isOpen } from './glance.js';
import { getMode } from './preset.js';

const FONTS = ['600 20px "Noto Serif SC Variable"', '400 14px "Noto Sans SC Variable"'];
const COMMON =
  '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工话儿者向情部正名定女问力机给等几很第相体物者比间被应使其被次什入安新平化最重产业公司技术数据模型智能开发布推出使用能力研究团队平台用户服务企业市场投资融资发表报告系统功能产品更新版本支持已经目前同时表示认为可以通过进行包括提供实现提升降低增长达到约万亿元美国中国日本欧洲开源闭源训练推理评测基准性能参数规模成本价格免费订阅接口应用场景工具代码程序软件硬件芯片算力显卡服务器云端本地部署集成生态伙伴合作收购上市估值轮融资亿美元人民币百分之倍增降低安全隐私监管政策法规合规风险漏洞攻击防护事件调查声明回应报道消息来源官方网站社区论坛视频图像语音文本生成理解搜索助手智能体代理编程写作翻译设计创意教育医疗金融制造汽车机器人自动驾驶科学数学物理生物化学论文实验结果方法问题解决方案优化改进创新突破挑战机会趋势未来今天昨天明天早上晚上凌晨小时分钟秒周月年季度';
const done = new Set();
let pending = [];
let timer = 0;

// 光把字体文件加载好还不够：每个字体文件第一次拿来排版时，浏览器还要建一次排版用的内部对象，
// 而且每种字重各建一次——这个才是第一次点开详情时卡的大头（实测排版耗时 1.3 秒 → 第二次几乎为零）。
// 所以加载完之后，把这批字在每种字重下真排一遍（藏在屏幕外，排完就删），把这笔开销提前花掉。
const WEIGHTS = [400, 500, 600, 700];
const FAMS = ['Noto Serif SC Variable', 'Noto Sans SC Variable'];
function shapeOnce(chunk) {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:-99999px;top:0;width:2000px;visibility:hidden;pointer-events:none;contain:layout style;';
  for (const fam of FAMS) for (const w of WEIGHTS) {
    const sp = document.createElement('span');
    sp.style.cssText = `font-family:"${fam}";font-weight:${w};font-size:18px;`;
    sp.textContent = chunk;
    box.append(sp);
  }
  document.body.append(box);
  void box.offsetHeight; // 触发排版
  box.remove();
}

function pump() {
  timer = 0;
  const chunk = pending.splice(0, 24).join('');
  if (chunk) {
    Promise.all(FONTS.map((f) => document.fonts.load(f, chunk)))
      .then(() => shapeOnce(chunk))
      .catch(() => {});
  }
  if (pending.length) schedule();
}
function schedule() {
  if (timer) return;
  timer = setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(pump, { timeout: 800 }) : pump()), 60);
}
export function warmText(text) {
  if (!document.fonts || !document.fonts.load) return;
  for (const ch of String(text)) {
    if (ch.codePointAt(0) > 0x2e7f && !done.has(ch)) {
      done.add(ch);
      pending.push(ch);
    }
  }
  if (pending.length) schedule();
}

/** 还剩多少字没预热（自测用）。 */
export const warmLeft = () => pending.length + (timer ? 1 : 0);

export function warmFonts() {
  window.__ncWarmLeft = warmLeft;
  warmText(JSON.stringify(quotes.quotes));
  warmText(NIGHT_LINES.join(''));
  for (const f of [featured, hot, daily]) f.subscribe((s) => s.data && warmText(JSON.stringify(s.data)));
  warmText(COMMON); // 放最后：先加载实际用得到的
}

// ---------- 第二笔开销：每段「没排过的字」第一次排版 ----------
// 实测：同一篇详情第二次打开几乎不花时间，但换一条新的，第一次打开又要多花几十毫秒——
// 浏览器按「字 × 字体 × 字重 × 字号」缓存排版结果，没排过的组合第一次要现算，
// 而且正好发生在点开的那一下（点开时要立刻量位置，会同步排版）。
// 所以开机后趁空闲，把「马上会被点开」的东西提前排一遍：
//   1. 整页版面：切到另一种版式、精选铺开、热点铺开各排一遍。全在同一个同步任务里做完再还原，
//      中间不会画出任何一帧，看不到闪动；
//   2. 每条精选 / 热点的详情文字（标题、摘要、推荐理由），在详情真正用的样式下排一遍（藏在屏幕外）。
// 一次只做一小块，放在空闲时间；做过的条目记下来，数据刷新后只补新出现的。
const stage = document.getElementById('stage');
const shaped = new Set();
const jobs = [];
let jobTimer = 0;

function busy() {
  return isOpen() || stage.classList.contains('morph') || stage.classList.contains('paused') || document.hidden;
}
function runJob() {
  jobTimer = 0;
  if (busy()) return void (jobs.length && scheduleJob(1500)); // 用户正在操作：让路，稍后再来
  const job = jobs.shift();
  try {
    job && job();
  } catch {
    /* 预热失败不影响使用 */
  }
  if (jobs.length) scheduleJob(120);
}
function scheduleJob(ms = 120) {
  if (jobTimer) return;
  jobTimer = setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(runJob, { timeout: 2500 }) : runJob()), ms);
}

/** 把整页版面排一遍：另一种版式，以及（简版里）精选 / 热点铺开。同步做完再还原，不出画面。 */
function layoutPass() {
  const cur = stage.dataset.mode;
  const other = cur === 'full' ? 'glance' : 'full';
  stage.dataset.mode = other;
  void stage.offsetHeight;
  stage.dataset.mode = cur;
  void stage.offsetHeight;
  if (getMode() === 'glance') {
    openList('feat');
    void stage.offsetHeight;
    collapse(true);
    openList('hot');
    void stage.offsetHeight;
    collapse(true);
  }
}

/** 一条新闻的详情文字：在简版印纸详情和完整版卡片用的样式下各排一遍。 */
function probeItem(it, withBody) {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
  const mk = (tag, cls, text) => {
    const el = document.createElement(tag);
    el.className = cls;
    el.textContent = text;
    return el;
  };
  const g = document.createElement('article');
  g.className = 'g-detail';
  g.style.cssText = 'left:0;top:0;';
  g.append(mk('h2', 'gd-title serif', it.title));
  const c = document.createElement('div');
  c.className = 'p-card';
  c.append(mk('h2', 'p-title serif', it.title));
  if (withBody && it.summary) {
    g.append(mk('p', 'gd-sum', it.summary));
    c.append(mk('p', 'p-sum', it.summary));
  }
  if (withBody && it.reason) {
    g.append(mk('div', 'gd-reason', it.reason));
    c.append(mk('div', 'p-reason', it.reason));
  }
  box.append(g, c);
  document.body.append(box);
  void box.offsetHeight;
  box.remove();
}

function queueItems() {
  for (const it of featured.state.data ? featured.state.data.list : []) {
    if (shaped.has('f' + it.id)) continue;
    shaped.add('f' + it.id);
    jobs.push(() => probeItem(it, true));
  }
  for (const it of hot.state.data ? hot.state.data.items : []) {
    if (shaped.has('h' + it.id)) continue;
    shaped.add('h' + it.id);
    jobs.push(() => probeItem(it, false));
  }
  if (jobs.length) scheduleJob(400);
}

export function warmLayout() {
  setTimeout(() => {
    jobs.push(layoutPass);
    queueItems();
    scheduleJob(300);
  }, 2500);
  featured.subscribe(() => jobs.length < 200 && queueItems());
  hot.subscribe(() => jobs.length < 200 && queueItems());
}

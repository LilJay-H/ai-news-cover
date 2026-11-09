// 外链：必须真正用系统默认浏览器打开，并且要到前台。
// 1) 助手在线：请求本机本地助手（127.0.0.1:47821，只放行 https://aihot.news/，见 helper/AI-news-cover-Opener.cs）
// 2) 助手不在线：立刻用 window.open（Lively 会交给系统，但浏览器可能留在后台）
// 为什么要记“助手在不在线”：window.open 必须在点击的当下同步调用，
// 如果先 await 一次请求再 window.open，会被浏览器当成没有用户操作的弹窗拦掉。
import { isAllowedLink } from '../ui/format.js';

// 创意工坊构建（__WORKSHOP__）：整段本机相关的代码和地址在打包时被丢掉，不探测、不请求任何本机服务，也不打开外链
const WORKSHOP = typeof __WORKSHOP__ !== 'undefined' && __WORKSHOP__;
const HELPER = typeof __WORKSHOP__ !== 'undefined' && __WORKSHOP__ ? '' : 'http://127.0.0.1:' + (typeof __HELPER_PORT__ !== 'undefined' ? __HELPER_PORT__ : 47821);
let helperUp = false;
let pinging = false;

// 在线演示页（浏览器里）没有托盘小工具，也不该去碰本机端口：构建时 __WEB__ 为 true
// Plash（Mac）：在线页加 ?host=plash，同样不碰本机端口；外链交给 Plash（它可设为用默认浏览器打开）
const PLASH = document.documentElement.classList.contains('plash');
const NO_HELPER = WORKSHOP || PLASH || (typeof __WEB__ !== 'undefined' && __WEB__);

export const helperIsUp = () => helperUp;

export async function pingHelper() {
  if (NO_HELPER) return false;
  if (pinging) return helperUp;
  pinging = true;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    await fetch(HELPER + '/ping', { mode: 'no-cors', signal: ctl.signal });
    clearTimeout(timer);
    helperUp = true;
  } catch {
    helperUp = false;
  } finally {
    pinging = false;
  }
  return helperUp;
}

/** 向助手查询 Windows 应用模式：'dark' | 'light'；助手不在线返回 null。
 *  传入 wait（壁纸当前的主题）时是长轮询：系统主题一变助手立刻返回，最多挂 25 秒。 */
export async function helperTheme(wait) {
  if (NO_HELPER || !helperUp) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    const r = await fetch(HELPER + '/theme' + (wait ? '?wait=' + wait : ''), { signal: ctl.signal });
    clearTimeout(timer);
    const t = (await r.text()).trim();
    return t === 'dark' || t === 'light' ? t : null;
  } catch {
    return null;
  }
}

export function openExternal(url) {
  if (WORKSHOP) return false;
  if (!isAllowedLink(url)) return false;
  if (PLASH) {
    // 普通的 <a target=_blank>：在点击的同一瞬间同步触发，由 Plash 接手
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
    return true;
  }
  if (!helperUp) {
    const w = window.open(url, '_blank'); // 同步调用，保住“用户点击”这个条件
    if (w) w.opener = null; // 等同 noopener：新页面碰不到壁纸
    pingHelper(); // 顺便重新探测，助手刚启动的话下次就走助手
    return true;
  }
  // 用 cors 模式：浏览器才会带上 Origin（助手要求 /open 必带来源；no-cors 的 GET 不带 Origin，会被助手拒绝）。
  // 失败不改 helperUp（浏览器其实可能已经打开，只是回应读不到），只重新探测一次。
  fetch(HELPER + '/open?url=' + encodeURIComponent(url)).catch(() => {
    pingHelper();
  });
  return true;
}

/** 各板块在 AIHOT 网站上的地址。 */
export const BOARD = {
  featured: 'https://aihot.news/',
  hot: 'https://aihot.news/hot',
};

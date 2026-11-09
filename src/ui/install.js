// 在线页右下角的「装到桌面」：一枚和预设图标同款的小胶囊，点开是一张小卡片。
// 自动识别系统，只给最合适的一步：Windows 下载 Setup.exe；Mac 走 Plash；浏览器支持时再给「安装为应用」（PWA）。
// 手机、Plash 里、已经作为应用打开且没有别的可装时，不显示。只在在线页（__WEB__）里挂载。
import D from '../distrib.json';
import { h, onTap, prefersReducedMotion } from './dom.js';
import { springFrames, springMs } from './motion.js';

const ua = navigator.userAgent;
// ?os=win|mac|mobile|other 只用于本地预览三种系统下的样子
const forced = (location.search.match(/[?&]os=(win|mac|mobile|other)\b/) || [])[1];
const OS =
  forced ||
  (/Android|iPhone|iPod|Mobile|HarmonyOS/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    ? 'mobile'
    : /Windows/.test(ua)
      ? 'win'
      : /Macintosh|Mac OS X/.test(ua)
        ? 'mac'
        : 'other');
const standalone = () => matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches;
const safari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);

let deferred = window.__bip || null; // index.html 头部先接住的 beforeinstallprompt
let installed = false;
let card = null;
let chip = null;
let anim = null;

const ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>';

function btn(label, { href, primary, onTap: fn, download } = {}) {
  const el = href ? h('a', { class: 'ic-btn' + (primary ? ' pri' : ''), href, ...(download ? { download: '' } : {}) }, label) : h('button', { class: 'ic-btn' + (primary ? ' pri' : '') }, label);
  if (fn) onTap(el, fn);
  return el;
}

function pwaBlock() {
  if (standalone()) return null;
  if (installed) return h('p', { class: 'ic-note' }, '已装好，可以在开始菜单或程序坞里找到「AI news cover」。');
  if (deferred) {
    return h('div', { class: 'ic-alt' },
      h('p', { class: 'ic-lead' }, OS === 'win' || OS === 'mac' ? '或者，装成一个独立的小窗口' : '装成一个独立的小窗口'),
      btn('安装为应用', {
        primary: OS !== 'win' && OS !== 'mac',
        onTap: async () => {
          const e = deferred;
          if (!e) return;
          deferred = null;
          e.prompt();
          try {
            const r = await e.userChoice;
            if (r && r.outcome === 'accepted') installed = true;
          } catch {
            /* 浏览器没给结果就当没装 */
          }
          render();
        },
      }),
    );
  }
  if (OS === 'mac' && safari) return h('div', { class: 'ic-alt' }, h('p', { class: 'ic-note' }, '或者，在 Safari 菜单「文件 → 添加到程序坞」，装成一个独立的小窗口。'));
  if (OS === 'other') return h('p', { class: 'ic-note' }, '用 Chrome 或 Edge 打开这个链接，就能装成一个独立的小应用。');
  return null;
}

function body() {
  const parts = [];
  if (OS === 'win') {
    parts.push(
      h('p', { class: 'ic-title' }, '装到 Windows 桌面'),
      h('p', { class: 'ic-lead' }, '下载一个文件，双击，报纸就铺在桌面上了。'),
      btn('下载并双击', { href: D.windowsSetup, primary: true, download: true }),
      h('p', { class: 'ic-note' }, '提示「Windows 已保护你的电脑」时，点「更多信息」，再点「仍要运行」。'),
    );
  } else if (OS === 'mac') {
    parts.push(
      h('p', { class: 'ic-title' }, '装到 Mac 桌面'),
      h('ol', { class: 'ic-steps' },
        h('li', null, h('span', null, '先装免费的 Plash'), btn('打开 App Store', { href: D.plashAppStore })),
        h('li', null, h('span', null, '装好后，把报纸加进去'), btn('添加到 Plash', { href: D.plashAdd, primary: true })),
      ),
      h('p', { class: 'ic-note' }, '在菜单栏的 Plash 里打开「浏览模式」，就能点新闻了。'),
    );
  } else {
    parts.push(h('p', { class: 'ic-title' }, '装到桌面'));
  }
  const pwa = pwaBlock();
  if (pwa) parts.push(pwa);
  return parts;
}

/** 有没有东西可给：没有就连胶囊也不显示 */
const hasOffer = () => OS === 'win' || OS === 'mac' || (OS === 'other' && !standalone());

function place() {
  if (!card || !chip) return;
  const r = chip.getBoundingClientRect();
  const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
  const k = Math.max(s, 0.8); // 窗口很小时卡片不跟着缩到看不清
  card.style.right = Math.max(8, innerWidth - r.right) + 'px';
  card.style.bottom = Math.max(8, innerHeight - r.top + 10 * s) + 'px';
  card.style.transform = `scale(${k})`;
}

function render() {
  if (!card) return;
  const box = card.querySelector('.ic-body');
  box.replaceChildren(...body());
}

function open() {
  if (card && card.isConnected && !card.classList.contains('closing')) return close();
  if (!card) {
    const x = h('button', { class: 'ic-x', 'aria-label': '关闭' });
    x.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    onTap(x, close);
    card = h('div', { id: 'install-card', role: 'dialog', 'aria-label': '装到桌面' }, h('span', { class: 'ic-eyebrow' }, '带回桌面'), x, h('div', { class: 'ic-body' }));
  }
  card.classList.remove('closing');
  render();
  document.body.append(card);
  place();
  chip.classList.add('on');
  if (anim) anim.cancel();
  const reduce = prefersReducedMotion();
  anim = card.animate(
    reduce ? [{ opacity: 0 }, { opacity: 1 }] : springFrames('mid', (p) => ({ opacity: Math.min(1, p * 1.6), translate: `0 ${(1 - p) * 8}px` }), { steps: 18 }),
    { duration: reduce ? 150 : springMs('mid') },
  );
}

function close() {
  if (!card || !card.isConnected) return;
  chip.classList.remove('on');
  card.classList.add('closing');
  if (anim) anim.cancel();
  const reduce = prefersReducedMotion();
  anim = card.animate(
    reduce ? [{ opacity: 1 }, { opacity: 0 }] : springFrames('back', (p) => ({ opacity: Math.max(0, 1 - p * 1.4), translate: `0 ${p * 6}px` }), { steps: 16 }),
    { duration: reduce ? 150 : Math.round(springMs('back') * 0.6), fill: 'forwards' },
  );
  anim.onfinish = () => {
    if (card.classList.contains('closing')) card.remove();
  };
}

export function mountInstall() {
  if (OS === 'mobile' || document.documentElement.classList.contains('plash')) return;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    render();
  });
  addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    render();
  });
  if (!hasOffer()) return;
  chip = h('button', { id: 'get-desktop', 'aria-label': '装到桌面' });
  chip.innerHTML = ICON + '<span>装到桌面</span>'; // 写死的外壳
  onTap(chip, open);
  document.getElementById('stage').append(chip);
  // 点卡片外面就收起
  document.addEventListener('pointerdown', (e) => {
    if (card && card.isConnected && !card.contains(e.target) && !chip.contains(e.target)) close();
  });
  addEventListener('resize', place);
}

// 离线缓存：只缓存页面自身（页面、脚本、样式、字体、图标），新闻数据不进这里
export function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

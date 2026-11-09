// 亮 / 暗：默认跟随系统（prefers-color-scheme），也可以在 Lively 属性面板里手动指定。
// 为什么要手动选项：Lively 内置的网页引擎不一定会把“系统切换了深浅色”实时告诉壁纸。
const mq = matchMedia('(prefers-color-scheme: dark)');
import { helperTheme, pingHelper } from '../host/opener.js';
let pref = 'auto'; // auto | light | dark
let sys = null; // 跳转助手查到的系统深浅色；没有助手时为 null，退回 matchMedia

function apply() {
  const dark = pref === 'dark' || (pref === 'auto' && (sys ? sys === 'dark' : mq.matches));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
// 系统深浅色一变就跟着变（Plash 的网页引擎会通知；Lively 不会，那边靠托盘小工具）
mq.addEventListener?.('change', () => apply());
export function setThemePref(p) {
  pref = p;
  apply();
}
/** 每分钟补查一次，防止宿主没有触发 change 事件。 */
export function refreshTheme() {
  apply();
}
export const systemIsDark = () => (sys ? sys === 'dark' : mq.matches);
/** 有跳转助手时：向它挂一个长轮询，系统深浅色一变它马上回答（Lively 自己不推送）。没有助手时每 5 秒再试。 */
async function watchSys() {
  for (;;) {
    const t = await helperTheme(sys);
    if (t) {
      if (t !== sys) {
        sys = t;
        apply();
      }
    } else {
      await new Promise((r) => setTimeout(r, 5000));
      pingHelper(); // 助手可能是后来才启动的
    }
  }
}
if (!(typeof __WORKSHOP__ !== 'undefined' && __WORKSHOP__) && !document.documentElement.classList.contains('plash')) setTimeout(watchSys, 1500);

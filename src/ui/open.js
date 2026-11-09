// 点开之后去哪里：简版（含缩放 < 0.75 的强制简版）走印纸风，完整版走居中卡片。
// 栏目组件只认这里，不直接认 panel.js / glance.js。
import * as card from './panel.js';
import * as paper from './glance.js';
import { getMode } from './preset.js';

const useGlance = () => getMode() === 'glance';
const pick = () => (useGlance() ? paper : card);

export const openDetail = (kind, id, from) => pick().openDetail(kind, id, from);
export const openList = (kind) => pick().openList(kind);
export const openDaily = (date, from) => pick().openDaily(date, from);
/** 切版式或进入暂停时，把两种风格的弹层都收掉。 */
export function closeAll() {
  paper.closeAll();
  card.close();
}

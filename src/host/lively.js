// Lively Wallpaper 宿主：属性面板、暂停事件。
// Lively 会直接调用这些全局函数；在别的宿主里它们不会被调用，无副作用。

/** 属性面板：LivelyProperties.json 里的每个控件改动时调用。 */
import { PRESETS, setPreset } from '../ui/preset.js';
import { setThemePref } from '../ui/theme.js';
import { setDevVisible } from '../ui/dev.js';

window.livelyPropertyListener = function (name, val) {
  if (name === 'preset' && PRESETS[val]) setPreset(PRESETS[val].id);
  if (name === 'theme') setThemePref(['auto', 'light', 'dark'][val] || 'auto');
  if (name === 'dev') setDevVisible(!!val);
  if (name === 'accent' && typeof val === 'string' && /^#[0-9a-f]{6}$/i.test(val)) {
    document.documentElement.style.setProperty('--accent', val);
  }
};

/** 全屏应用遮挡 / 恢复时 Lively 会通知（新版本）。data: { IsPaused: bool } 的 JSON。 */
export function onLivelyPlayback(cb) {
  window.livelyWallpaperPlaybackChanged = function (data) {
    try {
      const d = typeof data === 'string' ? JSON.parse(data) : data;
      cb(!!d.IsPaused);
    } catch {
      /* 忽略格式错误 */
    }
  };
}

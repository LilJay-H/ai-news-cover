// Wallpaper Engine 宿主：属性面板。WE 会调用 window.wallpaperPropertyListener；在别的宿主里不会被调用，无副作用。
import { PRESETS, setPreset } from '../ui/preset.js';
import { setThemePref } from '../ui/theme.js';
import { setDevVisible } from '../ui/dev.js';

function apply(p) {
  if (p.preset && PRESETS[+p.preset.value]) setPreset(PRESETS[+p.preset.value].id);
  if (p.theme) setThemePref(['auto', 'light', 'dark'][+p.theme.value] || 'auto');
  if (p.dev) setDevVisible(!!p.dev.value);
  if (p.accent && typeof p.accent.value === 'string') {
    // WE 的颜色是 "r g b"，每个分量 0–1
    const c = p.accent.value.split(' ').map((x) => Math.round(Math.min(1, Math.max(0, parseFloat(x))) * 255));
    if (c.length === 3 && c.every((n) => Number.isFinite(n))) {
      document.documentElement.style.setProperty('--accent', '#' + c.map((n) => n.toString(16).padStart(2, '0')).join(''));
    }
  }
}

window.wallpaperPropertyListener = { applyUserProperties: apply };

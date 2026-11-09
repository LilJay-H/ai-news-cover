// 1920×1080 为设计基准，整体按 min(W/1920, H/1080) 等比缩放。
// Windows：内容区靠右，多出来的宽度留在左边（桌面图标一侧）。Plash（Mac）：居中（图标在右、程序坞在下，位置由 mac.css 排）。
export function mountScale(stages, onChange) {
  stages = [].concat(stages);
  let queued = false;
  function fit() {
    queued = false;
    const w = innerWidth;
    const hgt = innerHeight;
    const s = Math.min(w / 1920, hgt / 1080);
    const plash = document.documentElement.classList.contains('plash');
    const x = plash ? (w - 1920 * s) / 2 : w - 1920 * s;
    const y = (hgt - 1080 * s) / 2;
    for (const el of stages) el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    document.documentElement.style.setProperty('--s', String(s));
    // 点开卡片时版面后退 1.5%：绕窗口中心缩，所以要补一段平移
    document.documentElement.style.setProperty('--rx', w * 0.0075 + 'px');
    document.documentElement.style.setProperty('--ry', hgt * 0.0075 + 'px');
    document.documentElement.style.setProperty('--ox', x + 'px');
    // 缩放 < 0.75 强制简版（全平台）
    document.documentElement.classList.toggle('compact', s < 0.75);
    if (onChange) onChange(s);
  }
  addEventListener('resize', () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(fit);
    }
  });
  fit();
}

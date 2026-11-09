// 在线页的离线缓存（构建时复制到 dist/web/sw.js，缓存名里的版本号换成内容指纹）。
// 只缓存页面自身：页面、脚本、样式、字体、图标、应用清单。新闻数据（aihot.news）不经过这里，
// 页面自己有本地缓存和「离线 · 内容时间」。体验指南、install.md 等其他文件也不缓存。
const CACHE = 'nc-__VERSION__';
const CORE = ['./', 'app.js', 'app.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nc-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const base = new URL('./', self.location).pathname;
function kind(url) {
  if (url.origin !== self.location.origin || !url.pathname.startsWith(base)) return null;
  const p = url.pathname.slice(base.length);
  if (p === '' || p === 'index.html') return 'page';
  if (p === 'app.js' || p === 'app.css' || p === 'manifest.webmanifest') return 'page';
  if (p.startsWith('fonts/') || p.startsWith('icons/')) return 'static'; // 字体文件名带指纹，不会变
  return null;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const k = req.mode === 'navigate' && kind(url) === 'page' ? 'page' : kind(url);
  if (!k) return; // 其他一律直接走网络，不缓存
  if (k === 'static') {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }
  // 页面、脚本、样式：先上网拿最新的，断网再用缓存（网址里的 ?host=… 不影响命中）
  const key = req.mode === 'navigate' ? './' : req;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(key, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))),
  );
});

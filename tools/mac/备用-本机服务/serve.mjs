// Mac 上的小服务：在 127.0.0.1:47822 提供壁纸页面，同时提供 /ping /open /theme（和 Windows 托盘小工具同一套接口）。
// 只依赖 Node 自带的模块。用法：node serve.mjs [页面目录]
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const PORT = 47822;
const HOST = '127.0.0.1';
const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), 'page'));
const SELF = `http://${HOST}:${PORT}`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };

// 只放行 https://aihot.news/ 下的网址
function allowed(raw) {
  if (!raw || raw.length > 2000 || /[\s"<>^|]/.test(raw)) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'aihot.news' && !u.port && !u.username && !u.password;
  } catch {
    return false;
  }
}

function readTheme() {
  return new Promise((resolve) => {
    if (platform() !== 'darwin') return resolve('light');
    execFile('defaults', ['read', '-g', 'AppleInterfaceStyle'], (err, out) => resolve(!err && /dark/i.test(out) ? 'dark' : 'light'));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, SELF);
  const origin = req.headers.origin;
  // 只回应壁纸自己的页面（同源）；别的网页拿不到响应，也不能触发 /open
  const mine = !origin || origin === SELF || req.headers['sec-fetch-site'] === 'same-origin';
  const done = (code, body, type) => {
    res.writeHead(code, { 'Content-Type': type || 'text/plain', 'Cache-Control': 'no-cache' });
    res.end(body);
  };
  try {
    if (url.pathname === '/ping') return done(mine ? 204 : 403);
    if (url.pathname === '/theme') {
      if (!mine) return done(403);
      let cur = await readTheme();
      const wait = url.searchParams.get('wait');
      if (wait === 'dark' || wait === 'light') {
        for (let t = 0; cur === wait && t < 25000; t += 1000) {
          await new Promise((r) => setTimeout(r, 1000));
          cur = await readTheme();
        }
      }
      return done(200, cur);
    }
    if (url.pathname === '/open') {
      const target = url.searchParams.get('url');
      if (!origin || !mine || !allowed(target)) return done(403);
      execFile('open', [new URL(target).href]);
      return done(204);
    }
    // 其余：静态页面
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    if (!p) p = 'index.html';
    const file = join(root, p);
    if (!file.startsWith(root + sep) && file !== root) return done(403);
    done(200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream');
  } catch {
    done(404);
  }
}).listen(PORT, HOST, () => console.log(`AI news cover 本机服务：${SELF}`));

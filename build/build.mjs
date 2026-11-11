// 打包：src/ → dist/lively/（Lively）、dist/we/（Wallpaper Engine）、dist/web/（在线演示页）。
// 三份用的是同一个页面，只是描述文件不同。
// 用法：npm run build   （加 --watch 只监听 dist/lively，改了代码会自动重打包）
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

const options = (out, web, port = 47821, workshop = false) => ({
  entryPoints: [join(root, 'src', 'main.js')],
  outdir: out,
  entryNames: 'app',
  assetNames: 'fonts/[name]-[hash]',
  bundle: true,
  format: 'iife', // file:// 下不能用 ES module，所以打成普通脚本
  target: 'chrome100',
  minify: !watch,
  sourcemap: false,
  loader: { '.woff2': 'file', '.woff': 'empty', '.json': 'json' },
  define: { __WEB__: web ? 'true' : 'false', __WORKSHOP__: workshop ? 'true' : 'false', __HELPER_PORT__: String(port) },
  logLevel: 'info',
});

// 在线页（链接即壁纸）：可安装为应用。清单、图标、主题色写进 <head>；
// beforeinstallprompt 可能在 app.js 跑起来之前就到，先在头部接住
const WEB_HEAD = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<meta name="theme-color" content="#f2ede3" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#1a1814" media="(prefers-color-scheme: dark)">',
  '<link rel="icon" href="icons/icon-32.png" sizes="32x32">',
  '<link rel="apple-touch-icon" href="icons/icon-180.png">',
  '<meta name="apple-mobile-web-app-title" content="AI news cover">',
  '<meta name="description" content="把桌面变成一张会更新的 AI 报纸。新闻来自 AIHOT。">',
  "<script>addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__bip=e});</script>",
].join('\n') + '\n';

const DIST = JSON.parse(readFileSync(join(root, 'src', 'distrib.json'), 'utf8'));

// 对外文字里写的下载地址必须都在 src/distrib.json 里（防止改了一处忘了另一处）
function checkLinks() {
  const ok = new Set(Object.values(DIST));
  const bad = [];
  for (const f of ['tools/public/README.md', 'tools/public/INSTALL-AGENT.md', 'README.md', 'INSTALL-AGENT.md', 'docs/体验指南.md']) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    for (const m of readFileSync(p, 'utf8').matchAll(/https:\/\/github\.com\/[^\s)`'"]*\/releases\/latest\/download\/[^\s)`'"]+/g)) if (!ok.has(m[0])) bad.push(f + '：' + m[0]);
  }
  if (bad.length) throw new Error('下载地址和 src/distrib.json 不一致：\n' + bad.join('\n'));
}

// 离线缓存只缓存页面自身。缓存名带上内容指纹，页面一更新旧缓存就整个换掉
function writePWA(out) {
  const icons = join(root, 'assets', 'icons');
  mkdirSync(join(out, 'icons'), { recursive: true });
  for (const f of ['icon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) cpSync(join(icons, f), join(out, 'icons', f));
  const manifest = {
    id: './',
    name: 'AI news cover',
    short_name: 'AI news cover',
    description: '把桌面变成一张会更新的 AI 报纸',
    lang: 'zh-CN',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#f2ede3',
    theme_color: '#f2ede3',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
  const h = createHash('sha256');
  for (const f of ['index.html', 'app.js', 'app.css']) h.update(readFileSync(join(out, f)));
  const sw = readFileSync(join(root, 'src', 'sw.js'), 'utf8').replace('__VERSION__', h.digest('hex').slice(0, 12));
  writeFileSync(join(out, 'sw.js'), sw);
}

function copyStatic(out, kind) {
  let html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  if (kind === 'web') html = html.replace('</head>', WEB_HEAD + '</head>');
  // 创意工坊版：页面里不留任何外部网页入口
  if (kind === 'workshop') html = html.replace(/\s*<a id="aihot-link"[\s\S]*?<\/a>/, '');
  // 无跳转特化：所有跳转入口（查看全部、阅读原文、日报跳转、右下角胶囊、行尾箭头）从一开始就不显示
  if (kind === 'workshop') html = html.replace('</head>', '<style>.more,.g-link,.p-link,.ff-more,.fk-more,.fd-more,#aihot-link,.sim-a{display:none!important}</style></head>');
  writeFileSync(join(out, 'index.html'), html);
  if (kind === 'lively') {
    cpSync(join(root, 'host-files', 'lively'), out, { recursive: true });
    // 网页版本号（UTC 年月日时分秒）：桌面程序靠它判断远程更新包是不是更新（helper/Update.cs）
    writeFileSync(join(out, 'build.txt'), BUILD + '\n');
  }
  if (kind === 'we') {
    cpSync(join(root, 'host-files', 'we', 'project.json'), join(out, 'project.json'));
    cpSync(join(root, 'assets', 'store', 'we_preview.jpg'), join(out, 'preview.jpg'));
  }
  if (kind === 'workshop') {
    // 创意工坊包：只有网页、字体、图片和 project.json（外观只留浅色 / 深色，没有开发预览条）
    const pj = JSON.parse(readFileSync(join(root, 'host-files', 'we', 'project.json'), 'utf8'));
    const props = pj.general.properties;
    props.theme.options = props.theme.options.filter((o) => o.label !== '跟随系统');
    props.theme.value = '1'; // 值沿用 we.js 的映射：1 浅色、2 深色
    delete props.dev;
    writeFileSync(join(out, 'project.json'), JSON.stringify(pj, null, 2) + '\n');
    cpSync(join(root, 'assets', 'store', 'we_preview.jpg'), join(out, 'preview.jpg'));
  }
  if (kind === 'web') {
    writeFileSync(join(out, '.nojekyll'), '');
    // 给 AI 助手的安装说明：用户对助手说「按这个链接帮我装：<在线页>/install.md」
    // 开发仓库里在 tools/public/，公开仓库里导出到了根目录：两处都认
    const agent = [join(root, 'tools', 'public', 'INSTALL-AGENT.md'), join(root, 'INSTALL-AGENT.md')].find((p) => existsSync(p));
    if (!agent) throw new Error('找不到 INSTALL-AGENT.md');
    cpSync(agent, join(out, 'install.md'));
    for (const g of ['体验指南.html']) {
      const p = join(root, 'docs', g);
      if (existsSync(p)) cpSync(p, join(out, 'guide.html'));
    }
    // 体验指南里用到的两张图
    mkdirSync(join(out, 'assets', 'store'), { recursive: true });
    for (const f of ['showcase_01_glance.png', 'showcase_02_full.png']) cpSync(join(root, 'assets', 'store', f), join(out, 'assets', 'store', f));
  }
}

function checkFonts(out) {
  const css = readFileSync(join(out, 'app.css'), 'utf8');
  const missing = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, '')).filter((u) => !u.startsWith('data:') && !existsSync(join(out, u)));
  if (missing.length) throw new Error('字体文件缺失：' + missing.slice(0, 3).join(', '));
}

// 创意工坊包扫描：只能有网页、字体、图片和 project.json；js / html / json 里不能出现本机地址
function checkWorkshop(out) {
  const bad = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        if (!/\.(html|js|css|woff2|jpg|png|json)$/i.test(e.name)) bad.push('不该有的文件：' + p);
        if (/\.(html|js|json)$/i.test(e.name) && /127\.0\.0\.1|localhost|:4782\d/.test(readFileSync(p, 'utf8'))) bad.push('出现本机地址：' + p);
      }
    }
  };
  walk(out);
  if (bad.length) throw new Error('创意工坊包扫描未通过：\n' + bad.join('\n'));
  console.log('创意工坊包扫描通过');
}

const BUILD = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
checkLinks();
const targets = watch ? [['lively', false]] : [['lively', false], ['we', false], ['workshop', false, 47821, true], ['web', true], ['mac', false, 47822]];
for (const [kind, web, port] of targets) {
  const out = join(root, 'dist', kind);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  if (watch) {
    const ctx = await context(options(out, web, port, kind === 'workshop'));
    await ctx.watch();
    copyStatic(out, kind);
    console.log('监听中，改了代码会自动重打包 →', out);
  } else {
    await build(options(out, web, port, kind === 'workshop'));
    copyStatic(out, kind);
    checkFonts(out);
    if (kind === 'web') writePWA(out);
    if (kind === 'workshop') checkWorkshop(out);
    console.log('完成 →', out);
  }
}

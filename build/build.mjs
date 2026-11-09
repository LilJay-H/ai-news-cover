// 打包：src/ → dist/lively/（Lively）、dist/we/（Wallpaper Engine）、dist/web/（在线演示页）。
// 三份用的是同一个页面，只是描述文件不同。
// 用法：npm run build   （加 --watch 只监听 dist/lively，改了代码会自动重打包）
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

// 在线演示页右上角的小入口
const WEB_LINK =
  '<a id="get-desktop" href="guide.html#install" target="_blank" rel="noopener" style="position:fixed;top:10px;right:14px;z-index:9;font:12px/1 system-ui,sans-serif;color:#7a7266;text-decoration:none;opacity:.75;padding:6px 8px">装到桌面 →</a>\n';

function copyStatic(out, kind) {
  let html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
  if (kind === 'web') html = html.replace('</body>', WEB_LINK + '</body>');
  // 创意工坊版：页面里不留任何外部网页入口
  if (kind === 'workshop') html = html.replace(/\s*<a id="aihot-link"[\s\S]*?<\/a>/, '');
  // 无跳转特化：所有跳转入口（查看全部、阅读原文、日报跳转、右下角胶囊、行尾箭头）从一开始就不显示
  if (kind === 'workshop') html = html.replace('</head>', '<style>.more,.g-link,.p-link,.ff-more,.fk-more,.fd-more,#aihot-link,.sim-a{display:none!important}</style></head>');
  writeFileSync(join(out, 'index.html'), html);
  if (kind === 'lively') cpSync(join(root, 'host-files', 'lively'), out, { recursive: true });
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
    if (kind === 'workshop') checkWorkshop(out);
    console.log('完成 →', out);
  }
}

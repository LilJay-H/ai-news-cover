// 编译 AI-news-cover-Setup.exe（安装程序 + 托盘 + 桌面壁纸，一个 exe）：用 Windows 自带的 csc.exe。
// 先运行 npm run pack（生成 dist/pack/*.zip，会作为资源内嵌进 exe；lively.zip 同时就是桌面壁纸用的网页）。
// WebView2 的接口文件来自微软官方 NuGet 包，第一次编译时下载到 .cache/，按 SHA-256 校验。
// 产物：dist/release/AI-news-cover-Setup.exe
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'release');
const csc = join(process.env.WINDIR || process.env.SystemRoot || '', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!existsSync(csc)) throw new Error('找不到 csc.exe：' + csc);
const zips = ['lively', 'we'].map((n) => join(root, 'dist', 'pack', n + '.zip'));
for (const z of zips) if (!existsSync(z)) throw new Error('缺少 ' + z + '，请先运行 npm run pack');

// ---- WebView2 SDK ----
const WV2_VERSION = '1.0.4314.35';
const WV2_SHA256 = '90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4';
const wv2Dir = join(root, '.cache', 'webview2-' + WV2_VERSION);
const nupkg = join(wv2Dir, 'pkg.nupkg');
const pkg = join(wv2Dir, 'pkg');
const coreDll = join(pkg, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll');
if (!existsSync(coreDll)) {
  mkdirSync(pkg, { recursive: true });
  if (!existsSync(nupkg)) {
    const url = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WV2_VERSION}/microsoft.web.webview2.${WV2_VERSION}.nupkg`;
    console.log('下载 WebView2 SDK', WV2_VERSION);
    const r = await fetch(url);
    if (!r.ok) throw new Error('下载失败：' + r.status);
    writeFileSync(nupkg, Buffer.from(await r.arrayBuffer()));
  }
  const sha = createHash('sha256').update(readFileSync(nupkg)).digest('hex');
  if (sha !== WV2_SHA256) throw new Error('WebView2 SDK 校验不符：' + sha);
  // nupkg 就是 zip：用系统自带的 tar（Windows 10 起自带）解开
  const t = spawnSync('tar', ['-xf', nupkg, '-C', pkg], { stdio: 'inherit' });
  if (t.status !== 0) throw new Error('解包 WebView2 SDK 失败');
}

mkdirSync(outDir, { recursive: true });
const exe = join(outDir, 'AI-news-cover-Setup.exe');
const src = ['AI-news-cover.cs', 'App.cs', 'Desktop.cs', 'Wallpaper.cs', 'Update.cs'].map((f) => join(root, 'helper', f));
const args = [
  '/nologo', '/optimize+', '/target:winexe', '/platform:anycpu', '/out:' + exe,
  '/win32icon:' + join(root, 'assets', 'icons', 'app.ico'),
  '/win32manifest:' + join(root, 'helper', 'app.manifest'),
  '/nowarn:1690',
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', '/r:Accessibility.dll',
  '/r:' + coreDll,
  ...['lively', 'we'].map((n) => '/resource:' + join(root, 'dist', 'pack', n + '.zip') + ',' + n + '.zip'),
  '/resource:' + join(root, 'assets', 'icons', 'app.ico') + ',app.ico',
  '/resource:' + coreDll + ',wv2.Core.dll',
  ...['win-x64', 'win-arm64', 'win-x86'].map((a) => '/resource:' + join(pkg, 'runtimes', a, 'native', 'WebView2Loader.dll') + ',wv2.' + a + '.WebView2Loader.dll'),
  ...src,
];
const r = spawnSync(csc, args, { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log('完成 →', exe);

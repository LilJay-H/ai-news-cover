// 编译安装程序 / 托盘小工具：用 Windows 自带的 csc.exe，不需要装任何东西。
// 先运行 npm run pack（生成 dist/pack/*.zip，会作为资源内嵌进 exe）。
// 产物：dist/release/AI-news-cover-Setup.exe
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'release');
const csc = join(process.env.WINDIR || process.env.SystemRoot || '', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!existsSync(csc)) throw new Error('找不到 csc.exe：' + csc);
const zips = ['lively', 'we'].map((n) => join(root, 'dist', 'pack', n + '.zip'));
for (const z of zips) if (!existsSync(z)) throw new Error('缺少 ' + z + '，请先运行 npm run pack');
mkdirSync(outDir, { recursive: true });

const exe = join(outDir, 'AI-news-cover-Setup.exe');
const args = [
  '/nologo', '/optimize+', '/target:winexe', '/out:' + exe,
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll',
  ...['lively', 'we'].map((n) => '/resource:' + join(root, 'dist', 'pack', n + '.zip') + ',' + n + '.zip'),
  join(root, 'helper', 'AI-news-cover.cs'),
];
const r = spawnSync(csc, args, { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log('完成 →', exe);

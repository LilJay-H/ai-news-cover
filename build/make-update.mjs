// 网页部分的远程更新包：装好的桌面程序定期来取，签名对得上才换（helper/Update.cs）。
// 用法：node build/make-update.mjs            （npm run release 的最后一步：签名 dist/pack/lively.zip）
//       node build/make-update.mjs --keygen   （只在第一次：生成签名私钥，打印要写进 Update.cs 的公钥）
// 产物（要和 Setup.exe 一起附到 Release 上）：dist/release/web-update.zip、web-update.txt、web-update.sig
// 私钥默认在 %USERPROFILE%\.ai-news-cover\update-key.pem（可用 AINC_UPDATE_KEY 指定），不进任何仓库；
// 没有私钥时跳过（比如在公开仓库里构建），不影响 Setup.exe。
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keyPath = process.env.AINC_UPDATE_KEY || join(homedir(), '.ai-news-cover', 'update-key.pem');
const HOST_API = 1; // 网页需要的桌面程序能力版本；网页用到程序的新接口时加一，并同步 Update.cs 的 HostApi

const b64 = (u) => Buffer.from(u, 'base64url').toString('base64');

if (process.argv.includes('--keygen')) {
  if (existsSync(keyPath)) throw new Error('私钥已存在，不覆盖：' + keyPath);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const jwk = publicKey.export({ format: 'jwk' });
  console.log('私钥 →', keyPath, '（请另外备份；丢了就只能靠重新安装来更新）');
  console.log('KeyModulus =', b64(jwk.n));
  console.log('KeyExponent =', b64(jwk.e));
  process.exit(0);
}

if (!existsSync(keyPath)) {
  console.log('没有更新签名私钥，跳过远程更新包（' + keyPath + '）');
  process.exit(0);
}
const zip = join(root, 'dist', 'pack', 'lively.zip');
const buildFile = join(root, 'dist', 'lively', 'build.txt');
if (!existsSync(zip) || !existsSync(buildFile)) throw new Error('缺少 dist/pack/lively.zip 或 dist/lively/build.txt，请先 npm run pack');
const build = readFileSync(buildFile, 'utf8').trim();
if (!/^\d{14}$/.test(build)) throw new Error('build.txt 格式不对：' + build);
const data = readFileSync(zip);
const manifest = [
  'ai-news-cover-web-update 1',
  'build=' + build,
  'hostApi=' + HOST_API,
  'size=' + data.length,
  'sha256=' + createHash('sha256').update(data).digest('hex'),
  '',
].join('\n');
const key = createPrivateKey(readFileSync(keyPath));
const sig = sign('sha256', Buffer.from(manifest, 'utf8'), key).toString('base64');
const out = join(root, 'dist', 'release');
mkdirSync(out, { recursive: true });
copyFileSync(zip, join(out, 'web-update.zip'));
writeFileSync(join(out, 'web-update.txt'), manifest);
writeFileSync(join(out, 'web-update.sig'), sig + '\n');
console.log('远程更新包 → dist/release/web-update.{zip,txt,sig}，build', build);

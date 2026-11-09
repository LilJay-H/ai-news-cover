"""把 dist/lively、dist/we 打成 zip（给安装程序内嵌用），另存一份 dist/AI-news-cover.zip 方便手动拖进 Lively。
zip 根目录就是壁纸文件夹的内容，路径用正斜杠；附上 MIT 许可和字体的 OFL 许可。"""
import os
import zipfile

base = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
dist = os.path.join(base, 'dist')
packdir = os.path.join(dist, 'pack')
os.makedirs(packdir, exist_ok=True)


def make(src, out):
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for d, _, files in os.walk(src):
            for f in files:
                p = os.path.join(d, f)
                z.write(p, os.path.relpath(p, src).replace(os.sep, '/'))
        z.write(os.path.join(base, 'LICENSE'), 'licenses/LICENSE')
        fonts = os.path.join(base, 'assets', 'fonts')
        for f in sorted(os.listdir(fonts)):
            if f.startswith('OFL-'):
                z.write(os.path.join(fonts, f), 'licenses/' + f)
    print('完成 →', os.path.normpath(out))


make(os.path.join(dist, 'lively'), os.path.join(packdir, 'lively.zip'))
make(os.path.join(dist, 'we'), os.path.join(packdir, 'we.zip'))
make(os.path.join(dist, 'lively'), os.path.join(dist, 'AI-news-cover.zip'))


def make_mac(out):
    """Mac 包：只有安装.command（带可执行权限）和一份极简说明。壁纸本身是在线页面，由 Plash 加载。"""
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, mode in (('安装.command', 0o755), ('说明.txt', 0o644)):
            info = zipfile.ZipInfo(name)
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(os.path.join(base, 'tools', 'mac', name), 'rb') as f:
                z.writestr(info, f.read())
        z.write(os.path.join(base, 'LICENSE'), 'LICENSE')
    print('完成 →', os.path.normpath(out))


os.makedirs(os.path.join(dist, 'release'), exist_ok=True)
make_mac(os.path.join(dist, 'release', 'AI-news-cover-mac.zip'))

# 让 AI 助手帮你装

把下面这段话整个发给你的 AI 助手（Claude Code、Codex 等），它会帮你装好。

---

请帮我安装「AI news cover」桌面壁纸。仓库：https://github.com/LilJay-H/ai-news-cover

规则：
- 只做安装，不删除、不修改任何已有的文件和设置
- 每一步失败就停下来，告诉我哪里出了问题，不要自己换办法硬做
- 需要我点同意的地方（比如 Windows 的「未知发布者」提示），提前告诉我

先判断我的系统。

**如果是 Windows：**

1. 检查有没有装 Lively Wallpaper 或 Wallpaper Engine（看开始菜单、Steam 库里有没有 wallpaper_engine，或注册表里的卸载项）。两个都没有，就问我想装哪个。装 Lively 可以用 `winget install rocksdanister.LivelyWallpaper`；Wallpaper Engine 需要我自己在 Steam 上买
2. 下载最新发布里的 `AI-news-cover-Setup.exe`：
   `gh release download --repo LilJay-H/ai-news-cover --pattern "AI-news-cover-Setup.exe"`，
   没有 `gh` 就从 https://github.com/LilJay-H/ai-news-cover/releases/latest 下载
3. 告诉我即将运行它，然后运行。它不需要管理员权限，会装好托盘小工具（开机自动运行），并把壁纸导入已经装好的 Lively 和 Wallpaper Engine
4. 等它弹出「已装好」的提示。如果 Windows 提示「未知发布者」，让我点「更多信息 → 仍要运行」

**如果是 macOS：** 还没有正式支持。请告诉我「Mac 版即将支持」，并给我这个链接，让我先在浏览器里体验：https://liljay-h.github.io/ai-news-cover/

最后告诉我去看这几处：
1. 桌面上是不是出现了一张报纸（在 Lively 的库或 Wallpaper Engine 的「已安装」里选「AI news cover」）
2. 右下角有两个小图标，点一下能不能换「简约版」「详细版」
3. 点一条新闻，再点「在 AIHOT 阅读原文」，浏览器是不是弹到最前面
4. 屏幕右下角托盘里有没有一个小图标（右键能看到「开机启动」「卸载」）

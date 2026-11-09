# 让 AI 助手帮你装

对你的 AI 助手（Claude Code、Codex 等）说一句就行：

> 按这个链接帮我装：https://liljay-h.github.io/ai-news-cover/install.md

下面是写给 AI 助手看的。

---

你要帮我安装「AI news cover」：一张铺在桌面上的 AI 报纸，新闻来自 AIHOT，实时更新、可以点。
在线页：https://liljay-h.github.io/ai-news-cover/ （打开就是报纸本身）

规则：
- 只做安装需要的事，不删除、不修改我电脑上任何已有的文件和设置
- 运行任何程序之前先告诉我；需要我点同意的地方提前说
- 每一步失败就停下来，告诉我哪里出了问题，不要自己换办法硬做

先判断我的系统，再按对应的一节做。

## Windows

1. 下载安装程序到「下载」文件夹：
   `https://github.com/LilJay-H/ai-news-cover/releases/latest/download/AI-news-cover-Setup.exe`
   （PowerShell：`Invoke-WebRequest -Uri <上面的网址> -OutFile "$HOME\Downloads\AI-news-cover-Setup.exe"`）
2. 告诉我即将运行它，然后运行。它不需要管理员权限，也不需要任何别的壁纸软件。如果 Windows 提示「Windows 已保护你的电脑」或「未知发布者」，让我点「更多信息」，再点「仍要运行」
3. 等它装完。如果弹出提示框，等我点完

装好后桌面上会出现报纸。如果我电脑上已经有 Lively Wallpaper 或 Wallpaper Engine，也可以在它们里面选「AI news cover」，这一步是可选的，不用替我装它们。

## macOS

Mac 上用免费的 Plash 把网页铺到桌面。

1. 检查有没有装 Plash（`/Applications/Plash.app` 或 `~/Applications/Plash.app`）。没有就运行 `open "https://apps.apple.com/app/id1494023538"` 打开 App Store 的 Plash 页面，让我自己点安装，装好后告诉你再继续
2. 告诉我即将把报纸加进 Plash，然后运行：
   `open "plash:add?url=https%3A%2F%2Fliljay-h.github.io%2Fai-news-cover%2F%3Fhost%3Dplash&title=AI%20news%20cover"`
3. 提醒我两件事，都在菜单栏的 Plash 图标里：打开「浏览模式」才能点新闻；在设置里打开「在默认浏览器中打开外部链接」，点开的新闻才会在浏览器里弹出

## 只想装成一个独立的小窗口（任何电脑）

不想铺到桌面，也可以装成一个应用：用 Chrome 或 Edge 打开在线页，点右下角的「装到桌面」，再点「安装为应用」；Mac 上的 Safari 用菜单「文件 → 添加到程序坞」。这一步要我自己点，你把在线页地址给我就行。

## 最后

告诉我去看这几处：
1. 桌面上（或应用窗口里）是不是出现了一张报纸，新闻是今天的
2. 右下角有两个小图标，点一下能不能换「简约版」「详细版」
3. 点一条新闻，再点「在 AIHOT 阅读原文」，浏览器是不是弹出来了

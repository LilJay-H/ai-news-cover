#!/bin/bash
# 双击运行：用 Plash 把 AI news cover 铺到桌面。只新增，不删除任何东西，不需要管理员权限，可以重复运行。
URL="https://liljay-h.github.io/ai-news-cover/?host=plash"
# Plash 的 URL scheme：plash:add?url=<网址>&title=<名字>（两个参数都要做 URL 编码；title 可省）
ADD="plash:add?url=https%3A%2F%2Fliljay-h.github.io%2Fai-news-cover%2F%3Fhost%3Dplash&title=AI%20news%20cover"
wait_key() { echo; echo "按回车键关闭。"; read -r _; }

if [ -d "/Applications/Plash.app" ] || [ -d "$HOME/Applications/Plash.app" ]; then
  open -g "$ADD"
  echo "已把「AI news cover」加进 Plash。"
  echo
  echo "还差两步，在菜单栏的 Plash 图标里："
  echo "  1. 打开「浏览模式」，才能点开新闻（平时它只当壁纸看，点不到）"
  echo "  2. 在设置里打开「在默认浏览器中打开外部链接」，点开的新闻才会在你的浏览器里弹出"
else
  echo "这台 Mac 还没有 Plash。我现在帮你打开 App Store 的 Plash 页面（免费）。"
  echo "装好后，再双击一次本文件。"
  open "macappstore://apps.apple.com/app/id1494023538" 2>/dev/null || open "https://sindresorhus.com/plash"
fi
wait_key

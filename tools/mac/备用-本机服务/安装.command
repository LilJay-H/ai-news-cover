#!/bin/bash
# 双击运行：把壁纸装到本机、设开机自启、加进 Plash。只新增，不删除任何东西。可以重复运行。
cd "$(dirname "$0")" || exit 1
APP="$HOME/Library/Application Support/AI-news-cover"
PLIST="$HOME/Library/LaunchAgents/com.ai-news-cover.plist"
stop() { echo; echo "没有装好：$1"; echo "按回车键关闭。"; read -r _; exit 1; }

NODE="$(command -v node)"
[ -z "$NODE" ] && stop "这台 Mac 上还没有 Node。请先到 https://nodejs.org 装好，再双击一次本文件。"

mkdir -p "$APP/page" "$HOME/Library/LaunchAgents" || stop "不能创建安装目录"
cp -R page/. "$APP/page/" || stop "复制页面失败"
cp serve.mjs "$APP/serve.mjs" || stop "复制服务失败"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.ai-news-cover</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$APP/serve.mjs</string><string>$APP/page</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST" || stop "不能启动本机服务"
echo "已装好本机服务（开机自动运行）。"

if [ -d "/Applications/Plash.app" ] || [ -d "$HOME/Applications/Plash.app" ]; then
  open "plash:add?url=http%3A%2F%2F127.0.0.1%3A47822&title=AI%20news%20cover"
  echo "已把「AI news cover」加进 Plash。要点开新闻的话，在菜单栏的 Plash 里打开「浏览模式」。"
else
  echo "还没有 Plash。请到 https://sindresorhus.com/plash 装好，再双击一次本文件。"
fi
echo "按回车键关闭。"; read -r _

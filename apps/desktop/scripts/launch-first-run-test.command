#!/bin/zsh
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
app="$script_dir/../release/mac-arm64/OpenCreator.app"
manifest="$script_dir/../release/opencreator-desktop-build-manifest.json"
profile="$HOME/Library/Application Support/OpenCreator First Run Test"

if [[ ! -f "$manifest" || ! -f "$app/Contents/Resources/web/index.html" ]]; then
  print -u2 '请先完成 pnpm desktop:package 和包校验，再运行首启测试。'
  exit 1
fi

if [[ "${1:-}" == '--reset' ]]; then
  rm -rf -- "$profile"
elif [[ "$#" -ne 0 ]]; then
  print -u2 '用法：launch-first-run-test.command [--reset]'
  exit 1
fi

mkdir -p -- "$profile/config" "$profile/electron" "$profile/Documents"
print "测试配置目录：$profile"
print '不会清除已安装 OpenCreator 的配置；如检测到本机 Codex 登录或模型设置，将复制到测试目录供你确认。'
OPENCREATOR_HOME="$profile/config" \
OPENCREATOR_DEFAULT_PROJECT_ROOT="$profile/Documents" \
"$app/Contents/MacOS/OpenCreator" --user-data-dir="$profile/electron"

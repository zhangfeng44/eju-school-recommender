#!/usr/bin/env bash
# 在 GitHub 上创建仓库并推送（需已安装 gh 且已 gh auth login）
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_NAME="${1:-eju-school-recommender}"

if ! command -v gh >/dev/null 2>&1; then
  echo "未找到 GitHub CLI (gh)。请先安装："
  echo "  brew install gh"
  echo "  gh auth login"
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "已有 remote origin，执行 push..."
  git push -u origin main
else
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push \
    --description "EJU 分数推荐日本大学学部（自用 MVP）"
fi

echo ""
echo "请在 GitHub 仓库 Settings → Pages → Build and deployment 中选择：GitHub Actions"
echo "推送 main 分支后几分钟内可访问 Pages URL。"

#!/usr/bin/env bash
# 部署交易人生静态资源到 204 服务器
# 用法:
#   ./scripts/deploy.sh                    # 使用 ~/.ssh/trading_204 密钥
#   SSHPASS='密码' ./scripts/deploy.sh     # 使用密码
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${DEPLOY_HOST:-root@43.98.167.204}"
REMOTE_DIR="/opt/trading-agent/dashboard/static/life"
SSH_KEY="${DEPLOY_KEY:-$HOME/.ssh/trading_204}"

echo "==> 构建..."
cd "$ROOT"
npm run build

echo "==> 上传到 $REMOTE:$REMOTE_DIR"
if [ -f "$SSH_KEY" ]; then
  SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=no)
  RSYNC_RSH="ssh ${SSH_OPTS[*]}"
  ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$REMOTE_DIR' && rm -rf '$REMOTE_DIR'/*"
  RSYNC_RSH="$RSYNC_RSH" rsync -avz dist/ "$REMOTE:$REMOTE_DIR/" 2>/dev/null || {
    scp "${SSH_OPTS[@]}" -r dist/* "$REMOTE:$REMOTE_DIR/"
  }
elif [ -n "${SSHPASS:-}" ]; then
  sshpass -e ssh -o StrictHostKeyChecking=no "$REMOTE" "mkdir -p '$REMOTE_DIR' && rm -rf '$REMOTE_DIR'/*"
  sshpass -e scp -o StrictHostKeyChecking=no -r dist/* "$REMOTE:$REMOTE_DIR/"
else
  echo "请配置 DEPLOY_KEY 或 SSHPASS 环境变量" >&2
  exit 1
fi

echo "==> 完成: http://43.98.167.204/trading/life/"

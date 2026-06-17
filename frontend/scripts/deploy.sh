#!/usr/bin/env bash
# 部署交易人生静态资源到 204 服务器
# 用法:
#   SSHPASS='密码' ./scripts/deploy.sh
#   DEPLOY_KEY=~/.ssh/xxx ./scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
OUT_DIR="$REPO_ROOT/dashboard/static/life"
REMOTE="${DEPLOY_HOST:-root@43.98.167.204}"
REMOTE_DIR="/opt/trading-agent/dashboard/static/life"
SSH_KEY="${DEPLOY_KEY:-$HOME/.ssh/trading_204}"
JUMP_HOST="${DEPLOY_JUMP:-root@120.55.192.144}"
JUMP_KEY="${DEPLOY_JUMP_KEY:-$HOME/.ssh/id_rsa_nopass}"

echo "==> 构建..."
cd "$ROOT"
npm run build

echo "==> 上传到 $REMOTE:$REMOTE_DIR"

build_ssh_cmd() {
  local -a base=(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=20)
  if [ -f "$JUMP_KEY" ]; then
    base+=(-o "ProxyCommand=ssh -o StrictHostKeyChecking=no -i $JUMP_KEY -W %h:%p $JUMP_HOST")
  fi
  if [ -f "$SSH_KEY" ]; then
    base+=(-i "$SSH_KEY")
  elif [ -n "${SSHPASS:-}" ]; then
    echo "sshpass -e ${base[*]}"
    return
  else
    echo "请配置 DEPLOY_KEY、SSHPASS，或确保 $JUMP_KEY 可连 $JUMP_HOST" >&2
    exit 1
  fi
  echo "${base[*]}"
}

if [ -n "${SSHPASS:-}" ]; then
  SSH_CMD=(sshpass -e ssh -o StrictHostKeyChecking=no -o ConnectTimeout=20)
  if [ -f "$JUMP_KEY" ]; then
    SSH_CMD+=(-o "ProxyCommand=ssh -o StrictHostKeyChecking=no -i $JUMP_KEY -W %h:%p $JUMP_HOST")
  fi
  export SSHPASS
elif [ -f "$SSH_KEY" ]; then
  SSH_CMD=(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=20 -i "$SSH_KEY")
  if [ -f "$JUMP_KEY" ]; then
    SSH_CMD+=(-o "ProxyCommand=ssh -o StrictHostKeyChecking=no -i $JUMP_KEY -W %h:%p $JUMP_HOST")
  fi
else
  echo "请配置 DEPLOY_KEY 或 SSHPASS 环境变量" >&2
  exit 1
fi

"${SSH_CMD[@]}" "$REMOTE" "mkdir -p '$REMOTE_DIR'"
RSYNC_SSH="${SSH_CMD[*]}"
RSYNC_RSH="$RSYNC_SSH" rsync -avz --delete "$OUT_DIR/" "$REMOTE:$REMOTE_DIR/"

echo "==> 完成: http://43.98.167.204/trading/life/"

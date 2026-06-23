#!/usr/bin/env bash
# 部署交易人生：前端静态资源 + 后端 Python（含健康检查与优雅重启）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
OUT_DIR="$REPO_ROOT/dashboard/static/life"
REMOTE="${DEPLOY_HOST:-root@43.98.167.204}"
REMOTE_STATIC="/opt/trading-agent/dashboard/static/life"
REMOTE_DASH="/opt/trading-agent/dashboard"
SSH_KEY="${DEPLOY_KEY:-$HOME/.ssh/trading_204}"
JUMP_HOST="${DEPLOY_JUMP:-root@120.55.192.144}"
JUMP_KEY="${DEPLOY_JUMP_KEY:-$HOME/.ssh/id_rsa_nopass}"
HEALTH_WAIT="${HEALTH_WAIT:-45}"

echo "==> 构建前端..."
cd "$ROOT"
npm run build

if [ ! -d "$OUT_DIR" ]; then
  echo "构建产物不存在: $OUT_DIR" >&2
  exit 1
fi

if [ -n "${SSHPASS:-}" ]; then
  SSH_CMD=(sshpass -e ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30)
  if [ -f "$JUMP_KEY" ]; then
    SSH_CMD+=(-o "ProxyCommand=ssh -o StrictHostKeyChecking=no -i $JUMP_KEY -W %h:%p $JUMP_HOST")
  fi
  export SSHPASS
elif [ -f "$SSH_KEY" ]; then
  SSH_CMD=(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 -i "$SSH_KEY")
  if [ -f "$JUMP_KEY" ]; then
    SSH_CMD+=(-o "ProxyCommand=ssh -o StrictHostKeyChecking=no -i $JUMP_KEY -W %h:%p $JUMP_HOST")
  fi
else
  SSH_CMD=(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30)
fi

RSYNC_RSH="${SSH_CMD[*]}"

echo "==> 上传后端 Python..."
for f in api.py life_game.py life_db.py life_auth.py life_engagement.py life_growth.py life_trading.py trading_events.py trading_modes.py agent_brain.py poker_hands.py poker_engine.py poker_bot.py poker_style.py poker_advanced.py; do
  if [ -f "$REPO_ROOT/dashboard/$f" ]; then
    RSYNC_RSH="$RSYNC_RSH" rsync -avz "$REPO_ROOT/dashboard/$f" "$REMOTE:$REMOTE_DASH/"
  fi
done

if [ -f "$REPO_ROOT/dashboard/scripts/wait-health.sh" ]; then
  "${SSH_CMD[@]}" "$REMOTE" "mkdir -p '$REMOTE_DASH/scripts'"
  RSYNC_RSH="$RSYNC_RSH" rsync -avz "$REPO_ROOT/dashboard/scripts/wait-health.sh" "$REMOTE:$REMOTE_DASH/scripts/"
fi

if [ -f "$REPO_ROOT/dashboard/deploy/trading-dashboard-graceful.conf" ]; then
  "${SSH_CMD[@]}" "$REMOTE" "mkdir -p /etc/systemd/system/trading-dashboard.service.d"
  RSYNC_RSH="$RSYNC_RSH" rsync -avz "$REPO_ROOT/dashboard/deploy/trading-dashboard-graceful.conf" \
    "$REMOTE:/etc/systemd/system/trading-dashboard.service.d/graceful.conf"
fi

echo "==> 上传前端静态资源..."
"${SSH_CMD[@]}" "$REMOTE" "mkdir -p '$REMOTE_STATIC'"
RSYNC_RSH="$RSYNC_RSH" rsync -avz --delete "$OUT_DIR/" "$REMOTE:$REMOTE_STATIC/"

echo "==> 重启 Dashboard 服务（优雅关闭）..."
"${SSH_CMD[@]}" "$REMOTE" bash -s <<'REMOTE_SCRIPT'
set -e
DASH="/opt/trading-agent/dashboard"
if [ -f /etc/systemd/system/trading-dashboard.service.d/graceful.conf ]; then
  systemctl daemon-reload
fi
if systemctl is-active --quiet trading-dashboard 2>/dev/null; then
  systemctl restart trading-dashboard
  echo "已重启 trading-dashboard"
elif systemctl is-active --quiet dashboard 2>/dev/null; then
  systemctl restart dashboard
  echo "已重启 dashboard"
else
  pkill -f "python.*dashboard/api.py" 2>/dev/null || true
  sleep 1
  cd "$DASH"
  nohup python3 -m uvicorn api:app --host 0.0.0.0 --port 9095 --timeout-graceful-shutdown 10 \
    >> /opt/trading-agent/logs/dashboard.log 2>&1 &
  echo "已后台启动 api.py"
fi
chmod +x "$DASH/scripts/wait-health.sh" 2>/dev/null || true
if [ -x "$DASH/scripts/wait-health.sh" ]; then
  "$DASH/scripts/wait-health.sh" "http://127.0.0.1:9095/api/health" 45 1
else
  for i in $(seq 1 45); do
    if curl -sf http://127.0.0.1:9095/api/health >/dev/null 2>&1; then
      echo "健康检查通过 (${i}s)"
      exit 0
    fi
    sleep 1
  done
  echo "健康检查超时" >&2
  journalctl -u trading-dashboard -n 20 --no-pager >&2 || true
  exit 1
fi
REMOTE_SCRIPT

echo "==> 外网探活..."
if [ -x "$ROOT/scripts/check-production.sh" ]; then
  bash "$ROOT/scripts/check-production.sh" || {
    echo "外网探活未完全通过，请手动检查 nginx / 防火墙" >&2
    exit 1
  }
fi

echo "==> 部署完成: http://43.98.167.204/trading/life/"

#!/usr/bin/env bash
# 本地开发环境一键初始化
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 项目根目录: $ROOT"

# Python venv
if [[ ! -d .venv ]]; then
  echo "==> 创建 Python 虚拟环境 .venv"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -U pip wheel
pip install -r requirements.txt

# 环境变量模板
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> 已生成 .env（请按需填写 API Key）"
fi

# 数据/日志目录
mkdir -p data logs config/agents

# 兼容生产路径（Dashboard 等脚本默认读 /opt/trading-agent）
if [[ ! -e /opt/trading-agent ]]; then
  if sudo ln -sf "$ROOT" /opt/trading-agent 2>/dev/null; then
    echo "==> 已创建符号链接 /opt/trading-agent -> $ROOT"
  else
    echo "==> 提示: 无法创建 /opt/trading-agent，请设置 TRADING_AGENT_ROOT=$ROOT"
  fi
fi

# Redis
if command -v redis-cli >/dev/null && redis-cli ping >/dev/null 2>&1; then
  echo "==> Redis 已运行"
elif command -v redis-server >/dev/null; then
  echo "==> 启动 Redis（后台）"
  redis-server --daemonize yes --port 6379 || true
else
  echo "==> 警告: 未检测到 Redis，请安装: sudo apt install redis-server"
fi

# 前端
if command -v npm >/dev/null; then
  echo "==> 安装前端依赖"
  (cd frontend && npm ci)
else
  echo "==> 警告: 未检测到 npm"
fi

echo ""
echo "✅ 开发环境就绪"
echo "   激活 Python: source .venv/bin/activate"
echo "   单次扫描:    cd scripts && python auto_runner.py --once"
echo "   Dashboard:   source .venv/bin/activate && python dashboard/api.py"
echo "   前端 dev:    cd frontend && npm run dev"

#!/usr/bin/env bash
# 等待 trading-dashboard 健康检查通过
set -euo pipefail

URL="${1:-http://127.0.0.1:9095/api/health}"
MAX_WAIT="${2:-45}"
INTERVAL="${3:-1}"

echo "==> 等待健康检查: $URL (最多 ${MAX_WAIT}s)"
for ((i = 1; i <= MAX_WAIT; i++)); do
  if resp=$(curl -sf "$URL" 2>/dev/null); then
    echo "OK (${i}s): $resp"
    exit 0
  fi
  sleep "$INTERVAL"
done

echo "健康检查超时 (${MAX_WAIT}s): $URL" >&2
exit 1

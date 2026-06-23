#!/usr/bin/env bash
# 从本地探测生产环境可用性
set -euo pipefail

BASE="${PROD_BASE:-http://43.98.167.204/trading}"
FAIL=0

check() {
  local name="$1" url="$2" expect="${3:-200}"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo "000")
  if [ "$code" = "$expect" ]; then
    echo "✓ $name  $code  $url"
  else
    echo "✗ $name  $code (期望 $expect)  $url" >&2
    FAIL=1
  fi
}

echo "=== 生产探活 $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
check "health" "$BASE/api/health" "200"
check "life-html" "$BASE/life/" "200"
html=$(curl -sS --max-time 20 "$BASE/life/" || true)
js=$(echo "$html" | grep -oE 'assets/index-[^"]+\.js' | head -1 || true)
if [ -n "$js" ]; then
  check "life-js" "$BASE/life/$js" "200"
else
  echo "✗ life-js  未从 index.html 解析到 JS 路径" >&2
  FAIL=1
fi
check "life-state" "$BASE/api/life/state" "401"

if [ "$FAIL" -eq 0 ]; then
  echo "=== 全部通过 ==="
else
  echo "=== 存在异常 ===" >&2
  exit 1
fi

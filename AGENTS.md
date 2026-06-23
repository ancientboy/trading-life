# AGENTS.md

## Cursor Cloud specific instructions

小风交易系统（XiaoFeng Trading Agent）是一个 Python AI 加密货币模拟交易系统。仓库包含三个可独立运行的部分。标准的依赖安装由启动时的 update script 自动完成（创建 `.venv` + `pip install -r requirements.txt` + `npm install --prefix frontend`），下面只记录非显而易见的运行注意事项。

### 服务总览

| 服务 | 目录 | 运行命令 | 端口 | 说明 |
|------|------|----------|------|------|
| Dashboard API（FastAPI 后端，核心 Web 应用） | `dashboard/` | `TRADING_AGENT_ROOT=/workspace .venv/bin/python dashboard/api.py`（须在 `dashboard/` 目录或保证该目录在 `sys.path`，见下） | `9095` | 提供 `/api/*` 交易监控 API + 交易人生 Life 游戏 `/api/life/*` |
| 前端（Vite + React + Three.js 3D 游戏「交易人生」） | `frontend/` | `npm run dev`（见 `frontend/package.json`） | `5174` | 访问 `http://localhost:5174/trading/life/` |
| 交易脚本（数据采集/分析/模拟下单 CLI） | `scripts/` | 例 `.venv/bin/python scripts/auto_runner.py --once`、`scripts/main.py` | — | 纯 CLI，无 HTTP 服务 |

### 关键非显而易见注意事项

- **启动 Dashboard 必须设置 `TRADING_AGENT_ROOT`。** `dashboard/api.py` 用 `os.environ` 直接读取，默认是生产路径 `/opt/trading-agent`，**不会**从 `.env` 加载。本地必须 `TRADING_AGENT_ROOT=/workspace`（已写入 `.env` 仅供脚本参考，但 api.py 不读 `.env`）。
- **Dashboard 须以脚本方式从 `dashboard/` 目录启动。** `api.py` 用裸 import（`import life_db`、`from life_game import ...`），依赖脚本所在目录被加入 `sys.path`。直接 `python dashboard/api.py` 即可（脚本目录会自动入栈）。不要用 `uvicorn dashboard.api:app` 这种包式导入，会 ImportError。
- **Dashboard 自带的静态 UI（`dashboard/static/index.html`）在本地直连下数据面板会是空的（显示 `undefined`/`--`）。** 因为它写死调用 `location.origin + '/trading/api/...'` 和 `/trading/ws`（生产环境由 nginx 把 `/trading` 前缀剥离后转发）。后端本身完全正常——直接访问 `http://localhost:9095/api/overview` 会返回 200 和完整数据。要让自带 UI 显示数据，需在前面挂一个把 `/trading/` 映射到 `/` 的反向代理。这是预期行为，不是 bug。
- **前端 dev server 把 `/trading/api` 代理到远程生产服务器 `http://43.98.167.204`**（见 `frontend/vite.config.ts`）。所以前端默认对接的是远程后端数据，而非本地 9095。要对接本地后端需修改该代理 target。
- **Dashboard 不需要 Redis**；交易脚本（`auto_runner.py` 等）会用到 Redis（`REDIS_URL` 默认 `redis://localhost:6379/1`）以及通过 `ccxt` 访问 Binance 公开行情（需联网）。镜像默认未安装 redis-server，运行完整交易循环前需 `sudo apt-get install -y redis-server && redis-server --daemonize yes`。
- **Life 游戏数据库**是 SQLite，首次启动自动在 `data/life_game.db` 创建（已 gitignore），无需手动建表。
- **前端类型检查 `tsc` 会报 TSX 泛型语法的预存错误**（TS1003/TS1382），这些不在项目工作流内：项目的构建用 `vite build`（esbuild），`npm run dev` / `npm run build` 均正常。不要为此修改源码。
- 项目内 `scripts/` 和 `dashboard/` 下有大量 `*.bak*` 历史备份文件，属正常，勿动。

### 快速冒烟验证

- 后端：`curl -s -o /dev/null -w '%{http_code}' http://localhost:9095/api/overview` → `200`
- Life 游戏端到端：`POST /api/life/auth/register` → `POST /api/life/points/daily-claim`（积分 +1000）
- 单元测试：`cd dashboard && ../.venv/bin/python test_poker_hands.py` → 打印 `ok`

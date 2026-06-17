# 交易人生 · Trading Life

Web 端模拟经营 + AI 自动交易游戏，核心形象 **咕咕嘎嘎 Gugugaga** Q 版企鹅。

## 技术栈（当前 MVP）

| 层级 | 技术 |
|------|------|
| 3D 渲染 | Three.js + React Three Fiber + Drei |
| 2.5D 模式 | OrthographicCamera 正交相机（默认） |
| 3D 模式 | PerspectiveCamera（底部栏一键切换） |
| 材质 | MeshToonMaterial 卡通平涂 |
| 状态 | Zustand |
| 构建 | Vite + React 18 + TypeScript |
| 后端对接 | 现有 `/trading/api/*`（overview、ticker、agent profile） |

## 本地开发

```bash
cd docs/trading/trading-life
npm install
npm run dev    # http://localhost:5174/trading/life/
npm run build  # 输出 dist/
```

## 部署（204 服务器）

```bash
npm run build
scp -r dist/* root@43.98.167.204:/opt/trading-agent/dashboard/static/life/
```

访问：`http://43.98.167.204/trading/life/`  
旧地址 `/trading/pixel.html` 自动跳转至此。

## 已实现

- [x] 五区 2.5D 地图：交易大厅、前厅接待、按摩、餐厅、赌场
- [x] 墙体隔断 + 门洞路径连通
- [x] Gugugaga 粘土风 Chibi 企鹅（异色瞳、银发夹、企鹅连体衣）
- [x] InstancedMesh 批量工位/按摩床
- [x] 分区 NPC（迎宾、服务员、技师、荷官）
- [x] Agent 路径寻路 + 休闲活动（休息/按摩/就餐/德州）
- [x] 压力值 → 自动前往休闲区；活动后减压
- [x] UI 四层：顶部通栏 / Agent 面板 / 底部控制条
- [x] SOUL + 策略参数编辑（对接现有 API）
- [x] 画质分级（低/中/高）+ 特效开关 + 模拟倍速

## 待迭代（方案 Phase 2+）

- [ ] React Flow 策略拖拽编辑器
- [ ] CodeMirror Lua 沙箱
- [ ] Lightweight Charts K 线面板
- [ ] Socket.IO 实时推送
- [ ] Go 独立演算微服务
- [ ] NestJS 业务后台 + PostgreSQL
- [ ] Mixamo 骨骼动画 + GLB 模型
- [ ] 性格四维度滑块 + 实时预览

详见项目根目录设计文档（用户提供的完整整合方案）。

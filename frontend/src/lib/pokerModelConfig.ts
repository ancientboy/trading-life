/** 德州牌桌 GLB — 将 Meshy 导出的模型放到 public/assets/models/poker-table.glb */
export const POKER_MODEL_URL = `${import.meta.env.BASE_URL}assets/models/poker-table.glb`;

export const POKER_MODEL = {
  /** 视口内牌桌占位系数（相对 CASINO_TABLE.r） */
  viewportFactor: 1.9,
  /** 模型 uniform 缩放 */
  scale: 1.35,
  /** 绕 Y 轴旋转（弧度）— 对齐 8 座座位 */
  rotY: 0,
  /** 相机俯仰（弧度，负值 = 从上往下看） */
  cameraPitch: 0.72,
  cameraDistance: 4.2,
  /** 模型垂直偏移 */
  offsetY: -0.15,
};

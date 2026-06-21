/** 竞技馆布局数据 — 纸面坐标（720×640），供渲染与寻路共用 */

export const ARENA_SCREEN = { px: 360, py: 185, w: 320, h: 128 };
export const ARENA_PIT = { px: 360, py: 395, r: 132 };
export const ARENA_PK_STAGE = { px: 360, py: 330, w: 140, h: 48 };

export interface ArenaPodDef {
  id: string;
  slot: number;
  px: number;
  py: number;
  facing: 'n' | 's' | 'e' | 'w';
}

export interface ArenaDisplayData {
  btcPrice?: number;
  startPrice?: number;
  endPrice?: number;
  pctChange?: number;
  secondsLeft?: number;
  bettingOpen?: boolean;
  poolUp?: number;
  poolDown?: number;
  statusLabel?: string;
  klineCloses?: number[];
}

export const ARENA_PODS: ArenaPodDef[] = Array.from({ length: 6 }, (_, i) => {
  const t = i / 5;
  const ang = Math.PI * 0.12 + t * Math.PI * 0.76;
  const dist = 152;
  const px = ARENA_PIT.px + Math.cos(ang) * dist;
  const py = ARENA_PIT.py + Math.sin(ang) * dist * 0.48;
  const facing: ArenaPodDef['facing'] = px < ARENA_PIT.px - 20 ? 'e' : px > ARENA_PIT.px + 20 ? 'w' : 'n';
  return { id: `arena_pod_${i + 1}`, slot: i, px, py, facing };
});

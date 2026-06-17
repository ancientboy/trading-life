/** 《交易人生》图标规范 — 全局 4 色 + 尺寸 */
export const ICON_COLORS = {
  muted: '#8A92A0',
  gold: '#D4AF37',
  profit: '#48D093',
  loss: '#56A3FF',
} as const;

export type IconColor = keyof typeof ICON_COLORS;

export const ICON_SIZES = {
  sidebar: 22,
  nav: 20,
  canvas: 18,
  modal: 16,
  mini: 13,
  sprite: 32,
} as const;

export type IconSize = keyof typeof ICON_SIZES;

export const STROKE = {
  default: 2,
  mini: 1.5,
} as const;

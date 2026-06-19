/**
 * 角色渲染策略 — 场景内统一 Canvas 2D 程序化绘制，不使用 PNG 贴图。
 * 新增皮肤/物种请在 agentSpecies.ts / agentOutfits.ts 扩展矢量绘制函数。
 */
import type { CharacterPromptView } from './characterPromptSpec';

/** 场景内永远不走 PNG sprite */
export const SCENE_CHARACTER_RENDER_MODE = 'canvas' as const;

export type CharacterSpriteView = CharacterPromptView;

/** @deprecated 场景内已禁用 PNG，恒为 false */
export function speciesUsesPngSprites(_speciesId?: string): boolean {
  return false;
}

/** @deprecated 场景内已禁用 PNG，恒为 false */
export function niumaSpriteReady(_speciesId: string, _skinId: string, _view: CharacterSpriteView): boolean {
  return false;
}

/** @deprecated 不再预加载 PNG */
export function preloadNiumaSprites(): void {
  /* canvas-only */
}

/** @deprecated 不再预加载 PNG */
export function preloadCharacterSkin(_speciesId: string, _skinId: string): void {
  /* canvas-only */
}

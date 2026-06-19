/** 角色 PNG 皮肤 — 有贴图则 drawImage，无则 fallback 程序化绘制 */
import type { CharacterPromptView } from './characterPromptSpec';

const BASE = `${import.meta.env.BASE_URL}assets/characters/`;

export type CharacterSpriteView = CharacterPromptView;

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

export function characterSpriteUrl(
  speciesId: string,
  skinId: string,
  view: CharacterSpriteView,
  layer: 'skin' | 'base' = 'skin',
): string {
  const dir = layer === 'base' ? 'base' : skinId;
  return `${BASE}${speciesId}/${dir}/${view}.png`;
}

export function getCachedCharacterSprite(url: string): HTMLImageElement | null {
  const img = cache.get(url);
  return img?.complete && img.naturalWidth > 0 ? img : null;
}

export function loadCharacterSprite(url: string): Promise<HTMLImageElement | null> {
  const hit = getCachedCharacterSprite(url);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const p = new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image();
    img.onload = () => {
      cache.set(url, img);
      pending.delete(url);
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(url);
      resolve(null);
    };
    img.src = url;
  });
  pending.set(url, p);
  return p;
}

/** 纸面坐标系下绘制正视图 sprite（锚点：脚底中心 ≈ py+8） */
export function drawCharacterSpriteFront(
  ctx: CanvasRenderingContext2D,
  py: number,
  img: HTMLImageElement,
  displayHeight = 54,
) {
  const scale = displayHeight / img.naturalHeight;
  const w = img.naturalWidth * scale;
  const h = displayHeight;
  const footY = py + 8;
  ctx.drawImage(img, -w / 2, footY - h, w, h);
}

export function preloadNiumaSprites(): void {
  for (const skin of ['default', 'casual', 'executive']) {
    preloadCharacterSkin('niuma', skin);
  }
}

export function niumaSpriteReady(speciesId: string, skinId: string, view: CharacterSpriteView): boolean {
  if (speciesId !== 'niuma') return false;
  return !!getCachedCharacterSprite(characterSpriteUrl('niuma', skinId, view, 'skin'));
}

/** @deprecated 使用 niumaSpriteReady */
export function niumaFrontSpriteReady(speciesId: string, skinId: string): boolean {
  return niumaSpriteReady(speciesId, skinId, 'front');
}

/** 预加载某物种某皮肤的三视图（有文件则缓存，无则静默失败） */
export function preloadCharacterSkin(speciesId: string, skinId: string): void {
  for (const view of ['front', 'back', 'side'] as const) {
    void loadCharacterSprite(characterSpriteUrl(speciesId, skinId, view, 'skin'));
  }
}

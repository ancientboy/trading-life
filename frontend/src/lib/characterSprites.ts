/** 角色 PNG 皮肤 — 有贴图则 drawImage，无则 fallback 程序化绘制 */
const BASE = `${import.meta.env.BASE_URL}assets/characters/`;

export type CharacterSpriteView = 'front' | 'back' | 'side';

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

export function characterSpriteUrl(
  speciesId: string,
  skinId: string,
  view: CharacterSpriteView,
): string {
  return `${BASE}${speciesId}/${skinId}/${view}.png`;
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
    void loadCharacterSprite(characterSpriteUrl('niuma', skin, 'front'));
  }
}

export function niumaFrontSpriteReady(speciesId: string, skinId: string): boolean {
  if (speciesId !== 'niuma') return false;
  return !!getCachedCharacterSprite(characterSpriteUrl('niuma', skinId, 'front'));
}

/** 角色 PNG 皮肤 — 有贴图则 drawImage，无则 fallback 程序化绘制 */
import type { CharacterPromptView } from './characterPromptSpec';
import manifest from '../../public/assets/characters/manifest.json';

const BASE = `${(typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/trading/life/'}assets/characters/`;
const MANIFEST_VERSION = String((manifest as { version?: number }).version ?? 1);

export type CharacterSpriteView = CharacterPromptView;
export type CharacterRenderMode = 'procedural' | 'png';

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

/** 场景内是否启用 PNG sprite（默认 procedural，与纸面矢量风格一致） */
export function speciesUsesPngSprites(speciesId: string): boolean {
  const render = (manifest as { render?: Record<string, CharacterRenderMode> }).render;
  return render?.[speciesId] === 'png';
}

export function characterSpriteUrl(
  speciesId: string,
  skinId: string,
  view: CharacterSpriteView,
  layer: 'skin' | 'base' = 'skin',
): string {
  const dir = layer === 'base' ? 'base' : skinId;
  return `${BASE}${speciesId}/${dir}/${view}.png?v=${MANIFEST_VERSION}`;
}

export function getCachedCharacterSprite(url: string): HTMLImageElement | null {
  const img = cache.get(url);
  return img?.complete && img.naturalWidth > 0 ? img : null;
}

/** 检测 AI 误烘焙的灰白棋盘格/纯色底（无 alpha 通道） */
function pixelIsMatteBackground(r: number, g: number, b: number, a: number): boolean {
  if (a < 128) return true;
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const chroma = maxc - minc;
  const avg = (r + g + b) / 3;
  return chroma < 18 && avg > 195;
}

function spriteNeedsBackgroundStrip(img: HTMLImageElement): boolean {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return false;
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0);
  const corners: [number, number][] = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [Math.floor(w * 0.08), Math.floor(h * 0.08)],
    [Math.floor(w * 0.92), Math.floor(h * 0.08)],
  ];
  let matte = 0;
  for (const [x, y] of corners) {
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
    if (pixelIsMatteBackground(r, g, b, a)) matte += 1;
  }
  return matte >= 4;
}

/** 运行时去底 + 裁切透明边，使 sprite 融入场景 */
function prepareCharacterSprite(img: HTMLImageElement): Promise<HTMLImageElement> {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) return Promise.resolve(img);
  sctx.drawImage(img, 0, 0);
  const data = sctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (pixelIsMatteBackground(px[i], px[i + 1], px[i + 2], px[i + 3])) {
      px[i + 3] = 0;
    }
  }
  sctx.putImageData(data, 0, 0);

  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = px[(y * w + x) * 4 + 3];
      if (a > 8) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return Promise.resolve(img);

  const pad = 2;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d');
  if (!octx) return Promise.resolve(img);
  octx.drawImage(src, x0, y0, cw, ch, 0, 0, cw, ch);

  return new Promise(resolve => {
    const cleaned = new Image();
    cleaned.onload = () => resolve(cleaned);
    cleaned.onerror = () => resolve(img);
    cleaned.src = out.toDataURL('image/png');
  });
}

function finalizeSprite(url: string, raw: HTMLImageElement): Promise<HTMLImageElement> {
  const work = spriteNeedsBackgroundStrip(raw)
    ? prepareCharacterSprite(raw)
    : Promise.resolve(raw);
  return work.then(img => {
    cache.set(url, img);
    pending.delete(url);
    return img;
  });
}

export function loadCharacterSprite(url: string): Promise<HTMLImageElement | null> {
  const hit = getCachedCharacterSprite(url);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const p = new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      void finalizeSprite(url, img).then(resolve);
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
  if (!speciesUsesPngSprites('niuma')) return;
  for (const skin of ['default', 'casual', 'executive']) {
    preloadCharacterSkin('niuma', skin);
  }
}

export function niumaSpriteReady(speciesId: string, skinId: string, view: CharacterSpriteView): boolean {
  if (speciesId !== 'niuma' || !speciesUsesPngSprites('niuma')) return false;
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

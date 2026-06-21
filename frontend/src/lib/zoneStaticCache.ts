import { PAPER } from './zoneProjection';

export type StaticCacheKey = string;

export function staticCacheKey(zone: string, skinKey: string, dayMode: string): StaticCacheKey {
  return `${zone}:${skinKey}:${dayMode}`;
}

/** 纸面坐标系 1:1 相机 — 用于离屏静态层绘制 */
export const PAPER_IDENTITY_CAM = {
  cw: PAPER.zoneW,
  ch: PAPER.zoneH,
  scale: 1,
  panX: 0,
  panY: 0,
};

export class ZoneStaticCache {
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private key: StaticCacheKey | null = null;

  invalidate() {
    this.key = null;
  }

  /** 获取或重建纸面静态层（720×640） */
  getLayer(key: StaticCacheKey, paint: (ctx: CanvasRenderingContext2D) => void): CanvasImageSource {
    if (this.key === key && this.canvas) return this.canvas;

    if (!this.canvas) {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.canvas = new OffscreenCanvas(PAPER.zoneW, PAPER.zoneH);
      } else {
        const el = document.createElement('canvas');
        el.width = PAPER.zoneW;
        el.height = PAPER.zoneH;
        this.canvas = el;
      }
    }

    const w = PAPER.zoneW;
    const h = PAPER.zoneH;
    if (this.canvas instanceof HTMLCanvasElement) {
      this.canvas.width = w;
      this.canvas.height = h;
    } else {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return this.canvas;
    ctx.clearRect(0, 0, w, h);
    paint(ctx);
    this.key = key;
    return this.canvas;
  }
}

/** 将纸面静态层按当前相机变换绘制到主画布 */
export function blitPaperLayer(
  ctx: CanvasRenderingContext2D,
  cam: { cw: number; ch: number; scale: number; panX: number; panY: number },
  image: CanvasImageSource,
) {
  const cx = PAPER.zoneW / 2 + cam.panX;
  const cy = PAPER.zoneH / 2 + cam.panY;
  ctx.save();
  ctx.translate(cam.cw / 2, cam.ch / 2);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cx, -cy);
  ctx.drawImage(image, 0, 0, PAPER.zoneW, PAPER.zoneH);
  ctx.restore();
}

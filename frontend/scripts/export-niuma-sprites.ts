/**
 * 从 Paper Canvas 2D 程序化绘制导出牛马 PNG（与场景矢量风格完全一致）
 * 用法: npm run sprites:export -- [skinId]
 */
import { createCanvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  drawNiumaAccessories2d,
  drawNiumaCharacter2d,
  type HairStyleId,
  type NiumaSkinId,
} from '../src/lib/agentSpecies';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(__dir, '../public/assets/characters/niuma');
const SIZE = 512;
const SCALE = 5.8;
const HAIR: HairStyleId = 'pompadour';
const HAIR_COLOR = '#4a3728';

type View = 'front' | 'back' | 'side';

function drawView(ctx: CanvasRenderingContext2D, view: View, skinId: NiumaSkinId) {
  const footPx = SIZE - 44;
  const py = footPx / SCALE - 8;

  ctx.save();
  ctx.translate(SIZE / 2, 0);
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.ellipse(0, py + 10, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  drawNiumaCharacter2d(ctx, py, skinId, view, 1, 0, 0);
  drawNiumaAccessories2d(ctx, py, HAIR, HAIR_COLOR, view, 1);
  ctx.restore();
}

function cropTransparent(canvas: ReturnType<typeof createCanvas>) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 8) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return canvas;
  const pad = 4;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const out = createCanvas(cw, ch);
  out.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return out;
}

function exportSkin(skinId: NiumaSkinId) {
  const dir = join(OUT_ROOT, skinId);
  mkdirSync(dir, { recursive: true });
  for (const view of ['front', 'back', 'side'] as const) {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawView(ctx, view, skinId);
    const cropped = cropTransparent(canvas);
    const out = join(dir, `${view}.png`);
    writeFileSync(out, cropped.toBuffer('image/png'));
    console.log('exported', out, `${cropped.width}x${cropped.height}`);
  }
}

const skin = (process.argv[2] ?? 'default') as NiumaSkinId;
exportSkin(skin);

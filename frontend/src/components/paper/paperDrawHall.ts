/** 交易大厅软装 */
import { hallRestPalette } from '../../lib/zoneSkins';
import { PAPER } from '../../lib/zoneProjection';
import type { PaperCamera } from './renderZone';
import { dropShadow, rrect } from './paperDrawUtils';

/** 交易大厅软装 — 地毯、绿植、壁灯 */
export function drawHallInteriorDecor(
  ctx: CanvasRenderingContext2D,
  cam: { cw: number; ch: number; scale: number; panX: number; panY: number },
  skinKey: string,
  t: number,
) {
  const pal = hallRestPalette(skinKey);
  const premium = skinKey === 'gold';
  const ws = (v: number) => v * cam.scale;
  const pt = (px: number, py: number) => camToScreen(cam, px, py);

  // 工位区地毯
  const rugCx = 340, rugCy = 310, rugW = 560, rugH = 280;
  const rug = pt(rugCx, rugCy);
  ctx.save();
  ctx.fillStyle = premium ? 'rgba(201,168,108,0.18)' : 'rgba(180,160,130,0.12)';
  ctx.beginPath();
  ctx.ellipse(rug.x, rug.y, ws(rugW / 2), ws(rugH / 2), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = premium ? 'rgba(212,175,55,0.25)' : 'rgba(160,140,110,0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // 走道分隔线
  ctx.strokeStyle = premium ? 'rgba(212,175,55,0.15)' : 'rgba(180,170,155,0.2)';
  ctx.lineWidth = 1;
  const aisleL = pt(60, 350);
  const aisleR = pt(660, 350);
  ctx.beginPath();
  ctx.moveTo(aisleL.x, aisleL.y);
  ctx.lineTo(aisleR.x, aisleR.y);
  ctx.stroke();

  // 角落绿植
  const plants = [{ px: 68, py: 175 }, { px: 640, py: 175 }, { px: 68, py: 480 }, { px: 640, py: 480 }];
  plants.forEach((p, i) => {
    const s = pt(p.px, p.py);
    dropShadow(ctx, s.x, s.y + ws(8), ws(24), ws(16), 0.08);
    ctx.fillStyle = '#8b6914';
    rrect(ctx, s.x - ws(8), s.y + ws(2), ws(16), ws(14), ws(3)); ctx.fill();
    ctx.fillStyle = i % 2 === 0 ? '#5a8a4a' : '#6b9e55';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - ws(4), ws(14), ws(18), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(90,138,74,0.6)';
    ctx.beginPath();
    ctx.ellipse(s.x - ws(6), s.y - ws(8), ws(10), ws(12), -0.3, 0, Math.PI * 2);
    ctx.fill();
  });

  // 墙面装饰条
  ctx.fillStyle = premium ? 'rgba(212,175,55,0.12)' : 'rgba(180,160,130,0.15)';
  const topBar = pt(360, 42);
  rrect(ctx, topBar.x - ws(300), topBar.y - ws(6), ws(600), ws(12), ws(4)); ctx.fill();

  // 吊灯
  [180, 360, 540].forEach((px, i) => {
    const lp = pt(px, 130);
    const glow = 0.35 + Math.sin(t * 2 + i) * 0.08;
    ctx.fillStyle = `rgba(212,175,55,${glow * (premium ? 1.2 : 0.7)})`;
    ctx.beginPath(); ctx.arc(lp.x, lp.y, ws(6), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lp.x, lp.y - ws(18)); ctx.lineTo(lp.x, lp.y - ws(6)); ctx.stroke();
  });
}

function camToScreen(cam: { cw: number; ch: number; scale: number; panX: number; panY: number }, px: number, py: number) {
  const cx = PAPER.zoneW / 2 + cam.panX;
  const cy = PAPER.zoneH / 2 + cam.panY;
  return {
    x: cam.cw / 2 + (px - cx) * cam.scale,
    y: cam.ch / 2 + (py - cy) * cam.scale,
  };
}


export function drawRestBooth(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flip = false, skinKey = 'default') {
  const pal = hallRestPalette(skinKey);
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);

  dropShadow(ctx, 0, 0, 170 * s, 95 * s, 0.1);
  ctx.fillStyle = pal.sofaArm;
  rrect(ctx, -78 * s, -32 * s, 28 * s, 58 * s, 6 * s); ctx.fill();
  rrect(ctx, -78 * s, -32 * s, 150 * s, 28 * s, 8 * s); ctx.fill();
  ctx.fillStyle = pal.sofa;
  rrect(ctx, -72 * s, -26 * s, 138 * s, 36 * s, 8 * s); ctx.fill();
  ctx.fillStyle = pal.cushion;
  ctx.beginPath(); ctx.ellipse(-40 * s, -6 * s, 22 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(20 * s, -6 * s, 20 * s, 13 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.accent;
  ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.ellipse(-40 * s, -8 * s, 14 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(20 * s, -8 * s, 12 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.sofaArm;
  rrect(ctx, 50 * s, -28 * s, 24 * s, 52 * s, 6 * s); ctx.fill();
  ctx.fillStyle = '#c8baa8';
  rrect(ctx, -20 * s, 18 * s, 44 * s, 22 * s, 4 * s); ctx.fill();
  ctx.fillStyle = '#faf6ef';
  ctx.beginPath(); ctx.ellipse(-18 * s, 14 * s, 8 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(6 * s, 14 * s, 7 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.accent;
  ctx.fillRect(62 * s, -48 * s, 4 * s, 36 * s);
  ctx.beginPath(); ctx.ellipse(64 * s, -50 * s, 10 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  if (skinKey === 'gold' || skinKey === 'bamboo') {
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.5 * s;
    rrect(ctx, -72 * s, -26 * s, 138 * s, 36 * s, 8 * s); ctx.stroke();
  }
  ctx.restore();
}

/** 前厅接待区绘制 */
import { receptionPalette } from '../../lib/zoneSkins';
import { PAPER } from '../../lib/zoneProjection';
import type { PaperCamera } from './renderZone';
import { dropShadow, rrect } from './paperDrawUtils';

/** 前厅接待区软装 */
export function drawReceptionInterior(
  ctx: CanvasRenderingContext2D,
  cam: { cw: number; ch: number; scale: number; panX: number; panY: number },
  skinKey: string,
  t: number,
  hoverId: string | null,
) {
  const pal = receptionPalette(skinKey);
  const luxury = skinKey === 'luxury';
  const ws = (v: number) => v * cam.scale;
  const pt = (px: number, py: number) => {
    const cx = PAPER.zoneW / 2 + cam.panX;
    const cy = PAPER.zoneH / 2 + cam.panY;
    return { x: cam.cw / 2 + (px - cx) * cam.scale, y: cam.ch / 2 + (py - cy) * cam.scale };
  };

  const floor = pt(360, 320);
  const grd = ctx.createRadialGradient(floor.x, floor.y, 0, floor.x, floor.y, ws(280));
  grd.addColorStop(0, pal.floorLight);
  grd.addColorStop(1, pal.floorDark);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, cam.cw, cam.ch);

  if (luxury) {
    ctx.save();
    ctx.strokeStyle = 'rgba(168,136,40,0.08)';
    ctx.lineWidth = ws(1);
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(floor.x + ws(i * 48 - 120), floor.y - ws(260));
      ctx.bezierCurveTo(
        floor.x + ws(i * 48), floor.y - ws(80),
        floor.x + ws(i * 48 + 30), floor.y + ws(100),
        floor.x + ws(i * 48 + 60), floor.y + ws(280),
      );
      ctx.stroke();
    }
    ctx.restore();

    const rug = pt(360, 430);
    dropShadow(ctx, rug.x, rug.y, ws(200), ws(90), 0.1);
    ctx.fillStyle = pal.rugBase;
    ctx.beginPath(); ctx.ellipse(rug.x, rug.y, ws(100), ws(42), 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pal.accentDim; ctx.lineWidth = ws(2);
    ctx.beginPath(); ctx.ellipse(rug.x, rug.y, ws(100), ws(42), 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = pal.rugPattern; ctx.lineWidth = ws(1);
    for (let ring = 0.78; ring > 0.28; ring -= 0.16) {
      ctx.beginPath(); ctx.ellipse(rug.x, rug.y, ws(100 * ring), ws(42 * ring), 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = pal.accent;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(rug.x + Math.cos(a) * ws(82), rug.y + Math.sin(a) * ws(34), ws(2.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  [[120, 180], [600, 180], [120, 500], [600, 500]].forEach(([px, py], i) => {
    const p = pt(px, py);
    dropShadow(ctx, p.x, p.y + ws(8), ws(24), ws(16), luxury ? 0.1 : 0.06);
    ctx.fillStyle = luxury ? pal.planter : pal.wood;
    rrect(ctx, p.x - ws(luxury ? 9 : 6), p.y + ws(4), ws(luxury ? 18 : 12), ws(luxury ? 16 : 14), ws(3)); ctx.fill();
    if (luxury) {
      ctx.strokeStyle = pal.accentDim; ctx.lineWidth = ws(1);
      rrect(ctx, p.x - ws(9), p.y + ws(4), ws(18), ws(16), ws(3)); ctx.stroke();
    }
    ctx.fillStyle = i % 2 === 0 ? pal.plant : (luxury ? '#5a9868' : pal.plant);
    ctx.beginPath(); ctx.ellipse(p.x, p.y - ws(2), ws(luxury ? 16 : 16), ws(luxury ? 22 : 20), 0, 0, Math.PI * 2); ctx.fill();
    if (luxury) {
      ctx.fillStyle = 'rgba(74,136,104,0.55)';
      ctx.beginPath(); ctx.ellipse(p.x - ws(7), p.y - ws(8), ws(11), ws(13), -0.3, 0, Math.PI * 2); ctx.fill();
    }
  });

  const wall = pt(360, 120);
  if (luxury) {
    ctx.fillStyle = pal.velvet;
    rrect(ctx, wall.x - ws(280), wall.y - ws(34), ws(560), ws(68), ws(6)); ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = ws(2.5);
    rrect(ctx, wall.x - ws(276), wall.y - ws(30), ws(552), ws(60), ws(5)); ctx.stroke();
    ctx.strokeStyle = pal.accentDim; ctx.lineWidth = ws(1);
    for (let i = 0; i < 4; i++) {
      const lx = wall.x - ws(220) + i * ws(147);
      ctx.beginPath(); ctx.moveTo(lx, wall.y - ws(22)); ctx.lineTo(lx, wall.y + ws(22)); ctx.stroke();
    }
    ctx.fillStyle = pal.accent;
    ctx.font = `700 ${Math.max(14, ws(18))}px Georgia,serif`; ctx.textAlign = 'center';
    ctx.fillText('◆  交易人生  ◆', wall.x, wall.y + ws(4));
    ctx.font = `400 ${Math.max(8, ws(9))}px Inter,sans-serif`;
    ctx.fillStyle = 'rgba(255,248,240,0.5)';
    ctx.fillText('PRIVATE RECEPTION LOUNGE', wall.x, wall.y + ws(20));
  } else {
    ctx.fillStyle = pal.wall;
    rrect(ctx, wall.x - ws(280), wall.y - ws(30), ws(560), ws(60), ws(8)); ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = ws(2);
    rrect(ctx, wall.x - ws(276), wall.y - ws(26), ws(552), ws(52), ws(6)); ctx.stroke();
    ctx.fillStyle = pal.accent;
    ctx.font = `700 ${Math.max(14, ws(18))}px Inter,sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('交易人生', wall.x, wall.y + ws(6));
  }

  [[240, 480], [480, 480]].forEach(([px, py], i) => {
    const p = pt(px, py);
    ctx.fillStyle = luxury ? pal.seat : pal.seat;
    rrect(ctx, p.x - ws(18), p.y - ws(10), ws(36), ws(20), ws(5)); ctx.fill();
    if (luxury) {
      ctx.strokeStyle = pal.accentDim; ctx.lineWidth = ws(1);
      rrect(ctx, p.x - ws(18), p.y - ws(10), ws(36), ws(20), ws(5)); ctx.stroke();
    }
    ctx.fillStyle = luxury ? pal.wood : pal.wood;
    rrect(ctx, p.x - ws(18), p.y + (i === 0 ? -ws(18) : ws(8)), ws(36), ws(8), ws(2)); ctx.fill();
    if (luxury) {
      ctx.fillStyle = pal.accentDim;
      rrect(ctx, p.x - ws(16), p.y + (i === 0 ? -ws(16) : ws(10)), ws(32), ws(3), ws(1)); ctx.fill();
    }
  });

  const lamp = pt(360, 260);
  const glow = 0.4 + Math.sin(t * 2) * 0.08;
  if (luxury) {
    ctx.strokeStyle = pal.accentDim; ctx.lineWidth = ws(1.5);
    ctx.beginPath(); ctx.moveTo(lamp.x, lamp.y - ws(36)); ctx.lineTo(lamp.x, lamp.y - ws(12)); ctx.stroke();
    ctx.fillStyle = pal.accent;
    ctx.beginPath(); ctx.arc(lamp.x, lamp.y - ws(38), ws(5), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(212,175,55,${glow * 0.35})`;
    ctx.beginPath(); ctx.arc(lamp.x, lamp.y - ws(14), ws(28), 0, Math.PI * 2); ctx.fill();
    [-ws(22), 0, ws(22)].forEach((dx) => {
      ctx.strokeStyle = pal.accent; ctx.lineWidth = ws(1.2);
      ctx.beginPath(); ctx.moveTo(lamp.x + dx, lamp.y - ws(12)); ctx.lineTo(lamp.x + dx * 0.7, lamp.y - ws(2)); ctx.stroke();
      ctx.fillStyle = `rgba(232,197,71,${glow})`;
      ctx.beginPath(); ctx.arc(lamp.x + dx * 0.7, lamp.y - ws(1), ws(4), 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = pal.accentDim;
    rrect(ctx, lamp.x - ws(26), lamp.y - ws(6), ws(52), ws(5), ws(2)); ctx.fill();
  } else {
    ctx.fillStyle = `rgba(212,175,55,${glow * 0.8})`;
    ctx.beginPath(); ctx.arc(lamp.x, lamp.y, ws(8), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lamp.x, lamp.y - ws(28)); ctx.lineTo(lamp.x, lamp.y - ws(8)); ctx.stroke();
  }
}

/** 接待台台面 — 在迎宾 NPC 之后绘制，形成「站在台后」效果 */
export function drawReceptionDesk(
  ctx: CanvasRenderingContext2D,
  cam: { cw: number; ch: number; scale: number; panX: number; panY: number },
  skinKey: string,
  hoverId: string | null,
) {
  const pal = receptionPalette(skinKey);
  const luxury = skinKey === 'luxury';
  const ws = (v: number) => v * cam.scale;
  const pt = (px: number, py: number) => {
    const cx = PAPER.zoneW / 2 + cam.panX;
    const cy = PAPER.zoneH / 2 + cam.panY;
    return { x: cam.cw / 2 + (px - cx) * cam.scale, y: cam.ch / 2 + (py - cy) * cam.scale };
  };
  const desk = pt(360, 400);
  dropShadow(ctx, desk.x, desk.y, ws(220), ws(70), luxury ? 0.16 : 0.12);
  ctx.fillStyle = pal.desk;
  rrect(ctx, desk.x - ws(110), desk.y - ws(22), ws(220), ws(44), ws(10)); ctx.fill();
  if (luxury) {
    ctx.fillStyle = pal.wood;
    rrect(ctx, desk.x - ws(108), desk.y + ws(14), ws(216), ws(6), ws(2)); ctx.fill();
    ctx.fillStyle = pal.marble;
    rrect(ctx, desk.x - ws(104), desk.y - ws(18), ws(208), ws(36), ws(8)); ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = ws(2);
    rrect(ctx, desk.x - ws(104), desk.y - ws(18), ws(208), ws(36), ws(8)); ctx.stroke();
    ctx.strokeStyle = pal.accentDim; ctx.lineWidth = ws(1);
    rrect(ctx, desk.x - ws(98), desk.y - ws(14), ws(196), ws(28), ws(6)); ctx.stroke();
    ctx.fillStyle = 'rgba(168,136,40,0.06)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(desk.x - ws(90 + i * 30), desk.y - ws(16));
      ctx.bezierCurveTo(
        desk.x - ws(70 + i * 30), desk.y - ws(4),
        desk.x - ws(50 + i * 30), desk.y + ws(8),
        desk.x - ws(30 + i * 30), desk.y + ws(12),
      );
      ctx.fill();
    }
    ctx.fillStyle = pal.accentDim;
    ctx.font = `600 ${Math.max(10, ws(11))}px Georgia,serif`; ctx.textAlign = 'center';
    ctx.fillText('接待台', desk.x, desk.y + ws(5));
  } else {
    ctx.fillStyle = pal.deskTop;
    rrect(ctx, desk.x - ws(104), desk.y - ws(18), ws(208), ws(36), ws(8)); ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = ws(1);
    rrect(ctx, desk.x - ws(104), desk.y - ws(18), ws(208), ws(36), ws(8)); ctx.stroke();
    ctx.fillStyle = pal.accent;
    ctx.font = `600 ${Math.max(10, ws(12))}px Inter,sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('接待台', desk.x, desk.y + ws(5));
  }
  if (hoverId === 'recv_ctr') {
    ctx.strokeStyle = luxury ? 'rgba(212,175,55,0.75)' : 'rgba(212,175,55,0.65)'; ctx.lineWidth = 2.5;
    rrect(ctx, desk.x - ws(112), desk.y - ws(24), ws(224), ws(48), ws(10)); ctx.stroke();
  }
}

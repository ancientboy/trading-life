/** 广式餐厅绘制 */
import { cantonesePalette, skinIsPremium, skinIsNeon, type CantonesePalette } from '../../lib/zoneSkins';
import type { PaperCamera } from './renderZone';
import { dropShadow, rrect } from './paperDrawUtils';

/** 餐桌椭圆桌面半径（× s） */
const DINE_TABLE_RX = 42;
const DINE_TABLE_RY = 32;
const DINE_RIM_INSET = 0.86;

/** 沿桌心→椅方向，落在椭圆桌缘上的点 */
function ellipseRimPoint(
  cx: number, cy: number,
  towardX: number, towardY: number,
  rx: number, ry: number,
  inset = DINE_RIM_INSET,
): { x: number; y: number; angle: number } {
  const dx = towardX - cx;
  const dy = towardY - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const t = inset / Math.sqrt((ux / rx) ** 2 + (uy / ry) ** 2);
  return { x: cx + ux * t, y: cy + uy * t, angle: Math.atan2(dy, dx) };
}

/** 绘制融入桌面的餐具（画在桌布层，非浮贴） */
function drawPlaceSettingEmbedded(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, s: number,
  pal: ReturnType<typeof cantonesePalette>,
  variant: number,
  facingAngle: number,
) {
  const ps = s * 0.68;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facingAngle + Math.PI / 2);

  // 桌布上的浅影 — 让餐具「压」在桌面
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.beginPath(); ctx.ellipse(1 * ps, 2 * ps, 6 * ps, 4.5 * ps, 0, 0, Math.PI * 2); ctx.fill();

  // 餐垫 — 与桌布同色阶，非纯白贴片
  ctx.fillStyle = pal.cream;
  ctx.globalAlpha = 0.92;
  rrect(ctx, -5.5 * ps, -4 * ps, 11 * ps, 8 * ps, 1.8 * ps); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(139,105,20,0.22)'; ctx.lineWidth = 0.5 * ps;
  rrect(ctx, -5.5 * ps, -4 * ps, 11 * ps, 8 * ps, 1.8 * ps); ctx.stroke();

  // 碗 — 略压进桌布
  ctx.fillStyle = pal.jade;
  ctx.beginPath(); ctx.ellipse(0, 0.5 * ps, 4 * ps, 3 * ps, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(45,106,82,0.35)'; ctx.lineWidth = 0.4 * ps;
  ctx.stroke();

  // 金边碟沿
  ctx.strokeStyle = pal.goldDim;
  ctx.lineWidth = 0.5 * ps;
  ctx.beginPath(); ctx.ellipse(0, 0.5 * ps, 3.2 * ps, 2.2 * ps, 0, 0, Math.PI * 2); ctx.stroke();

  // 茶杯 — 按 variant 微偏移，四席略有差异
  const cupOff = (variant % 2 === 0 ? 1 : -1) * 3.2 * ps;
  ctx.fillStyle = pal.crimson;
  ctx.beginPath(); ctx.arc(cupOff, -2.5 * ps, 1.5 * ps, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.gold;
  ctx.beginPath(); ctx.arc(cupOff, -2.5 * ps, 0.8 * ps, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

export function placeSettingAtChair(
  tableX: number, tableY: number,
  chairX: number, chairY: number,
  s: number,
): { x: number; y: number } {
  const rim = ellipseRimPoint(
    tableX, tableY, chairX, chairY,
    DINE_TABLE_RX * s, DINE_TABLE_RY * s,
  );
  return { x: rim.x, y: rim.y };
}

export function drawDiningTable(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number,
  skinKey = 'default',
  chairPts?: { x: number; y: number }[],
) {
  const pal = cantonesePalette(skinKey);
  const rx = DINE_TABLE_RX * s;
  const ry = DINE_TABLE_RY * s;
  dropShadow(ctx, x, y, 110 * s, 85 * s, 0.12);
  ctx.fillStyle = pal.wood;
  ctx.fillRect(x - 5 * s, y + 12 * s, 10 * s, 18 * s);
  ctx.fillStyle = pal.woodLight;
  ctx.beginPath(); ctx.ellipse(x, y + 6 * s, 48 * s, 36 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.tableTop;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();

  // 餐具画在桌布层、中心装饰与金边之前 — 融入桌面
  const chairs = chairPts ?? [
    { x, y: y + 50 * s },
    { x: x - 54 * s, y },
    { x: x + 54 * s, y },
    { x, y: y - 50 * s },
  ];
  chairs.forEach((ch, i) => {
    const rim = ellipseRimPoint(x, y, ch.x, ch.y, rx, ry);
    drawPlaceSettingEmbedded(ctx, rim.x, rim.y, s, pal, i, rim.angle);
  });

  ctx.fillStyle = pal.crimsonDeep;
  ctx.beginPath(); ctx.ellipse(x, y, 18 * s, 13 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.goldDim;
  ctx.beginPath(); ctx.ellipse(x, y, 14 * s, 10 * s, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fffef8';
  rrect(ctx, x - 6 * s, y - 5 * s, 12 * s, 10 * s, 2 * s); ctx.fill();
  ctx.fillStyle = pal.crimson;
  ctx.beginPath(); ctx.arc(x, y, 2.5 * s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = skinKey === 'premium' ? 2.5 * s : 1.8 * s;
  ctx.beginPath(); ctx.ellipse(x, y, 40 * s, 30 * s, 0, 0, Math.PI * 2); ctx.stroke();
  if (skinKey === 'default' || skinKey === 'garden') {
    ctx.fillStyle = pal.crimson;
    ctx.font = `${Math.max(8, 10 * s)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('福', x + 28 * s, y - 22 * s);
  }
}


/** 餐桌上菜 — 在指定座位前缘摆放菜品 */
export function drawTableDishes(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, s: number, t: number, count = 3,
) {
  const dishes = ['🥟', '🦐', '🥬', '🍚', '🍵'].slice(0, count);
  dishes.forEach((emoji, i) => {
    const spread = (i - (dishes.length - 1) / 2) * 5 * s;
    ctx.font = `${Math.max(9, 11 * s)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(emoji, x + spread, y + Math.sin(t * 3 + i) * 1.5);
  });
}

/** 服务员端盘动画 */
export function drawWaiterServeMotion(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  s: number, progress: number, t: number,
) {
  const p = Math.min(1, Math.max(0, progress));
  const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const x = fromX + (toX - fromX) * ease;
  const y = fromY + (toY - fromY) * ease - Math.sin(p * Math.PI) * 8 * s;
  ctx.font = `${Math.max(12, 16 * s)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🍽️', x, y + Math.sin(t * 8) * 2);
  if (p < 0.95) {
    ctx.strokeStyle = 'rgba(232,121,169,0.35)'; ctx.lineWidth = 1.5 * s;
    ctx.setLineDash([4 * s, 4 * s]);
    ctx.beginPath(); ctx.moveTo(fromX, fromY); ctx.lineTo(toX, toY); ctx.stroke();
    ctx.setLineDash([]);
  }
}


export function drawCantoneseBackdrop(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number; scale: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  dayMode: 'day' | 'night',
  skinKey = 'default',
) {
  const pal = cantonesePalette(skinKey);
  const w = cam.cw, h = cam.ch;
  const grd = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, Math.max(w, h) * 0.72);
  grd.addColorStop(0, dayMode === 'night' ? pal.crimsonDeep : pal.floorLight);
  grd.addColorStop(1, dayMode === 'night' ? '#241810' : pal.floorDark);
  ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);

  const header = toScreen(360, 48);
  ctx.fillStyle = pal.crimsonDeep;
  rrect(ctx, header.x - ws(300), header.y - ws(8), ws(600), ws(68), ws(6)); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = ws(2);
  ctx.strokeRect(header.x - ws(290), header.y - ws(4), ws(580), ws(58));

  ctx.fillStyle = pal.gold;
  ctx.font = `700 ${Math.max(12, ws(15))}px Georgia,serif`; ctx.textAlign = 'center';
  const title = skinKey === 'modern' ? '◆  现代粤菜馆  ◆' : '◆  广式粤菜馆  ◆';
  ctx.fillText(title, header.x, header.y + ws(28));
  ctx.font = `400 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.fillStyle = 'rgba(250,243,232,0.75)';
  ctx.fillText(skinKey === 'modern' ? 'MODERN CANTONESE · 轻食 · 茶点' : 'CANTONESE CUISINE · 老火靓汤 · 烧味双拼', header.x, header.y + ws(46));
}

export function drawCantoneseDecor(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  s: number,
  t: number,
  skinKey = 'default',
) {
  const pal = cantonesePalette(skinKey);
  if (skinKey !== 'modern') {
    [[120, 120], [360, 110], [600, 120]].forEach(([px, py]) => {
      const p = toScreen(px, py);
      drawChineseLantern(ctx, p.x, p.y, s, t, pal);
    });
  } else {
    [[120, 120], [600, 120]].forEach(([px, py]) => {
      const p = toScreen(px, py);
      ctx.fillStyle = pal.jade;
      rrect(ctx, p.x - ws(10), p.y - ws(40), ws(20), ws(80), ws(4)); ctx.fill();
    });
  }

  [[85, 380], [635, 380]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    ctx.fillStyle = pal.wood;
    rrect(ctx, p.x - ws(14), p.y - ws(90), ws(28), ws(180), ws(3)); ctx.fill();
    ctx.strokeStyle = pal.goldDim; ctx.lineWidth = 1 * s;
    for (let i = 0; i < 6; i++) {
      ctx.strokeRect(p.x - ws(10), p.y - ws(80) + i * ws(28), ws(20), ws(22));
    }
  });

  const tea = toScreen(120, 555);
  drawTeaStation(ctx, tea.x, tea.y, s, pal);

  [[200, 280], [360, 280], [520, 280], [200, 470], [360, 470], [520, 470]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    drawLazySusanHint(ctx, p.x, p.y, 22, s, t);
  });

  ctx.fillStyle = skinKey === 'modern' ? 'rgba(90,152,136,0.08)' : 'rgba(184,50,50,0.06)';
  const aisle = toScreen(360, 340);
  ctx.beginPath(); ctx.ellipse(aisle.x, aisle.y, ws(280), ws(180), 0, 0, Math.PI * 2); ctx.fill();
}

export function drawCantoneseAmbientLights(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
) {
  const center = toScreen(360, 320);
  const grd = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, ws(340));
  grd.addColorStop(0, 'rgba(255,220,160,0.14)');
  grd.addColorStop(0.5, 'rgba(212,175,55,0.06)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, cam.cw, cam.ch);
}


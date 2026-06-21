/** 德州 VIP 厅绘制 */
import { casinoSeatSlotAngle, CASINO_PLAYER_SEATS } from '../../lib/zoneFurniture';
import { vipPalette, skinIsNeon, type VipPalette } from '../../lib/zoneSkins';
import type { PaperCamera } from './renderZone';
import { dropShadow, rrect } from './paperDrawUtils';

function drawPokerChips(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, colors: string[], count = 4) {
  for (let i = 0; i < count; i++) {
    const ox = (i - (count - 1) / 2) * 7 * s;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath(); ctx.ellipse(x + ox, y - i * 2 * s, 7 * s, 3.5 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.6 * s;
    ctx.beginPath(); ctx.ellipse(x + ox, y - i * 2 * s, 5 * s, 2.5 * s, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

/** 绘制扑克牌背面（以当前变换原点为中心） */
function drawPokerCardBack(
  ctx: CanvasRenderingContext2D, w: number, h: number, radius: number, s: number,
) {
  const hw = w / 2;
  const hh = h / 2;
  const grd = ctx.createLinearGradient(-hw, -hh, hw, hh);
  grd.addColorStop(0, '#9a7420');
  grd.addColorStop(0.45, '#6b4f10');
  grd.addColorStop(1, '#8b6914');
  ctx.fillStyle = grd;
  rrect(ctx, -hw, -hh, w, h, radius);
  ctx.fill();
  ctx.strokeStyle = '#5a4010';
  ctx.lineWidth = Math.max(0.6, 0.8 * s);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(245,239,230,0.38)';
  ctx.lineWidth = Math.max(0.4, 0.55 * s);
  rrect(ctx, -hw + 2 * s, -hh + 2 * s, w - 4 * s, h - 4 * s, Math.max(1, radius - s));
  ctx.stroke();
  ctx.fillStyle = 'rgba(245,239,230,0.88)';
  ctx.font = `${Math.max(8, 11 * s)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🂠', 0, 0);
}

export function drawPokerTable8(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number,
  skinKey = 'default',
) {
  const pal = vipPalette(skinKey);
  const chipColors = skinKey === 'neon'
    ? ['#e040fb', '#00e5ff', '#ff4081', '#7c4dff']
    : skinKey === 'royal'
      ? ['#d4af37', '#8b0000', '#ffd700', '#4a0080']
      : ['#d4af37', '#c0392b', '#2980b9', '#27ae60'];

  dropShadow(ctx, x, y, 250 * s, 190 * s, 0.16);
  ctx.fillStyle = pal.walnutLight;
  ctx.beginPath(); ctx.ellipse(x, y, 122 * s, 84 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.goldDim;
  ctx.lineWidth = 5 * s;
  ctx.strokeStyle = pal.gold;
  ctx.beginPath(); ctx.ellipse(x, y, 116 * s, 78 * s, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = skinKey === 'neon' ? '#1a4038' : '#2d5a3d';
  ctx.beginPath(); ctx.ellipse(x, y, 108 * s, 72 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1 * s;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.ellipse(x, y + i * 14 * s, 96 * s, 8 * s, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = skinKey === 'neon' ? '#143028' : '#1a4030';
  ctx.beginPath(); ctx.ellipse(x, y, 92 * s, 58 * s, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#1a1a1a';
  rrect(ctx, x - 18 * s, y - 58 * s, 36 * s, 22 * s, 4 * s); ctx.fill();
  ctx.fillStyle = pal.gold;
  rrect(ctx, x - 14 * s, y - 54 * s, 28 * s, 6 * s, 2 * s); ctx.fill();
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.translate(x - 10 * s + i * 8 * s, y - 41 * s);
    drawPokerCardBack(ctx, 6 * s, 9 * s, 1 * s, s);
    ctx.restore();
  }

  const cardCount = 5;
  const cardGap = 13 * s;
  const cardStart = x - (cardCount - 1) * cardGap / 2;
  for (let i = 0; i < cardCount; i++) {
    ctx.save();
    ctx.translate(cardStart + i * cardGap, y + Math.sin(t * 2 + i) * 1.5 * s);
    drawPokerCardBack(ctx, 13 * s, 18 * s, 2 * s, s);
    ctx.restore();
  }

  drawPokerSeatNumbers(ctx, x, y, s, chipColors);

  ctx.fillStyle = pal.gold;
  ctx.font = `700 ${Math.max(8, 10 * s)}px Inter,sans-serif`; ctx.textAlign = 'center';
  ctx.fillText('TEXAS HOLD\'EM', x, y + 32 * s);
}

/** 桌面顺时针 1–7 号位（跳过荷官正北）+ 各座位前筹码堆 */
function drawPokerSeatNumbers(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, s: number,
  chipColors: string[],
) {
  const numRx = 100 * s;
  const numRy = 66 * s;
  const chipRx = 82 * s;
  const chipRy = 54 * s;
  const r = 6 * s;

  for (let seatNum = 1; seatNum <= CASINO_PLAYER_SEATS; seatNum++) {
    const ang = casinoSeatSlotAngle(seatNum);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const lx = x + cos * numRx;
    const ly = y + sin * numRy;
    const cx = x + cos * chipRx;
    const cy = y + sin * chipRy;

    drawPokerChips(ctx, cx, cy, s, chipColors, 4);

    ctx.fillStyle = 'rgba(45, 28, 38, 0.92)';
    ctx.beginPath(); ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(212,175,55,0.75)'; ctx.lineWidth = 0.7 * s; ctx.stroke();
    ctx.fillStyle = '#e8c547';
    ctx.font = `700 ${Math.max(7, 8.5 * s)}px Inter,sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(String(seatNum), lx, ly + 2.5 * s);
  }
}

/** 牌桌发牌动画 — 逐张落向桌面中心（牌背朝上） */
export function drawPokerTableDealing(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number,
) {
  for (let i = 0; i < 5; i++) {
    const progress = Math.min(1, Math.max(0, t * 2.2 - i * 0.28));
    if (progress <= 0) continue;
    const ang = -1.1 + i * 0.42;
    const dist = 38 * s * progress;
    const cx = x + Math.cos(ang) * dist;
    const cy = y + Math.sin(ang) * dist * 0.55 - progress * 10 * s;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang * 0.5);
    drawPokerCardBack(ctx, 22 * s, 30 * s, 3 * s, s);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(212,175,55,0.9)';
  ctx.font = `600 ${Math.max(10, 12 * s)}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🃏 荷官发牌中…', x, y - 48 * s);
}


/* ─── Casino VIP lounge decor ─── */

const VIP = {
  gold: '#d4af37',
  goldDim: '#8b6914',
  walnut: '#2a2220',
  walnutLight: '#3d322c',
  burgundy: '#5c2438',
  velvet: '#4a1e32',
  velvetDeep: '#321428',
  rugBase: '#5a2838',
  rugPattern: '#c9a227',
  lampGlow: 'rgba(255,196,120,0.35)',
  cream: '#f5efe6',
};

function drawOvalRug(
  ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, s: number,
  pal: VipPalette = vipPalette('default'),
) {
  dropShadow(ctx, x, y + 4 * s, rx * 2 * s, ry * 2 * s, 0.12);
  ctx.fillStyle = pal.rugBase;
  ctx.beginPath(); ctx.ellipse(x, y, rx * s, ry * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = pal.goldDim; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.ellipse(x, y, rx * s, ry * s, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = pal.rugPattern; ctx.lineWidth = 1 * s;
  for (let ring = 0.75; ring > 0.2; ring -= 0.18) {
    ctx.beginPath(); ctx.ellipse(x, y, rx * ring * s, ry * ring * s, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = pal.gold;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * rx * 0.82 * s, y + Math.sin(a) * ry * 0.82 * s, 3 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRunnerRug(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], s: number, pal: VipPalette = vipPalette('default')) {
  ctx.strokeStyle = pal.rugBase;
  ctx.lineWidth = 28 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.stroke();
  ctx.strokeStyle = pal.goldDim;
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  ctx.strokeStyle = pal.rugPattern;
  ctx.lineWidth = 1 * s;
  ctx.setLineDash([6 * s, 8 * s]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawCasinoVipBackdrop(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number; scale: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  dayMode: 'day' | 'night',
  skinKey = 'default',
) {
  const P = vipPalette(skinKey);
  const w = cam.cw, h = cam.ch;
  const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.65);
  if (dayMode === 'night') {
    grd.addColorStop(0, P.backdropCenter);
    grd.addColorStop(1, '#1a1412');
  } else {
    grd.addColorStop(0, P.backdropCenter);
    grd.addColorStop(1, P.backdropEdge);
  }
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const wallTop = toScreen(360, 40);
  ctx.fillStyle = P.velvetDeep;
  rrect(ctx, wallTop.x - ws(340), wallTop.y - ws(8), ws(680), ws(90), ws(4)); ctx.fill();
  ctx.strokeStyle = P.gold; ctx.lineWidth = ws(2);
  ctx.beginPath();
  ctx.moveTo(wallTop.x - ws(320), wallTop.y + ws(78));
  ctx.lineTo(wallTop.x + ws(320), wallTop.y + ws(78));
  ctx.stroke();

  ctx.fillStyle = P.gold;
  ctx.font = `700 ${Math.max(11, ws(14))}px Georgia,serif`;
  ctx.textAlign = 'center';
  ctx.fillText(skinKey === 'neon' ? '◆  NEON POKER  ◆' : '◆  VIP 德州厅  ◆', wallTop.x, wallTop.y + ws(42));
  ctx.font = `400 ${Math.max(8, ws(9))}px Inter,sans-serif`;
  ctx.fillStyle = 'rgba(245,239,230,0.55)';
  ctx.fillText(skinKey === 'neon' ? 'NEON NIGHT LOUNGE' : 'PRIVATE POKER LOUNGE', wallTop.x, wallTop.y + ws(58));

  [[90, 320], [630, 320]].forEach(([px, py]) => {
    const p = toScreen(px, py);
    ctx.fillStyle = P.velvet;
    rrect(ctx, p.x - ws(18), p.y - ws(120), ws(36), ws(240), ws(4)); ctx.fill();
    ctx.strokeStyle = P.goldDim; ctx.lineWidth = ws(1);
    for (let i = 0; i < 5; i++) {
      const ly = p.y - ws(100) + i * ws(48);
      ctx.beginPath(); ctx.moveTo(p.x - ws(14), ly); ctx.lineTo(p.x + ws(14), ly); ctx.stroke();
    }
  });
}

export function drawCasinoVipDecor(
  ctx: CanvasRenderingContext2D,
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
  s: number,
  t: number,
  skinKey = 'default',
) {
  const P = vipPalette(skinKey);
  const runner = [
    toScreen(22, 320), toScreen(120, 300), toScreen(220, 260),
    toScreen(320, 220), toScreen(360, 200),
  ];
  drawRunnerRug(ctx, runner, s, P);

  const rug = toScreen(360, 340);
  drawOvalRug(ctx, rug.x, rug.y, 210, 155, s, P);

  [
    { px: 118, py: 530, flip: false },
    { px: 602, py: 530, flip: true },
    { px: 118, py: 155, flip: false },
    { px: 602, py: 155, flip: true },
  ].forEach(({ px, py, flip }) => {
    const p = toScreen(px, py);
    drawVipSofa(ctx, p.x, p.y, s, flip, P);
    const tbl = toScreen(px + (flip ? -55 : 55), py + 20);
    drawSideTable(ctx, tbl.x, tbl.y, s, P);
    drawChipStack(ctx, tbl.x, tbl.y - ws(14), s);
  });

  [
    { px: 255, py: 145, kind: 'lamp' as const },
    { px: 465, py: 145, kind: 'lamp' as const },
    { px: 75, py: 420, kind: 'plant' as const },
    { px: 645, py: 420, kind: 'plant' as const },
  ].forEach(({ px, py, kind }) => {
    const p = toScreen(px, py);
    if (kind === 'lamp') drawFloorLamp(ctx, p.x, p.y, s, t, P);
    else drawDecorPlant(ctx, p.x, p.y, s, P);
  });

  const ch = toScreen(360, 195);
  drawChandelier(ctx, ch.x, ch.y, s, t, P);

  const bar = toScreen(360, 580);
  drawChipCabinet(ctx, bar.x, bar.y, s, P);
}

export function drawVipSofa(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flip = false, pal: VipPalette = vipPalette('default')) {
  dropShadow(ctx, x, y, 130 * s, 70 * s, 0.14);
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.fillStyle = pal.burgundy;
  rrect(ctx, -58 * s, -22 * s, 116 * s, 44 * s, 10 * s); ctx.fill();
  ctx.fillStyle = pal.velvetDeep;
  rrect(ctx, -62 * s, -30 * s, 28 * s, 58 * s, 8 * s); ctx.fill();
  rrect(ctx, 34 * s, -30 * s, 28 * s, 58 * s, 8 * s); ctx.fill();
  ctx.fillStyle = pal.gold;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.arc(i * 22 * s, -18 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = pal.cream;
  ctx.beginPath(); ctx.ellipse(0, 6 * s, 20 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawSideTable(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: VipPalette = vipPalette('default')) {
  dropShadow(ctx, x, y + 2 * s, 36 * s, 28 * s, 0.1);
  ctx.fillStyle = pal.walnutLight;
  ctx.beginPath(); ctx.ellipse(x, y, 18 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.5 * s; ctx.stroke();
  ctx.fillStyle = pal.walnut;
  ctx.fillRect(x - 2 * s, y, 4 * s, 14 * s);
}

export function drawChipStack(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const colors = ['#d4af37', '#c0392b', '#2d5a3d', '#1a1a1a'];
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.ellipse(x, y - i * 3 * s, 8 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 0.5; ctx.stroke();
  });
}

export function drawFloorLamp(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, pal: VipPalette = vipPalette('default')) {
  const glow = 0.85 + Math.sin(t * 3) * 0.15;
  ctx.fillStyle = `rgba(255,190,100,${0.12 * glow})`;
  ctx.beginPath(); ctx.ellipse(x, y + 20 * s, 45 * s, 35 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.walnutLight;
  ctx.fillRect(x - 2 * s, y, 4 * s, 38 * s);
  ctx.fillStyle = pal.gold;
  ctx.beginPath();
  ctx.moveTo(x - 14 * s, y - 2 * s);
  ctx.lineTo(x + 14 * s, y - 2 * s);
  ctx.lineTo(x + 10 * s, y - 18 * s);
  ctx.lineTo(x - 10 * s, y - 18 * s);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = `rgba(255,220,160,${0.9 * glow})`;
  ctx.beginPath(); ctx.ellipse(x, y - 20 * s, 8 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawDecorPlant(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: VipPalette = vipPalette('default')) {
  dropShadow(ctx, x, y + 8 * s, 28 * s, 20 * s, 0.08);
  ctx.fillStyle = '#6b4423';
  ctx.beginPath();
  ctx.moveTo(x - 12 * s, y + 10 * s);
  ctx.lineTo(x + 12 * s, y + 10 * s);
  ctx.lineTo(x + 10 * s, y + 28 * s);
  ctx.lineTo(x - 10 * s, y + 28 * s);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = pal.goldDim; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#2d6a3e';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.45;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * 16 * s, y - 8 * s + Math.sin(a) * 10 * s, 14 * s, 8 * s, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#3d8a50';
  ctx.beginPath(); ctx.ellipse(x, y - 18 * s, 10 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawChandelier(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, pal: VipPalette = vipPalette('default')) {
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.moveTo(x, y - 30 * s); ctx.lineTo(x, y); ctx.stroke();
  ctx.fillStyle = pal.gold;
  ctx.beginPath(); ctx.ellipse(x, y - 32 * s, 6 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = -2; i <= 2; i++) {
    const cx = x + i * 14 * s;
    const spark = 0.6 + Math.sin(t * 4 + i) * 0.4;
    ctx.fillStyle = `rgba(255,230,160,${spark})`;
    ctx.beginPath(); ctx.arc(cx, y + 4 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pal.gold; ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + 4 * s); ctx.stroke();
  }
}

export function drawChipCabinet(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: VipPalette = vipPalette('default')) {
  dropShadow(ctx, x, y, 100 * s, 40 * s, 0.1);
  ctx.fillStyle = pal.walnutLight;
  rrect(ctx, x - 50 * s, y - 18 * s, 100 * s, 36 * s, 6 * s); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.5 * s; ctx.stroke();
  for (let i = -2; i <= 2; i++) {
    drawChipStack(ctx, x + i * 18 * s, y - 6 * s, s * 0.85);
  }
  ctx.fillStyle = pal.cream;
  ctx.font = `600 ${Math.max(7, 8 * s)}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('筹码柜', x, y + 14 * s);
}

export function drawVipChair(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, facing: 'n' | 's' | 'e' | 'w' = 's') {
  dropShadow(ctx, x, y + 4 * s, 26 * s, 22 * s, 0.1);
  ctx.fillStyle = VIP.velvetDeep;
  rrect(ctx, x - 11 * s, y - 5 * s, 22 * s, 15 * s, 4 * s); ctx.fill();
  ctx.strokeStyle = VIP.goldDim; ctx.lineWidth = 0.8 * s; ctx.stroke();
  const back = facing === 'n' ? -9 : facing === 's' ? 9 : 0;
  ctx.fillStyle = VIP.burgundy;
  rrect(ctx, x - 11 * s, y + back * s - 5 * s, 22 * s, 7 * s, 3 * s); ctx.fill();
  ctx.fillStyle = VIP.gold;
  ctx.beginPath(); ctx.arc(x, y + back * s - 2 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
}

export function drawCasinoAmbientLights(
  ctx: CanvasRenderingContext2D, cam: { cw: number; ch: number },
  toScreen: (px: number, py: number) => { x: number; y: number },
  ws: (v: number) => number,
) {
  const table = toScreen(360, 330);
  const grd = ctx.createRadialGradient(table.x, table.y, 0, table.x, table.y, ws(280));
  grd.addColorStop(0, 'rgba(255,200,120,0.18)');
  grd.addColorStop(0.5, 'rgba(212,175,55,0.06)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, cam.cw, cam.ch);
}

/* ─── Cantonese restaurant decor ─── */

const YUE = {
  crimson: '#b83232',
  crimsonDeep: '#8a2424',
  gold: '#d4af37',
  goldDim: '#a88828',
  cream: '#faf3e8',
  wood: '#5c3d28',
  woodLight: '#8b5a3c',
  jade: '#3d7a62',
};

function drawChineseLantern(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, pal: CantonesePalette) {
  const sway = Math.sin(t * 2 + x * 0.02) * 3 * s;
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.2 * s;
  ctx.beginPath(); ctx.moveTo(x, y - 18 * s); ctx.lineTo(x + sway, y - 6 * s); ctx.stroke();
  dropShadow(ctx, x + sway, y, 16 * s, 22 * s, 0.1);
  ctx.fillStyle = pal.crimson;
  ctx.beginPath(); ctx.ellipse(x + sway, y, 14 * s, 18 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = pal.gold; ctx.lineWidth = 1.5 * s; ctx.stroke();
  ctx.fillStyle = pal.gold;
  ctx.beginPath(); ctx.ellipse(x + sway, y - 16 * s, 5 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + sway, y + 16 * s, 4 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = pal.goldDim;
  ctx.font = `700 ${Math.max(7, 8 * s)}px serif`; ctx.textAlign = 'center';
  ctx.fillText('福', x + sway, y + 3 * s);
}

function drawTeaStation(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, pal: CantonesePalette) {
  dropShadow(ctx, x, y, 70 * s, 40 * s, 0.08);
  ctx.fillStyle = pal.wood;
  rrect(ctx, x - 35 * s, y - 8 * s, 70 * s, 16 * s, 4 * s); ctx.fill();
  ctx.fillStyle = pal.woodLight;
  rrect(ctx, x - 30 * s, y - 22 * s, 24 * s, 14 * s, 3 * s); ctx.fill();
  ctx.fillStyle = '#fff8f0';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.ellipse(x + 8 * s + i * 16 * s, y - 2 * s, 6 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = pal.goldDim;
  ctx.font = `600 ${Math.max(7, 8 * s)}px Inter,sans-serif`; ctx.textAlign = 'center';
  ctx.fillText('功夫茶', x, y + 14 * s);
}

function drawLazySusanHint(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, s: number, t: number) {
  ctx.strokeStyle = 'rgba(212,175,55,0.35)'; ctx.lineWidth = 1 * s;
  ctx.beginPath(); ctx.arc(x, y, r * s, t * 0.4, t * 0.4 + Math.PI * 1.2); ctx.stroke();
}


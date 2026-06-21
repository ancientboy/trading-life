/** Canvas 2D 通用家具与 UI 绘制 */
import { outfitForRole, type NpcRole } from '../../lib/npcOutfits';
import { DEFAULT_SCARF } from '../../lib/scarfColors';
import { drawScarfStripes } from '../../lib/agentAppearance';
import { drawPenguinBody, drawPenguinFace } from '../../lib/agentSpecies';
import { cantonesePalette, skinIsPremium } from '../../lib/zoneSkins';
import { dropShadow, rrect } from './paperDrawUtils';

function drawMiniChart(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  seed: number, t: number, active: boolean,
) {
  const n = Math.max(6, Math.floor(w / 5));
  const scroll = active ? Math.floor(t * 3) % 3 : 0;
  for (let i = 0; i < n; i++) {
    const idx = i + scroll;
    const bull = ((seed + idx * 7) % 5) > 1;
    const bodyH = (3 + ((seed + idx * 13) % 7)) * (h / 14);
    const cx = x + (i + 0.5) * (w / n);
    const base = y + h * (0.35 + ((seed + idx) % 5) * 0.08) + Math.sin(t * 2 + idx + seed) * (active ? 1.2 : 0);
    ctx.strokeStyle = bull ? '#48D093' : '#56A3FF';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, base - bodyH);
    ctx.lineTo(cx, base + bodyH * 0.3);
    ctx.stroke();
    ctx.fillRect(cx - 1.2, base - bodyH, 2.4, bodyH);
  }
  if (active) {
    ctx.strokeStyle = 'rgba(72,208,147,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const cx = x + (i + 0.5) * (w / n);
      const ny = y + h * (0.3 + ((seed + i * 3) % 4) * 0.12) + Math.sin(t * 4 + i) * 2;
      if (i === 0) ctx.moveTo(cx, ny); else ctx.lineTo(cx, ny);
    }
    ctx.stroke();
  }
}

export function drawDesk(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number,
  opts: { active?: boolean; chartSeed?: number; t?: number; skinKey?: string } = {},
) {
  const monitorActive = opts.active ?? false;
  const t = opts.t ?? 0;
  const seed = opts.chartSeed ?? 1;
  const premium = skinIsPremium(opts.skinKey ?? 'default');
  const dw = 82 * s, dh = 50 * s, r = 6 * s, side = 4 * s;
  const woodTop = premium ? '#c9a86c' : '#e8e0d4';
  const woodSide = premium ? '#8b6914' : '#c8baa8';
  const woodLeg = premium ? '#6b5010' : '#a89888';

  dropShadow(ctx, x, y + side / 2, dw + 8 * s, dh + 8 * s, 0.1);
  // 桌腿
  ctx.fillStyle = woodLeg;
  rrect(ctx, x - dw / 2 + 6 * s, y + dh / 2 - 2 * s, 8 * s, 14 * s, 2 * s); ctx.fill();
  rrect(ctx, x + dw / 2 - 14 * s, y + dh / 2 - 2 * s, 8 * s, 14 * s, 2 * s); ctx.fill();
  // 侧板
  ctx.fillStyle = woodSide;
  ctx.beginPath();
  ctx.moveTo(x + dw / 2, y - dh / 2);
  ctx.lineTo(x + dw / 2, y + dh / 2);
  ctx.lineTo(x + dw / 2, y + dh / 2 + side);
  ctx.lineTo(x - dw / 2, y + dh / 2 + side);
  ctx.lineTo(x - dw / 2, y + dh / 2);
  ctx.closePath(); ctx.fill();
  // 桌面
  ctx.fillStyle = woodTop;
  rrect(ctx, x - dw / 2, y - dh / 2, dw, dh, r); ctx.fill();
  ctx.strokeStyle = premium ? 'rgba(212,175,55,0.45)' : '#ddd4c8';
  ctx.lineWidth = premium ? 1.2 * s : 1; ctx.stroke();
  // 键盘
  ctx.fillStyle = '#3a3a3a';
  rrect(ctx, x - 18 * s, y + 4 * s, 36 * s, 10 * s, 2 * s); ctx.fill();
  ctx.fillStyle = '#555';
  for (let i = 0; i < 5; i++) {
    rrect(ctx, x - 14 * s + i * 6 * s, y + 6 * s, 4 * s, 3 * s, 1 * s); ctx.fill();
  }
  // 咖啡杯
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(x + 24 * s, y + 2 * s, 5 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8B6914';
  ctx.beginPath(); ctx.ellipse(x + 24 * s, y + 1 * s, 3.5 * s, 2.5 * s, 0, 0, Math.PI * 2); ctx.fill();

  const mw = 36 * s, mh = 22 * s;
  const mx = x - mw / 2, my = y - dh / 2 - mh - 4 * s;
  ctx.fillStyle = premium ? '#1a1408' : '#2a2a2a';
  rrect(ctx, mx, my, mw, mh, 4 * s); ctx.fill();
  ctx.fillStyle = monitorActive ? '#0a1520' : '#141820';
  rrect(ctx, mx + 2 * s, my + 2 * s, mw - 4 * s, mh - 4 * s, 3 * s); ctx.fill();
  drawMiniChart(ctx, mx + 3 * s, my + 3 * s, mw - 6 * s, mh - 6 * s, seed, t, monitorActive);
  // 副屏
  if (premium) {
    const sw = 18 * s, sh = 14 * s;
    ctx.fillStyle = '#1a1408';
    rrect(ctx, mx + mw + 4 * s, my + 4 * s, sw, sh, 2 * s); ctx.fill();
    ctx.fillStyle = monitorActive ? '#0a1520' : '#141820';
    rrect(ctx, mx + mw + 5 * s, my + 5 * s, sw - 2 * s, sh - 2 * s, 2 * s); ctx.fill();
  }
  // 显示器支架
  ctx.fillStyle = '#444';
  rrect(ctx, x - 4 * s, y - dh / 2 - 3 * s, 8 * s, 4 * s, 1 * s); ctx.fill();
}

export function drawBooth(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const w = 200 * s, h = 130 * s;
  dropShadow(ctx, x, y, w, h, 0.08);
  ctx.fillStyle = '#c8baa8';
  rrect(ctx, x - w / 2, y - h / 2 - 20 * s, w, 28 * s, 6 * s); ctx.fill();
  ctx.fillStyle = '#8b7355';
  rrect(ctx, x - w / 2 + 12 * s, y - h / 2 + 20 * s, w - 24 * s, 36 * s, 8 * s); ctx.fill();
  ctx.fillStyle = '#d4c8b8';
  rrect(ctx, x - w / 2 + 20 * s, y - h / 2 + 8 * s, w - 40 * s, 14 * s, 4 * s); ctx.fill();
}

/** 大型滚动行情屏 */
export function drawMarketBigScreen(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  items: { label: string; price: string; up?: boolean }[], t: number, s: number,
) {
  dropShadow(ctx, x, y, w, h, 0.1);
  ctx.fillStyle = '#1e1e22';
  rrect(ctx, x - w / 2, y - h / 2, w, h, 10 * s); ctx.fill();
  ctx.strokeStyle = '#3a3a42'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#4285F4';
  rrect(ctx, x - w / 2, y - h / 2, w, 22 * s, 10 * s); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${Math.max(11, 13 * s)}px Inter,sans-serif`; ctx.textAlign = 'left';
  ctx.fillText('实时行情', x - w / 2 + 12 * s, y - h / 2 + 15 * s);

  const rowH = 26 * s;
  const innerH = h - 28 * s;
  const totalH = items.length * rowH;
  const scroll = totalH > innerH ? (t * 28) % totalH : 0;

  ctx.save();
  rrect(ctx, x - w / 2 + 6 * s, y - h / 2 + 24 * s, w - 12 * s, innerH, 6 * s);
  ctx.clip();

  for (let pass = 0; pass < 2; pass++) {
    items.forEach((item, i) => {
      const ry = y - h / 2 + 28 * s + i * rowH - scroll + pass * totalH;
      if (ry < y - h / 2 + 20 * s || ry > y + h / 2 - 4 * s) return;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'transparent';
      ctx.fillRect(x - w / 2 + 8 * s, ry - rowH * 0.35, w - 16 * s, rowH);
      ctx.fillStyle = '#9ab0c8';
      ctx.font = `600 ${Math.max(10, 12 * s)}px Inter,sans-serif`; ctx.textAlign = 'left';
      ctx.fillText(item.label, x - w / 2 + 14 * s, ry + 4 * s);
      ctx.fillStyle = item.up === false ? '#56A3FF' : '#48D093';
      ctx.font = `700 ${Math.max(10, 12 * s)}px monospace`; ctx.textAlign = 'right';
      ctx.fillText(item.price, x + w / 2 - 14 * s, ry + 4 * s);
    });
  }
  ctx.restore();
}

/** 咖啡休息区 */
export function drawCoffeeZone(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number,
  skinKey = 'default',
  vertical = false,
) {
  const premium = skinKey === 'gold';
  const cw = (vertical ? 52 : 130) * s;
  const ch = (vertical ? 118 : 52) * s;
  dropShadow(ctx, x, y, cw + 10 * s, ch + 10 * s, 0.1);
  ctx.fillStyle = premium ? '#8b6914' : '#c8baa8';
  rrect(ctx, x - cw / 2, y - ch / 2, cw, ch, 10 * s); ctx.fill();
  ctx.fillStyle = premium ? '#f8f0e0' : '#f5f0e8';
  rrect(ctx, x - cw / 2 + 3 * s, y - ch / 2 + 3 * s, cw - 6 * s, ch - 6 * s, 8 * s); ctx.fill();
  ctx.strokeStyle = premium ? 'rgba(212,175,55,0.5)' : '#ddd4c8'; ctx.lineWidth = 1; ctx.stroke();

  if (vertical) {
    ctx.fillStyle = premium ? '#2a2218' : '#4a4a4a';
    rrect(ctx, x - 14 * s, y - ch / 2 + 10 * s, 28 * s, 32 * s, 4 * s); ctx.fill();
    ctx.fillStyle = premium ? '#d4af37' : '#666';
    rrect(ctx, x - 10 * s, y - ch / 2 + 14 * s, 20 * s, 8 * s, 2 * s); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const cy = y - ch / 2 + 52 * s + i * 16 * s;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(x, cy + 4 * s, 6 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8B6914';
      ctx.beginPath(); ctx.ellipse(x, cy + 2 * s, 4.5 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
      if (i === 0) {
        ctx.strokeStyle = 'rgba(180,180,180,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, cy - 4 * s);
        ctx.quadraticCurveTo(x + 3 * s, cy - 10 * s - Math.sin(t * 3) * 2, x - 2 * s, cy - 12 * s);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#6b8e4e';
    ctx.beginPath(); ctx.ellipse(x, y + ch / 2 - 14 * s, 8 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
    drawFacilityLabel(ctx, x + cw / 2 + 18 * s, y, '☕ 咖啡区', s);
  } else {
    ctx.fillStyle = premium ? '#2a2218' : '#4a4a4a';
    rrect(ctx, x - cw / 2 + 8 * s, y - 16 * s, 28 * s, 32 * s, 4 * s); ctx.fill();
    ctx.fillStyle = premium ? '#d4af37' : '#666';
    rrect(ctx, x - cw / 2 + 12 * s, y - 12 * s, 20 * s, 8 * s, 2 * s); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const cx = x - cw / 2 + 48 * s + i * 18 * s;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(cx, y + 4 * s, 6 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8B6914';
      ctx.beginPath(); ctx.ellipse(cx, y + 2 * s, 4.5 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
      if (i === 0) {
        ctx.strokeStyle = 'rgba(180,180,180,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, y - 4 * s);
        ctx.quadraticCurveTo(cx + 3 * s, y - 10 * s - Math.sin(t * 3) * 2, cx - 2 * s, y - 12 * s);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#6b8e4e';
    ctx.beginPath(); ctx.ellipse(x + cw / 2 - 16 * s, y - 8 * s, 8 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
    drawFacilityLabel(ctx, x, y + ch / 2 + 14 * s, '☕ 咖啡区', s);
  }
}


export function drawZoneTransitOverlay(
  ctx: CanvasRenderingContext2D, cw: number, ch: number, t: number, label: string,
) {
  ctx.fillStyle = 'rgba(244,242,237,0.92)';
  ctx.fillRect(0, 0, cw, ch);
  const cx = cw / 2, cy = ch / 2;
  const step = Math.sin(t * 8) * 6;
  ctx.fillStyle = '#3d3530';
  ctx.font = '600 15px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy - 36);
  ctx.font = '12px Inter,sans-serif'; ctx.fillStyle = '#8a7e72';
  ctx.fillText('正在前往…', cx, cy - 16);
  for (let i = 0; i < 3; i++) {
    const ox = (i - 1) * 22 + step * (i === 1 ? 0 : 1);
    ctx.beginPath(); ctx.ellipse(cx + ox, cy + 18, 8, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = i === 1 ? '#1a1a1a' : '#888';
    ctx.fill();
  }
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 40, cy + 40);
  ctx.lineTo(cx - 20 + step, cy + 40); ctx.lineTo(cx - 28 + step, cy + 32); ctx.moveTo(cx - 20 + step, cy + 40);
  ctx.lineTo(cx - 28 + step, cy + 48); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 40, cy + 40);
  ctx.lineTo(cx + 20 - step, cy + 40); ctx.lineTo(cx + 28 - step, cy + 32); ctx.moveTo(cx + 20 - step, cy + 40);
  ctx.lineTo(cx + 28 - step, cy + 48); ctx.stroke();
}

export function drawNavArrow(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, dir: 'n' | 's' | 'e' | 'w', bob: number) {
  const py = y + Math.sin(bob * 2.5) * 2;
  const w = 68, h = 26;
  ctx.fillStyle = 'rgba(255,252,247,0.92)';
  ctx.strokeStyle = 'rgba(212,175,55,0.75)'; ctx.lineWidth = 1;
  rrect(ctx, x - w / 2, py - h / 2, w, h, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d4af37';
  ctx.beginPath();
  const ax = x - 22, ay = py;
  const s = 5;
  if (dir === 's') { ctx.moveTo(ax, ay + s); ctx.lineTo(ax - s, ay - s); ctx.lineTo(ax + s, ay - s); }
  else if (dir === 'n') { ctx.moveTo(ax, ay - s); ctx.lineTo(ax - s, ay + s); ctx.lineTo(ax + s, ay + s); }
  else if (dir === 'e') { ctx.moveTo(ax + s, ay); ctx.lineTo(ax - s, ay - s); ctx.lineTo(ax - s, ay + s); }
  else { ctx.moveTo(ax - s, ay); ctx.lineTo(ax + s, ay - s); ctx.lineTo(ax + s, ay + s); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#5a5048'; ctx.font = '600 11px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(label, x + 6, py + 4);
}

export function drawFacilityLabel(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, scale: number, hover = false) {
  ctx.font = `600 ${Math.max(9, 10 * scale)}px Inter,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = hover ? '#3d3530' : 'rgba(61,53,48,0.55)';
  ctx.fillText(label, x, y);
}


export function drawRoundTable(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  dropShadow(ctx, x, y, 80 * s, 80 * s);
  ctx.fillStyle = '#c9b896';
  ctx.beginPath(); ctx.ellipse(x, y, 55 * s, 38 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a8f62';
  ctx.beginPath(); ctx.ellipse(x, y, 38 * s, 26 * s, 0, 0, Math.PI * 2); ctx.fill();
}

export function drawChair(
  ctx: CanvasRenderingContext2D, x: number, y: number, s: number,
  facing: 'n' | 's' | 'e' | 'w' = 's', skinKey = 'default',
) {
  const pal = cantonesePalette(skinKey);
  dropShadow(ctx, x, y + 4 * s, 24 * s, 20 * s, 0.08);
  const seatColor = skinKey === 'modern' ? pal.woodLight : skinKey === 'premium' ? '#4a3020' : '#8b7355';
  const backColor = skinKey === 'modern' ? pal.jade : skinKey === 'premium' ? pal.wood : '#a08060';
  const sw = 20 * s, sh = 14 * s, sr = 3 * s;
  ctx.fillStyle = seatColor;
  rrect(ctx, x - 10 * s, y - 6 * s, sw, sh, sr); ctx.fill();
  if (skinKey === 'premium') {
    ctx.strokeStyle = pal.gold; ctx.lineWidth = 1 * s;
    rrect(ctx, x - 10 * s, y - 6 * s, sw, sh, sr); ctx.stroke();
  }
  ctx.fillStyle = backColor;
  const bw = 20 * s, bh = 6 * s, br = 2 * s;
  if (facing === 'n') {
    rrect(ctx, x - 10 * s, y - 14 * s, bw, bh, br); ctx.fill();
  } else if (facing === 's') {
    rrect(ctx, x - 10 * s, y + 8 * s, bw, bh, br); ctx.fill();
  } else if (facing === 'e') {
    rrect(ctx, x - 16 * s, y - 4 * s, bh, bh + 2 * s, br); ctx.fill();
  } else {
    rrect(ctx, x + 10 * s, y - 4 * s, bh, bh + 2 * s, br); ctx.fill();
  }
}

function drawNpcClothing2d(ctx: CanvasRenderingContext2D, py: number, role: NpcRole) {
  const o = outfitForRole(role);
  if (o.vestColor) {
    ctx.fillStyle = o.vestColor;
    ctx.beginPath(); ctx.ellipse(0, py + 8, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (o.apronColor) {
    ctx.fillStyle = o.apronColor;
    ctx.beginPath();
    ctx.moveTo(-10, py + 4); ctx.lineTo(10, py + 4);
    ctx.lineTo(8, py + 16); ctx.lineTo(-8, py + 16);
    ctx.closePath(); ctx.fill();
  }
  if (o.badgeColor) {
    ctx.fillStyle = o.badgeColor;
    ctx.beginPath(); ctx.arc(0, py + 6, 3, 0, Math.PI * 2); ctx.fill();
  }
  if (o.bowtie) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(-3, py + 2, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3, py + 2, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (o.prop === 'cards') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(10, py + 4, 8, 10);
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 0.5; ctx.strokeRect(10, py + 4, 8, 10);
  }
  if (o.prop === 'tray') {
    ctx.fillStyle = '#d4c8b8';
    ctx.beginPath(); ctx.ellipse(12, py + 8, 7, 3, 0.3, 0, Math.PI * 2); ctx.fill();
  }
}

function drawNpcHat2d(ctx: CanvasRenderingContext2D, py: number, role: NpcRole) {
  const o = outfitForRole(role);
  ctx.fillStyle = o.hatColor;
  switch (o.hat) {
    case 'concierge':
      ctx.fillRect(-8, py - 18, 16, 5);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(-5, py - 22, 10, 4);
      break;
    case 'chef':
      ctx.beginPath(); ctx.ellipse(0, py - 20, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, py - 26, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'headband':
      ctx.fillRect(-10, py - 16, 20, 4);
      break;
    case 'dealer':
      ctx.beginPath(); ctx.ellipse(0, py - 20, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-7, py - 26, 14, 6);
      break;
  }
}

export function drawNpc(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  opts: { npcRole: NpcRole; color: string; name: string; wave: number },
) {
  const bob = Math.sin(opts.wave * 3) * 2;
  const py = y + bob;
  dropShadow(ctx, x, py + 6, 34, 38, 0.12);
  ctx.save(); ctx.translate(x, 0);
  drawPenguinBody(ctx, py);
  drawScarfStripes(ctx, 0, py + 1, 22, 7, false, DEFAULT_SCARF);
  drawScarfStripes(ctx, -10, py + 6, 6, 9, true, DEFAULT_SCARF);
  drawNpcClothing2d(ctx, py, opts.npcRole);
  drawPenguinFace(ctx, py - 2);
  drawNpcHat2d(ctx, py, opts.npcRole);
  ctx.restore();
  ctx.fillStyle = '#3d3530';
  ctx.font = '600 10px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(opts.name.split(' ')[0], x, py - 22);
}

export function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, s: number) {
  const maxW = 140 * s;
  ctx.font = `600 ${Math.max(9, 10 * s)}px Inter,sans-serif`;
  const tw = Math.min(maxW, ctx.measureText(text).width + 16 * s);
  const th = 28 * s;
  ctx.fillStyle = 'rgba(255,252,247,0.96)';
  ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1;
  rrect(ctx, x - tw / 2, y - th - 8 * s, tw, th, 8 * s); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6 * s, y - 8 * s); ctx.lineTo(x, y); ctx.lineTo(x + 6 * s, y - 8 * s);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3d3530'; ctx.textAlign = 'center';
  ctx.fillText(text.length > 18 ? text.slice(0, 17) + '…' : text, x, y - th + 6 * s);
}

/** Agent 服装皮肤 — 整套替换角色外观（非贴图叠加） */

import { drawAgentHat2d, drawAgentScarf2d } from './agentAppearance';

export const OUTFIT_IDS = ['default', 'panda', 'astronaut', 'chef', 'knight', 'street', 'maniu'] as const;
export type OutfitId = typeof OUTFIT_IDS[number];

export const OUTFIT_CATALOG: Record<OutfitId, { label: string; desc: string; preview: string }> = {
  default: { label: '经典企鹅', desc: '默认黑白造型', preview: '🐧' },
  panda: { label: '熊猫连体服', desc: '整只圆滚滚熊猫', preview: '🐼' },
  astronaut: { label: '太空探险服', desc: '全套宇航服 + 头盔', preview: '🚀' },
  chef: { label: '星级厨师服', desc: '厨师帽 + 白褂全身', preview: '👨‍🍳' },
  knight: { label: '皇家骑士甲', desc: '盔甲头盔 + 披风', preview: '🛡️' },
  street: { label: '潮牌卫衣', desc: '连帽卫衣包裹全身', preview: '🧥' },
  maniu: { label: '马牛西装', desc: '商务蓝西装 + 飞机头', preview: '👔' },
};

export const OUTFIT_UNLOCK_MAP: Record<Exclude<OutfitId, 'default'>, string> = {
  panda: 'outfit_panda',
  astronaut: 'outfit_astronaut',
  chef: 'outfit_chef',
  knight: 'outfit_knight',
  street: 'outfit_street',
  maniu: 'outfit_maniu',
};

export function outfitReplacesBaseCharacter(outfitId: OutfitId): boolean {
  return outfitId !== 'default';
}

function darken(hex: string, amt = 0.3): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = Math.max(0, parseInt(full.slice(0, 2), 16) * (1 - amt));
  const g = Math.max(0, parseInt(full.slice(2, 4), 16) * (1 - amt));
  const b = Math.max(0, parseInt(full.slice(4, 6), 16) * (1 - amt));
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function lighten(hex: string, amt = 0.15): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = Math.min(255, parseInt(full.slice(0, 2), 16) + 255 * amt);
  const g = Math.min(255, parseInt(full.slice(2, 4), 16) + 255 * amt);
  const b = Math.min(255, parseInt(full.slice(4, 6), 16) + 255 * amt);
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** 绘制完整角色（含头身），替代默认企鹅 */
export function drawAgentOutfitFull2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  outfitId: OutfitId,
  accent: string,
  view: 'front' | 'back' | 'side' = 'front',
  flip = 1,
) {
  if (outfitId === 'default') return;
  ctx.save();
  if (view === 'side') ctx.scale(flip, 1);
  switch (outfitId) {
    case 'panda': drawPandaFull(ctx, py, view); break;
    case 'astronaut': drawAstronautFull(ctx, py, view); break;
    case 'chef': drawChefFull(ctx, py, view); break;
    case 'knight': drawKnightFull(ctx, py, accent, view); break;
    case 'street': drawStreetFull(ctx, py, accent, view); break;
    case 'maniu': drawManiuFull(ctx, py, view); break;
  }
  ctx.restore();
}

/** 服装之上叠加围巾/帽子（ neck / 头顶位置因服装微调） */
export function drawOutfitAccessories2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  outfitId: OutfitId,
  color: string,
  scarfEnabled: boolean,
  hatEnabled: boolean,
  hatStyle: import('./agentAppearance').HatStyleId,
  view: 'front' | 'back' | 'side',
  flip = 1,
) {
  const neck = outfitNeckY(py, outfitId);
  const hatY = outfitHatY(py, outfitId);
  if (scarfEnabled) drawAgentScarf2d(ctx, neck, color, view, flip);
  if (hatEnabled) drawAgentHat2d(ctx, hatY, hatStyle, color, view, flip);
}

function outfitNeckY(py: number, outfitId: OutfitId): number {
  switch (outfitId) {
    case 'astronaut': return py + 2;
    case 'chef': return py + 4;
    case 'knight': return py + 3;
    case 'street': return py + 6;
    case 'maniu': return py + 4;
    default: return py + 1;
  }
}

function outfitHatY(py: number, outfitId: OutfitId): number {
  switch (outfitId) {
    case 'panda': return py - 24;
    case 'astronaut': return py - 26;
    case 'chef': return py - 30;
    case 'knight': return py - 26;
    case 'street': return py - 22;
    case 'maniu': return py - 24;
    default: return py - 2;
  }
}

export function drawOutfitLimbs2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  outfitId: OutfitId,
  accent: string,
  facing: 'n' | 's' | 'e' | 'w',
  walking: boolean,
  t: number,
  swing: number,
  bounce: number,
) {
  if (outfitId === 'default') return false;
  const vert = facing === 'n' || facing === 's';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;

  switch (outfitId) {
    case 'panda': {
      ctx.strokeStyle = '#1a1a1a';
      ctx.fillStyle = '#1a1a1a';
      if (vert) {
        ctx.beginPath(); ctx.ellipse(-5, py + 20 - bounce + swing, 5.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(5, py + 20 - bounce - swing, 5.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-12, py + 4); ctx.lineTo(-16 - swing * 0.5, py + 14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(12, py + 4); ctx.lineTo(16 + swing * 0.5, py + 14); ctx.stroke();
      } else {
        const flip = facing === 'w' ? -1 : 1;
        ctx.beginPath(); ctx.ellipse(flip * (-4 + swing * 0.4), py + 20 - bounce, 5, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(flip * 11, py + 4); ctx.lineTo(flip * (15 + swing * 0.4), py + 13); ctx.stroke();
      }
      return true;
    }
    case 'astronaut': {
      ctx.fillStyle = '#9aa8b8';
      ctx.strokeStyle = '#e8eef5';
      if (vert) {
        ctx.fillRect(-7, py + 17 - bounce + swing, 6, 5);
        ctx.fillRect(1, py + 17 - bounce - swing, 6, 5);
        ctx.beginPath(); ctx.moveTo(-13, py + 2); ctx.lineTo(-17 - swing * 0.5, py + 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(13, py + 2); ctx.lineTo(17 + swing * 0.5, py + 12); ctx.stroke();
      } else {
        const flip = facing === 'w' ? -1 : 1;
        ctx.fillRect(flip * (2 + swing * 0.3), py + 17 - bounce, 6, 5);
        ctx.beginPath(); ctx.moveTo(flip * 12, py + 2); ctx.lineTo(flip * (16 + swing * 0.4), py + 12); ctx.stroke();
      }
      return true;
    }
    case 'chef': {
      ctx.fillStyle = '#ddd';
      ctx.strokeStyle = '#fafafa';
      if (vert) {
        ctx.beginPath(); ctx.ellipse(-5, py + 19 - bounce + swing, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(5, py + 19 - bounce - swing, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-11, py + 2); ctx.lineTo(-14 - swing * 0.5, py + 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(11, py + 2); ctx.lineTo(14 + swing * 0.5, py + 12); ctx.stroke();
      }
      return true;
    }
    case 'knight': {
      ctx.fillStyle = darken(accent, 0.35);
      ctx.strokeStyle = '#b8c4d0';
      if (vert) {
        ctx.fillRect(-6, py + 18 - bounce + swing, 5, 4);
        ctx.fillRect(1, py + 18 - bounce - swing, 5, 4);
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-12, py + 2); ctx.lineTo(-16 - swing * 0.5, py + 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(12, py + 2); ctx.lineTo(16 + swing * 0.5, py + 12); ctx.stroke();
      }
      return true;
    }
    case 'street': {
      ctx.fillStyle = darken(accent, 0.4);
      ctx.strokeStyle = accent;
      if (vert) {
        ctx.beginPath(); ctx.ellipse(-5, py + 19 - bounce + swing, 5, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(5, py + 19 - bounce - swing, 5, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-11, py + 2); ctx.lineTo(-14 - swing * 0.5, py + 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(11, py + 2); ctx.lineTo(14 + swing * 0.5, py + 12); ctx.stroke();
      }
      return true;
    }
    case 'maniu': {
      ctx.fillStyle = '#faf8f4';
      if (vert) {
        ctx.beginPath(); ctx.arc(-13 - swing * 0.3, py + 6 - bounce + swing * 0.2, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(13 + swing * 0.3, py + 6 - bounce - swing * 0.2, 4.5, 0, Math.PI * 2); ctx.fill();
      } else {
        const flip = facing === 'w' ? -1 : 1;
        ctx.beginPath(); ctx.arc(flip * (12 + swing * 0.3), py + 6 - bounce, 4.2, 0, Math.PI * 2); ctx.fill();
      }
      return true;
    }
    default: return false;
  }
}

// ─── 熊猫：整只 Q 版熊猫 ───────────────────────────────────────

function drawPandaFull(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const white = '#f8f8f8';
  const black = '#1a1a1a';
  if (view === 'front') {
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(0, py + 10, 17, 21, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, py - 12, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = black;
    ctx.beginPath(); ctx.arc(-11, py - 27, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(11, py - 27, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-6, py - 10, 5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6, py - 10, 5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.arc(-6, py - 9, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(6, py - 9, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = black;
    ctx.beginPath(); ctx.ellipse(0, py - 4, 3, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(0, py + 12, 10, 11, 0, 0, Math.PI * 2); ctx.fill();
  } else if (view === 'back') {
    ctx.fillStyle = black;
    ctx.beginPath(); ctx.ellipse(0, py + 8, 17, 21, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, py - 12, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.arc(-10, py - 26, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(10, py - 26, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, py + 4, 8, 9, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(5, py + 9, 14, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(6, py - 12, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = black;
    ctx.beginPath(); ctx.arc(10, py - 25, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, py - 10, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.arc(8, py - 9, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = black;
    ctx.beginPath(); ctx.ellipse(10, py - 4, 2.5, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// ─── 宇航员：头盔 + 宇航服 + 背包 ───────────────────────────────

function drawAstronautFull(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const suit = '#eef2f7';
  const trim = '#7aa8e8';
  const boot = '#8a96a8';
  if (view === 'front') {
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.ellipse(0, py + 12, 18, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = lighten(suit, 0.08);
    ctx.beginPath(); ctx.ellipse(0, py + 14, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = trim; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = trim;
    ctx.fillRect(-9, py + 2, 18, 5);
    ctx.fillStyle = '#e67e22';
    ctx.fillRect(-4, py + 6, 8, 5);
    ctx.fillStyle = boot;
    ctx.fillRect(-8, py + 28, 7, 5);
    ctx.fillRect(1, py + 28, 7, 5);
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.arc(0, py - 14, 17, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b0c0d8'; ctx.lineWidth = 2.5; ctx.stroke();
    const visor = ctx.createRadialGradient(0, py - 14, 2, 0, py - 14, 14);
    visor.addColorStop(0, 'rgba(120,180,230,0.95)');
    visor.addColorStop(0.6, 'rgba(60,120,190,0.75)');
    visor.addColorStop(1, 'rgba(30,70,130,0.55)');
    ctx.fillStyle = visor;
    ctx.beginPath(); ctx.ellipse(0, py - 13, 13, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(-4, py - 17, 4, 6, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a3545';
    ctx.beginPath(); ctx.arc(-4, py - 12, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, py - 12, 2, 0, Math.PI * 2); ctx.fill();
  } else if (view === 'back') {
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.ellipse(0, py + 10, 18, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c8d4e4';
    ctx.fillRect(-8, py - 8, 16, 18);
    ctx.fillStyle = '#98aac4';
    ctx.fillRect(-6, py - 6, 12, 8);
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.arc(0, py - 14, 17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = boot;
    ctx.fillRect(-8, py + 28, 7, 5);
    ctx.fillRect(1, py + 28, 7, 5);
    ctx.fillStyle = trim;
    ctx.fillRect(-3, py - 2, 6, 14);
  } else {
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.ellipse(6, py + 10, 15, 21, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c8d4e4';
    ctx.fillRect(2, py - 6, 8, 16);
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.arc(7, py - 14, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(80,140,200,0.7)';
    ctx.beginPath(); ctx.ellipse(9, py - 13, 10, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = boot;
    ctx.fillRect(4, py + 28, 7, 5);
  }
}

// ─── 厨师：高帽 + 全身白褂 ─────────────────────────────────────

function drawChefFull(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const coat = '#fafafa';
  const shadow = '#e8e8e8';
  if (view === 'front') {
    ctx.fillStyle = coat;
    ctx.beginPath(); ctx.moveTo(-18, py + 28); ctx.lineTo(-14, py - 2); ctx.lineTo(14, py - 2); ctx.lineTo(18, py + 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shadow;
    for (let i = 0; i < 4; i++) ctx.fillRect(-10 + i * 6, py + 4 + (i % 2) * 5, 3, 3);
    ctx.fillStyle = '#c0392b';
    ctx.beginPath(); ctx.moveTo(0, py + 2); ctx.lineTo(-6, py + 10); ctx.lineTo(6, py + 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = coat;
    ctx.beginPath(); ctx.ellipse(0, py - 10, 13, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a2220';
    ctx.beginPath(); ctx.arc(-4, py - 10, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, py - 10, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0c090';
    ctx.beginPath(); ctx.ellipse(0, py - 5, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = coat;
    ctx.fillRect(-10, py - 32, 20, 22);
    ctx.beginPath(); ctx.ellipse(0, py - 32, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.ellipse(-4, py - 34, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, py - 33, 3.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  } else if (view === 'back') {
    ctx.fillStyle = coat;
    ctx.beginPath(); ctx.moveTo(-17, py + 28); ctx.lineTo(-13, py - 2); ctx.lineTo(13, py - 2); ctx.lineTo(17, py + 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = coat;
    ctx.fillRect(-10, py - 32, 20, 22);
    ctx.beginPath(); ctx.ellipse(0, py - 32, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, py - 10, 13, 12, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = coat;
    ctx.beginPath(); ctx.moveTo(0, py + 28); ctx.lineTo(-4, py - 2); ctx.lineTo(18, py - 2); ctx.lineTo(14, py + 28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = coat;
    ctx.fillRect(4, py - 32, 16, 22);
    ctx.beginPath(); ctx.ellipse(10, py - 32, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, py - 10, 12, 11, 0, 0, Math.PI * 2); ctx.fill();
  }
}

// ─── 骑士：盔甲 + 头盔 + 披风 ─────────────────────────────────

function drawKnightFull(ctx: CanvasRenderingContext2D, py: number, accent: string, view: 'front' | 'back' | 'side') {
  const plate = '#b8c4d0';
  const plateDark = '#8a98a8';
  const cape = accent;
  if (view === 'front') {
    ctx.fillStyle = darken(cape, 0.1);
    ctx.beginPath(); ctx.moveTo(-20, py - 4); ctx.lineTo(0, py + 26); ctx.lineTo(20, py - 4); ctx.lineTo(14, py - 8); ctx.lineTo(-14, py - 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = plate;
    ctx.beginPath(); ctx.ellipse(0, py + 12, 16, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = plateDark;
    ctx.fillRect(-5, py + 2, 10, 14);
    ctx.fillStyle = lighten(plate, 0.12);
    ctx.beginPath(); ctx.ellipse(-12, py + 0, 6, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(12, py + 0, 6, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = plate;
    ctx.beginPath(); ctx.ellipse(0, py - 12, 14, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a4555';
    ctx.fillRect(-6, py - 14, 12, 8);
    ctx.fillStyle = '#1a2535';
    ctx.fillRect(-2, py - 12, 4, 10);
    ctx.fillStyle = plateDark;
    ctx.beginPath(); ctx.ellipse(0, py - 22, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  } else if (view === 'back') {
    ctx.fillStyle = darken(cape, 0.2);
    ctx.beginPath(); ctx.moveTo(-18, py - 2); ctx.lineTo(0, py + 28); ctx.lineTo(18, py - 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = plateDark;
    ctx.beginPath(); ctx.ellipse(0, py + 10, 16, 19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = plate;
    ctx.beginPath(); ctx.ellipse(0, py - 12, 14, 13, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = cape;
    ctx.fillRect(0, py - 4, 10, 28);
    ctx.fillStyle = plate;
    ctx.beginPath(); ctx.ellipse(6, py + 10, 14, 19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = plateDark;
    ctx.beginPath(); ctx.ellipse(8, py - 12, 13, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a4555';
    ctx.fillRect(6, py - 14, 8, 7);
  }
}

// ─── 马牛：商务蓝西装 + 飞机头 ─────────────────────────────────

function drawManiuFull(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const skin = '#f5efe6';
  const hair = '#2a2018';
  const suit = '#2b7fd4';
  const lapel = '#1a4a8a';
  const tie = '#f4a89a';
  if (view === 'front') {
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(-14, py - 10);
    ctx.quadraticCurveTo(-8, py - 32, 6, py - 22);
    ctx.quadraticCurveTo(12, py - 18, 10, py - 8);
    ctx.quadraticCurveTo(2, py - 14, -14, py - 10);
    ctx.fill();
    ctx.fillStyle = '#2a2220';
    ctx.fillRect(-9, py - 8, 7, 2.2);
    ctx.fillRect(2, py - 8, 7, 2.2);
    ctx.beginPath(); ctx.ellipse(-5, py - 2, 3.2, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, py - 2, 3.2, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a2220'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, py + 4); ctx.quadraticCurveTo(-3, py + 6, -5, py + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, py + 4); ctx.quadraticCurveTo(3, py + 6, 5, py + 4); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = suit;
    ctx.fillRect(-18, py + 2, 36, 22);
    ctx.fillStyle = lapel;
    ctx.beginPath(); ctx.moveTo(-10, py + 2); ctx.lineTo(-2, py + 14); ctx.lineTo(-6, py + 14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, py + 2); ctx.lineTo(2, py + 14); ctx.lineTo(6, py + 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(-4, py + 4); ctx.lineTo(0, py + 16); ctx.lineTo(4, py + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = tie;
    ctx.fillRect(-2, py + 6, 4, 12);
    ctx.fillStyle = lapel;
    ctx.fillRect(6, py + 10, 7, 6);
    ctx.fillStyle = '#e8c547';
    ctx.beginPath(); ctx.arc(9.5, py + 13, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-12, py + 9, 10, 6);
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 0.6; ctx.strokeRect(-12, py + 9, 10, 6);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 5px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('马牛', -7, py + 13.5);
    ctx.restore();
  } else if (view === 'back') {
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.ellipse(0, py - 14, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = darken(suit, 0.12);
    ctx.fillRect(-18, py + 2, 36, 22);
    ctx.fillStyle = lapel;
    ctx.fillRect(-2, py + 4, 4, 16);
    ctx.restore();
  } else {
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(7, py + 2, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(2, py - 8);
    ctx.quadraticCurveTo(8, py - 30, 16, py - 18);
    ctx.quadraticCurveTo(14, py - 10, 6, py - 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a2220';
    ctx.beginPath(); ctx.ellipse(10, py - 2, 2.8, 3.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(7, py + 2, 16, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = suit;
    ctx.fillRect(-2, py + 2, 20, 20);
    ctx.fillStyle = tie;
    ctx.fillRect(8, py + 8, 3, 10);
    ctx.restore();
  }
}

// ─── 潮牌卫衣：连帽包裹全身 ───────────────────────────────────

function drawStreetFull(ctx: CanvasRenderingContext2D, py: number, accent: string, view: 'front' | 'back' | 'side') {
  const main = accent;
  const shade = darken(accent, 0.22);
  const hood = darken(accent, 0.12);
  if (view === 'front') {
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.ellipse(0, py + 12, 17, 21, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hood;
    ctx.beginPath(); ctx.moveTo(-16, py - 6); ctx.quadraticCurveTo(0, py - 34, 16, py - 6); ctx.quadraticCurveTo(0, py - 18, -16, py - 6); ctx.fill();
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.moveTo(-12, py - 4); ctx.lineTo(0, py - 28); ctx.lineTo(12, py - 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = darken(main, 0.35);
    ctx.fillRect(-8, py + 10, 16, 8);
    ctx.strokeStyle = darken(main, 0.45); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-3, py - 20); ctx.lineTo(-3, py - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3, py - 20); ctx.lineTo(3, py - 6); ctx.stroke();
    ctx.fillStyle = '#2a2220';
    ctx.beginPath(); ctx.arc(-4, py - 12, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, py - 12, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = main;
    ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('潮', 0, py + 16);
  } else if (view === 'back') {
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.ellipse(0, py + 12, 17, 21, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hood;
    ctx.beginPath(); ctx.moveTo(-15, py - 4); ctx.quadraticCurveTo(0, py - 32, 15, py - 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.moveTo(-10, py - 2); ctx.lineTo(0, py - 26); ctx.lineTo(10, py - 2); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.ellipse(6, py + 11, 15, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hood;
    ctx.beginPath(); ctx.moveTo(0, py - 4); ctx.quadraticCurveTo(10, py - 32, 18, py - 6); ctx.lineTo(8, py - 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a2220';
    ctx.beginPath(); ctx.arc(9, py - 12, 2, 0, Math.PI * 2); ctx.fill();
  }
}

export function isOutfitShopItem(item: { id: string; type: string }): boolean {
  return item.type === 'outfit';
}

/** @deprecated 使用 drawAgentOutfitFull2d */
export function drawAgentOutfit2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  outfitId: OutfitId,
  accent: string,
  view: 'front' | 'back' | 'side' = 'front',
  flip = 1,
) {
  drawAgentOutfitFull2d(ctx, py, outfitId, accent, view, flip);
}

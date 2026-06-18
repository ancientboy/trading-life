/** 角色物种 — 与企鹅同级的独立基础角色（各有专属皮肤） */

import { drawAgentHat2d, drawAgentScarf2d, type HatStyleId } from './agentAppearance';

export const SPECIES_IDS = ['penguin', 'maniu'] as const;
export type SpeciesId = typeof SPECIES_IDS[number];

export const SPECIES_CATALOG: Record<SpeciesId, { label: string; desc: string; preview: string }> = {
  penguin: { label: '经典企鹅', desc: '黑白 Q 版企鹅造型', preview: '🐧' },
  maniu: { label: '马牛', desc: '圆球头身 · 商务西装 · 漂浮小手', preview: '👔' },
};

export const SPECIES_UNLOCK_MAP: Partial<Record<Exclude<SpeciesId, 'penguin'>, string>> = {
  maniu: 'species_maniu',
};

/** 马牛专属皮肤（default = 蓝色商务西装基础造型） */
export const MANIU_SKIN_IDS = ['default', 'casual', 'executive'] as const;
export type ManiuSkinId = typeof MANIU_SKIN_IDS[number];

export const MANIU_SKIN_CATALOG: Record<ManiuSkinId, { label: string; desc: string; preview: string }> = {
  default: { label: '商务西装', desc: '蓝色西装 + 工牌「马牛」', preview: '👔' },
  casual: { label: '休闲 Polo', desc: '绿色 Polo + 轻松造型', preview: '👕' },
  executive: { label: '总裁黑金', desc: '黑色高定 + 金边领带', preview: '🎩' },
};

export const MANIU_SKIN_UNLOCK_MAP: Record<Exclude<ManiuSkinId, 'default'>, string> = {
  casual: 'outfit_maniu_casual',
  executive: 'outfit_maniu_executive',
};

export function isSpeciesUnlocked(speciesId: SpeciesId, shopUnlocks: string[]): boolean {
  if (speciesId === 'penguin') return true;
  const id = SPECIES_UNLOCK_MAP[speciesId];
  if (id && shopUnlocks.includes(id)) return true;
  // 旧版 outfit_maniu 购买记录兼容为物种解锁
  if (speciesId === 'maniu' && shopUnlocks.includes('outfit_maniu')) return true;
  return false;
}

export function isManiuSkinUnlocked(skinId: ManiuSkinId, shopUnlocks: string[]): boolean {
  if (skinId === 'default') return true;
  const id = MANIU_SKIN_UNLOCK_MAP[skinId];
  return id ? shopUnlocks.includes(id) : false;
}

export function unlockedManiuSkins(shopUnlocks: string[]): ManiuSkinId[] {
  return MANIU_SKIN_IDS.filter(id => isManiuSkinUnlocked(id, shopUnlocks));
}

export function normalizeSpeciesId(raw?: string): SpeciesId {
  return raw === 'maniu' ? 'maniu' : 'penguin';
}

/** 旧数据迁移：outfitId=maniu → speciesId=maniu + outfitId=default */
export function migrateLegacyAppearance(meta: { speciesId?: string; outfitId?: string }): {
  speciesId: SpeciesId;
  outfitId: string;
} {
  if (meta.outfitId === 'maniu' && !meta.speciesId) {
    return { speciesId: 'maniu', outfitId: 'default' };
  }
  const speciesId = normalizeSpeciesId(meta.speciesId);
  let outfitId = meta.outfitId || 'default';
  if (speciesId === 'maniu') {
    if (!MANIU_SKIN_IDS.includes(outfitId as ManiuSkinId)) outfitId = 'default';
  }
  return { speciesId, outfitId };
}

function darken(hex: string, amt = 0.3): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = Math.max(0, parseInt(full.slice(0, 2), 16) * (1 - amt));
  const g = Math.max(0, parseInt(full.slice(2, 4), 16) * (1 - amt));
  const b = Math.max(0, parseInt(full.slice(4, 6), 16) * (1 - amt));
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function drawManiuFace(ctx: CanvasRenderingContext2D, py: number) {
  ctx.fillStyle = '#2a2220';
  ctx.fillRect(-9, py - 8, 7, 2.2);
  ctx.fillRect(2, py - 8, 7, 2.2);
  ctx.beginPath(); ctx.ellipse(-5, py - 2, 3.2, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(5, py - 2, 3.2, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2a2220'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, py + 4); ctx.quadraticCurveTo(-3, py + 6, -5, py + 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, py + 4); ctx.quadraticCurveTo(3, py + 6, 5, py + 4); ctx.stroke();
}

function drawManiuHair(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  ctx.fillStyle = '#2a2018';
  if (view === 'front') {
    ctx.beginPath();
    ctx.moveTo(-14, py - 10);
    ctx.quadraticCurveTo(-8, py - 32, 6, py - 22);
    ctx.quadraticCurveTo(12, py - 18, 10, py - 8);
    ctx.quadraticCurveTo(2, py - 14, -14, py - 10);
    ctx.fill();
  } else if (view === 'back') {
    ctx.beginPath(); ctx.ellipse(0, py - 14, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(2, py - 8);
    ctx.quadraticCurveTo(8, py - 30, 16, py - 18);
    ctx.quadraticCurveTo(14, py - 10, 6, py - 6);
    ctx.closePath(); ctx.fill();
  }
}

function drawManiuBodySphere(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const skin = '#f5efe6';
  ctx.fillStyle = skin;
  if (view === 'side') {
    ctx.beginPath(); ctx.arc(7, py + 2, 16, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.fill();
  }
}

function drawManiuSuitDefault(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const suit = '#2b7fd4';
  const lapel = '#1a4a8a';
  const tie = '#f4a89a';
  if (view === 'front') {
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
    ctx.save();
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = darken(suit, 0.12);
    ctx.fillRect(-18, py + 2, 36, 22);
    ctx.fillStyle = lapel;
    ctx.fillRect(-2, py + 4, 4, 16);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath(); ctx.arc(7, py + 2, 16, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = suit;
    ctx.fillRect(-2, py + 2, 20, 20);
    ctx.fillStyle = tie;
    ctx.fillRect(8, py + 8, 3, 10);
    ctx.restore();
  }
}

function drawManiuSuitCasual(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const polo = '#4a9e5c';
  const collar = '#fafafa';
  if (view === 'front') {
    ctx.save();
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = polo;
    ctx.fillRect(-18, py + 6, 36, 18);
    ctx.fillStyle = collar;
    ctx.beginPath(); ctx.moveTo(-6, py + 6); ctx.lineTo(0, py + 12); ctx.lineTo(6, py + 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = darken(polo, 0.2);
    ctx.fillRect(-3, py + 10, 6, 10);
    ctx.fillStyle = '#fafafa';
    ctx.font = 'bold 6px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MN', 0, py + 20);
    ctx.restore();
  } else if (view === 'back') {
    ctx.save();
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = darken(polo, 0.08);
    ctx.fillRect(-18, py + 6, 36, 18);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath(); ctx.arc(7, py + 2, 16, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = polo;
    ctx.fillRect(-2, py + 6, 20, 16);
    ctx.restore();
  }
}

function drawManiuSuitExecutive(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const suit = '#1a1a2e';
  const gold = '#d4af37';
  if (view === 'front') {
    ctx.save();
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = suit;
    ctx.fillRect(-18, py + 2, 36, 22);
    ctx.strokeStyle = gold; ctx.lineWidth = 1;
    ctx.strokeRect(-10, py + 4, 20, 18);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(-4, py + 4); ctx.lineTo(0, py + 16); ctx.lineTo(4, py + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(-2, py + 6, 4, 12);
    ctx.fillStyle = gold;
    ctx.fillRect(-8, py + 10, 6, 1.5);
    ctx.fillRect(2, py + 10, 6, 1.5);
    ctx.restore();
  } else if (view === 'back') {
    ctx.save();
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#12121f';
    ctx.fillRect(-18, py + 2, 36, 22);
    ctx.strokeStyle = gold; ctx.lineWidth = 0.8;
    ctx.strokeRect(-8, py + 4, 16, 18);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath(); ctx.arc(7, py + 2, 16, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = suit;
    ctx.fillRect(-2, py + 2, 20, 20);
    ctx.restore();
  }
}

/** 绘制马牛完整角色（物种基础 + 皮肤） */
export function drawManiuCharacter2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  skinId: ManiuSkinId,
  view: 'front' | 'back' | 'side' = 'front',
  flip = 1,
) {
  ctx.save();
  if (view === 'side') ctx.scale(flip, 1);
  drawManiuBodySphere(ctx, py, view);
  drawManiuHair(ctx, py, view);
  if (view === 'front') drawManiuFace(ctx, py);
  else if (view === 'side') {
    ctx.fillStyle = '#2a2220';
    ctx.beginPath(); ctx.ellipse(10, py - 2, 2.8, 3.8, 0, 0, Math.PI * 2); ctx.fill();
  }
  switch (skinId) {
    case 'default': drawManiuSuitDefault(ctx, py, view); break;
    case 'casual': drawManiuSuitCasual(ctx, py, view); break;
    case 'executive': drawManiuSuitExecutive(ctx, py, view); break;
  }
  ctx.restore();
}

export function drawManiuLimbs2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  facing: 'n' | 's' | 'e' | 'w',
  swing: number,
  bounce: number,
) {
  const vert = facing === 'n' || facing === 's';
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

export function drawManiuAccessories2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  skinId: ManiuSkinId,
  color: string,
  scarfEnabled: boolean,
  hatEnabled: boolean,
  hatStyle: HatStyleId,
  view: 'front' | 'back' | 'side',
  flip = 1,
) {
  const neck = py + (skinId === 'default' ? 4 : 6);
  const hatY = py - 24;
  if (scarfEnabled) drawAgentScarf2d(ctx, neck, color, view, flip);
  if (hatEnabled) drawAgentHat2d(ctx, hatY, hatStyle, color, view, flip);
}

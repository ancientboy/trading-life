/** 角色物种 — 牛马等与企鹅同级的独立基础角色 */

export const SPECIES_IDS = ['penguin', 'niuma'] as const;
export type SpeciesId = typeof SPECIES_IDS[number];

export const SPECIES_CATALOG: Record<SpeciesId, { label: string; desc: string; preview: string }> = {
  penguin: { label: '经典企鹅', desc: '黑白 Q 版企鹅造型', preview: '🐧' },
  niuma: { label: '牛马', desc: '圆球头身 · 商务西装 · 漂浮圆手', preview: '👔' },
};

export const SPECIES_UNLOCK_MAP: Partial<Record<Exclude<SpeciesId, 'penguin'>, string>> = {
  niuma: 'species_niuma',
};

/** 牛马专属皮肤 */
export const NIUMa_SKIN_IDS = ['default', 'casual', 'executive'] as const;
export type NiumaSkinId = typeof NIUMa_SKIN_IDS[number];

export const NIUMa_SKIN_CATALOG: Record<NiumaSkinId, { label: string; desc: string; preview: string }> = {
  default: { label: '商务西装', desc: '蓝色西装 + 工牌「牛马」', preview: '👔' },
  casual: { label: '休闲 Polo', desc: '绿色 Polo + 轻松造型', preview: '👕' },
  executive: { label: '总裁黑金', desc: '黑色高定 + 金边领带', preview: '🎩' },
};

export const NIUMa_SKIN_UNLOCK_MAP: Record<Exclude<NiumaSkinId, 'default'>, string> = {
  casual: 'outfit_niuma_casual',
  executive: 'outfit_niuma_executive',
};

/** 牛马发型（类似企鹅帽子，可换款式 + 配色） */
export const HAIR_STYLE_IDS = ['pompadour', 'buzz', 'sidepart', 'curly', 'spiky', 'afro', 'twin'] as const;
export type HairStyleId = typeof HAIR_STYLE_IDS[number];

export const HAIR_STYLES: Record<HairStyleId, { label: string }> = {
  pompadour: { label: '飞机头' },
  buzz: { label: '寸头' },
  sidepart: { label: '侧分' },
  curly: { label: '卷发' },
  spiky: { label: '刺猬头' },
  afro: { label: '爆炸头' },
  twin: { label: '双丸子' },
};

export const FREE_HAIR_STYLES = new Set<HairStyleId>(['pompadour', 'buzz', 'sidepart']);

export const HAIR_UNLOCK_MAP: Partial<Record<HairStyleId, string>> = {
  curly: 'hair_curly_unlock',
  spiky: 'hair_spiky_unlock',
  afro: 'hair_afro_unlock',
  twin: 'hair_twin_unlock',
};

const LEGACY_SPECIES_UNLOCKS = ['species_maniu', 'outfit_maniu'];
const LEGACY_SKIN_UNLOCKS: Record<string, string> = {
  casual: 'outfit_maniu_casual',
  executive: 'outfit_maniu_executive',
};

export function isSpeciesUnlocked(speciesId: SpeciesId, shopUnlocks: string[]): boolean {
  if (speciesId === 'penguin') return true;
  const id = SPECIES_UNLOCK_MAP[speciesId];
  if (id && shopUnlocks.includes(id)) return true;
  if (speciesId === 'niuma' && LEGACY_SPECIES_UNLOCKS.some(k => shopUnlocks.includes(k))) return true;
  return false;
}

export function isNiumaSkinUnlocked(skinId: NiumaSkinId, shopUnlocks: string[]): boolean {
  if (skinId === 'default') return true;
  const id = NIUMa_SKIN_UNLOCK_MAP[skinId];
  if (id && shopUnlocks.includes(id)) return true;
  const legacy = LEGACY_SKIN_UNLOCKS[skinId];
  return legacy ? shopUnlocks.includes(legacy) : false;
}

export function isHairUnlocked(style: HairStyleId, shopUnlocks: string[]): boolean {
  if (FREE_HAIR_STYLES.has(style)) return true;
  const id = HAIR_UNLOCK_MAP[style];
  return id ? shopUnlocks.includes(id) : true;
}

export function unlockedNiumaSkins(shopUnlocks: string[]): NiumaSkinId[] {
  return NIUMa_SKIN_IDS.filter(id => isNiumaSkinUnlocked(id, shopUnlocks));
}

export function unlockedHairStyles(shopUnlocks: string[]): HairStyleId[] {
  return HAIR_STYLE_IDS.filter(id => isHairUnlocked(id, shopUnlocks));
}

export function normalizeSpeciesId(raw?: string): SpeciesId {
  if (raw === 'niuma' || raw === 'maniu') return 'niuma';
  return 'penguin';
}

export function migrateLegacyAppearance(meta: { speciesId?: string; outfitId?: string }): {
  speciesId: SpeciesId;
  outfitId: string;
} {
  const legacySpecies = meta.speciesId === 'maniu' || meta.outfitId === 'maniu';
  if (legacySpecies && normalizeSpeciesId(meta.speciesId) !== 'niuma') {
    return { speciesId: 'niuma', outfitId: meta.outfitId === 'maniu' ? 'default' : (meta.outfitId || 'default') };
  }
  if (meta.outfitId === 'maniu' && !meta.speciesId) {
    return { speciesId: 'niuma', outfitId: 'default' };
  }
  const speciesId = normalizeSpeciesId(meta.speciesId);
  let outfitId = meta.outfitId || 'default';
  if (outfitId === 'maniu') outfitId = 'default';
  if (speciesId === 'niuma' && !NIUMa_SKIN_IDS.includes(outfitId as NiumaSkinId)) outfitId = 'default';
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

function drawNiumaFace(ctx: CanvasRenderingContext2D, py: number) {
  ctx.fillStyle = '#2a2220';
  ctx.fillRect(-9, py - 8, 7, 2.2);
  ctx.fillRect(2, py - 8, 7, 2.2);
  ctx.beginPath(); ctx.ellipse(-5, py - 2, 3.2, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(5, py - 2, 3.2, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2a2220'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0, py + 4); ctx.quadraticCurveTo(-3, py + 6, -5, py + 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, py + 4); ctx.quadraticCurveTo(3, py + 6, 5, py + 4); ctx.stroke();
}

/** 牛马发型 2D — 可换款式与颜色 */
export function drawNiumaHair2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  style: HairStyleId,
  hairColor: string,
  view: 'front' | 'back' | 'side' = 'front',
  flip = 1,
) {
  const main = hairColor;
  const shade = darken(hairColor, 0.22);
  ctx.fillStyle = main;
  if (view === 'back') {
    ctx.beginPath(); ctx.ellipse(0, py - 14, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (view === 'side') {
    ctx.save();
    if (flip === -1) ctx.scale(-1, 1);
    switch (style) {
      case 'pompadour':
        ctx.beginPath();
        ctx.moveTo(2, py - 8);
        ctx.quadraticCurveTo(8, py - 30, 16, py - 18);
        ctx.quadraticCurveTo(14, py - 10, 6, py - 6);
        ctx.closePath(); ctx.fill();
        break;
      case 'afro':
        ctx.beginPath(); ctx.arc(8, py - 14, 12, 0, Math.PI * 2); ctx.fill();
        break;
      default:
        ctx.beginPath(); ctx.ellipse(8, py - 12, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    return;
  }
  switch (style) {
    case 'pompadour':
      ctx.beginPath();
      ctx.moveTo(-14, py - 10);
      ctx.quadraticCurveTo(-8, py - 32, 6, py - 22);
      ctx.quadraticCurveTo(12, py - 18, 10, py - 8);
      ctx.quadraticCurveTo(2, py - 14, -14, py - 10);
      ctx.fill();
      break;
    case 'buzz':
      ctx.beginPath(); ctx.ellipse(0, py - 16, 15, 6, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'sidepart':
      ctx.beginPath();
      ctx.moveTo(-15, py - 8);
      ctx.quadraticCurveTo(-4, py - 28, 12, py - 14);
      ctx.quadraticCurveTo(8, py - 8, -10, py - 6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade;
      ctx.fillRect(-2, py - 22, 2, 14);
      break;
    case 'curly':
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath(); ctx.arc(i * 6, py - 18 + (i % 2) * 2, 5, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'spiky':
      ctx.fillStyle = main;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 5 - 2, py - 8);
        ctx.lineTo(i * 5, py - 26);
        ctx.lineTo(i * 5 + 2, py - 8);
        ctx.closePath(); ctx.fill();
      }
      break;
    case 'afro':
      ctx.beginPath(); ctx.arc(0, py - 16, 16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.arc(-4, py - 18, 5, 0, Math.PI * 2); ctx.fill();
      break;
    case 'twin':
      ctx.beginPath(); ctx.arc(-9, py - 22, 6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(9, py - 22, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.arc(-9, py - 23, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(9, py - 23, 2.5, 0, Math.PI * 2); ctx.fill();
      break;
  }
}

function drawNiumaBodySphere(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  ctx.fillStyle = '#f5efe6';
  if (view === 'side') {
    ctx.beginPath(); ctx.arc(7, py + 2, 16, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.fill();
  }
}

/** 漂浮圆手 — 绘制在身体两侧外侧 */
export function drawNiumaHands2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  view: 'front' | 'back' | 'side',
  swing = 0,
  bounce = 0,
) {
  const hand = '#faf8f4';
  const outline = 'rgba(40,30,20,0.18)';
  ctx.fillStyle = hand;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 1;
  const r = 5.8;
  const yHand = py + 10 - bounce;
  if (view === 'front') {
    ctx.beginPath(); ctx.arc(-22 - swing * 0.25, yHand, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(22 + swing * 0.25, yHand, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else if (view === 'back') {
    ctx.beginPath(); ctx.arc(-20 - swing * 0.2, yHand, r - 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(20 + swing * 0.2, yHand, r - 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(26 + swing * 0.25, yHand, r - 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

function drawNiumaSuitDefault(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
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
    ctx.fillText('牛马', -7, py + 13.5);
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

function drawNiumaSuitCasual(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const polo = '#4a9e5c';
  if (view === 'front') {
    ctx.save();
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = polo;
    ctx.fillRect(-18, py + 6, 36, 18);
    ctx.fillStyle = '#fafafa';
    ctx.beginPath(); ctx.moveTo(-6, py + 6); ctx.lineTo(0, py + 12); ctx.lineTo(6, py + 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = darken(polo, 0.2);
    ctx.fillRect(-3, py + 10, 6, 10);
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

function drawNiumaSuitExecutive(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
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
    ctx.restore();
  } else if (view === 'back') {
    ctx.save();
    ctx.beginPath(); ctx.arc(0, py + 2, 18, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#12121f';
    ctx.fillRect(-18, py + 2, 36, 22);
    ctx.restore();
  } else {
    ctx.save();
    ctx.beginPath(); ctx.arc(7, py + 2, 16, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = suit;
    ctx.fillRect(-2, py + 2, 20, 20);
    ctx.restore();
  }
}

/** 绘制牛马完整角色（身体 + 皮肤 + 圆手；发型在 head 层单独绘制） */
export function drawNiumaCharacter2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  skinId: NiumaSkinId,
  view: 'front' | 'back' | 'side' = 'front',
  flip = 1,
  swing = 0,
  bounce = 0,
) {
  ctx.save();
  if (view === 'side') ctx.scale(flip, 1);
  drawNiumaBodySphere(ctx, py, view);
  if (view === 'front') drawNiumaFace(ctx, py);
  else if (view === 'side') {
    ctx.fillStyle = '#2a2220';
    ctx.beginPath(); ctx.ellipse(10, py - 2, 2.8, 3.8, 0, 0, Math.PI * 2); ctx.fill();
  }
  switch (skinId) {
    case 'default': drawNiumaSuitDefault(ctx, py, view); break;
    case 'casual': drawNiumaSuitCasual(ctx, py, view); break;
    case 'executive': drawNiumaSuitExecutive(ctx, py, view); break;
  }
  drawNiumaHands2d(ctx, py, view, swing, bounce);
  ctx.restore();
}

export function drawNiumaLimbs2d(
  _ctx: CanvasRenderingContext2D,
  _py: number,
  _facing: 'n' | 's' | 'e' | 'w',
  _swing: number,
  _bounce: number,
) {
  // 圆手在 drawNiumaCharacter2d 末尾绘制（避免被身体遮挡）
  return true;
}

/** 牛马 head 层 — 仅发型（替代企鹅围巾/帽子） */
export function drawNiumaAccessories2d(
  ctx: CanvasRenderingContext2D,
  py: number,
  hairStyle: HairStyleId,
  hairColor: string,
  view: 'front' | 'back' | 'side',
  flip = 1,
) {
  drawNiumaHair2d(ctx, py, hairStyle, hairColor, view, flip);
}

// ─── 旧名兼容 ───────────────────────────────────────────────────
export type ManiuSkinId = NiumaSkinId;
export const MANIU_SKIN_IDS = NIUMa_SKIN_IDS;
export const MANIU_SKIN_CATALOG = NIUMa_SKIN_CATALOG;
export const drawManiuCharacter2d = drawNiumaCharacter2d;
export const drawManiuLimbs2d = drawNiumaLimbs2d;
export const drawManiuAccessories2d = drawNiumaAccessories2d;
export const unlockedManiuSkins = unlockedNiumaSkins;
export const isManiuSkinUnlocked = isNiumaSkinUnlocked;

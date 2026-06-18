/** Agent 服装皮肤 — 与围巾、帽子可同时穿戴（蛋仔派对式分层） */

export const OUTFIT_IDS = ['default', 'panda', 'astronaut', 'chef', 'knight', 'street'] as const;
export type OutfitId = typeof OUTFIT_IDS[number];

export const OUTFIT_CATALOG: Record<OutfitId, { label: string; desc: string; preview: string }> = {
  default: { label: '经典企鹅', desc: '默认黑白造型', preview: '🐧' },
  panda: { label: '熊猫连体服', desc: '圆滚滚黑白熊猫', preview: '🐼' },
  astronaut: { label: '太空探险服', desc: '白色宇航服 + 背包', preview: '🚀' },
  chef: { label: '星级厨师服', desc: '双排扣白褂 + 领结', preview: '👨‍🍳' },
  knight: { label: '皇家骑士甲', desc: '银色胸甲 + 披风', preview: '🛡️' },
  street: { label: '潮牌卫衣', desc: '连帽卫衣 + 口袋', preview: '🧥' },
};

export const OUTFIT_UNLOCK_MAP: Record<Exclude<OutfitId, 'default'>, string> = {
  panda: 'outfit_panda',
  astronaut: 'outfit_astronaut',
  chef: 'outfit_chef',
  knight: 'outfit_knight',
  street: 'outfit_street',
};

function darken(hex: string, amt = 0.3): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = Math.max(0, parseInt(full.slice(0, 2), 16) * (1 - amt));
  const g = Math.max(0, parseInt(full.slice(2, 4), 16) * (1 - amt));
  const b = Math.max(0, parseInt(full.slice(4, 6), 16) * (1 - amt));
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** 在 drawPenguinBody 之后、围巾/脸/帽子之前绘制服装层 */
export function drawAgentOutfit2d(
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
    case 'panda':
      drawPandaOutfit(ctx, py, view);
      break;
    case 'astronaut':
      drawAstronautOutfit(ctx, py, view);
      break;
    case 'chef':
      drawChefOutfit(ctx, py, view);
      break;
    case 'knight':
      drawKnightOutfit(ctx, py, accent, view);
      break;
    case 'street':
      drawStreetOutfit(ctx, py, accent, view);
      break;
  }

  ctx.restore();
}

function drawPandaOutfit(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  if (view === 'front') {
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath(); ctx.ellipse(0, py + 8, 11, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(-8, py - 18, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, py - 18, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-5, py - 8, 3.5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5, py - 8, 3.5, 4, 0, 0, Math.PI * 2); ctx.fill();
  } else if (view === 'back') {
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(0, py + 4, 13, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath(); ctx.ellipse(-7, py - 17, 3.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7, py - 17, 3.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = '#f5f5f5';
    ctx.beginPath(); ctx.ellipse(4, py + 7, 8, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(6, py - 17, 3.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawAstronautOutfit(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  const suit = '#e8eef5';
  const trim = '#7aa8e8';
  if (view === 'front') {
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.ellipse(0, py + 5, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = trim;
    ctx.fillRect(-8, py - 2, 16, 4);
    ctx.fillStyle = '#5a9ad4';
    ctx.beginPath(); ctx.ellipse(0, py + 2, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#888';
    ctx.fillRect(-6, py + 16, 5, 3);
    ctx.fillRect(1, py + 16, 5, 3);
  } else if (view === 'back') {
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.ellipse(0, py + 4, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b0c4de';
    ctx.fillRect(-6, py - 6, 12, 14);
    ctx.fillStyle = trim;
    ctx.fillRect(-4, py - 4, 8, 3);
  } else {
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.ellipse(5, py + 4, 11, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b0c4de';
    ctx.fillRect(2, py - 5, 6, 12);
  }
}

function drawChefOutfit(ctx: CanvasRenderingContext2D, py: number, view: 'front' | 'back' | 'side') {
  if (view === 'front') {
    ctx.fillStyle = '#fafafa';
    ctx.beginPath(); ctx.ellipse(0, py + 6, 13, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c0392b';
    ctx.beginPath(); ctx.moveTo(0, py + 1); ctx.lineTo(-5, py + 8); ctx.lineTo(5, py + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ddd';
    for (let i = 0; i < 3; i++) ctx.fillRect(-7 + i * 5, py + 4, 2, 2);
  } else if (view === 'back') {
    ctx.fillStyle = '#fafafa';
    ctx.beginPath(); ctx.ellipse(0, py + 4, 13, 14, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = '#fafafa';
    ctx.beginPath(); ctx.ellipse(4, py + 5, 10, 13, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawKnightOutfit(ctx: CanvasRenderingContext2D, py: number, accent: string, view: 'front' | 'back' | 'side') {
  const plate = '#b8c4d0';
  const cape = accent;
  if (view === 'front') {
    ctx.fillStyle = cape;
    ctx.beginPath(); ctx.moveTo(-14, py - 2); ctx.lineTo(0, py + 14); ctx.lineTo(14, py - 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = plate;
    ctx.beginPath(); ctx.ellipse(0, py + 4, 11, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = darken(plate, 0.2);
    ctx.fillRect(-3, py - 2, 6, 10);
  } else if (view === 'back') {
    ctx.fillStyle = darken(cape, 0.15);
    ctx.beginPath(); ctx.moveTo(-12, py); ctx.lineTo(0, py + 16); ctx.lineTo(12, py); ctx.closePath(); ctx.fill();
    ctx.fillStyle = plate;
    ctx.beginPath(); ctx.ellipse(0, py + 3, 11, 11, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = cape;
    ctx.fillRect(0, py - 2, 8, 16);
    ctx.fillStyle = plate;
    ctx.beginPath(); ctx.ellipse(5, py + 3, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawStreetOutfit(ctx: CanvasRenderingContext2D, py: number, accent: string, view: 'front' | 'back' | 'side') {
  const main = accent;
  const shade = darken(accent, 0.25);
  if (view === 'front') {
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.ellipse(0, py + 5, 14, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.moveTo(-10, py - 14); ctx.lineTo(0, py - 22); ctx.lineTo(10, py - 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = darken(main, 0.35);
    ctx.fillRect(-6, py + 8, 12, 6);
    ctx.strokeStyle = darken(main, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-2, py - 18); ctx.lineTo(-2, py - 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, py - 18); ctx.lineTo(2, py - 8); ctx.stroke();
  } else if (view === 'back') {
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.ellipse(0, py + 4, 14, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.moveTo(-9, py - 13); ctx.lineTo(0, py - 20); ctx.lineTo(9, py - 13); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.ellipse(5, py + 4, 11, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade;
    ctx.beginPath(); ctx.moveTo(2, py - 13); ctx.lineTo(8, py - 20); ctx.lineTo(12, py - 12); ctx.closePath(); ctx.fill();
  }
}

export function isOutfitShopItem(item: { id: string; type: string }): boolean {
  return item.type === 'outfit';
}

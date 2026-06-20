import type { ZoneId } from '../store/useGameStore';

/** 可换肤区域（含前厅、竞技馆） */
export type SkinZone = 'hall' | 'restaurant' | 'spa' | 'casino' | 'reception' | 'arena';

export const SKIN_ZONES: SkinZone[] = ['hall', 'restaurant', 'spa', 'casino', 'reception', 'arena'];

export const SKIN_ZONE_LABELS: Record<SkinZone, string> = {
  hall: '交易大厅',
  restaurant: '广式粤菜馆',
  spa: '禅意理疗馆',
  casino: 'VIP 德州厅',
  reception: '前厅接待',
  arena: '交易竞技馆',
};

export interface ZoneSkinOption {
  id: string;
  label: string;
  desc: string;
  preview: string;
  /** 商城 item id；无则免费默认 */
  shopId?: string;
  /** 旧版商城 id 兼容 */
  legacyShopIds?: string[];
}

export const ZONE_SKIN_OPTIONS: Record<SkinZone, ZoneSkinOption[]> = {
  hall: [
    { id: 'default', label: '经典大厅', desc: '米色休息区与咖啡角', preview: '🏛' },
    {
      id: 'gold', label: '金色 lounge', desc: '丝绒沙发与金边装饰',
      preview: '✨', shopId: 'zone_skin_hall_gold', legacyShopIds: ['skin_sofa_gold'],
    },
    {
      id: 'bamboo', label: '竹韵商务', desc: '竹绿点缀与简约工位区',
      preview: '🎋', shopId: 'zone_skin_hall_bamboo',
    },
  ],
  restaurant: [
    { id: 'default', label: '广式经典', desc: '红灯笼、木屏与功夫茶台', preview: '🏮' },
    {
      id: 'premium', label: '尊享宴席', desc: '深色木桌与金边餐盘',
      preview: '🍽', shopId: 'zone_skin_restaurant_premium', legacyShopIds: ['skin_table_premium'],
    },
    { id: 'modern', label: '现代简约', desc: '浅灰墙面与青绿点缀', preview: '🌿', shopId: 'zone_skin_restaurant_modern' },
    {
      id: 'garden', label: '岭南茶室', desc: '竹篱、石景与清茶氛围',
      preview: '🍵', shopId: 'zone_skin_restaurant_garden',
    },
  ],
  spa: [
    { id: 'default', label: '禅意 lavender', desc: '竹屏、香薰与地垫', preview: '☯' },
    { id: 'tropical', label: '热带度假', desc: '棕榈绿与暖沙色调', preview: '🌴', shopId: 'zone_skin_spa_tropical' },
    {
      id: 'zen_ink', label: '水墨禅境', desc: '墨色山水与留白美学',
      preview: '🖋', shopId: 'zone_skin_spa_zen_ink',
    },
  ],
  casino: [
    { id: 'default', label: '经典 VIP', desc: '酒红丝绒与金色吊灯', preview: '🎰' },
    { id: 'neon', label: '霓虹之夜', desc: '紫粉霓虹与暗色墙面', preview: '💜', shopId: 'zone_skin_casino_neon' },
    {
      id: 'royal', label: '皇家金銮', desc: '深红绒面与皇家金饰',
      preview: '👑', shopId: 'zone_skin_casino_royal',
    },
  ],
  reception: [
    { id: 'default', label: '经典前厅', desc: '米色大理石与接待台', preview: '🏨' },
    {
      id: 'luxury', label: '尊享接待', desc: '香槟大理石与酒红绒面',
      preview: '💎', shopId: 'zone_skin_reception_luxury',
    },
  ],
  arena: [
    { id: 'default', label: '经典交易厅', desc: '深蓝 K 线屏与银灰 Pod', preview: '📊' },
    {
      id: 'neon', label: '霓虹赛博', desc: '紫青霓虹与暗色竞技台',
      preview: '💜', shopId: 'zone_skin_arena_neon',
    },
    {
      id: 'bloom', label: '金色 bloom', desc: '暖金灯光与丝绒颁奖台',
      preview: '✨', shopId: 'zone_skin_arena_bloom',
    },
  ],
};

export const DEFAULT_ZONE_SKINS: Record<SkinZone, string> = {
  hall: 'default',
  restaurant: 'default',
  spa: 'default',
  casino: 'default',
  reception: 'default',
  arena: 'default',
};

const LEGACY_UNLOCK_MAP: Record<string, { zone: SkinZone; skinId: string }> = {
  skin_sofa_gold: { zone: 'hall', skinId: 'gold' },
  skin_table_premium: { zone: 'restaurant', skinId: 'premium' },
};

export function shopIdsForSkin(zone: SkinZone, skinId: string): string[] {
  const opt = ZONE_SKIN_OPTIONS[zone].find(o => o.id === skinId);
  if (!opt) return [];
  return [...(opt.legacyShopIds ?? []), ...(opt.shopId ? [opt.shopId] : [])];
}

export function isZoneSkinOwned(zone: SkinZone, skinId: string, shopUnlocks: string[]): boolean {
  const opt = ZONE_SKIN_OPTIONS[zone].find(o => o.id === skinId);
  if (!opt) return false;
  if (!opt.shopId && !(opt.legacyShopIds?.length)) return true;
  return shopIdsForSkin(zone, skinId).some(id => shopUnlocks.includes(id));
}

export function ownedSkinsForZone(zone: SkinZone, shopUnlocks: string[]): ZoneSkinOption[] {
  return ZONE_SKIN_OPTIONS[zone].filter(o => isZoneSkinOwned(zone, o.id, shopUnlocks));
}

export function normalizeZoneSkins(raw: Record<string, string> | undefined | null): Record<SkinZone, string> {
  const out = { ...DEFAULT_ZONE_SKINS };
  if (!raw) return out;
  for (const z of SKIN_ZONES) {
    const id = raw[z];
    if (id && ZONE_SKIN_OPTIONS[z].some(o => o.id === id)) out[z] = id;
  }
  return out;
}

export function effectiveZoneSkin(zone: SkinZone, zoneSkins: Record<string, string>, shopUnlocks: string[]): string {
  const picked = zoneSkins[zone] ?? DEFAULT_ZONE_SKINS[zone];
  if (isZoneSkinOwned(zone, picked, shopUnlocks)) return picked;
  return DEFAULT_ZONE_SKINS[zone];
}

export function migrateLegacyUnlocks(shopUnlocks: string[]): Record<SkinZone, string> {
  const patch: Partial<Record<SkinZone, string>> = {};
  for (const id of shopUnlocks) {
    const m = LEGACY_UNLOCK_MAP[id];
    if (m) patch[m.zone] = m.skinId;
  }
  return normalizeZoneSkins(patch);
}

export function zoneSkinShopItems(): { zone: SkinZone; skinId: string; shopId: string }[] {
  const items: { zone: SkinZone; skinId: string; shopId: string }[] = [];
  for (const zone of SKIN_ZONES) {
    for (const opt of ZONE_SKIN_OPTIONS[zone]) {
      if (opt.shopId) items.push({ zone, skinId: opt.id, shopId: opt.shopId });
    }
  }
  return items;
}

export function isZoneSkinShopItem(catalogItem: { id: string; type: string }): boolean {
  return catalogItem.type === 'zone_skin';
}

export function parseZoneSkinValue(value: string): { zone: SkinZone; skinId: string } | null {
  const [zone, skinId] = value.split(':');
  if (!zone || !skinId) return null;
  if (!SKIN_ZONES.includes(zone as SkinZone)) return null;
  const z = zone as SkinZone;
  if (!ZONE_SKIN_OPTIONS[z].some(o => o.id === skinId)) return null;
  return { zone: z, skinId };
}

/* ─── 渲染调色板 ─── */

export interface CantonesePalette {
  crimson: string;
  crimsonDeep: string;
  gold: string;
  goldDim: string;
  cream: string;
  wood: string;
  woodLight: string;
  jade: string;
  floorLight: string;
  floorDark: string;
  tableTop: string;
  tableEdge: string;
}

export interface VipPalette {
  gold: string;
  goldDim: string;
  walnut: string;
  walnutLight: string;
  burgundy: string;
  velvet: string;
  velvetDeep: string;
  rugBase: string;
  rugPattern: string;
  cream: string;
  backdropCenter: string;
  backdropEdge: string;
}

export interface SpaPalette {
  lavender: string;
  lavenderDeep: string;
  sage: string;
  sageDeep: string;
  bamboo: string;
  bambooDark: string;
  cream: string;
  stone: string;
  teal: string;
  glow: string;
  floorLight: string;
  floorDark: string;
  mat: string;
}

export interface HallRestPalette {
  sofa: string;
  sofaArm: string;
  cushion: string;
  floorLight: string;
  floorDark: string;
  accent: string;
}

const CANTONESE: Record<string, CantonesePalette> = {
  default: {
    crimson: '#b83232', crimsonDeep: '#8a2424', gold: '#d4af37', goldDim: '#a88828',
    cream: '#faf3e8', wood: '#5c3d28', woodLight: '#8b5a3c', jade: '#3d7a62',
    floorLight: '#faf3e8', floorDark: '#f0e4d4', tableTop: '#d4c8b8', tableEdge: '#c0b4a4',
  },
  premium: {
    crimson: '#9a2828', crimsonDeep: '#6a1818', gold: '#e8c547', goldDim: '#c9a227',
    cream: '#fff8f0', wood: '#3d2818', woodLight: '#6b4423', jade: '#2d6a52',
    floorLight: '#f5ebe0', floorDark: '#e8dcc8', tableTop: '#8b6914', tableEdge: '#6b4f10',
  },
  modern: {
    crimson: '#4a6a62', crimsonDeep: '#3a5248', gold: '#7ab8a8', goldDim: '#5a9888',
    cream: '#f4f6f5', wood: '#6a7570', woodLight: '#8a9590', jade: '#5a9888',
    floorLight: '#f0f4f2', floorDark: '#e2eae6', tableTop: '#e8ecea', tableEdge: '#c8d4ce',
  },
  garden: {
    crimson: '#5a7868', crimsonDeep: '#3a5848', gold: '#c4a574', goldDim: '#a88858',
    cream: '#f5f2ea', wood: '#6b5344', woodLight: '#8b7355', jade: '#4a8868',
    floorLight: '#f0ebe0', floorDark: '#e4dcc8', tableTop: '#d8ccb8', tableEdge: '#c0b4a0',
  },
};

const VIP: Record<string, VipPalette> = {
  default: {
    gold: '#d4af37', goldDim: '#8b6914', walnut: '#2a2220', walnutLight: '#3d322c',
    burgundy: '#5c2438', velvet: '#4a1e32', velvetDeep: '#321428',
    rugBase: '#5a2838', rugPattern: '#c9a227', cream: '#f5efe6',
    backdropCenter: '#3d322c', backdropEdge: '#221a18',
  },
  neon: {
    gold: '#e040fb', goldDim: '#9c27b0', walnut: '#1a1428', walnutLight: '#2a2040',
    burgundy: '#4a148c', velvet: '#311b92', velvetDeep: '#1a0a30',
    rugBase: '#2a1848', rugPattern: '#00e5ff', cream: '#ede7f6',
    backdropCenter: '#2a1840', backdropEdge: '#120820',
  },
  royal: {
    gold: '#ffd700', goldDim: '#b8860b', walnut: '#1a0a10', walnutLight: '#3a1828',
    burgundy: '#6a1028', velvet: '#4a0820', velvetDeep: '#2a0410',
    rugBase: '#4a1830', rugPattern: '#ffd700', cream: '#fff8f0',
    backdropCenter: '#3a1828', backdropEdge: '#1a0818',
  },
};

const SPA: Record<string, SpaPalette> = {
  default: {
    lavender: '#9b87c4', lavenderDeep: '#6b5b8a', sage: '#5a8a6a', sageDeep: '#3d6a52',
    bamboo: '#c4a574', bambooDark: '#8b7355', cream: '#f8f4ef', stone: '#d8d0c8',
    teal: '#6aabb8', glow: 'rgba(180,150,220,0.28)',
    floorLight: '#ebe8f2', floorDark: '#ddd6e8', mat: '#e8e0d4',
  },
  tropical: {
    lavender: '#5a9888', lavenderDeep: '#3a6858', sage: '#6aaa5a', sageDeep: '#4a8a3a',
    bamboo: '#d4a574', bambooDark: '#a07848', cream: '#fff8f0', stone: '#e8dcc8',
    teal: '#48a898', glow: 'rgba(255,200,120,0.25)',
    floorLight: '#f5f0e4', floorDark: '#ebe0cc', mat: '#f0e8d8',
  },
  zen_ink: {
    lavender: '#6a6a72', lavenderDeep: '#4a4a52', sage: '#5a5a62', sageDeep: '#3a3a42',
    bamboo: '#8a8278', bambooDark: '#5a5248', cream: '#f4f2ee', stone: '#d8d4cc',
    teal: '#6a6870', glow: 'rgba(80,80,88,0.22)',
    floorLight: '#eceae6', floorDark: '#dcd8d0', mat: '#e8e4dc',
  },
};

const HALL_REST: Record<string, HallRestPalette> = {
  default: {
    sofa: '#d4c8b8', sofaArm: '#c8baa8', cushion: '#faf6ef',
    floorLight: '#f5f0e8', floorDark: '#ebe4d8', accent: '#8b7355',
  },
  gold: {
    sofa: '#c9a227', sofaArm: '#a88828', cushion: '#fff8e8',
    floorLight: '#f8f0e0', floorDark: '#ebe0c8', accent: '#d4af37',
  },
  bamboo: {
    sofa: '#c8d4c0', sofaArm: '#8aa878', cushion: '#f4f8f0',
    floorLight: '#f0f4ec', floorDark: '#e2eae0', accent: '#5a8868',
  },
};

export function cantonesePalette(skinKey: string): CantonesePalette {
  return CANTONESE[skinKey] ?? CANTONESE.default;
}

export function vipPalette(skinKey: string): VipPalette {
  return VIP[skinKey] ?? VIP.default;
}

export function spaPalette(skinKey: string): SpaPalette {
  return SPA[skinKey] ?? SPA.default;
}

export function hallRestPalette(skinKey: string): HallRestPalette {
  return HALL_REST[skinKey] ?? HALL_REST.default;
}

export interface ReceptionPalette {
  floorLight: string; floorDark: string; wall: string; desk: string; deskTop: string;
  accent: string; accentDim: string; wood: string; seat: string; plant: string;
  velvet: string; marble: string; planter: string; rugBase: string; rugPattern: string;
}

const RECEPTION: Record<string, ReceptionPalette> = {
  default: {
    floorLight: '#faf6ef', floorDark: '#ebe4d8', wall: '#f5f0e8', desk: '#8b7355',
    deskTop: '#d4c8b8', accent: '#d4af37', accentDim: '#a88828', wood: '#6b5344',
    seat: '#c8baa8', plant: '#5a8868', velvet: '#8b7355', marble: '#faf6ef',
    planter: '#6b5344', rugBase: '#ebe4d8', rugPattern: '#d4c8b8',
  },
  luxury: {
    floorLight: '#f8f0e4', floorDark: '#e8dcc8', wall: '#3a1828', desk: '#3d2818',
    deskTop: '#fff8f0', accent: '#d4af37', accentDim: '#a88828', wood: '#6b4423',
    seat: '#5c2438', plant: '#4a8868', velvet: '#4a1e32', marble: '#fff8f0',
    planter: '#8b6914', rugBase: '#5a2838', rugPattern: '#c9a227',
  },
};

export function receptionPalette(skinKey: string): ReceptionPalette {
  return RECEPTION[skinKey] ?? RECEPTION.default;
}

export interface ArenaPalette {
  backdropCenter: string;
  backdropEdge: string;
  wall: string;
  pillar: string;
  accent: string;
  accentDim: string;
  floorRing: string;
  screenBg: string;
  chartLine: string;
  podBase: string;
  podHover: string;
  podEdge: string;
  npcDesk: string;
  text: string;
  textMuted: string;
  up: string;
  down: string;
}

const ARENA: Record<string, ArenaPalette> = {
  default: {
    backdropCenter: '#1a2840', backdropEdge: '#0e1624', wall: '#243048', pillar: '#2a3850',
    accent: '#4a90c8', accentDim: '#2a5888', floorRing: 'rgba(74,144,200,0.12)',
    screenBg: '#0a1520', chartLine: '#48d093', podBase: '#2a3a52', podHover: '#3a5070',
    podEdge: '#4a6888', npcDesk: '#1e2a3a', text: '#e8eef5', textMuted: 'rgba(232,238,245,0.55)',
    up: '#48d093', down: '#e07070',
  },
  neon: {
    backdropCenter: '#1a0a30', backdropEdge: '#0a0518', wall: '#2a1048', pillar: '#3a1860',
    accent: '#e040fb', accentDim: '#9c27b0', floorRing: 'rgba(224,64,251,0.15)',
    screenBg: '#120820', chartLine: '#00e5ff', podBase: '#2a1848', podHover: '#4a2878',
    podEdge: '#7c4dff', npcDesk: '#1a0830', text: '#ede7f6', textMuted: 'rgba(200,180,255,0.55)',
    up: '#00e676', down: '#ff5252',
  },
  bloom: {
    backdropCenter: '#3a2818', backdropEdge: '#1a1008', wall: '#4a3828', pillar: '#5a4838',
    accent: '#ffd700', accentDim: '#b8860b', floorRing: 'rgba(255,215,0,0.12)',
    screenBg: '#1a1208', chartLine: '#ffb74d', podBase: '#4a3828', podHover: '#6a5840',
    podEdge: '#c9a227', npcDesk: '#2a2010', text: '#fff8e8', textMuted: 'rgba(255,248,232,0.55)',
    up: '#66bb6a', down: '#ef5350',
  },
};

export function arenaPalette(skinKey: string): ArenaPalette {
  return ARENA[skinKey] ?? ARENA.default;
}

export function skinZoneFromGameZone(zone: ZoneId): SkinZone | null {
  if (zone === 'reception') return 'reception';
  if (zone === 'hall' || zone === 'restaurant' || zone === 'spa' || zone === 'casino') return zone;
  return null;
}

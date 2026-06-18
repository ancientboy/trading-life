import type { ZoneId } from '../store/useGameStore';

/** 可换肤区域（不含 reception） */
export type SkinZone = 'hall' | 'restaurant' | 'spa' | 'casino';

export const SKIN_ZONES: SkinZone[] = ['hall', 'restaurant', 'spa', 'casino'];

export const SKIN_ZONE_LABELS: Record<SkinZone, string> = {
  hall: '交易大厅',
  restaurant: '广式粤菜馆',
  spa: '禅意理疗馆',
  casino: 'VIP 德州厅',
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
  ],
  restaurant: [
    { id: 'default', label: '广式经典', desc: '红灯笼、木屏与功夫茶台', preview: '🏮' },
    {
      id: 'premium', label: '尊享宴席', desc: '深色木桌与金边餐盘',
      preview: '🍽', shopId: 'zone_skin_restaurant_premium', legacyShopIds: ['skin_table_premium'],
    },
    { id: 'modern', label: '现代简约', desc: '浅灰墙面与青绿点缀', preview: '🌿', shopId: 'zone_skin_restaurant_modern' },
  ],
  spa: [
    { id: 'default', label: '禅意 lavender', desc: '竹屏、香薰与地垫', preview: '☯' },
    { id: 'tropical', label: '热带度假', desc: '棕榈绿与暖沙色调', preview: '🌴', shopId: 'zone_skin_spa_tropical' },
  ],
  casino: [
    { id: 'default', label: '经典 VIP', desc: '酒红丝绒与金色吊灯', preview: '🎰' },
    { id: 'neon', label: '霓虹之夜', desc: '紫粉霓虹与暗色墙面', preview: '💜', shopId: 'zone_skin_casino_neon' },
  ],
};

export const DEFAULT_ZONE_SKINS: Record<SkinZone, string> = {
  hall: 'default',
  restaurant: 'default',
  spa: 'default',
  casino: 'default',
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

export function skinZoneFromGameZone(zone: ZoneId): SkinZone | null {
  if (zone === 'reception') return null;
  return zone;
}

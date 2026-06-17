/** NPC 职业类型 — 与 Gugugaga role 对齐 */
export type NpcRole = 'reception' | 'waiter' | 'masseur' | 'dealer';

export interface NpcOutfitDef {
  role: NpcRole;
  label: string;
  accentColor: string;
  /** 帽子类型 */
  hat: 'concierge' | 'chef' | 'headband' | 'dealer';
  hatColor: string;
  /** 上身服装 */
  vestColor?: string;
  apronColor?: string;
  /** 领结/徽章 */
  bowtie?: boolean;
  badgeColor?: string;
  /** 3D 额外道具 */
  prop?: 'tray' | 'cards';
}

export const NPC_OUTFITS: Record<NpcRole, NpcOutfitDef> = {
  reception: {
    role: 'reception',
    label: '迎宾 Gugu',
    accentColor: '#d4af37',
    hat: 'concierge',
    hatColor: '#d4af37',
    vestColor: '#2d3748',
    badgeColor: '#d4af37',
  },
  waiter: {
    role: 'waiter',
    label: '服务员 Lily',
    accentColor: '#e879a9',
    hat: 'chef',
    hatColor: '#ffffff',
    apronColor: '#e879a9',
    prop: 'tray',
  },
  masseur: {
    role: 'masseur',
    label: '技师 Gaga',
    accentColor: '#c8a8e8',
    hat: 'headband',
    hatColor: '#ffffff',
    vestColor: '#c8a8e8',
  },
  dealer: {
    role: 'dealer',
    label: '荷官 Jack',
    accentColor: '#d4af37',
    hat: 'dealer',
    hatColor: '#1a1a1a',
    vestColor: '#b91c1c',
    bowtie: true,
    prop: 'cards',
  },
};

export const NPC_ID_TO_ROLE: Record<string, NpcRole> = {
  reception: 'reception',
  lily: 'waiter',
  masseur: 'masseur',
  dealer: 'dealer',
};

export function npcRoleFromId(id: string): NpcRole | null {
  return NPC_ID_TO_ROLE[id] ?? null;
}

export function outfitForRole(role: NpcRole): NpcOutfitDef {
  return NPC_OUTFITS[role];
}

/** 休闲服务分档 — 基础档免费，高档消耗积分 */

export type LeisureTierId = 'a' | 'b' | 'c';
export type LeisureService = 'dine' | 'massage';

export interface LeisureTierDef {
  id: LeisureTierId;
  name: string;
  desc: string;
  cost: number;
  effect: string;
  /** 压力减免比例 0–1 */
  stressRelief: number;
}

export const DINE_TIERS: LeisureTierDef[] = [
  { id: 'a', name: '老火靓汤套餐', desc: '例汤 + 时蔬 + 白饭', cost: 0, effect: '-30% 压力', stressRelief: 0.3 },
  { id: 'b', name: '招牌烧味双拼', desc: '烧鹅/叉烧 + 艇仔粥', cost: 50, effect: '-50% 压力', stressRelief: 0.5 },
  { id: 'c', name: '至尊粤菜筵席', desc: '龙虾 + 鲍翅 + 老火汤', cost: 120, effect: '-70% 压力', stressRelief: 0.7 },
];

export const MASSAGE_TIERS: LeisureTierDef[] = [
  { id: 'a', name: '基础放松', desc: '30 分钟肩颈', cost: 0, effect: '-30% 压力', stressRelief: 0.3 },
  { id: 'b', name: '深度理疗', desc: '60 分钟全身 + 热石', cost: 80, effect: '-50% 压力', stressRelief: 0.5 },
  { id: 'c', name: '臻享水疗 SPA', desc: '90 分钟精油 + 芳疗', cost: 150, effect: '-70% 压力', stressRelief: 0.7 },
];

export const LEISURE_TIERS: Record<LeisureService, LeisureTierDef[]> = {
  dine: DINE_TIERS,
  massage: MASSAGE_TIERS,
};

export function getLeisureTier(service: LeisureService, tierId: LeisureTierId): LeisureTierDef {
  return LEISURE_TIERS[service].find(t => t.id === tierId) ?? LEISURE_TIERS[service][0];
}

export function stressReliefFor(service: LeisureService, tierId?: LeisureTierId | null): number {
  if (!tierId) return service === 'massage' ? 0.3 : 0.3;
  return getLeisureTier(service, tierId).stressRelief;
}

export const DAILY_ALLOWANCE_AMOUNT = 1000;

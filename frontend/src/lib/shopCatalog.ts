import type { LifeState } from './lifeApi';

/** 与后端 life_game.SHOP_CATALOG 保持同步 — 用于 API 未返回时的兜底展示 */
export const SHOP_CATALOG_FALLBACK: LifeState['shop_catalog'] = [
  { id: 'color_aurora', type: 'color', value: '#FF6B9D', cost: 80, label: '极光粉' },
  { id: 'color_midnight', type: 'color', value: '#1E3A5F', cost: 80, label: '午夜蓝' },
  { id: 'color_mint', type: 'color', value: '#2DD4BF', cost: 80, label: '薄荷绿' },
  { id: 'hat_beret_unlock', type: 'hat', value: 'beret', cost: 120, label: '贝雷帽款式' },
  { id: 'hat_top_unlock', type: 'hat', value: 'top', cost: 150, label: '礼帽款式' },
  { id: 'hat_bobble_unlock', type: 'hat', value: 'bobble', cost: 100, label: '毛球帽款式' },
  { id: 'outfit_panda', type: 'outfit', value: 'panda', cost: 180, label: '熊猫连体服' },
  { id: 'outfit_astronaut', type: 'outfit', value: 'astronaut', cost: 220, label: '太空探险服' },
  { id: 'outfit_chef', type: 'outfit', value: 'chef', cost: 160, label: '星级厨师服' },
  { id: 'outfit_knight', type: 'outfit', value: 'knight', cost: 260, label: '皇家骑士甲' },
  { id: 'outfit_street', type: 'outfit', value: 'street', cost: 150, label: '潮牌卫衣' },
  { id: 'species_niuma', type: 'species', value: 'niuma', cost: 200, label: '牛马角色' },
  { id: 'outfit_niuma_casual', type: 'niuma_outfit', value: 'casual', cost: 150, label: '牛马 · 休闲 Polo' },
  { id: 'outfit_niuma_executive', type: 'niuma_outfit', value: 'executive', cost: 180, label: '牛马 · 总裁黑金' },
  { id: 'hair_curly_unlock', type: 'hair', value: 'curly', cost: 120, label: '牛马 · 卷发' },
  { id: 'hair_spiky_unlock', type: 'hair', value: 'spiky', cost: 120, label: '牛马 · 刺猬头' },
  { id: 'hair_afro_unlock', type: 'hair', value: 'afro', cost: 150, label: '牛马 · 爆炸头' },
  { id: 'hair_twin_unlock', type: 'hair', value: 'twin', cost: 100, label: '牛马 · 双丸子' },
  { id: 'species_maniu', type: 'species', value: 'niuma', cost: 200, label: '牛马角色（旧版）', legacy: true },
  { id: 'outfit_maniu', type: 'species', value: 'niuma', cost: 200, label: '牛马角色（旧版2）', legacy: true },
  { id: 'outfit_maniu_casual', type: 'niuma_outfit', value: 'casual', cost: 150, label: '牛马 · 休闲（旧版）', legacy: true },
  { id: 'outfit_maniu_executive', type: 'niuma_outfit', value: 'executive', cost: 180, label: '牛马 · 黑金（旧版）', legacy: true },
  { id: 'zone_skin_hall_gold', type: 'zone_skin', value: 'hall:gold', cost: 200, label: '大厅 · 金色 lounge 皮肤包' },
  { id: 'zone_skin_restaurant_premium', type: 'zone_skin', value: 'restaurant:premium', cost: 180, label: '粤菜馆 · 尊享宴席皮肤包' },
  { id: 'zone_skin_restaurant_modern', type: 'zone_skin', value: 'restaurant:modern', cost: 220, label: '粤菜馆 · 现代简约皮肤包' },
  { id: 'zone_skin_spa_tropical', type: 'zone_skin', value: 'spa:tropical', cost: 200, label: '理疗馆 · 热带度假皮肤包' },
  { id: 'zone_skin_casino_neon', type: 'zone_skin', value: 'casino:neon', cost: 250, label: '德州厅 · 霓虹之夜皮肤包' },
  { id: 'zone_skin_hall_bamboo', type: 'zone_skin', value: 'hall:bamboo', cost: 180, label: '大厅 · 竹韵商务皮肤包' },
  { id: 'zone_skin_restaurant_garden', type: 'zone_skin', value: 'restaurant:garden', cost: 200, label: '粤菜馆 · 岭南茶室皮肤包' },
  { id: 'zone_skin_spa_zen_ink', type: 'zone_skin', value: 'spa:zen_ink', cost: 220, label: '理疗馆 · 水墨禅境皮肤包' },
  { id: 'zone_skin_casino_royal', type: 'zone_skin', value: 'casino:royal', cost: 280, label: '德州厅 · 皇家金銮皮肤包' },
  { id: 'zone_skin_reception_luxury', type: 'zone_skin', value: 'reception:luxury', cost: 160, label: '前厅 · 尊享接待皮肤包' },
  { id: 'zone_skin_arena_neon', type: 'zone_skin', value: 'arena:neon', cost: 240, label: '竞技馆 · 霓虹赛博皮肤包' },
  { id: 'zone_skin_arena_bloom', type: 'zone_skin', value: 'arena:bloom', cost: 260, label: '竞技馆 · 金色 bloom 皮肤包' },
  { id: 'skin_sofa_gold', type: 'zone_skin', value: 'hall:gold', cost: 200, label: '大厅 · 金色 lounge（旧版）', legacy: true },
  { id: 'skin_table_premium', type: 'zone_skin', value: 'restaurant:premium', cost: 180, label: '粤菜馆 · 尊享宴席（旧版）', legacy: true },
];

export function resolveShopCatalog(catalog?: LifeState['shop_catalog']): LifeState['shop_catalog'] {
  if (catalog?.length) return catalog;
  return SHOP_CATALOG_FALLBACK;
}

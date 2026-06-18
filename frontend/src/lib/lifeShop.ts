import { APPEARANCE_PRESETS } from './customAgents';
import type { HatStyleId } from './agentAppearance';
import { OUTFIT_CATALOG, OUTFIT_IDS, OUTFIT_UNLOCK_MAP, type OutfitId } from './agentOutfits';
import {
  SPECIES_CATALOG, SPECIES_IDS, isSpeciesUnlocked, isManiuSkinUnlocked,
  unlockedManiuSkins, MANIU_SKIN_CATALOG, MANIU_SKIN_IDS, type SpeciesId, type ManiuSkinId,
} from './agentSpecies';

const FREE_COLORS = new Set(APPEARANCE_PRESETS.colors);
const FREE_HATS = new Set<HatStyleId>(['beanie', 'cap']);

export function isColorUnlocked(color: string, shopUnlocks: string[], catalog: { id: string; type: string; value: string }[]) {
  if (FREE_COLORS.has(color)) return true;
  return catalog.some(i => i.type === 'color' && i.value === color && shopUnlocks.includes(i.id));
}

export function isHatUnlocked(style: HatStyleId, shopUnlocks: string[]) {
  if (FREE_HATS.has(style)) return true;
  const map: Record<string, string> = {
    beret: 'hat_beret_unlock',
    top: 'hat_top_unlock',
    bobble: 'hat_bobble_unlock',
  };
  const id = map[style];
  return id ? shopUnlocks.includes(id) : true;
}

export function isOutfitUnlocked(outfitId: OutfitId, shopUnlocks: string[]): boolean {
  if (outfitId === 'default') return true;
  const unlockId = OUTFIT_UNLOCK_MAP[outfitId];
  return unlockId ? shopUnlocks.includes(unlockId) : false;
}

export function unlockedColors(catalog: { id: string; type: string; value: string; label: string }[], shopUnlocks: string[]) {
  const base = [...APPEARANCE_PRESETS.colors];
  catalog.filter(i => i.type === 'color' && shopUnlocks.includes(i.id)).forEach(i => {
    if (!base.includes(i.value)) base.push(i.value);
  });
  return base;
}

export function unlockedHatStyles(shopUnlocks: string[]): HatStyleId[] {
  const all: HatStyleId[] = ['beanie', 'cap', 'top', 'bobble', 'beret'];
  return all.filter(h => isHatUnlocked(h, shopUnlocks));
}

export function unlockedOutfits(shopUnlocks: string[]): OutfitId[] {
  return OUTFIT_IDS.filter(id => isOutfitUnlocked(id, shopUnlocks));
}

export function unlockedSkinsForSpecies(speciesId: SpeciesId, shopUnlocks: string[]): (OutfitId | ManiuSkinId)[] {
  if (speciesId === 'maniu') return unlockedManiuSkins(shopUnlocks);
  return unlockedOutfits(shopUnlocks);
}

export function unlockedSpecies(shopUnlocks: string[]): SpeciesId[] {
  return SPECIES_IDS.filter(id => isSpeciesUnlocked(id, shopUnlocks));
}

export function ownedZoneSkinPacks(shopUnlocks: string[]) {
  return shopUnlocks.filter(id => id.startsWith('zone_skin_') || id.startsWith('skin_'));
}

/** @deprecated 使用 ownedZoneSkinPacks */
export function ownedCosmetics(shopUnlocks: string[]) {
  return ownedZoneSkinPacks(shopUnlocks);
}

export function isOutfitShopItem(item: { id: string; type: string }): boolean {
  return item.type === 'outfit' || item.type === 'maniu_outfit';
}

export function isSpeciesShopItem(item: { id: string; type: string }): boolean {
  return item.type === 'species';
}

export function skinCatalogForSpecies(speciesId: SpeciesId) {
  return speciesId === 'maniu' ? MANIU_SKIN_CATALOG : OUTFIT_CATALOG;
}

export { OUTFIT_CATALOG, OUTFIT_IDS, SPECIES_CATALOG, MANIU_SKIN_CATALOG, MANIU_SKIN_IDS };

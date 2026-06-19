#!/usr/bin/env node
/**
 * 打印角色出图提示词 — 复制到 Midjourney / SD / DALL·E 等
 * 用法: npm run prompts:character -- niuma default front
 */
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

async function loadSpec() {
  const specTs = join(__dir, '../src/lib/characterPromptSpec.ts');
  try {
    const mod = await import(pathToFileURL(specTs).href);
    return mod;
  } catch {
    return null;
  }
}

const [species = 'niuma', skin = 'default', view = 'front', layer = 'full'] = process.argv.slice(2);
const manifest = JSON.parse(
  readFileSync(join(__dir, '../public/assets/characters/manifest.json'), 'utf8'),
);

const spec = await loadSpec();
const sp = manifest.species[species];
if (!sp) {
  console.error('未知物种:', species);
  process.exit(1);
}
const skinMeta = sp.skins[skin];
const outfitKey = skinMeta?.outfitKey ?? undefined;

if (spec?.buildCharacterPromptPack) {
  const pack = spec.buildCharacterPromptPack({
    species,
    view,
    layer: layer === 'naked' ? 'naked_base' : 'full',
    outfitKey,
  });
  console.log('=== 正向提示词 ===');
  console.log(pack.positive);
  console.log('\n=== 负面提示词 ===');
  console.log(pack.negative);
} else {
  console.error('无法加载 characterPromptSpec.ts，请使用 vite-node 或 tsx');
  process.exit(1);
}

console.log('\n=== 输出路径 ===');
console.log(`frontend/public/assets/characters/${species}/${skin}/${view}.png`);

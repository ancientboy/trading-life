#!/usr/bin/env node
/**
 * 打印角色出图提示词 — 复制到 Midjourney / SD / DALL·E 等
 * 用法: node scripts/print-character-prompts.mjs niuma default front
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const specPath = join(__dir, '../public/assets/characters/manifest.json');
const manifest = JSON.parse(readFileSync(specPath, 'utf8'));

const GLOBAL_PREFIX = 'top-down full overhead orthographic view, flat vector illustration, game sprite asset for Three.js web simulation game, solid clean flat color blocks, no gradient noise, no texture grain, no rough texture, no specular highlight, no PBR physical rendering, only one soft subtle drop shadow under character, thin uniform consistent black outline, pure transparent checkerboard PNG background, ultra clean sharp edges, slight 2.5D soft thickness, simple gentle cartoon style, low saturation neutral color palette, no complex lighting, no ambient occlusion, no heavy realistic shadow, no perspective distortion, no clutter, redundant decorative elements removed, square canvas, cutout layered sprite';

const GLOBAL_NEGATIVE = 'photorealistic, 3D render, strong highlight, metal reflection, blur jagged edge, dirty gradient smudge, tilted isometric perspective, human limb distortion, messy wrinkles, film lighting, grain texture, lens flare, complex background, oil painting, thick heavy shading, stretched deformed body';

const BODIES = {
  penguin: 'cute chubby round penguin Agent, plump oval penguin body, short small flipper wings on left and right, short tiny webbed feet hidden under body, smooth simple penguin silhouette, no egg-shaped body',
  niuma: 'cute egg-shaped chibi Ma Niu character, smooth round egg torso, small stubby round hands on both sides, oval rounded head integrated with egg body',
};

const VIEW_SUFFIX = {
  front: '',
  back: 'back view only, no facial features visible, back silhouette of body/hair/clothes',
  side: 'left side profile, only half silhouette visible, side outline of character',
};

const OUTFITS = {
  penguin_agent_suit: 'dark slim agent business suit, small hidden chest chip badge, simple black neck tie',
  niuma_default: 'royal blue business suit blazer, light pink tie, small white name tag with Chinese characters "马牛" on left chest, tiny pink pocket square on right chest, two dark buttons, no feet no legs egg bottom',
  niuma_casual: 'green casual polo shirt, relaxed office style, no tie',
  niuma_executive: 'black gold executive suit, premium lapels, red tie',
};

const [species = 'niuma', skin = 'default', view = 'front'] = process.argv.slice(2);
const sp = manifest.species[species];
if (!sp) {
  console.error('未知物种:', species);
  process.exit(1);
}
const skinMeta = sp.skins[skin];
const outfitKey = skinMeta?.outfitKey;
const parts = [GLOBAL_PREFIX, BODIES[species]];
if (outfitKey && OUTFITS[outfitKey]) parts.push(OUTFITS[outfitKey]);
if (VIEW_SUFFIX[view]) parts.push(VIEW_SUFFIX[view]);

console.log('=== 正向提示词 ===');
console.log(parts.join(', '));
console.log('\n=== 负面提示词 ===');
console.log(GLOBAL_NEGATIVE);
console.log('\n=== 输出路径 ===');
console.log(`frontend/public/assets/characters/${species}/${skin}/${view}.png`);

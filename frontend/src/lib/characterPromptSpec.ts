/**
 * 角色 Sprite 生成提示词规范 — Paper Canvas 2D 纯平面
 * 用法：buildCharacterPrompt({ species: 'niuma', view: 'front', outfitKey: 'niuma_default' })
 */

export type CharacterSpeciesId = 'penguin' | 'niuma';
export type CharacterPromptView = 'front' | 'back' | 'side';
export type CharacterPromptLayer = 'full' | 'naked_base';

/** 一、固定全局正向前缀（所有角色/视角/皮肤通用，永不改动） */
export const GLOBAL_PROMPT_PREFIX = [
  'top-down full overhead orthographic top view',
  'flat pure 2D vector sprite',
  'Paper Canvas 2D game asset',
  'fully flat no 2.5D thickness',
  'solid clean flat color blocks',
  'zero gradient noise',
  'no texture grain',
  'no rough texture',
  'no specular highlight',
  'no 3D PBR rendering',
  'only ultra faint tiny soft gray shadow directly under character body',
  'thin consistent 1px black outline',
  'pure transparent checkerboard PNG background',
  'ultra clean sharp edges',
  'simple gentle minimalist cartoon style',
  'low saturation neutral soft color palette',
  'no complex lighting',
  'no ambient occlusion',
  'no heavy realistic shadow',
  'no perspective distortion',
  'no clutter',
  'redundant decorative elements removed',
  'square equal canvas size',
  'cutout 2D sprite for canvas drawImage',
].join(', ');

/** 二、固定全局负面词（每次生成必带） */
export const GLOBAL_NEGATIVE_PROMPT = [
  'photorealistic',
  '3D render',
  '2.5D extrusion',
  'thick shadow',
  'strong highlight',
  'metal reflection',
  'blur jagged edge',
  'dirty gradient smudge',
  'tilted isometric perspective',
  'human limb distortion',
  'messy wrinkles',
  'film lighting',
  'grain texture',
  'lens flare',
  'complex background',
  'oil painting',
  'thick heavy shading',
  'stretched deformed body',
  'three dimensional depth',
  'extra feet',
  'visible legs',
].join(', ');

/** 三、马牛（蛋形、无脚）本体片段 */
export const NIUMa_BODY_PROMPT = [
  'cute egg-shaped chibi Ma Niu character',
  'smooth round egg torso',
  'small stubby round hands on both sides',
  'oval rounded head integrated with egg body',
  'no feet',
  'hidden bottom body edge',
].join(', ');

/** 四、企鹅（圆胖、带小脚）本体片段 */
export const PENGUIN_BODY_PROMPT = [
  'cute chubby round penguin Agent',
  'plump oval penguin body',
  'short small flipper wings on left and right',
  'short tiny webbed feet hidden under body',
  'smooth simple penguin silhouette',
  'no egg-shaped body',
].join(', ');

/** 视角追加片段（拼接在角色片段末尾） */
export const VIEW_SUFFIX: Record<CharacterSpeciesId, Record<CharacterPromptView, string>> = {
  niuma: {
    front: '',
    back: 'back view only, no facial features visible, flat 2D back silhouette, same outline and shadow rule, no feet, smooth rounded egg back',
    side: 'left side profile, flat 2D side silhouette, half facial outline, consistent thickness outline, no feet',
  },
  penguin: {
    front: '',
    back: 'back view only, no facial features visible, flat 2D back silhouette, same outline and shadow rule, small webbed feet visible at bottom rear',
    side: 'left side profile, flat 2D side silhouette, half facial outline, consistent thickness outline, one flipper and small webbed foot visible',
  },
};

/** 裸基底（分层换装底层） */
export const NAKED_BASE_LAYER: Record<CharacterSpeciesId, string> = {
  niuma: 'naked base egg character, no clothes, no hair, blank smooth egg body, fully flat 2D, no feet, hidden bottom body edge, small stubby round hands on both sides',
  penguin: 'naked base penguin, no clothes, no accessories, blank body only, fully flat 2D, plump oval penguin body, short flipper wings, tiny webbed feet',
};

/** 马牛正面完整成品 — 商务西装原版（含发型/五官，供 front 默认皮肤参考） */
export const NIUMa_DEFAULT_FRONT_DETAILS = [
  'neat swept dark brown pompadour hairstyle',
  'big dark purple oval eyes',
  'small w-shaped cute mouth',
  'faint pink blush on cheeks',
  'royal blue business suit blazer',
  'light pink tie',
  'white shirt inner',
  'small name tag with Chinese "马牛" on left chest',
].join(', ');

/** 服装/皮肤描述（新增皮肤仅改此处） */
export const OUTFIT_PROMPT_EXAMPLES: Record<string, string> = {
  penguin_agent_suit: 'dark slim agent business suit, small hidden chest chip badge, simple black neck tie',
  niuma_default: NIUMa_DEFAULT_FRONT_DETAILS,
  niuma_casual: 'green casual polo shirt, relaxed office style, no tie, neat short hair',
  niuma_executive: 'black gold executive suit, premium lapels, red tie, slick dark hair',
};

export type BuildCharacterPromptOpts = {
  species: CharacterSpeciesId;
  view?: CharacterPromptView;
  layer?: CharacterPromptLayer;
  outfit?: string;
  outfitKey?: keyof typeof OUTFIT_PROMPT_EXAMPLES | string;
  extra?: string;
};

function speciesBody(species: CharacterSpeciesId): string {
  return species === 'penguin' ? PENGUIN_BODY_PROMPT : NIUMa_BODY_PROMPT;
}

/**
 * 组装完整正向提示词
 * 规则：全局正向前缀 + 角色专属片段 + [裸基底] + [服装] + [视角] + [extra]
 */
export function buildCharacterPrompt(opts: BuildCharacterPromptOpts): string {
  const view = opts.view ?? 'front';
  const parts: string[] = [GLOBAL_PROMPT_PREFIX, speciesBody(opts.species)];

  if (opts.layer === 'naked_base') {
    parts.push(NAKED_BASE_LAYER[opts.species]);
  }

  const outfitText = opts.outfit
    ?? (opts.outfitKey ? OUTFIT_PROMPT_EXAMPLES[opts.outfitKey] : undefined);
  if (outfitText && opts.layer !== 'naked_base') parts.push(outfitText);

  const viewSuffix = VIEW_SUFFIX[opts.species][view];
  if (viewSuffix) parts.push(viewSuffix);

  if (opts.extra?.trim()) parts.push(opts.extra.trim());

  return parts.filter(Boolean).join(', ');
}

export function buildCharacterPromptPack(opts: BuildCharacterPromptOpts) {
  return {
    positive: buildCharacterPrompt(opts),
    negative: GLOBAL_NEGATIVE_PROMPT,
    species: opts.species,
    view: opts.view ?? 'front',
    layer: opts.layer ?? 'full',
  };
}

export function assetPathFor(
  species: CharacterSpeciesId,
  skinId: string,
  view: CharacterPromptView,
  layer: CharacterPromptLayer = 'full',
): string {
  const layerDir = layer === 'naked_base' ? 'base' : skinId;
  return `assets/characters/${species}/${layerDir}/${view}.png`;
}

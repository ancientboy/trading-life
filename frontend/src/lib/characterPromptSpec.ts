/**
 * 角色 Sprite 生成提示词规范 — 全局基底固定，仅替换角色本体 / 视角 / 服装片段
 * 用法：buildCharacterPrompt({ species: 'niuma', view: 'front', outfit: '...' })
 */

export type CharacterSpeciesId = 'penguin' | 'niuma';
export type CharacterPromptView = 'front' | 'back' | 'side';
export type CharacterPromptLayer = 'full' | 'naked_base';

/** 一、全局固定通用基底（所有角色通用，永远不修改） */
export const GLOBAL_PROMPT_PREFIX = [
  'top-down full overhead orthographic view',
  'flat vector illustration',
  'game sprite asset for Three.js web simulation game',
  'solid clean flat color blocks',
  'no gradient noise',
  'no texture grain',
  'no rough texture',
  'no specular highlight',
  'no PBR physical rendering',
  'only one soft subtle drop shadow under character',
  'thin uniform consistent black outline',
  'pure transparent checkerboard PNG background',
  'ultra clean sharp edges',
  'slight 2.5D soft thickness',
  'simple gentle cartoon style',
  'low saturation neutral color palette',
  'no complex lighting',
  'no ambient occlusion',
  'no heavy realistic shadow',
  'no perspective distortion',
  'no clutter',
  'redundant decorative elements removed',
  'square canvas',
  'cutout layered sprite',
].join(', ');

/** 全局统一负面词（所有生成必带） */
export const GLOBAL_NEGATIVE_PROMPT = [
  'photorealistic',
  '3D render',
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
].join(', ');

/** 二、企鹅专用可变片段 */
export const PENGUIN_BODY_PROMPT = [
  'cute chubby round penguin Agent',
  'plump oval penguin body',
  'short small flipper wings on left and right',
  'short tiny webbed feet hidden under body',
  'smooth simple penguin silhouette',
  'no egg-shaped body',
].join(', ');

/** 三、马牛专用可变片段 */
export const NIUMa_BODY_PROMPT = [
  'cute egg-shaped chibi Ma Niu character',
  'smooth round egg torso',
  'small stubby round hands on both sides',
  'oval rounded head integrated with egg body',
].join(', ');

/** 四、分层 / 视角拓展片段 */
export const VIEW_SUFFIX: Record<CharacterPromptView, string> = {
  front: '',
  back: 'back view only, no facial features visible, back silhouette of body/hair/clothes',
  side: 'left side profile, only half silhouette visible, side outline of character',
};

export const NAKED_BASE_LAYER: Record<CharacterSpeciesId, string> = {
  penguin: 'naked base penguin, no clothes, no accessories, blank body only',
  niuma: 'naked base egg character, no clothes, no hair, blank smooth egg body',
};

/** 服装皮肤示例（可按皮肤 ID 扩展） */
export const OUTFIT_PROMPT_EXAMPLES: Record<string, string> = {
  penguin_agent_suit: 'dark slim agent business suit, small hidden chest chip badge, simple black neck tie',
  niuma_default: 'royal blue business suit blazer, light pink tie, small white name tag with Chinese characters "马牛" on left chest, tiny pink pocket square on right chest, two dark buttons, no feet no legs egg bottom',
  niuma_casual: 'green casual polo shirt, relaxed office style, no tie',
  niuma_executive: 'black gold executive suit, premium lapels, red tie',
};

export type BuildCharacterPromptOpts = {
  species: CharacterSpeciesId;
  /** 默认 front */
  view?: CharacterPromptView;
  /** full=整身；naked_base=裸基底分层 */
  layer?: CharacterPromptLayer;
  /** 追加服装/配饰描述，或使用 OUTFIT_PROMPT_EXAMPLES 的 key */
  outfit?: string;
  outfitKey?: keyof typeof OUTFIT_PROMPT_EXAMPLES | string;
  /** 额外追加在末尾的自定义片段 */
  extra?: string;
};

function speciesBody(species: CharacterSpeciesId): string {
  return species === 'penguin' ? PENGUIN_BODY_PROMPT : NIUMa_BODY_PROMPT;
}

/**
 * 组装完整正向提示词
 * 规则：通用前缀 + 角色本体 + [裸基底] + [服装] + [视角] + [extra]
 */
export function buildCharacterPrompt(opts: BuildCharacterPromptOpts): string {
  const view = opts.view ?? 'front';
  const parts: string[] = [GLOBAL_PROMPT_PREFIX, speciesBody(opts.species)];

  if (opts.layer === 'naked_base') {
    parts.push(NAKED_BASE_LAYER[opts.species]);
  }

  const outfitText = opts.outfit
    ?? (opts.outfitKey ? OUTFIT_PROMPT_EXAMPLES[opts.outfitKey] : undefined);
  if (outfitText) parts.push(outfitText);

  const viewSuffix = VIEW_SUFFIX[view];
  if (viewSuffix) parts.push(viewSuffix);

  if (opts.extra?.trim()) parts.push(opts.extra.trim());

  return parts.filter(Boolean).join(', ');
}

/** 导出给 AI 出图工具的完整包（正向 + 负面） */
export function buildCharacterPromptPack(opts: BuildCharacterPromptOpts) {
  return {
    positive: buildCharacterPrompt(opts),
    negative: GLOBAL_NEGATIVE_PROMPT,
    species: opts.species,
    view: opts.view ?? 'front',
    layer: opts.layer ?? 'full',
  };
}

/** 资产路径约定 — 场景内 Canvas 2D 程序化绘制 */
export function assetPathFor(
  species: CharacterSpeciesId,
  skinId: string,
  view: CharacterPromptView,
  layer: CharacterPromptLayer = 'full',
): string {
  const layerDir = layer === 'naked_base' ? 'base' : skinId;
  return `assets/characters/${species}/${layerDir}/${view}.png`;
}

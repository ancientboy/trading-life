/** 3D 场景 Sprite 贴图路径（Vite base 兼容） */
const BASE = import.meta.env.BASE_URL + 'assets/sprite/';

export const SPRITE = {
  chatBubble: BASE + 'chat-bubble.svg',
  plateCoffee: BASE + 'plate-coffee.svg',
  tray: BASE + 'tray.svg',
  spaBubble: BASE + 'spa-bubble.svg',
  massageHand: BASE + 'massage-hand.svg',
  pokerChips: BASE + 'poker-chips.svg',
  cards: BASE + 'cards.svg',
  monitor: BASE + 'monitor.svg',
  stormCloud: BASE + 'storm-cloud.svg',
  healStar: BASE + 'heal-star.svg',
} as const;

export type SpriteId = keyof typeof SPRITE;

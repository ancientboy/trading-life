/** 扑克牌展示 — 与后端 poker_hands.py 编码一致，如 Ah、Td */

export type PokerCardCode = string;

const SUIT_SYMBOL: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RANK_LABEL: Record<string, string> = {
  T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A',
};

export function parsePokerCard(code: string): { rank: string; suit: string; red: boolean } | null {
  if (!code || code.length < 2) return null;
  const suitKey = code[code.length - 1];
  const rankKey = code.slice(0, -1);
  if (!SUIT_SYMBOL[suitKey]) return null;
  return {
    rank: RANK_LABEL[rankKey] ?? rankKey,
    suit: SUIT_SYMBOL[suitKey],
    red: suitKey === 'h' || suitKey === 'd',
  };
}

export function formatPokerCard(code: string): string {
  const p = parsePokerCard(code);
  return p ? `${p.rank}${p.suit}` : code;
}

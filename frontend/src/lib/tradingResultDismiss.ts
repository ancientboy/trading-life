/** 跨组件挂载周期记住已展示/已关闭的竞技结算，避免面板重挂载后重复弹窗 */

const shownPk = new Set<string>();
const shownGuess = new Set<string>();
const shownArena = new Set<string>();
const dismissedPk = new Set<string>();
const dismissedGuess = new Set<string>();
const dismissedArena = new Set<string>();

function cap(set: Set<string>, max = 64) {
  if (set.size <= max) return;
  const keep = [...set].slice(-max);
  set.clear();
  keep.forEach(id => set.add(id));
}

export function shouldShowPkResult(roundId: string): boolean {
  return !shownPk.has(roundId) && !dismissedPk.has(roundId);
}

export function markPkResultShown(roundId: string) {
  shownPk.add(roundId);
  cap(shownPk);
}

export function dismissPkResult(roundId: string) {
  dismissedPk.add(roundId);
  shownPk.add(roundId);
  cap(dismissedPk);
  cap(shownPk);
}

export function shouldShowGuessResult(roundId: string): boolean {
  return !shownGuess.has(roundId) && !dismissedGuess.has(roundId);
}

export function markGuessResultShown(roundId: string) {
  shownGuess.add(roundId);
  cap(shownGuess);
}

export function dismissGuessResult(roundId: string) {
  dismissedGuess.add(roundId);
  shownGuess.add(roundId);
  cap(dismissedGuess);
  cap(shownGuess);
}

export function shouldShowArenaResult(roundId: string): boolean {
  return !shownArena.has(roundId) && !dismissedArena.has(roundId);
}

export function markArenaResultShown(roundId: string) {
  shownArena.add(roundId);
  cap(shownArena);
}

export function dismissArenaResult(roundId: string) {
  dismissedArena.add(roundId);
  shownArena.add(roundId);
  cap(dismissedArena);
  cap(shownArena);
}

import type { ArenaRoundState, GuessRoundState } from './lifeEngagementApi';

export type GuessPhase = 'betting' | 'locked' | 'settled';

export function liveGuessRound(guess: GuessRoundState, syncedAtMs: number, nowMs = Date.now()): GuessRoundState {
  const elapsed = Math.max(0, Math.floor((nowMs - syncedAtMs) / 1000));
  const seconds_left = Math.max(0, guess.seconds_left - elapsed);
  const bet_seconds_left = Math.max(0, (guess.bet_seconds_left ?? 0) - elapsed);
  const betting_open = bet_seconds_left > 0 && guess.status === 'open';
  return { ...guess, seconds_left, bet_seconds_left, betting_open };
}

export function guessPhase(guess: GuessRoundState): GuessPhase {
  if (guess.status === 'settled') return 'settled';
  if (guess.betting_open) return 'betting';
  return 'locked';
}

export function guessPhaseLabel(guess: GuessRoundState): string {
  const phase = guessPhase(guess);
  if (phase === 'betting') return `押注中 · ${guess.bet_seconds_left ?? guess.seconds_left}s`;
  if (phase === 'locked') return `封盘 · ${guess.seconds_left}s 后结算`;
  return '已结算';
}

export function liveArenaRound(arena: ArenaRoundState, syncedAtMs: number, nowMs = Date.now()): ArenaRoundState {
  const elapsed = Math.max(0, Math.floor((nowMs - syncedAtMs) / 1000));
  const seconds_left = Math.max(0, arena.seconds_left - elapsed);
  const join_seconds_left = Math.max(0, arena.join_seconds_left - elapsed);
  const can_join = arena.status === 'join' && join_seconds_left > 0
    && (arena.entries?.length ?? 0) < 12 && !arena.my_entry;
  return { ...arena, seconds_left, join_seconds_left, can_join };
}

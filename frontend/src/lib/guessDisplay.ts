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

/** 大赛阶段文案（含本地倒计时到 0 时的「结算中」） */
export function arenaPhaseLabel(arena: ArenaRoundState): string {
  if (arena.status === 'join') {
    const j = arena.join_seconds_left ?? 0;
    return j > 0 ? `报名中 · ${j}s` : '即将开赛…';
  }
  if (arena.status === 'running') {
    const s = arena.seconds_left ?? 0;
    return s > 0 ? `进行中 · ${s}s` : '结算中…';
  }
  return '结算中';
}

export function arenaNeedsServerRefresh(arena: ArenaRoundState): boolean {
  if (arena.status === 'join') return (arena.join_seconds_left ?? 0) <= 0;
  if (arena.status === 'running') return (arena.seconds_left ?? 0) <= 0;
  return false;
}

/** 本局进度（1 报名 → 2 比赛 → 3 结算/下一局） */
export function arenaRoundStep(arena: ArenaRoundState): 1 | 2 | 3 {
  if (arena.status === 'join') return 1;
  if (arena.status === 'running' && (arena.seconds_left ?? 0) > 0) return 2;
  return 3;
}

export function arenaParticipationHint(arena: ArenaRoundState): string {
  if (arena.my_entry) {
    if (arena.status === 'join') return '已报名 · 等待报名截止后自动开赛，无需再点进入';
    if (arena.status === 'running' && (arena.seconds_left ?? 0) > 0) {
      return '比赛中 · Agent 每 30s 自动换向交易，下方可看各轮操作';
    }
    return '本局结束结算中 · 稍后会自动开下一局报名';
  }
  if (arena.can_join) return '尚未报名 · 点下方绿色按钮，或点场景空选手台上的「报名」';
  return '本局报名已截止 · 等待本局结束后再报下一局';
}

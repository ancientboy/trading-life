import { describe, expect, it } from 'vitest';
import { guessPhaseLabel, liveGuessRound } from './guessDisplay';
import type { GuessRoundState } from './lifeEngagementApi';

const base: GuessRoundState = {
  round_id: 'r1', symbol: 'BTCUSDT', start_price: 60000, status: 'open',
  pool_up: 0, pool_down: 0, total_pool: 0, betting_open: true,
  bet_seconds_left: 40, seconds_left: 50, bets_count: 0,
};

describe('guessDisplay', () => {
  it('ticks countdown locally', () => {
    const synced = Date.now() - 5000;
    const live = liveGuessRound(base, synced);
    expect(live.bet_seconds_left).toBe(35);
    expect(live.seconds_left).toBe(45);
    expect(live.betting_open).toBe(true);
  });

  it('labels locked phase with settle countdown', () => {
    const locked = { ...base, betting_open: false, bet_seconds_left: 0, status: 'locked', seconds_left: 8 };
    expect(guessPhaseLabel(locked)).toBe('封盘 · 8s 后结算');
  });
});

import { describe, expect, it } from 'vitest';
import type { CharState } from './constants';
import { activityWallExpiry, hasFreeSeat, mergeLocalSeatOccupancy, seatNowMs } from './seatRegistry';

function mockChar(overrides: Partial<CharState> = {}): CharState {
  return {
    agentId: 'custom_1',
    x: 0, z: 0,
    pathQueue: [], pathIndex: 0, isWalking: false, destNode: 'bed_1',
    activity: 'massage', activityUntil: 0, activityStartedAt: 0,
    travelIntent: null, state: 'idle', stress: 0,
    moveTimer: 0, nextMoveTime: 0, facing: 'n',
    data: { id: 'custom_1', name: 'Test', color: '#fff', headwear: 'scarf', hatStyle: 'beanie', desc: '', strategy: '', market: '', interval: '', risk: '', agentType: 'entertainment', owner: 'user' },
    ...overrides,
  };
}

describe('activityWallExpiry', () => {
  it('maps performance-based activityUntil to wall clock', () => {
    const wall = 1_700_000_000_000;
    const perfStart = 5_000_000;
    const perfEnd = 5_010_000;
    const char = mockChar({ activityStartedAt: perfStart, activityUntil: perfEnd });
    expect(activityWallExpiry(char, wall)).toBe(wall + 10_000);
  });

  it('passes through unix activityUntil', () => {
    const until = 1_700_000_060_000;
    const char = mockChar({ activityUntil: until });
    expect(activityWallExpiry(char)).toBe(until);
  });
});

describe('mergeLocalSeatOccupancy', () => {
  it('treats server seats as free when until_ts is unix and now is wall clock', () => {
    const wall = seatNowMs();
    const server: Record<string, { user_id: string; agent_id: string; activity: string; until_ts: number }> = {
      bed_1: { user_id: 'u2', agent_id: 'custom_2', activity: 'massage', until_ts: wall - 1 },
    };
    expect(hasFreeSeat('massage', 'custom_1', server, wall)).toBe(true);
  });

  it('merges local agent with wall expiry from perf timers', () => {
    const wall = 1_700_000_000_000;
    const char = mockChar({
      destNode: 'bed_1',
      activityStartedAt: 1000,
      activityUntil: 11000,
    });
    const merged = mergeLocalSeatOccupancy({}, { custom_1: char }, wall);
    expect(merged.bed_1.until_ts).toBe(wall + 10_000);
  });
});

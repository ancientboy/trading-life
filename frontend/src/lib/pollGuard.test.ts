import { describe, expect, it, vi, afterEach } from 'vitest';
import { dedupeAsync, throttleAsync } from './pollGuard';

describe('pollGuard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dedupeAsync reuses in-flight promise', async () => {
    let calls = 0;
    const fn = () => new Promise<number>(resolve => {
      calls += 1;
      setTimeout(() => resolve(calls), 20);
    });
    const a = dedupeAsync('test-key', fn);
    const b = dedupeAsync('test-key', fn);
    expect(await a).toBe(1);
    expect(await b).toBe(1);
    expect(calls).toBe(1);
  });

  it('throttleAsync skips rapid re-entry', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = async () => { calls += 1; };
    await throttleAsync('throttle-key', 5000, fn);
    await throttleAsync('throttle-key', 5000, fn);
    expect(calls).toBe(1);
    vi.advanceTimersByTime(5001);
    await throttleAsync('throttle-key', 5000, fn);
    expect(calls).toBe(2);
  });
});

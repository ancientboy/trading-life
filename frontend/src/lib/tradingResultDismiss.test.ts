import { describe, expect, it } from 'vitest';
import {
  shouldShowPkResult, markPkResultShown, dismissPkResult,
} from './tradingResultDismiss';

describe('tradingResultDismiss', () => {
  it('blocks repeat PK modal after dismiss', () => {
    const rid = 'test-round-' + Math.random();
    expect(shouldShowPkResult(rid)).toBe(true);
    markPkResultShown(rid);
    expect(shouldShowPkResult(rid)).toBe(false);
    dismissPkResult(rid);
    expect(shouldShowPkResult(rid)).toBe(false);
  });
});
